import { formatDateTime } from "./format";
import type { Game } from "./game";
import { roundStatus } from "./rounds";
import { formatDay, type ScheduleRow, type ScheduleSummary } from "./schedule";
import type { Round } from "./store";
import { addDays, appTimeZone, ymdIn, zonedTime } from "./time";

/**
 * The host's to-do list, worked out from the schedule and the state of the game.
 * Nothing is stored: items disappear once they're done.
 */

export type Todo = {
  id: string;
  title: string;
  detail: string;
  urgency: "overdue" | "now" | "soon";
  href?: string;
  action?: string;
};

const DAY = 24 * 60 * 60 * 1000;

/** The day a round happens: the meeting day, or the day voting closes. */
function roundDay(r: Round) {
  return ymdIn(new Date(r.meeting?.at ?? r.closesAt), appTimeZone());
}

/** The round set up for a schedule event: linked directly, or (for older rounds) on the same day. */
export function roundForRow(row: ScheduleRow, rounds: Round[]): Round | undefined {
  const live = rounds.filter((r) => !r.test && !r.cancelledAt);
  return live.find((r) => r.scheduleId === row.id) ?? live.find((r) => !r.scheduleId && roundDay(r) === row.date);
}

export function buildTodos(args: {
  game: Game;
  schedule: ScheduleSummary;
  /** This game's rounds. */
  rounds: Round[];
  /** Rounds whose results have been revealed. */
  revealed: Set<string>;
  today: string;
  now?: number;
}): Todo[] {
  const { game, schedule, rounds, revealed, today } = args;
  const now = args.now ?? Date.now();
  const todos: Todo[] = [];
  if (game.status !== "active") return todos;

  if (!game.cast.length) {
    todos.push({ id: "cast", title: "Add the players to the cast", detail: "Votes and the schedule track the players in the cast.", urgency: "now", href: "#cast", action: "Go to the cast" });
  }
  if (!schedule.rows.length) {
    todos.push({ id: "schedule", title: "Load the schedule", detail: "Plan when the murders and banishments happen.", urgency: "soon", href: "#schedule", action: "Go to the schedule" });
  }

  // Banishments to set up: the next one, plus any in the next couple of days.
  const pending = schedule.rows.filter(
    (r) => r.kind === "banishment" && r.status !== "done" && r.status !== "skipped" && !roundForRow(r, rounds),
  );
  const soon = addDays(today, 2);
  pending
    .filter((r, i) => i === 0 || r.date <= soon)
    .forEach((r) => {
      const rsvpAt = zonedTime(addDays(r.date, -1), 9, 0, appTimeZone()).getTime();
      const late = now >= rsvpAt;
      todos.push({
        id: `setup:${r.id}`,
        title: `Set up the ${formatDay(r.date)} banishment`,
        detail: late
          ? `The RSVPs were due to go out ${formatDateTime(new Date(rsvpAt).toISOString())}. Set it up now and they'll go out straight away, with an hour to reply.`
          : `Set it up before ${formatDateTime(new Date(rsvpAt).toISOString())} so everyone gets the RSVP at 9am the day before.`,
        urgency: late || r.date <= today ? "overdue" : rsvpAt - now < DAY ? "now" : "soon",
        href: `/rounds/new?schedule=${r.id}`,
        action: "Set it up",
      });
    });

  // Murders that should have happened by now.
  for (const r of schedule.rows) {
    if (r.kind !== "murder" || (r.status !== "today" && r.status !== "overdue")) continue;
    todos.push({
      id: `murder:${r.id}`,
      title: `Record the ${formatDay(r.date)} murder`,
      detail: "Mark the murdered player in the cast, so any vote of theirs stops counting and anyone who voted for them is asked to vote again.",
      urgency: r.status === "overdue" ? "overdue" : "now",
      href: "#cast",
      action: "Go to the cast",
    });
  }

  for (const round of rounds) {
    if (round.test || round.cancelledAt) continue;
    const status = roundStatus(round, now);
    const m = round.meeting;
    // Meetings about to start: request votes.
    if (m && status === "open" && !m.requestedAt && now >= Date.parse(m.at) - 30 * 60 * 1000) {
      todos.push({
        id: `request:${round.id}`,
        title: `Request votes in “${round.title}”`,
        detail: `The meeting ${now >= Date.parse(m.at) ? "has started" : "starts soon"}. Press Request votes when everyone's ready.`,
        urgency: "now",
        href: `/rounds/${round.id}`,
        action: "Open the round",
      });
    }
    // Votes in, result not yet revealed.
    const banishedHere = game.cast.some((c) => c.outRoundId === round.id);
    if (status === "closed" && !revealed.has(round.id) && !banishedHere) {
      todos.push({
        id: `reveal:${round.id}`,
        title: `Reveal the result of “${round.title}”`,
        detail: m ? "Run the face-to-face script." : "Run the reveal in Slack, or face to face.",
        urgency: "now",
        href: `/rounds/${round.id}`,
        action: "Open the round",
      });
    }
  }

  const end = schedule.rows.find((r) => r.kind === "end");
  if (end && end.date <= today) {
    todos.push({
      id: "end",
      title: "End the game",
      detail: `The schedule's end game is ${formatDay(end.date)}. Use End game at the top when it's over.`,
      urgency: end.date < today ? "overdue" : "now",
    });
  }

  const order = { overdue: 0, now: 1, soon: 2 };
  return todos.sort((a, b) => order[a.urgency] - order[b.urgency]);
}
