"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Player } from "@/lib/store";
import { Avatar } from "./Avatar";
import { meetingAction } from "./meetingApi";

/** Meeting banishments: the host enters the office's paper votes. */
export function PaperVotePanel({
  roundId,
  players,
  officeIds,
  votedIds,
  paperVotes,
  locked,
}: {
  roundId: string;
  players: Player[];
  /** In the office: listed first. */
  officeIds: string[];
  votedIds: string[];
  paperVotes: { voterId: string; targetId: string }[];
  /** The reveal has started. */
  locked: boolean;
}) {
  const router = useRouter();
  const office = new Set(officeIds);
  const remaining = players
    .filter((p) => !votedIds.includes(p.id))
    .sort((a, b) => Number(office.has(b.id)) - Number(office.has(a.id)));
  const officeLeft = remaining.filter((p) => office.has(p.id)).length;
  const [voterId, setVoterId] = useState(remaining[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!remaining.some((p) => p.id === voterId)) setVoterId(remaining[0]?.id ?? "");
  }, [remaining, voterId]);

  const name = (id: string) => players.find((p) => p.id === id)?.name ?? "Unknown";

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await meetingAction(roundId, body);
      setNote(done);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel paper">
      <h2 className="panel-title">📝 Paper votes</h2>
      <p className="panel-sub">
        Enter the office&apos;s paper votes before you start the script, so they&apos;re counted and you can check what each
        person says against their paper.
      </p>

      {error && <div className="error">{error}</div>}
      {note && <p className="done-note">✓ {note}</p>}

      {locked ? (
        <p className="hint">The reveal has started, so paper votes can&apos;t change. Reset the reveal to change them.</p>
      ) : remaining.length === 0 ? (
        <div className="summary">Everyone has voted.</div>
      ) : (
        <>
          <div className="field">
            <label className="label" htmlFor="paper-voter">
              <span>Paper from</span>
              <strong>{officeLeft ? `${officeLeft} in the office still to enter` : "Office all entered"}</strong>
            </label>
            <select id="paper-voter" value={voterId} onChange={(e) => setVoterId(e.target.value)} disabled={busy}>
              {remaining.map((p) => (
                <option key={p.id} value={p.id}>{office.has(p.id) ? `🏢 ${p.name}` : `${p.name} (not in the office)`}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <div className="label"><span>{name(voterId)} voted for</span></div>
            <div className="target-grid">
              {players.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="player"
                  disabled={busy || !voterId}
                  onClick={() => send({ action: "paper", voterId, targetId: p.id }, `${name(voterId)}: ${p.name}`)}
                >
                  <Avatar player={p} />
                  <span className="name">{p.id === voterId ? `${p.name} (self)` : p.name}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {paperVotes.length > 0 && (
        <ul className="paper-list">
          {paperVotes.map((v) => (
            <li key={v.voterId}>
              <span>{name(v.voterId)} → <b>{name(v.targetId)}</b></span>
              {!locked && (
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={busy}
                  onClick={() => send({ action: "paper-undo", voterId: v.voterId }, `Removed ${name(v.voterId)}'s paper vote`)}
                >
                  Undo
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
