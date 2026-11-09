"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Banished } from "@/lib/game";
import type { Player } from "@/lib/store";

type Props = { name: string; startedAt: string; banished: Banished[]; candidates: Player[]; nextName: string };

export function GamePanel({ name, startedAt, banished, candidates, nextName }: Props) {
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [newName, setNewName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/game", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="reveal-head">
        <h2 className="panel-title">{name}</h2>
        {newName === null && (
          <button type="button" className="btn ghost small" onClick={() => setNewName(nextName)}>New game</button>
        )}
      </div>
      <p className="panel-sub">Started {startedAt}. Banished players can&apos;t be picked again in this game.</p>

      {newName !== null && (
        <form
          className="new-game"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await send({ action: "new", name: newName })) setNewName(null);
          }}
        >
          <p className="hint" style={{ marginTop: 0 }}>A new game brings everyone back. Old rounds are kept under “Earlier rounds”.</p>
          <div className="inline">
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New game name" maxLength={60} autoFocus />
            <button className="btn primary small" type="submit" disabled={busy}>Start</button>
            <button className="btn ghost small" type="button" onClick={() => setNewName(null)}>Cancel</button>
          </div>
        </form>
      )}

      {error && <div className="error">{error}</div>}

      <div className="label"><span>Banished</span><strong>{banished.length}</strong></div>
      {banished.length === 0 ? (
        <p className="hint" style={{ marginTop: 0 }}>Nobody yet.</p>
      ) : (
        <div className="chips" style={{ marginBottom: 4 }}>
          {banished.map((b) => (
            <span key={b.playerId} className="tag">
              {b.name}
              {!b.roundId && <span className="muted"> (added)</span>}
              <button
                type="button"
                aria-label={`Bring ${b.name} back`}
                title="Bring back into the game"
                disabled={busy}
                onClick={() => window.confirm(`Bring ${b.name} back into ${name}?`) && send({ action: "unbanish", playerId: b.playerId })}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="inline" style={{ marginTop: 12 }}>
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Player to mark as banished">
          <option value="">Mark someone as banished…</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button
          type="button"
          className="btn small"
          disabled={!pick || busy}
          onClick={async () => {
            if (await send({ action: "banish", playerId: pick })) setPick("");
          }}
        >
          Banish
        </button>
      </div>
    </section>
  );
}
