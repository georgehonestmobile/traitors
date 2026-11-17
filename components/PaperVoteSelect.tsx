"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { meetingAction } from "./meetingApi";

/** Meeting banishments: enter an office voter's paper vote as they reveal it. */
export function PaperVoteSelect({
  roundId,
  voterId,
  targetId,
  players,
}: {
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
      await meetingAction(roundId, { action: "paper", voterId, targetId: v === "blank" ? null : v });
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
      aria-label="Their paper vote"
    >
      {!value && <option value="" disabled>📝 Paper vote…</option>}
      {players.map((p) => (
        <option key={p.id} value={p.id}>{p.id === voterId ? `${p.name} (self)` : p.name}</option>
      ))}
      <option value="blank">Blank / no vote</option>
    </select>
  );
}
