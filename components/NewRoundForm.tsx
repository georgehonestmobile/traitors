"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Player } from "@/lib/store";
import { Avatar } from "./Avatar";

/** "YYYY-MM-DDTHH:mm" in the browser's local time, for <input type="datetime-local"> */
function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DURATIONS = [
  { label: "15 min", mins: 15 },
  { label: "30 min", mins: 30 },
  { label: "1 hr", mins: 60 },
  { label: "3 hr", mins: 180 },
  { label: "24 hr", mins: 1440 },
];

const fmt = (d: Date) =>
  d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Mirrors the server: RSVPs 9am–5pm the day before (local time), or now + 1 hour if that's passed. */
function rsvpPreview(meeting: Date) {
  const now = Date.now();
  const day = new Date(meeting.getFullYear(), meeting.getMonth(), meeting.getDate() - 1);
  let opens = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9).getTime();
  let closes = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 17).getTime();
  const now_ = opens < now;
  if (now_) opens = now;
  if (closes <= opens) closes = opens + 60 * 60 * 1000;
  if (closes > meeting.getTime()) closes = meeting.getTime();
  return { opensNow: now_, opens: new Date(opens), closes: new Date(closes) };
}

export function NewRoundForm({
  players,
  lastRoundPlayerIds,
  banishedIds,
  preselectedIds = [],
}: {
  players: Player[];
  lastRoundPlayerIds: string[];
  banishedIds: string[];
  /** Ticked when the form opens (the players still in the game). */
  preselectedIds?: string[];
}) {
  const banished = new Set(banishedIds);
  const canPlay = (id: string) => !banished.has(id);
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preselectedIds.filter((id) => !banishedIds.includes(id))));
  const [openNow, setOpenNow] = useState(true);
  const [test, setTest] = useState(false);
  const [format, setFormat] = useState<"meeting" | "remote">("meeting");
  const [meetingAt, setMeetingAt] = useState("");
  // Times depend on the browser's clock and timezone, so fill them in after mount.
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  useEffect(() => {
    setOpensAt(toLocalInput(new Date(Date.now() + 60 * 60 * 1000)));
    setClosesAt(toLocalInput(new Date(Date.now() + 30 * 60 * 1000)));
    const t = new Date();
    setMeetingAt(toLocalInput(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1, 10)));
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? players.filter((p) => p.name.toLowerCase().includes(q)) : players;
  }, [players, query]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openDate = openNow ? new Date() : new Date(opensAt);
  const closeDate = new Date(closesAt);
  const setDuration = (mins: number) => setClosesAt(toLocalInput(new Date(openDate.getTime() + mins * 60000)));

  const meeting = format === "meeting";
  const meetingDate = new Date(meetingAt);
  const meetingValid = !Number.isNaN(meetingDate.getTime()) && meetingDate.getTime() > Date.now();
  const rsvp = meetingValid ? rsvpPreview(meetingDate) : null;
  const valid =
    selected.size >= 2 && (meeting ? meetingValid : !Number.isNaN(closeDate.getTime()) && closeDate > openDate);
  const selectedNames = players.filter((p) => selected.has(p.id)).map((p) => p.name);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rounds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          playerIds: [...selected],
          opensAt: openNow ? undefined : new Date(opensAt).toISOString(),
          closesAt: meeting ? undefined : closeDate.toISOString(),
          test,
          format,
          meetingAt: meeting ? meetingDate.toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't create the round.");
      router.push(`/rounds/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <h2 className="panel-title">Call a vote</h2>
      <p className="panel-sub">Each selected player gets a private Slack DM and can vote for any selected player.</p>

      <div className="field">
        <div className="label"><span>Format</span></div>
        <div className="chips">
          <button type="button" className={`chip${meeting ? " on" : ""}`} onClick={() => setFormat("meeting")}>🗣️ Meeting banishment</button>
          <button type="button" className={`chip${!meeting ? " on" : ""}`} onClick={() => setFormat("remote")}>💬 Remote (Slack)</button>
        </div>
        <p className="hint">
          {meeting
            ? "Players are asked the day before (9am, reply by 5pm) if they'll be at the meeting. Those who can't come vote in advance; everyone else votes in the meeting, with one minute, when you request votes."
            : "Players vote in Slack over a window you set. Afterwards you announce the results in a Slack channel (or face to face)."}
        </p>
      </div>

      <div className="field">
        <label className="label" htmlFor="title">Round name</label>
        <input id="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Night 3: Banishment" maxLength={100} />
      </div>

      <div className="field">
        <div className="label"><span>Mode</span></div>
        <div className="chips">
          <button type="button" className={`chip${!test ? " on" : ""}`} onClick={() => setTest(false)}>Real round</button>
          <button type="button" className={`chip${test ? " on" : ""}`} onClick={() => setTest(true)}>🧪 Test round</button>
        </div>
        {test && (
          <p className="hint">Nobody is DM&apos;d. You cast votes on players&apos; behalf from the round page, then run the reveal as normal.</p>
        )}
      </div>

      <div className="field">
        <div className="label">
          <span>Players</span>
          <strong>{selected.size} selected</strong>
        </div>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Slack members…" aria-label="Search players" />
        <div className="chips" style={{ marginTop: 10 }}>
          <button type="button" className="chip" onClick={() => setSelected(new Set(visible.map((p) => p.id).filter(canPlay)))}>
            Select {query ? "shown" : "all"}
          </button>
          {lastRoundPlayerIds.length > 0 && (
            <button type="button" className="chip" onClick={() => setSelected(new Set(lastRoundPlayerIds.filter((id) => canPlay(id) && players.some((p) => p.id === id))))}>
              Same as last round
            </button>
          )}
          <button type="button" className="chip" onClick={() => setSelected(new Set())} disabled={!selected.size}>
            Clear
          </button>
        </div>
        <div className="players" role="group" aria-label="Players">
          {visible.map((p) => {
            if (banished.has(p.id)) {
              return (
                <button
                  type="button"
                  key={p.id}
                  className="player banished"
                  disabled
                  aria-label={`${p.name}, out of the game`}
                  title={`${p.name} is out of this game`}
                >
                  <Avatar player={p} />
                  <span className="name">{p.name}</span>
                  <span className="tick" aria-hidden>🗡</span>
                </button>
              );
            }
            const on = selected.has(p.id);
            return (
              <button type="button" key={p.id} className={`player${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggle(p.id)}>
                <Avatar player={p} />
                <span className="name">{p.name}</span>
                <span className="tick">{on ? "✓" : ""}</span>
              </button>
            );
          })}
          {!visible.length && <div className="empty">No one matches “{query}”.</div>}
        </div>
      </div>

      {meeting && (
        <div className="field">
          <label className="label" htmlFor="meeting-at"><span>Meeting starts</span></label>
          <input id="meeting-at" type="datetime-local" value={meetingAt} onChange={(e) => setMeetingAt(e.target.value)} required />
        </div>
      )}

      {!meeting && (<>
      <div className="field">
        <div className="label"><span>Voting opens</span></div>
        <div className="chips" style={{ marginBottom: openNow ? 0 : 10 }}>
          <button type="button" className={`chip${openNow ? " on" : ""}`} onClick={() => setOpenNow(true)}>Now</button>
          <button type="button" className={`chip${!openNow ? " on" : ""}`} onClick={() => setOpenNow(false)}>At a set time</button>
        </div>
        {!openNow && (
          <input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} aria-label="Voting opens at" required />
        )}
      </div>

      <div className="field">
        <div className="label"><span>Voting closes (strict deadline)</span></div>
        <div className="chips" style={{ marginBottom: 10 }}>
          {DURATIONS.map((d) => (
            <button type="button" key={d.mins} className="chip" onClick={() => setDuration(d.mins)}>
              +{d.label}
            </button>
          ))}
        </div>
        <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} aria-label="Voting closes at" required />
      </div>
      </>)}

      {error && <div className="error">{error}</div>}

      <div className="summary">
        {!closesAt ? (
          "\u00a0"
        ) : selected.size < 2 ? (
          "Pick at least two players."
        ) : meeting ? (
          !rsvp ? (
            "Choose a meeting time in the future."
          ) : (
            <>
              {test ? <>🧪 Test round: nobody is DM&apos;d. </> : null}
              Meeting <b>{fmt(meetingDate)}</b> with{" "}
              <b>{selectedNames.length <= 4 ? selectedNames.join(", ") : `${selected.size} players`}</b>.
              {!test && (
                <>
                  {" "}RSVPs go out <b>{rsvp.opensNow ? "now" : fmt(rsvp.opens)}</b>, replies by <b>{fmt(rsvp.closes)}</b>.
                </>
              )}
            </>
          )
        ) : closeDate <= openDate ? (
          "The deadline needs to be after voting opens."
        ) : (
          <>
            {test ? <>🧪 Test round with </> : null}
            <b>{selectedNames.length <= 4 ? selectedNames.join(", ") : `${selected.size} players`}</b>
            {test ? <>. Nobody is DM&apos;d; voting opens </> : <> will be DM&apos;d </>}
            {openNow ? <b>now</b> : <>at <b>{fmt(openDate)}</b></>}. Voting closes <b>{fmt(closeDate)}</b>.
          </>
        )}
      </div>

      <button className="btn primary block" type="submit" disabled={!valid || busy}>
        {busy
          ? "Creating…"
          : test
            ? "Create test round"
            : meeting
              ? rsvp?.opensNow
                ? "Send the RSVPs"
                : "Schedule the RSVPs"
              : openNow
                ? "Send the ballots"
                : "Schedule the ballots"}
      </button>
    </form>
  );
}
