"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { meetingAction } from "./meetingApi";

/**
 * Meeting banishments: enter an office voter's paper vote as they reveal it.
 * `kind` "tiebreak": their paper vote in a tiebreak re-vote (the tied players only).
 */
export function PaperVoteSelect({
  roundId,
  voterId,
  targetId,
  players,
  kind = "paper",
}: {
  kind?: "paper" | "tiebreak";
  roundId: string;
  voterId: string;
  /** Entered so far: a player id, null for blank, undefined if not yet. */
  targetId?: string | null;
  players: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const value = targetId === undefined ? "" : targetId === null ? "blank" : targetId;

  async function change(v: string) {
    setBusy(true);
    try {
      const chosen = v === "blank" ? null : v;
      if (kind === "tiebreak") {
        const res = await fetch(`/api/rounds/${roundId}/reveal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "revote-paper", voterId, targetId: chosen }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Something went wrong.");
      } else {
        await meetingAction(roundId, { action: "paper", voterId, targetId: chosen });
      }
      router.refresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      className={`paper-select${value ? " set" : ""}`}
      value={value}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
      aria-label={kind === "tiebreak" ? "Their tiebreak paper vote" : "Their paper vote"}
    >
      {!value && <option value="" disabled>{kind === "tiebreak" ? "⚖️ Tiebreak vote…" : "📝 Paper vote…"}</option>}
      {players.map((p) => (
        <option key={p.id} value={p.id}>{p.id === voterId ? `${p.name} (self)` : p.name}</option>
      ))}
      <option value="blank">Blank / no vote</option>
    </select>
  );
}
