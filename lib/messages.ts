import type { Player, Round } from "./store";

/** Slack Block Kit messages sent to players. */

export const VOTE_ACTION_ID = "cast_vote";
export const voteBlockId = (roundId: string) => `vote:${roundId}`;
export const roundIdFromBlockId = (blockId: string) =>
  blockId.startsWith("vote:") ? blockId.slice("vote:".length) : null;

type Message = { text: string; blocks: unknown[] };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Renders in each player's own Slack timezone. */
const slackDate = (iso: string) => {
  const unix = Math.floor(Date.parse(iso) / 1000);
  return `<!date^${unix}^{date_short_pretty} at {time}|${new Date(iso).toUTCString()}>`;
};

const section = (text: string) => ({ type: "section", text: { type: "mrkdwn", text } });
const context = (text: string) => ({ type: "context", elements: [{ type: "mrkdwn", text }] });

export function voteMessage(round: Round, voter: Player): Message {
  const options = round.players.slice(0, 100).map((p) => ({
    text: { type: "plain_text", text: (p.id === voter.id ? `${p.name} (you)` : p.name).slice(0, 75) },
    value: p.id,
  }));

  return {
    text: `🗡️ ${round.title}: who do you believe is a Traitor? Voting closes ${slackDate(round.closesAt)}.`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "🗡️ The Round Table has gathered", emoji: true } },
      section(
        `*${esc(round.title)}*\n\nThe time has come. Who do you believe is a *Traitor*?\n\n` +
          `Voting closes *${slackDate(round.closesAt)}*. Your vote is *final* once cast, and will be revealed at the Round Table.`,
      ),
      {
        type: "actions",
        block_id: voteBlockId(round.id),
        elements: [
          {
            type: "static_select",
            action_id: VOTE_ACTION_ID,
            placeholder: { type: "plain_text", text: "Choose a player…" },
            options,
            confirm: {
              title: { type: "plain_text", text: "Lock in your vote?" },
              text: { type: "mrkdwn", text: "Once cast, your vote *cannot* be changed." },
              confirm: { type: "plain_text", text: "Lock it in" },
              deny: { type: "plain_text", text: "Not yet" },
              style: "danger",
            },
          },
        ],
      },
      context(`Eligible players: ${round.players.map((p) => esc(p.name)).join(", ")}`),
    ],
  };
}

export function votedMessage(round: Round, target: Player): Message {
  return {
    text: `Your vote is locked in: ${target.name}.`,
    blocks: [
      section(`🗳️ *${esc(round.title)}*\n\nYour vote is locked in: *${esc(target.name)}*.`),
      context(`Votes will be revealed at the Round Table. Voting closes ${slackDate(round.closesAt)}.`),
    ],
  };
}

export function alreadyVotedMessage(round: Round, target?: Player): Message {
  const who = target ? ` for *${esc(target.name)}*` : "";
  return {
    text: "You've already voted in this round.",
    blocks: [section(`🗳️ *${esc(round.title)}*\n\nYou've already voted${who}. Votes are final.`)],
  };
}

export function closedMessage(round: Round, opts: { voted: boolean }): Message {
  const tail = opts.voted ? "Your vote has been counted." : "You didn't vote in time, so no vote was counted.";
  return {
    text: `Voting has closed: ${round.title}`,
    blocks: [section(`🕯️ *${esc(round.title)}*\n\nVoting has now closed. ${tail}`)],
  };
}

/** Sent to every player at the deadline. */
export function deadlineMessage(round: Round): Message {
  return {
    text: `Voting has closed: ${round.title}`,
    blocks: [
      section(`🕯️ *${esc(round.title)}*\n\nVoting has now closed. Make your way to the Round Table.`),
    ],
  };
}

export function cancelledMessage(round: Round): Message {
  return {
    text: `Vote cancelled: ${round.title}`,
    blocks: [section(`✖️ *${esc(round.title)}* was cancelled by the host. No vote is needed.`)],
  };
}

export function notOpenMessage(round: Round): Message {
  return {
    text: "Voting hasn't opened yet.",
    blocks: [section(`⏳ *${esc(round.title)}*\n\nVoting opens ${slackDate(round.opensAt)}.`)],
  };
}

export function notEligibleMessage(): Message {
  return {
    text: "You're not eligible to vote in this round.",
    blocks: [section("You're not eligible to vote in this round.")],
  };
}
