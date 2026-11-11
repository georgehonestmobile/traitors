/** Client helper for the game admin API. Throws with the server's message on failure. */
export async function gameAction(body: Record<string, unknown>) {
  const res = await fetch("/api/game", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
}
