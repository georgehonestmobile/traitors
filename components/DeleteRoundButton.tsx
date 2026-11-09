"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteRoundButton({ id, title, active, redirectHome }: { id: string; title: string; active: boolean; redirectHome?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    const warning = active ? "\n\nVoting is still live: players' ballots will be withdrawn." : "";
    if (!window.confirm(`Delete “${title}”? Its votes and reveal are deleted too. This can't be undone.${warning}`)) return;
    setBusy(true);
    const res = await fetch(`/api/rounds/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return window.alert("Couldn't delete the round.");
    if (redirectHome) router.push("/");
    router.refresh();
  }

  return (
    <button type="button" className="btn danger small" disabled={busy} onClick={remove}>
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}
