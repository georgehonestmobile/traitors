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

/** The vote dropdown. Its block_id carries the round, so any message containing it can take a vote. */
function ballotBlock(round: Round, voter: Player) {
  const options = round.players.slice(0, 100).map((p) => ({
    text: { type: "plain_text", text: (p.id === voter.id ? `${p.name} (you)` : p.name).slice(0, 75) },
    value: p.id,
  }));
  return {
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
  };
}

export function voteMessage(round: Round, voter: Player): Message {
  return {
    text: `🗡️ ${round.title}: who do you believe is a Traitor? Voting closes ${slackDate(round.closesAt)}.`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "🗡️ The Round Table has gathered", emoji: true } },
      section(
        `*${esc(round.title)}*\n\nThe time has come. Who do you believe is a *Traitor*?\n\n` +
          `Voting closes *${slackDate(round.closesAt)}*. Your vote is *final* once cast, and will be revealed at the Round Table.`,
      ),
      ballotBlock(round, voter),
      context(`Eligible players: ${round.players.map((p) => esc(p.name)).join(", ")}`),
    ],
  };
}

/* ---------------- Leaving the game ---------------- */

/** DM to a player the host has just marked as murdered. */
export function murderedMessage(name: string, roundTitles: string[]): Message {
  const rounds = roundTitles.length
    ? ` That includes ${roundTitles.map((t) => `*${esc(t)}*`).join(", ")}.`
    : "";
  return {
    text: "🔪 You have been murdered by the Traitors.",
    blocks: [
      { type: "header", text: { type: "plain_text", text: "🔪 You have been murdered", emoji: true } },
      section(
        `*${esc(name)}*, we're sorry to tell you that the Traitors have murdered you, so you're out of the game.\n\n` +
          `As you're no longer playing, any vote you've made, or were due to make, no longer counts.${rounds}`,
      ),
      context("Thank you for playing."),
    ],
  };
}

/** Replaces an out player's ballot or RSVP in a round they can no longer take part in. */
export function outOfRoundMessage(round: Round): Message {
  return {
    text: "You're no longer in the game.",
    blocks: [section(`*${esc(round.title)}*\n\nYou're no longer in the game, so you won't be voting in this round.`)],
  };
}

/** Sent to someone whose vote was for a player who has since been murdered. */
export function revoteMessage(round: Round, voter: Player, outName: string): Message {
  return {
    text: `${outName} has been murdered, so your vote no longer counts. Please vote again.`,
    blocks: [
      section(`🔪 *${esc(round.title)}*\n\n*${esc(outName)}* has been murdered, so your vote for them no longer counts. Please vote again.`),
      ballotBlock(round, voter),
      context(round.format === "meeting" && round.meeting ? `Advance votes close when the meeting starts, ${slackDate(round.meeting.at)}.` : `Voting closes ${slackDate(round.closesAt)}.`),
    ],
  };
}

/* ---------------- Meeting banishments ---------------- */

export const RSVP_YES = "rsvp_yes";
export const RSVP_NO = "rsvp_no";
export const rsvpBlockId = (roundId: string) => `rsvp:${roundId}`;
export const roundIdFromRsvpBlockId = (blockId: string) =>
  blockId.startsWith("rsvp:") ? blockId.slice("rsvp:".length) : null;

const rsvpButtons = (round: Round, which: ("yes" | "no")[]) => ({
  type: "actions",
  block_id: rsvpBlockId(round.id),
  elements: which.map((w) =>
    w === "yes"
      ? { type: "button", action_id: RSVP_YES, style: "primary", text: { type: "plain_text", text: "✅ I'll be there", emoji: true }, value: "yes" }
      : { type: "button", action_id: RSVP_NO, text: { type: "plain_text", text: "❌ I can't make it", emoji: true }, value: "no" },
  ),
});

