import crypto from "node:crypto";
import * as slack from "./slack";
import { getStore, type Player, type Round } from "./store";
import { RoundError, roundStatus } from "./rounds";
import { removeFromOpenRounds } from "./departure";
import { banish, unbanish } from "./game";
import { resolveOutcome, type Outcome } from "./outcome";
import { scriptBeats, scriptCard, type ScriptBeat, type ScriptCard } from "./script";
import * as pace from "./pacing";
import { suspensefulOrder, winners, type VotePair } from "./suspense";

/**
 * The reveal: a paced sequence of posts in a Slack channel.
 *
 * The host's admin page drives it: it calls `stepReveal` whenever the next step is due,
 * so the reveal pauses if that page is closed and picks up again when it is reopened.
 * Each step is claimed atomically, so two open admin tabs can't double-post.
 *
 * The whole sequence (vote order, any tiebreak recount, the verdict) is worked out
 * up front when the reveal starts, then posted step by step.
 */

type StepBase = { delayAfter: number };
export type Step = StepBase &
  (
    | { kind: "intro" }
    | { kind: "tease"; voterId: string; n: number; total: number; recount?: boolean }
    | { kind: "reveal"; voterId: string; targetId: string; n: number; total: number; recount?: boolean }
    | { kind: "standings"; upTo: number }
    | { kind: "tie" }
    | { kind: "draw"; phase: "announce" | "tease" | "reveal" }
    | { kind: "final" }
  );

export type RevealMode = "slack" | "in-person";

export type RevealSettings = {
  /** "in-person": nothing is posted in Slack; the host follows a script on the round page. */
  mode?: RevealMode;
  channel: string;
  channelName: string;
  standingsEvery: number;
};

export type RevealState = RevealSettings & {
  roundId: string;
  runId: string;
  order: VotePair[];
  /** Missing on reveals started before tiebreaks existed. */
  outcome?: Outcome;
  plan: Step[];
  /** Face-to-face reveals only: the script, in order. `next` counts the cards shown so far. */
  beats?: ScriptBeat[];
  next: number;
  nextAt: string;
  status: "running" | "paused" | "done";
  startedAt: string;
  finishedAt?: string;
  attempt: number;
  error?: string;
  tsByVoter: Record<string, string>;
};

/** What the admin page sees: only what has already been posted, so the host isn't spoiled either. */
export type RevealView = {
  mode: RevealMode;
  /** Face-to-face reveals: the whole script. Cards before `stepsDone` have been reached. */
  script?: ScriptCard[];
  status: RevealState["status"];
  channelName: string;
  stepsDone: number;
  stepsTotal: number;
  msUntilNext: number;
  error?: string;
  revealed: { key: string; n: number; total: number; voter: string; target: string; recount: boolean }[];
  result?: {
    tally: { name: string; count: number }[];
    recount?: { tied: string[]; tally: { name: string; count: number }[] };
    banished: string[];
    unresolved: boolean;
    /** Players who drew straws, if the tiebreak was still level. */
    drawnFrom?: string[];
  };
};

const stateKey = (roundId: string) => `reveal:${roundId}`;
const DEFAULTS_KEY = "reveal:defaults";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/* ---------------- Slack messages for the channel ---------------- */

type Message = { text: string; blocks: unknown[] };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const section = (text: string, avatar?: Player) => ({
  type: "section",
  text: { type: "mrkdwn", text },
  ...(avatar?.avatar ? { accessory: { type: "image", image_url: avatar.avatar, alt_text: avatar.name } } : {}),
});
const context = (text: string) => ({ type: "context", elements: [{ type: "mrkdwn", text }] });
const header = (round: Round, text: string, emoji: string) => ({
  type: "header",
  text: { type: "plain_text", text: `${round.test ? "🧪 TEST · " : `${emoji} `}${text}`, emoji: true },
});

const TEASES = [
  "picks up their slate…",
  "takes a long breath…",
  "looks slowly around the table…",
  "turns their slate around…",
  "rises to reveal their vote…",
];

