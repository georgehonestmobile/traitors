import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getReveal, revealKey } from "@/lib/reveal";
import { revoteEntriesKey } from "@/lib/revote";
import { cancelRound, roundStatus } from "@/lib/rounds";
import { getStore, paperKey, rsvpKey } from "@/lib/store";

/** Delete a round. An active real round is cancelled first, so scheduled DMs are withdrawn. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const store = getStore();
  const round = await store.getRound(id);
  if (!round) return NextResponse.json({ ok: true });
  const status = roundStatus(round);
  if (!round.test && (status === "open" || status === "scheduled")) {
    try {
      await cancelRound(id);
    } catch (e) {
      console.error(e);
    }
  }
  const reveal = await getReveal(id);
  await store.deleteRound(id, [revealKey(id), rsvpKey(id), paperKey(id), ...(reveal ? [revoteEntriesKey(id, reveal.runId)] : [])]);
  return NextResponse.json({ ok: true });
}
