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
  defaults,
}: {
  players: Player[];
  lastRoundPlayerIds: string[];
  banishedIds: string[];
  /** Ticked when the form opens (the players still in the game). */
  preselectedIds?: string[];
  /** Pre-filled when setting up a scheduled banishment. */
  defaults?: { title?: string; format?: "meeting" | "remote"; meetingDate?: string; scheduleId?: string };
}) {
  const banished = new Set(banishedIds);
  const canPlay = (id: string) => !banished.has(id);
  const router = useRouter();
  const [title, setTitle] = useState(defaults?.title ?? "");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preselectedIds.filter((id) => !banishedIds.includes(id))));
  const [openNow, setOpenNow] = useState(true);
  const [test, setTest] = useState(false);
  const [format, setFormat] = useState<"meeting" | "remote">(defaults?.format ?? "meeting");
  const [meetingAt, setMeetingAt] = useState("");
  const [virtual, setVirtual] = useState(false);
  // Remote rounds: ask first whether players can vote in the window.
  const [askFirst, setAskFirst] = useState(false);
  const [rsvpBy, setRsvpBy] = useState("");
  // Times depend on the browser's clock and timezone, so fill them in after mount.
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  useEffect(() => {
    setOpensAt(toLocalInput(new Date(Date.now() + 60 * 60 * 1000)));
    setClosesAt(toLocalInput(new Date(Date.now() + 30 * 60 * 1000)));
    const t = new Date();
    setMeetingAt(
      defaults?.meetingDate
        ? `${defaults.meetingDate}T10:00`
        : toLocalInput(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1, 10)),
    );
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

  const asking = format === "remote" && askFirst;
  const openDate = openNow && !asking ? new Date() : new Date(opensAt);
  const rsvpDate = new Date(rsvpBy);
  const rsvpError = !asking
    ? null
    : Number.isNaN(rsvpDate.getTime())
      ? "Choose when RSVP replies close."
      : rsvpDate.getTime() - Date.now() < 5 * 60 * 1000
        ? "Give players at least five minutes to reply to the RSVP."
        : rsvpDate > openDate
          ? "RSVP replies must close before voting opens."
          : null;
  function turnOnRsvp() {
    setAskFirst(true);
    setOpenNow(false);
    const opens = new Date(opensAt).getTime();
    const by = Math.max(Date.now() + 60 * 60 * 1000, (Number.isNaN(opens) ? Date.now() : opens) - 6 * 60 * 60 * 1000);
    setRsvpBy(toLocalInput(new Date(by)));
  }
  const closeDate = new Date(closesAt);
  const setDuration = (mins: number) => setClosesAt(toLocalInput(new Date(openDate.getTime() + mins * 60000)));

  const meeting = format === "meeting";
  const meetingDate = new Date(meetingAt);
  const meetingValid = !Number.isNaN(meetingDate.getTime()) && meetingDate.getTime() > Date.now();
  const rsvp = meetingValid ? rsvpPreview(meetingDate) : null;
  const valid =
    selected.size >= 2 && (meeting ? meetingValid : !Number.isNaN(closeDate.getTime()) && closeDate > openDate && !rsvpError);
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
          opensAt: openNow && !asking ? undefined : new Date(opensAt).toISOString(),
          rsvpClosesAt: asking ? rsvpDate.toISOString() : undefined,
          closesAt: meeting ? undefined : closeDate.toISOString(),
          test,
          format,
          meetingAt: meeting ? meetingDate.toISOString() : undefined,
          virtual: meeting && virtual,
          scheduleId: defaults?.scheduleId,
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
            ? "Players are asked the day before (9am, reply by 5pm) if they'll be at the meeting. Those who can't come vote in advance; everyone else votes in the meeting when you request votes."
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

      {meeting && (
        <div className="field">
          <div className="label"><span>Where</span></div>
          <div className="chips">
            <button type="button" className={`chip${!virtual ? " on" : ""}`} onClick={() => setVirtual(false)}>🏢💻 Office or dialling in</button>
            <button type="button" className={`chip${virtual ? " on" : ""}`} onClick={() => setVirtual(true)}>💻 Everyone dials in</button>
          </div>
          <p className="hint">
            {virtual
              ? "Players are only asked whether they're coming. Everyone at the meeting votes in Slack, with one minute."
              : "Attendees also say whether they'll be in the office (vote on paper) or dialling in (vote in Slack, with one minute)."}
          </p>
        </div>
      )}

      {!meeting && (<>
      <div className="field">
        <div className="label"><span>Ask first?</span></div>
        <div className="chips">
          <button type="button" className={`chip${!askFirst ? " on" : ""}`} onClick={() => setAskFirst(false)}>No, just send ballots</button>
          <button type="button" className={`chip${askFirst ? " on" : ""}`} onClick={turnOnRsvp}>📅 RSVP first</button>
        </div>
        <p className="hint">
          {askFirst
            ? "An RSVP goes out now asking if they can vote in the window. Anyone who can't gets a ballot straight away and votes in advance; everyone else gets theirs when voting opens."
            : "Players get their ballot when voting opens."}
        </p>
        {askFirst && (
          <>
            <div className="label" style={{ marginTop: 10 }}><span>RSVP replies by</span></div>
            <input type="datetime-local" value={rsvpBy} onChange={(e) => setRsvpBy(e.target.value)} aria-label="RSVP replies by" required />
          </>
        )}
      </div>

      <div className="field">
        <div className="label"><span>Voting opens</span></div>
        <div className="chips" style={{ marginBottom: openNow && !asking ? 0 : 10 }}>
          <button type="button" className={`chip${openNow && !asking ? " on" : ""}`} disabled={asking} onClick={() => setOpenNow(true)}>Now</button>
          <button type="button" className={`chip${!openNow || asking ? " on" : ""}`} onClick={() => setOpenNow(false)}>At a set time</button>
        </div>
        {(!openNow || asking) && (
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
              {virtual ? "All-virtual meeting" : "Meeting"} <b>{fmt(meetingDate)}</b> with{" "}
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
        ) : rsvpError ? (
          rsvpError
        ) : (
          <>
            {asking && !test ? <>An RSVP goes out <b>now</b>, replies by <b>{fmt(rsvpDate)}</b>. </> : null}
            {test ? <>🧪 Test round with </> : null}
            <b>{selectedNames.length <= 4 ? selectedNames.join(", ") : `${selected.size} players`}</b>
            {test ? <>. Nobody is DM&apos;d; voting opens </> : asking ? <> get their ballot </> : <> will be DM&apos;d </>}
            {openNow && !asking ? <b>now</b> : <>at <b>{fmt(openDate)}</b></>}. Voting closes <b>{fmt(closeDate)}</b>.
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
              : asking
                ? "Send the RSVPs"
                : openNow
                ? "Send the ballots"
                : "Schedule the ballots"}
      </button>
    </form>
  );
}
