import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { castVote, type VoteOutcome } from "@/lib/rounds";
import { getStore } from "@/lib/store";

const EXPLAIN: Record<Exclude<VoteOutcome, "recorded">, string> = {
  already: "That player has already voted.",
  closed: "Voting has closed for this round.",
  not_open: "Voting hasn't opened yet.",
  cancelled: "This round was cancelled.",
  ineligible: "Both players must be in this round.",
};

/**
 * Test rounds only: the host casts votes on behalf of players.
 * Body: { voterId, targetId } for one vote, or { action: "random" } to fill in everyone left.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const store = getStore();
  const round = await store.getRound(id);
  if (!round) return NextResponse.json({ error: "Round not found." }, { status: 404 });
  if (!round.test) return NextResponse.json({ error: "Only test rounds allow voting on behalf of players." }, { status: 400 });

  const body = await req.json().catch(() => ({}));

  if (body.action === "random") {
    const voted = new Set((await store.getVotes(id)).map((v) => v.voterId));
    let recorded = 0;
    for (const p of round.players.filter((p) => !voted.has(p.id))) {
      const target = round.players[Math.floor(Math.random() * round.players.length)];
      const r = await castVote({ roundId: id, voterId: p.id, targetId: target.id });
      if (r.outcome === "recorded") recorded++;
      else if (r.outcome !== "already") return NextResponse.json({ error: EXPLAIN[r.outcome] }, { status: 400 });
    }
    return NextResponse.json({ recorded });
  }

  const r = await castVote({ roundId: id, voterId: String(body.voterId ?? ""), targetId: String(body.targetId ?? "") });
  if (r.outcome !== "recorded") return NextResponse.json({ error: EXPLAIN[r.outcome] }, { status: 400 });
  return NextResponse.json({ recorded: 1 });
}
