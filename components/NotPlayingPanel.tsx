"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Player } from "@/lib/store";

/** People who are never selectable (e.g. the host). */
export function NotPlayingPanel({ hidden, others }: { hidden: Player[]; others: Player[] }) {
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);

  async function set(playerId: string, notPlaying: boolean) {
    setBusy(true);
    const res = await fetch("/api/not-playing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, notPlaying }),
    });
    setBusy(false);
    if (!res.ok) return window.alert("Couldn't update the list.");
    setPick("");
    router.refresh();
  }

  return (
    <details className="panel not-playing">
      <summary>
        <h2 className="panel-title">Not playing</h2>
        <span className="muted">{hidden.length} hidden from every game</span>
      </summary>
      <p className="panel-sub" style={{ marginTop: 10 }}>These people never appear in the player list.</p>
      <div className="chips">
        {hidden.map((p) => (
          <span key={p.id} className="tag">
            {p.name}
            <button type="button" aria-label={`Show ${p.name} again`} title="Show in the player list again" disabled={busy} onClick={() => set(p.id, false)}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="inline" style={{ marginTop: 12 }}>
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Person to hide">
          <option value="">Hide someone…</option>
          {others.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button type="button" className="btn small" disabled={!pick || busy} onClick={() => set(pick, true)}>Hide</button>
      </div>
    </details>
  );
}
