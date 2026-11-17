import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { askHowJoining, finishMeetingVote, recordPaperVote, removePaperVote, requestVotes, setAttendance } from "@/lib/meeting";
import { RoundError } from "@/lib/rounds";

/**
 * Body: { action }
 *   request | finish | end-now      the one-minute vote
 *   ask-join                        DM attendees who haven't said whether they're in the office or dialling in
 *   attendance { playerId, join }   the host sets how someone is joining ("office" | "dial-in")
 *   paper { voterId, targetId }     enter a paper vote      paper-undo { voterId }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "request") await requestVotes(id);
    else if (body.action === "finish") await finishMeetingVote(id);
    else if (body.action === "end-now") await finishMeetingVote(id, { now: true });
    else if (body.action === "ask-join") return NextResponse.json({ ok: true, ...(await askHowJoining(id)) });
    else if (body.action === "attendance") {
      if (body.join !== "office" && body.join !== "dial-in") return NextResponse.json({ error: "Choose office or dialling in." }, { status: 400 });
      await setAttendance(id, String(body.playerId ?? ""), body.join);
    } else if (body.action === "paper") await recordPaperVote(id, String(body.voterId ?? ""), String(body.targetId ?? ""));
    else if (body.action === "paper-undo") await removePaperVote(id, String(body.voterId ?? ""));
    else return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = e instanceof RoundError ? 400 : 500;
    if (status === 500) console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status });
  }
}
