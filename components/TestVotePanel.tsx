"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Player } from "@/lib/store";
import { Avatar } from "./Avatar";

/** Test rounds only: cast votes on behalf of players. */
export function TestVotePanel({ roundId, players, votedIds }: { roundId: string; players: Player[]; votedIds: string[] }) {
  const router = useRouter();
  const remaining = players.filter((p) => !votedIds.includes(p.id));
  const [voterId, setVoterId] = useState(remaining[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Once the chosen voter has voted, move on to the next player who hasn't.
  useEffect(() => {
    if (!remaining.some((p) => p.id === voterId)) setVoterId(remaining[0]?.id ?? "");
  }, [remaining, voterId]);

  async function send(body: Record<string, unknown>, success: (n: number) => string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rounds/${roundId}/test-vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setNote(success(data.recorded ?? 0));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const name = (id: string) => players.find((p) => p.id === id)?.name ?? "";

  return (
    <section className="panel test">
      <h2 className="panel-title">🧪 Vote as a player</h2>
      <p className="panel-sub">Test round: choose who&apos;s voting, then click who they vote for.</p>

      {error && <div className="error">{error}</div>}
      {note && <p className="done-note">✓ {note}</p>}

      {remaining.length === 0 ? (
        <div className="summary">Everyone has voted. Use <b>Close voting now</b> at the top, then run the reveal.</div>
      ) : (
        <>
          <div className="field">
            <label className="label" htmlFor="voter">
              <span>Voting as</span>
              <strong>{remaining.length} still to vote</strong>
            </label>
            <select id="voter" value={voterId} onChange={(e) => setVoterId(e.target.value)} disabled={busy}>
              {remaining.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <div className="label"><span>{name(voterId)} votes for</span></div>
            <div className="target-grid">
              {players.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="player"
                  disabled={busy || !voterId}
                  onClick={() => send({ voterId, targetId: p.id }, () => `${name(voterId)} voted for ${p.name}`)}
                >
                  <Avatar player={p} />
                  <span className="name">{p.id === voterId ? `${p.name} (self)` : p.name}</span>
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="btn ghost small"
            disabled={busy}
            onClick={() => send({ action: "random" }, (n) => `Filled in ${n} random ${n === 1 ? "vote" : "votes"}`)}
          >
            🎲 Fill in the rest randomly
          </button>
        </>
      )}
    </section>
  );
}
