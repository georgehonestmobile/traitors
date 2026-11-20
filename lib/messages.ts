import { joinLocksAt, type JoinMode, type Player, type Round, type Rsvp } from "./store";

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

/* ---------------- Tiebreak re-vote (face-to-face meetings) ---------------- */

export const REVOTE_ACTION_ID = "cast_tiebreak";
export const revoteBlockId = (roundId: string) => `tiebreak:${roundId}`;
export const roundIdFromRevoteBlockId = (blockId: string) =>
  blockId.startsWith("tiebreak:") ? blockId.slice("tiebreak:".length) : null;

const andNames = (names: string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** Sent in the meeting when the vote is tied: vote again, between the tied players only. */
export function tiebreakBallotMessage(round: Round, voter: Player, tied: Player[], closesAt: string): Message {
  const names = andNames(tied.map((p) => `*${esc(p.name)}*`));
  return {
    text: "⚖️ Tiebreak: vote again. You have one minute.",
    blocks: [
      { type: "header", text: { type: "plain_text", text: "⚖️ Tiebreak: one minute", emoji: true } },
      section(
        `*${esc(round.title)}*\n\nIt's a tie between ${names}. Your vote went to someone outside the tie, so please vote again, ` +
          `choosing between ${names} only. You have *one minute*. If you don't vote in time, you won't be counted.`,
      ),
      {
        type: "actions",
        block_id: revoteBlockId(round.id),
        elements: [
          {
            type: "static_select",
            action_id: REVOTE_ACTION_ID,
            placeholder: { type: "plain_text", text: "Choose a tied player…" },
            options: tied.map((p) => ({ text: { type: "plain_text", text: p.name.slice(0, 75) }, value: p.id })),
            confirm: {
              title: { type: "plain_text", text: "Lock in your vote?" },
              text: { type: "mrkdwn", text: "Once cast, your tiebreak vote *cannot* be changed." },
              confirm: { type: "plain_text", text: "Lock it in" },
              deny: { type: "plain_text", text: "Not yet" },
              style: "danger",
            },
          },
        ],
      },
      context(`Voting closes at <!date^${Math.floor(Date.parse(closesAt) / 1000)}^{time_secs}|${new Date(closesAt).toUTCString()}>.`),
    ],
  };
}

export function tiebreakVotedMessage(round: Round, target?: Player): Message {
  return {
    text: target ? `Your tiebreak vote is locked in: ${target.name}.` : "You've already cast your tiebreak vote.",
    blocks: [
      section(
        target
          ? `⚖️ *${esc(round.title)}*\n\nYour tiebreak vote is locked in: *${esc(target.name)}*.`
          : `⚖️ *${esc(round.title)}*\n\nYou've already cast your tiebreak vote.`,
      ),
    ],
  };
}

export function tiebreakTimeUpMessage(round: Round): Message {
  return {
    text: "Time's up. Your tiebreak vote wasn't counted.",
    blocks: [section(`⌛ *${esc(round.title)}*\n\nTime's up for the tiebreak vote, so you weren't counted.`)],
  };
}

export function tiebreakClosedMessage(round: Round): Message {
  return {
    text: "There's no tiebreak vote open for you.",
    blocks: [section(`*${esc(round.title)}*\n\nThere's no tiebreak vote open for you right now.`)],
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

/** Replaces an out player's ballot or RSVP in a round they can no longer take part in. */
export function outOfRoundMessage(round: Round): Message {
  return {
    text: "You're no longer in the game.",
    blocks: [section(`*${esc(round.title)}*\n\nYou're no longer in the game, so you won't be voting in this round.`)],
  };
}

/** They picked someone from an older ballot who has since left the game. */
export function targetGoneMessage(round: Round, voter: Player): Message {
  return {
    text: "That player is no longer in the game. Please choose someone else.",
    blocks: [
      section(`*${esc(round.title)}*\n\nThe player you picked is no longer in the game, so that vote can't count. Please choose someone else.`),
      ballotBlock(round, voter),
    ],
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

export const RSVP_YES = "rsvp_yes"; // older RSVPs: "I'll be there", without saying how
export const RSVP_NO = "rsvp_no";
export const RSVP_OFFICE = "rsvp_office";
export const RSVP_DIAL_IN = "rsvp_dial_in";
export const RSVP_ACTIONS = [RSVP_YES, RSVP_NO, RSVP_OFFICE, RSVP_DIAL_IN];
export const rsvpBlockId = (roundId: string) => `rsvp:${roundId}`;
export const roundIdFromRsvpBlockId = (blockId: string) =>
  blockId.startsWith("rsvp:") ? blockId.slice("rsvp:".length) : null;

type RsvpButton = "yes" | "office" | "dial-in" | "no";
const BUTTONS: Record<RsvpButton, { action_id: string; text: string; style?: string }> = {
  yes: { action_id: RSVP_YES, text: "✅ I'll be there", style: "primary" },
  office: { action_id: RSVP_OFFICE, text: "🏢 In the office", style: "primary" },
  "dial-in": { action_id: RSVP_DIAL_IN, text: "💻 Dialling in", style: "primary" },
  no: { action_id: RSVP_NO, text: "❌ I can't make it" },
};
const SWITCH: Record<JoinMode, string> = {
  office: "🏢 I'll be in the office instead",
  "dial-in": "💻 I'll dial in instead",
};

const rsvpButtons = (round: Round, which: RsvpButton[], labels: Partial<Record<RsvpButton, string>> = {}) => ({
  type: "actions",
  block_id: rsvpBlockId(round.id),
  elements: which.map((w) => ({
    type: "button",
    action_id: BUTTONS[w].action_id,
    ...(BUTTONS[w].style && !labels[w] ? { style: BUTTONS[w].style } : {}),
    text: { type: "plain_text", text: labels[w] ?? BUTTONS[w].text, emoji: true },
    value: w,
  })),
});

const HOW_TO_VOTE =
  "*In the office:* you'll vote on paper in the meeting.\n" +
  "*Dialling in:* your ballot arrives here during the meeting, and you'll have one minute to vote.";

const VIRTUAL_HOW_TO_VOTE = "*Coming:* your ballot arrives here during the meeting, and you'll have one minute to vote.";

/** Sent the day before: will you be at the banishment meeting, and how? */
export function rsvpMessage(round: Round): Message {
  const m = round.meeting!;
  if (m.virtual) {
    return {
      text: `Banishment meeting ${slackDate(m.at)}: will you be there? Please reply by ${slackDate(m.rsvpClosesAt)}.`,
      blocks: [
        { type: "header", text: { type: "plain_text", text: "🕯️ A banishment meeting is coming", emoji: true } },
        section(
          `*${esc(round.title)}* takes place *${slackDate(m.at)}*. Everyone will be dialling in.\n\n` +
            `Will you be there? Please reply by *${slackDate(m.rsvpClosesAt)}*.\n\n` +
            "It's completely fine if you can't make it, whether you're busy, not working that day or anything else. " +
            "Just let us know, and you can vote in advance instead so your vote still counts.",
        ),
        rsvpButtons(round, ["yes", "no"]),
        context(`${VIRTUAL_HOW_TO_VOTE}\n*Can't make it:* you'll get your ballot as soon as you reply.`),
      ],
    };
  }
  return {
    text: `Banishment meeting ${slackDate(m.at)}: will you be there? Please reply by ${slackDate(m.rsvpClosesAt)}.`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "🕯️ A banishment meeting is coming", emoji: true } },
      section(
        `*${esc(round.title)}* takes place *${slackDate(m.at)}*.\n\n` +
          `Will you be there, and how will you join? Please reply by *${slackDate(m.rsvpClosesAt)}*.\n\n` +
          "It's completely fine if you can't make it, whether you're busy, not working that day or anything else. " +
          "Just let us know, and you can vote in advance instead so your vote still counts.",
      ),
      rsvpButtons(round, ["office", "dial-in", "no"]),
      context(
        `${HOW_TO_VOTE}\n*Can't make it:* you'll get your ballot as soon as you reply.\n` +
          `You can switch between the office and dialling in until ${slackDate(joinLocksAt(m))}.`,
      ),
    ],
  };
}

/** Asked of attendees who said they'd be there before the office/dial-in choice existed. */
export function joinQuestionMessage(round: Round): Message {
  const m = round.meeting!;
  return {
    text: `${round.title}: will you be in the office or dialling in?`,
    blocks: [
      section(
        `🕯️ *${esc(round.title)}*\n\nThanks for letting us know you'll be at the meeting, *${slackDate(m.at)}*. ` +
          "Will you be in the office, or dialling in?",
      ),
      rsvpButtons(round, ["office", "dial-in"]),
      context(`${HOW_TO_VOTE}\nYou can change your answer until ${slackDate(joinLocksAt(m))}.`),
    ],
  };
}

/**
 * Their RSVP as it now stands, with buttons for whatever they can still change.
 * `notice` explains why something they clicked couldn't be changed.
 */
export function rsvpAnsweredMessage(
  round: Round,
  voter: Player,
  rsvp: Rsvp,
  can: { answer: boolean; join: boolean },
  notice?: string,
): Message {
  const m = round.meeting!;
  const tail = notice ? [context(notice)] : [];
  if (m.virtual) {
    if (rsvp.answer === "no") {
      return {
        text: "You can't make the meeting, so please vote now.",
        blocks: [
          section(`❌ *${esc(round.title)}*\n\nNo problem, thanks for letting us know. As you can't be at the meeting, please nominate who you believe is a *Traitor* now. Your vote counts just the same, and will be read out at the meeting.`),
          ballotBlock(round, voter),
          context(`Advance votes close when the meeting starts, ${slackDate(m.at)}.`),
          ...(can.answer ? [rsvpButtons(round, ["yes"], { yes: "✅ I can make it after all" })] : []),
          ...tail,
        ],
      };
    }
    return {
      text: "See you at the meeting. Your ballot arrives during it.",
      blocks: [
        section(`✅ *${esc(round.title)}*\n\nSee you at the meeting, *${slackDate(m.at)}*. Your ballot will arrive here during the meeting, and you'll have one minute to vote.`),
        ...(can.answer ? [rsvpButtons(round, ["no"])] : []),
        context(can.answer ? `You can change your answer until ${slackDate(m.rsvpClosesAt)}.` : "If something changes, let the host know."),
        ...tail,
      ],
    };
  }
  if (rsvp.answer === "no") {
    return {
      text: "You can't make the meeting, so please vote now.",
      blocks: [
        section(`❌ *${esc(round.title)}*\n\nNo problem, thanks for letting us know. As you can't be at the meeting, please nominate who you believe is a *Traitor* now. Your vote counts just the same, and will be read out at the meeting.`),
        ballotBlock(round, voter),
        context(`Advance votes close when the meeting starts, ${slackDate(m.at)}.`),
        ...(can.answer ? [rsvpButtons(round, ["office", "dial-in"], { office: "🏢 I can make it after all, in the office", "dial-in": "💻 I can make it after all, dialling in" })] : []),
        ...tail,
      ],
    };
  }
  if (!rsvp.join) {
    return {
      text: "You'll be at the meeting. Will you be in the office or dialling in?",
      blocks: [
        section(`✅ *${esc(round.title)}*\n\nSee you at the meeting, *${slackDate(m.at)}*. Will you be in the office, or dialling in?`),
        ...(can.join ? [rsvpButtons(round, can.answer ? ["office", "dial-in", "no"] : ["office", "dial-in"])] : []),
        context(HOW_TO_VOTE),
        ...tail,
      ],
    };
  }
  const office = rsvp.join === "office";
  const other: JoinMode = office ? "dial-in" : "office";
  const buttons: RsvpButton[] = [...(can.join ? [other] : []), ...(can.answer ? ["no" as const] : [])];
  return {
    text: office ? "See you in the office. You'll vote on paper." : "You're dialling in. Your ballot arrives during the meeting.",
    blocks: [
      section(
        office
          ? `🏢 *${esc(round.title)}*\n\nSee you in the office, *${slackDate(m.at)}*. You'll vote on paper in the meeting, so there's nothing to do here.`
          : `💻 *${esc(round.title)}*\n\nYou're dialling in, *${slackDate(m.at)}*. Your ballot will arrive here during the meeting, and you'll have one minute to vote.`,
      ),
      ...(buttons.length ? [rsvpButtons(round, buttons, { [other]: SWITCH[other] })] : []),
      context(
        can.join
          ? `You can switch between the office and dialling in until ${slackDate(joinLocksAt(m))}.`
          : "This is locked in now. If something changes, let the host know.",
      ),
      ...tail,
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

/** An office attendee tried to vote in Slack. */
export function officeVoteMessage(round: Round): Message {
  return {
    text: "You're down as in the office, so you'll vote on paper.",
    blocks: [section(`🏢 *${esc(round.title)}*\n\nYou're down as in the office, so you'll vote on paper in the meeting. If you're dialling in instead, let the host know.`)],
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
  const how = round.meeting?.virtual
    ? "If you're coming, your ballot arrives during the meeting."
    : "If you're dialling in, your ballot arrives during the meeting. If you're in the office, you'll vote on paper.";
  return {
    text: "Your ballot will arrive during the meeting.",
    blocks: [section(`*${esc(round.title)}*\n\nAdvance voting is only for players who can't make the meeting, and closes when it starts. ${how}`)],
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
