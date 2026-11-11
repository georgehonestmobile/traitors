"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RoundStatus } from "@/lib/rounds";

export function RoundActions({ id, status, canClose = true }: { id: string; status: RoundStatus; canClose?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "close" | "cancel", prompt: string) {
    if (!window.confirm(prompt)) return;
    setBusy(action);
    setError(null);
    const res = await fetch(`/api/rounds/${id}/${action}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error || "Something went wrong.");
    setBusy(null);
    router.refresh();
  }

  if (status !== "open" && status !== "scheduled") return null;
  return (
    <div>
      <div className="actions">
        {status === "open" && canClose && (
          <button className="btn" disabled={!!busy} onClick={() => run("close", "Close voting now? Anyone who hasn't voted will miss out.")}>
            {busy === "close" ? "Closing…" : "Close voting now"}
          </button>
        )}
        <button className="btn danger" disabled={!!busy} onClick={() => run("cancel", "Cancel this round? Players will be told no vote is needed.")}>
          {busy === "cancel" ? "Cancelling…" : "Cancel round"}
        </button>
      </div>
      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  );
}