function tally(order: VotePair[], upTo = order.length) {
  const counts = new Map<string, number>();
  for (const v of order.slice(0, upTo)) counts.set(v.targetId, (counts.get(v.targetId) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

function tallyLines(round: Round, order: VotePair[], upTo?: number) {
  const name = playerName(round);
  return tally(order, upTo)
    .map(([id, n]) => `${"🟥".repeat(Math.min(n, 20))}  *${esc(name(id))}*  ${n}`)
    .join("\n");
}

const playerName = (round: Round) => {
  const m = new Map(round.players.map((p) => [p.id, p.name]));
  return (id: string) => m.get(id) ?? "Unknown";
};
const playerById = (round: Round, id: string) => round.players.find((p) => p.id === id);
const andList = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const votes = (n: number) => `${n} ${n === 1 ? "vote" : "votes"}`;

function introMessage(round: Round, order: VotePair[]): Message {
  const voted = new Set(order.map((v) => v.voterId));
  const absent = round.players.filter((p) => !voted.has(p.id));
  const blocks: unknown[] = [
    header(round, "The Round Table", "🕯️"),
    section(
      `*${esc(round.title)}*\n\nThe votes are in: *${order.length}* of *${round.players.length}* players voted.\n` +
        "One by one, each player will now reveal who they believe is a *Traitor*.",
    ),
  ];
  if (absent.length) blocks.push(context(`Did not vote: ${absent.map((p) => esc(p.name)).join(", ")}`));
  if (round.test) blocks.push(context("🧪 This is a test run. The votes were cast by the host, not the players."));
  return { text: `${round.test ? "[TEST] " : ""}The Round Table: ${round.title}. The votes are in.`, blocks };
}

const voteContext = (step: { n: number; total: number; recount?: boolean }) =>
  context(`${step.recount ? "Recount · vote" : "Vote"} ${step.n} of ${step.total}`);

function teaseMessage(round: Round, step: Extract<Step, { kind: "tease" }>): Message {
  const who = esc(playerName(round)(step.voterId));
  const last = step.n === step.total;
  const line = step.recount
    ? `*The final vote of the recount.* *${who}*'s vote goes to…`
    : last
      ? `*The final vote.* *${who}* ${TEASES[0]}`
      : `*${who}* ${TEASES[(step.n - 1) % TEASES.length]}`;
  return { text: `${who} is about to reveal their vote…`, blocks: [section(`🪶 ${line}`), voteContext(step)] };
}

function revealMessage(round: Round, step: Extract<Step, { kind: "reveal" }>): Message {
  const name = playerName(round);
  const voter = esc(name(step.voterId));
  const target = esc(name(step.targetId).toUpperCase());
  const self = step.voterId === step.targetId;
  const line = step.recount
    ? `🔁 *${voter}*'s vote goes to… *${target}*`
    : self
      ? `🗡️ *${voter}* votes for… *${target}*. Themselves?! 😳`
      : `🗡️ *${voter}* votes for… *${target}*`;
  return {
    text: `${name(step.voterId)} votes for ${name(step.targetId)}`,
    blocks: [section(line, playerById(round, step.targetId)), voteContext(step)],
  };
}

function standingsMessage(round: Round, order: VotePair[], upTo: number): Message {
  return {
    text: `The count so far: ${upTo} of ${order.length} votes revealed`,
    blocks: [
      section(`📜 *The count so far*  ·  ${upTo} of ${order.length} votes revealed\n\n${tallyLines(round, order, upTo)}`),
    ],
  };
}

function tieMessage(round: Round, order: VotePair[], outcome: Outcome): Message {
  const tb = outcome.tiebreak!;
  const name = playerName(round);
  const tied = tb.tiedIds.map((id) => `*${esc(name(id))}*`);
  const lines: string[] = [
    `${andList(tied)} are level on *${votes(tb.tiedCount)}* each.`,
    "",
    "*Tiebreak:* tied players can't vote in the tiebreak, so their votes are removed and the count is replayed " +
      `between ${andList(tied)} only.`,
  ];
  if (tb.removed.length) {
    lines.push("", "*Votes removed*");
    for (const v of tb.removed) lines.push(`• *${esc(name(v.voterId))}*'s vote for ${esc(name(v.targetId))}`);
  }
  const tiedNoVote = tb.tiedIds.filter((id) => !tb.removed.some((v) => v.voterId === id));
  if (tiedNoVote.length) lines.push(`_${andList(tiedNoVote.map((id) => esc(name(id))))} didn't vote._`);
  if (tb.setAside.length) {
    lines.push(
      "",
      `*Set aside:* ${votes(tb.setAside.length)} for players outside the tie (${andList(
        [...new Set(tb.setAside.map((v) => esc(name(v.targetId))))],
      )}).`,
    );
  }
  lines.push(
    "",
    tb.order.length
      ? `That leaves *${votes(tb.order.length)}* to count again…`
      : "That leaves no votes to count, so it comes down to drawing straws…",
  );
  return {
    text: `It's a tie between ${andList(tb.tiedIds.map(name))}. Recounting without the tied players' votes.`,
    blocks: [header(round, "It's a tie!", "⚖️"), section(lines.join("\n")), { type: "divider" }, section(`*The count*\n\n${tallyLines(round, order)}`)],
  };
}

function drawMessage(round: Round, outcome: Outcome, phase: "announce" | "tease" | "reveal"): Message {
  const name = playerName(round);
  const from = outcome.drawnFrom ?? [];
  const who = andList(from.map((id) => `*${esc(name(id))}*`));
  const short = outcome.banished[0];
  if (phase === "announce") {
    const why = outcome.tiebreak?.order.length
      ? `Even after the recount, ${who} are level on *${votes(outcome.count)}* each.`
      : `There are no votes left to separate ${who}.`;
    return {
      text: `Still level. ${andList(from.map(name))} will draw straws.`,
      blocks: [
        header(round, "Still level", "🎲"),
        section(`${why}

It comes down to chance. Each of them draws a straw, and whoever draws the *short straw* is banished.`),
      ],
    };
  }
  if (phase === "tease") {
    return {
      text: "The straws are drawn…",
      blocks: [section(`🥢 ${who} each draw a straw…`), context("Drawing straws")],
    };
  }
  return {
    text: `${name(short)} draws the short straw.`,
    blocks: [
      section(`🥢 *${esc(name(short).toUpperCase())}* draws the short straw.`, playerById(round, short)),
      context("Drawing straws"),
    ],
  };
}

function finalMessage(round: Round, order: VotePair[], outcome: Outcome): Message {
  const name = playerName(round);
  const head = header(round, "The votes have been counted", "⚖️");
  if (!order.length) {
    return { text: "No votes were cast.", blocks: [head, section("No votes were cast. Nobody is banished… tonight.")] };
  }
  const tb = outcome.tiebreak;
  const winner = outcome.banished[0];
  let verdict: string;
  if (outcome.drawnFrom) {
    verdict = `*${esc(name(winner))}* drew the short straw.\n*${esc(name(winner).toUpperCase())}*, you have been banished from the Round Table.`;
  } else if (!outcome.unresolved) {
    verdict = `${tb ? "After the tiebreak, with" : "With"} *${votes(outcome.count)}*, *${esc(name(winner).toUpperCase())}*, you have been banished from the Round Table.`;
  } else if (tb && !tb.order.length) {
    verdict = `It's still a tie between ${andList(outcome.banished.map((id) => `*${esc(name(id))}*`))}.\nThe host will decide what happens next.`;
  } else {
    verdict = `Even after the tiebreak, ${andList(outcome.banished.map((id) => `*${esc(name(id))}*`))} are level on *${votes(outcome.count)}* each.\nThe host will decide what happens next.`;
  }
  const blocks: unknown[] = [
    head,
    section(verdict, outcome.unresolved ? undefined : playerById(round, winner)),
    { type: "divider" },
    section(`*${tb ? "Original count" : "Final count"}*\n\n${tallyLines(round, order)}`),
  ];
  if (tb?.order.length) blocks.push(section(`*Tiebreak recount*\n\n${tallyLines(round, tb.order)}`));
  return {
    text: outcome.unresolved ? "It's still a tie." : `${name(winner)} has been banished.`,
    blocks,
  };
}

/* ---------------- Plan ---------------- */

export function buildPlan(order: VotePair[], outcome: Outcome, standingsEvery: number): Step[] {
  const steps: Step[] = [{ kind: "intro", delayAfter: pace.INTRO_PAUSE }];
  const total = order.length;
  order.forEach((v, i) => {
    const n = i + 1;
    const standings = n < total && standingsEvery > 0 && n % standingsEvery === 0;
    steps.push({ kind: "tease", voterId: v.voterId, n, total, delayAfter: pace.teasePause(n, total) });
    steps.push({
      kind: "reveal",
      voterId: v.voterId,
      targetId: v.targetId,
      n,
      total,
      delayAfter: standings ? pace.STANDINGS_PAUSE : pace.gapAfter(n, total),
    });
    if (standings) steps.push({ kind: "standings", upTo: n, delayAfter: pace.gapAfter(n, total) });
  });

  const recount = outcome.tiebreak?.order;
  if (outcome.tiebreak) {
    steps.push({ kind: "tie", delayAfter: recount?.length ? pace.TIE_PAUSE : pace.AFTER_LAST_VOTE });
    recount?.forEach((v, i) => {
      const n = i + 1;
      const last = n === recount.length;
      const common = { voterId: v.voterId, n, total: recount.length, recount: true };
      if (last && recount.length > 1) steps.push({ kind: "tease", ...common, delayAfter: 4 });
      steps.push({ kind: "reveal", ...common, targetId: v.targetId, delayAfter: last ? pace.AFTER_LAST_VOTE : pace.RECOUNT_GAP });
    });
  }
  if (outcome.drawnFrom) {
    steps.push({ kind: "draw", phase: "announce", delayAfter: pace.DRAW_ANNOUNCE_PAUSE });
    steps.push({ kind: "draw", phase: "tease", delayAfter: pace.DRAW_TEASE_PAUSE });
    steps.push({ kind: "draw", phase: "reveal", delayAfter: pace.AFTER_LAST_VOTE });
  }
  steps.push({ kind: "final", delayAfter: 0 });
  return steps;
}

/* ---------------- State & actions ---------------- */

export async function getReveal(roundId: string) {
  return getStore().getJSON<RevealState>(stateKey(roundId));
}

export async function getRevealDefaults(): Promise<Partial<RevealSettings>> {
  return (await getStore().getJSON<RevealSettings>(DEFAULTS_KEY)) ?? {};
}

function outcomeOf(state: RevealState): Outcome {
  if (state.outcome) return state.outcome;
  const w = winners(state.order);
  return { banished: w.ids, count: w.count, unresolved: w.ids.length > 1 };
}

export function toView(state: RevealState | null, round: Round): RevealView | null {
  if (!state) return null;
  const name = playerName(round);
  const done = state.plan.slice(0, state.next);
  const named = (o: VotePair[]) => tally(o).map(([id, count]) => ({ name: name(id), count }));
  const inPerson = state.mode === "in-person";
  const view: RevealView = {
    mode: inPerson ? "in-person" : "slack",
    ...(inPerson
      ? { script: (state.beats ?? []).map((b) => scriptCard(b, round, state.order, outcomeOf(state), state.beats)) }
      : {}),
    status: state.status,
    channelName: state.channelName,
    stepsDone: state.next,
    stepsTotal: inPerson ? (state.beats?.length ?? 0) : state.plan.length,
    msUntilNext: state.status === "running" ? Math.max(0, Date.parse(state.nextAt) - Date.now()) : 0,
    error: state.error,
    revealed: done.flatMap((s) =>
      s.kind === "reveal"
        ? [{ key: `${s.recount ? "r" : "v"}${s.n}`, n: s.n, total: s.total, voter: name(s.voterId), target: name(s.targetId), recount: !!s.recount }]
        : [],
    ),
  };
  if (state.status === "done") {
    const outcome = outcomeOf(state);
    view.result = {
      tally: named(state.order),
      banished: outcome.banished.map(name),
      unresolved: outcome.unresolved,
      ...(outcome.drawnFrom ? { drawnFrom: outcome.drawnFrom.map(name) } : {}),
      ...(outcome.tiebreak
        ? { recount: { tied: outcome.tiebreak.tiedIds.map(name), tally: named(outcome.tiebreak.order) } }
        : {}),
    };
  }
  return view;
}

async function loadRound(id: string) {
  const round = await getStore().getRound(id);
  if (!round) throw new RoundError("Round not found.");
  return round;
}

export async function startReveal(roundId: string, settings: RevealSettings) {
  const store = getStore();
  const round = await loadRound(roundId);
  if (roundStatus(round) !== "closed") throw new RoundError("Close voting before starting the reveal.");
  const existing = await getReveal(roundId);
  if (existing) throw new RoundError("This reveal has already been started. Reset it to start again.");
  const inPerson = settings.mode === "in-person";
  if (!inPerson && !settings.channel) throw new RoundError("Choose a channel to reveal in.");

  const standingsEvery = clamp(Math.round(settings.standingsEvery ?? 3), 0, 50);
  const eligible = new Set(round.players.map((p) => p.id));
  const recorded = (await store.getVotes(roundId)).filter((v) => eligible.has(v.voterId) && eligible.has(v.targetId));
  const cast = recorded.map((v) => ({ voterId: v.voterId, targetId: v.targetId }));
  // Meeting banishments: votes made before the host requested votes were cast in advance.
  const requested = round.meeting?.requestedAt ? Date.parse(round.meeting.requestedAt) : Infinity;
  const advance = round.format === "meeting" ? recorded.filter((v) => Date.parse(v.at) < requested).map((v) => v.voterId) : [];
  const order = suspensefulOrder(cast);
  const outcome = resolveOutcome(order);

  const now = Date.now();
  const state: RevealState = {
    roundId,
    runId: crypto.randomUUID().slice(0, 8),
    ...(inPerson ? { mode: "in-person" as const, beats: scriptBeats(order, outcome, advance) } : {}),
    channel: inPerson ? "" : settings.channel,
    channelName: inPerson ? "" : settings.channelName,
    standingsEvery,
    order,
    outcome,
    plan: inPerson ? [] : buildPlan(order, outcome, standingsEvery),
    next: inPerson ? 1 : 0, // face to face: the opening card is showing straight away
    nextAt: new Date(now).toISOString(),
    status: "running",
    startedAt: new Date(now).toISOString(),
    attempt: 0,
    tsByVoter: {},
  };
  await store.setJSON(stateKey(roundId), state);
  const previous = await getRevealDefaults();
  await store.setJSON(DEFAULTS_KEY, {
    mode: inPerson ? "in-person" : "slack",
    channel: inPerson ? (previous.channel ?? "") : state.channel,
    channelName: inPerson ? (previous.channelName ?? "") : state.channelName,
    standingsEvery,
  } satisfies RevealSettings);
  return inPerson ? toView(state, round) : stepReveal(roundId);
}

/** Face-to-face reveals: move through the script. Finishing it records the banished player. */
export async function moveScript(roundId: string, delta: 1 | -1) {
  const store = getStore();
  const round = await loadRound(roundId);
  const state = await getReveal(roundId);
  if (!state || state.mode !== "in-person") return toView(state, round);
  const total = state.beats?.length ?? 0;
  const next = clamp(state.next + delta, 1, total);
  if (next === state.next) return toView(state, round);

  const wasDone = state.status === "done";
  state.next = next;
  state.status = next >= total ? "done" : "running";
  state.finishedAt = state.status === "done" ? new Date().toISOString() : undefined;
  await store.setJSON(stateKey(roundId), state);
  if (state.status === "done" && !wasDone) await recordBanished(round, state);
  if (wasDone && state.status !== "done" && round.gameId && !round.test) await unbanish(round.gameId, { roundId });
  return toView(state, round);
}

async function perform(step: Step, state: RevealState, round: Round): Promise<Record<string, string>> {
  const ch = state.channel;
  const tsKey = (s: { voterId: string; recount?: boolean }) => `${s.recount ? "recount:" : ""}${s.voterId}`;
  switch (step.kind) {
    case "intro":
      await slack.postMessage(ch, introMessage(round, state.order));
      return {};
    case "tease":
      return { [tsKey(step)]: await slack.postMessage(ch, teaseMessage(round, step)) };
    case "reveal": {
      const ts = state.tsByVoter[tsKey(step)];
      if (ts) await slack.updateMessage(ch, ts, revealMessage(round, step));
      else await slack.postMessage(ch, revealMessage(round, step));
      return {};
    }
    case "standings":
      await slack.postMessage(ch, standingsMessage(round, state.order, step.upTo));
      return {};
    case "tie":
      await slack.postMessage(ch, tieMessage(round, state.order, outcomeOf(state)));
      return {};
    case "draw": {
      const message = drawMessage(round, outcomeOf(state), step.phase);
      if (step.phase === "tease") return { "draw:straws": await slack.postMessage(ch, message) };
      const ts = step.phase === "reveal" ? state.tsByVoter["draw:straws"] : undefined;
      if (ts) await slack.updateMessage(ch, ts, message);
      else await slack.postMessage(ch, message);
      return {};
    }
    case "final":
      await slack.postMessage(ch, finalMessage(round, state.order, outcomeOf(state)));
      return {};
  }
}

function friendlySlackError(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  if (m.includes("not_in_channel") || m.includes("channel_not_found"))
    return "The bot can't post in that channel. For a private channel, invite it first: /invite @Round Table";
  if (m.includes("missing_scope"))
    return "The Slack app is missing a permission. Add the new scopes from the README and reinstall the app.";
  return m;
}

/** Post the next step if it's due (or `force`). Safe to call repeatedly and from several tabs. */
export async function stepReveal(roundId: string, opts: { force?: boolean } = {}) {
  const store = getStore();
  const round = await loadRound(roundId);
  const state = await getReveal(roundId);
  if (!state || state.status !== "running") return toView(state, round);
  if (state.mode === "in-person") return opts.force ? moveScript(roundId, 1) : toView(state, round);
  if (!opts.force && Date.now() < Date.parse(state.nextAt) - 250) return toView(state, round);

  const i = state.next;
  if (i >= state.plan.length) {
    state.status = "done";
    await store.setJSON(stateKey(roundId), state);
    return toView(state, round);
  }
  if (!(await store.claim(`reveal-step:${roundId}:${state.runId}:${i}:${state.attempt}`, 60))) {
    return toView(state, round); // another request is posting this step
  }

  const step = state.plan[i];
  let newTs: Record<string, string> = {};
  let error: string | undefined;
  try {
    newTs = await perform(step, state, round);
  } catch (e) {
    error = friendlySlackError(e);
  }

  // Re-read so a pause pressed mid-step isn't overwritten.
  const fresh = (await getReveal(roundId)) ?? state;
  if (fresh.runId !== state.runId) return toView(fresh, round); // reset meanwhile
  if (error) {
    fresh.status = "paused";
    fresh.error = error;
    fresh.attempt += 1;
  } else {
    fresh.next = i + 1;
    fresh.nextAt = new Date(Date.now() + step.delayAfter * 1000).toISOString();
    fresh.tsByVoter = { ...fresh.tsByVoter, ...newTs };
    fresh.error = undefined;
    if (fresh.next >= fresh.plan.length) {
      fresh.status = "done";
      fresh.finishedAt = new Date().toISOString();
    }
  }
  await store.setJSON(stateKey(roundId), fresh);
  if (!error && fresh.status === "done") await recordBanished(round, fresh);
  return toView(fresh, round);
}

export async function pauseReveal(roundId: string) {
  const round = await loadRound(roundId);
  const state = await getReveal(roundId);
  if (state?.status === "running") {
    state.status = "paused";
    await getStore().setJSON(stateKey(roundId), state);
  }
  return toView(state, round);
}

export async function resumeReveal(roundId: string) {
  const round = await loadRound(roundId);
  const state = await getReveal(roundId);
  if (state?.status === "paused") {
    state.status = "running";
    state.error = undefined;
    state.nextAt = new Date(Date.now() + 1000).toISOString();
    await getStore().setJSON(stateKey(roundId), state);
  }
  return toView(state, round);
}

/** Real rounds: the banished player sits out the rest of the game. */
async function recordBanished(round: Round, state: RevealState) {
  if (round.test || !round.gameId) return;
  const player = playerById(round, outcomeOf(state).banished[0] ?? "");
  if (!player) return;
  await banish(round.gameId, player, { id: round.id, title: round.title });
  await removeFromOpenRounds(round.gameId, player, { exceptRoundId: round.id });
}

/** Forget the reveal so it can be run again. Messages already posted in Slack stay. */
export async function resetReveal(roundId: string) {
  const round = await loadRound(roundId);
  await getStore().setJSON(stateKey(roundId), null);
  if (round.gameId && !round.test) await unbanish(round.gameId, { roundId });
  return null;
}

export const revealKey = stateKey;
