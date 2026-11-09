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

export function NewRoundForm({ players, lastRoundPlayerIds }: { players: Player[]; lastRoundPlayerIds: string[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openNow, setOpenNow] = useState(true);
  // Times depend on the browser's clock and timezone, so fill them in after mount.
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  useEffect(() => {
    setOpensAt(toLocalInput(new Date(Date.now() + 60 * 60 * 1000)));
    setClosesAt(toLocalInput(new Date(Date.now() + 30 * 60 * 1000)));
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

  const valid = selected.size >= 2 && !Number.isNaN(closeDate.getTime()) && closeDate > openDate;
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
          closesAt: closeDate.toISOString(),
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
        <label className="label" htmlFor="title">Round name</label>
        <input id="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Night 3: Banishment" maxLength={100} />
      </div>

      <div className="field">
        <div className="label">
          <span>Players</span>
          <strong>{selected.size} selected</strong>
        </div>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Slack members…" aria-label="Search players" />
        <div className="chips" style={{ marginTop: 10 }}>
          <button type="button" className="chip" onClick={() => setSelected(new Set(visible.map((p) => p.id)))}>
            Select {query ? "shown" : "all"}
          </button>
          {lastRoundPlayerIds.length > 0 && (
            <button type="button" className="chip" onClick={() => setSelected(new Set(lastRoundPlayerIds.filter((id) => players.some((p) => p.id === id))))}>
              Same as last round
            </button>
          )}
          <button type="button" className="chip" onClick={() => setSelected(new Set())} disabled={!selected.size}>
            Clear
          </button>
        </div>
        <div className="players" role="group" aria-label="Players">
          {visible.map((p) => {
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

      {error && <div className="error">{error}</div>}

      <div className="summary">
        {!closesAt ? (
          "\u00a0"
        ) : selected.size < 2 ? (
          "Pick at least two players."
        ) : closeDate <= openDate ? (
          "The deadline needs to be after voting opens."
        ) : (
          <>
            <b>{selectedNames.length <= 4 ? selectedNames.join(", ") : `${selected.size} players`}</b> will be DM&apos;d{" "}
            {openNow ? <b>now</b> : <>at <b>{fmt(openDate)}</b></>}. Voting closes <b>{fmt(closeDate)}</b>.
          </>
        )}
      </div>

      <button className="btn primary block" type="submit" disabled={!valid || busy}>
        {busy ? "Sending…" : openNow ? "Send the ballots" : "Schedule the ballots"}
      </button>
    </form>
  );
}
