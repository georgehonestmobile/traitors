"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { meetingAction } from "./meetingApi";

/** The host sets whether someone is in the office or dialling in (until votes are requested). */
export function AttendanceSelect({
  roundId,
  playerId,
  join,
  label,
}: {
  roundId: string;
  playerId: string;
  join?: "office" | "dial-in";
  /** Shown when they haven't said how they're joining. */
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function change(value: string) {
    setBusy(true);
    try {
      await meetingAction(roundId, { action: "attendance", playerId, join: value });
      router.refresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      className={`attendance ${join ?? "unset"}`}
      value={join ?? ""}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
      aria-label="How they're joining"
      title="Change how they're joining"
    >
      {!join && <option value="" disabled>{label}</option>}
      <option value="office">🏢 In the office</option>
      <option value="dial-in">💻 Dialling in</option>
    </select>
  );
}
