import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { finishMeetingVote, requestVotes } from "@/lib/meeting";
import { RoundError } from "@/lib/rounds";

/** Body: { action: "request" | "finish" | "end-now" } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "request") await requestVotes(id);
    else if (body.action === "finish") await finishMeetingVote(id);
    else if (body.action === "end-now") await finishMeetingVote(id, { now: true });
    else return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = e instanceof RoundError ? 400 : 500;
    if (status === 500) console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status });
  }
}
