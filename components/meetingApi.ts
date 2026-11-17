/** POST an action to a meeting round. Throws with the server's message on failure. */
export async function meetingAction(roundId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/rounds/${roundId}/meeting`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
