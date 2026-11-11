import { NextResponse } from "next/server";
import { recordRsvp } from "@/lib/meeting";
import { castVote } from "@/lib/rounds";
import { roundIdFromBlockId, roundIdFromRsvpBlockId, RSVP_NO, RSVP_YES, VOTE_ACTION_ID } from "@/lib/messages";
import { respond, verifySlackRequest } from "@/lib/slack";

/**
 * Slack "Interactivity" request URL. Slack calls this when a player picks someone
 * from a ballot in their DM, or answers a meeting RSVP.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const ok = verifySlackRequest(
    raw,
    req.headers.get("x-slack-request-timestamp"),
    req.headers.get("x-slack-signature"),
  );
  if (!ok) return new NextResponse("Invalid signature", { status: 401 });

  const payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "{}");
  if (payload.type !== "block_actions") return new NextResponse(null, { status: 200 });
  const userId: string = payload.user?.id;

  for (const action of payload.actions ?? []) {
    if (action.action_id === VOTE_ACTION_ID) {
      const roundId = roundIdFromBlockId(action.block_id ?? "");
      const targetId = action.selected_option?.value;
      if (!roundId || !targetId) continue;
      const { message } = await castVote({ roundId, voterId: userId, targetId });
      if (payload.response_url) await respond(payload.response_url, message);
    } else if (action.action_id === RSVP_YES || action.action_id === RSVP_NO) {
      const roundId = roundIdFromRsvpBlockId(action.block_id ?? "");
      if (!roundId) continue;
      const message = await recordRsvp(roundId, userId, action.action_id === RSVP_YES ? "yes" : "no");
      if (payload.response_url) await respond(payload.response_url, message);
    }
  }

  return new NextResponse(null, { status: 200 });
}
