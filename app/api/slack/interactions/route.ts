import { NextResponse } from "next/server";
import { recordRsvp, type RsvpChoice } from "@/lib/meeting";
import { castVote } from "@/lib/rounds";
import { castRevote } from "@/lib/revote";
import { REVOTE_ACTION_ID, roundIdFromBlockId, roundIdFromRevoteBlockId, roundIdFromRsvpBlockId, RSVP_DIAL_IN, RSVP_NO, RSVP_OFFICE, RSVP_YES, VOTE_ACTION_ID } from "@/lib/messages";
import { respond, verifySlackRequest } from "@/lib/slack";

/**
 * Slack "Interactivity" request URL. Slack calls this when a player picks someone
 * from a ballot in their DM (or a tiebreak ballot), or answers a meeting RSVP.
 */
const RSVP_CHOICES: Record<string, RsvpChoice> = {
  [RSVP_YES]: "yes",
  [RSVP_NO]: "no",
  [RSVP_OFFICE]: "office",
  [RSVP_DIAL_IN]: "dial-in",
};

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
    } else if (action.action_id === REVOTE_ACTION_ID) {
      const roundId = roundIdFromRevoteBlockId(action.block_id ?? "");
      const targetId = action.selected_option?.value;
      if (!roundId || !targetId) continue;
      const message = await castRevote(roundId, userId, targetId);
      if (payload.response_url) await respond(payload.response_url, message);
    } else if (Object.hasOwn(RSVP_CHOICES, action.action_id)) {
      const roundId = roundIdFromRsvpBlockId(action.block_id ?? "");
      if (!roundId) continue;
      const message = await recordRsvp(roundId, userId, RSVP_CHOICES[action.action_id]);
      if (payload.response_url) await respond(payload.response_url, message);
    }
  }

  return new NextResponse(null, { status: 200 });
}