/** Sent the day before: will you be at the banishment meeting? */
export function rsvpMessage(round: Round): Message {
  const m = round.meeting!;
  return {
    text: `Banishment meeting ${slackDate(m.at)}: will you be there? Please reply by ${slackDate(m.rsvpClosesAt)}.`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "🕯️ A banishment meeting is coming", emoji: true } },
      section(
        `*${esc(round.title)}* takes place *${slackDate(m.at)}*.

Will you be there? Please reply by *${slackDate(m.rsvpClosesAt)}*.`,
      ),
      rsvpButtons(round, ["yes", "no"]),
      context("If you'll be there, your ballot arrives during the meeting. If you can't make it, you'll vote in advance."),
    ],
  };
}

/** Their reply, with the advance ballot if they can't make it. */
export function rsvpAnsweredMessage(round: Round, voter: Player, answer: "yes" | "no", canChange: boolean): Message {
  const m = round.meeting!;
  if (answer === "yes") {
    return {
      text: "You'll be at the meeting. Your ballot arrives during it.",
      blocks: [
        section(`✅ *${esc(round.title)}*

See you at the meeting, *${slackDate(m.at)}*. Your ballot will arrive here during the meeting, and you'll have one minute to vote.`),
        ...(canChange ? [rsvpButtons(round, ["no"]), context(`You can change your answer until ${slackDate(m.rsvpClosesAt)}.`)] : []),
      ],
    };
  }
  return {
    text: "You can't make the meeting, so please vote now.",
    blocks: [
      section(`❌ *${esc(round.title)}*

Thanks for letting us know. As you can't be at the meeting, please nominate who you believe is a *Traitor* now. Your vote will be read out at the meeting.`),
      ballotBlock(round, voter),
      context(`Advance votes close when the meeting starts, ${slackDate(m.at)}.`),
      ...(canChange ? [rsvpButtons(round, ["yes"])] : []),
    ],
  };
}

export function rsvpClosedMessage(round: Round): Message {
  return {
    text: "Replies have closed.",
    blocks: [section(`*${esc(round.title)}*

Replies closed ${slackDate(round.meeting!.rsvpClosesAt)}. If you're at the meeting, your ballot will arrive during it.`)],
  };
}

/** Sent in the meeting: one minute to vote. */
export function meetingBallotMessage(round: Round, voter: Player): Message {
  const closes = round.meeting!.votingClosesAt!;
  return {
    text: "⏱️ Vote now: you have one minute.",
    blocks: [
      { type: "header", text: { type: "plain_text", text: "⏱️ Vote now: one minute", emoji: true } },
      section(`*${esc(round.title)}*

Who do you believe is a *Traitor*? You have *one minute*. If you don't vote in time, your vote won't count.`),
      ballotBlock(round, voter),
      context(`Voting closes at <!date^${Math.floor(Date.parse(closes) / 1000)}^{time_secs}|${new Date(closes).toUTCString()}>.`),
    ],
  };
}

export function meetingWaitMessage(round: Round): Message {
  return {
    text: "Your ballot will arrive during the meeting.",
    blocks: [section(`*${esc(round.title)}*\n\nAdvance voting is only for players who can't make the meeting, and closes when it starts. If you're at the meeting, your ballot arrives during it.`)],
  };
}

export function timeUpMessage(round: Round): Message {
  return {
    text: "Time's up. Your vote wasn't counted.",
    blocks: [section(`⌛ *${esc(round.title)}*

Time's up. Your vote wasn't counted.`)],
  };
}

export function votedMessage(round: Round, target: Player): Message {
  return {
    text: `Your vote is locked in: ${target.name}.`,
    blocks: [
      section(`🗳️ *${esc(round.title)}*\n\nYour vote is locked in: *${esc(target.name)}*.`),
      context(
        round.format === "meeting"
          ? "Votes will be revealed at the meeting."
          : `Votes will be revealed at the Round Table. Voting closes ${slackDate(round.closesAt)}.`,
      ),
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
