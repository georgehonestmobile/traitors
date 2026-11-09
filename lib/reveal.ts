import crypto from "node:crypto";
import * as slack from "./slack";
import { getStore, type Player, type Round } from "./store";
import { RoundError, roundStatus } from "./rounds";
import { suspensefulOrder, winners, type VotePair } from "./suspense";

/**
 * The reveal: a paced sequence of posts in a Slack channel.
 *
 * The host's admin page drives it: it calls `stepReveal` whenever the next step is due,
 * so the reveal pauses if that page is closed and picks up again when it is reopened.
 * Each step is claimed atomically, so two open admin tabs can't double-post.
 */

type StepBase = { delayAfter: number };
export type Step = StepBase &
  (
    | { kind: "intro" }
    | { kind: "tease"; voterId: string; n: number; total: number }
    | { kind: "reveal"; voterId: string; targetId: string; n: number; total: number }
    | { kind: "standings"; upTo: number }
    | { kind: "final" }
  );

export type RevealSettings = { channel: string; channelName: string; intervalSec: number; standingsEvery: number };

export type RevealState = RevealSettings & {
  roundId: string;
  runId: string;
  order: VotePair[];
  plan: Step[];
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
  status: RevealState["status"];
  channelName: string;
  stepsDone: number;
  stepsTotal: number;
  msUntilNext: number;
  error?: string;
  revealed: { n: number; total: number; voter: string; target: string }[];
  result?: { tally: { name: string; count: number }[]; banished: string[] };
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

function introMessage(round: Round, order: VotePair[]): Message {
  const voted = new Set(order.map((v) => v.voterId));
  const absent = round.players.filter((p) => !voted.has(p.id));
  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: round.test ? "🧪 TEST · The Round Table" : "🕯️ The Round Table", emoji: true },
    },
    section(
      `*${esc(round.title)}*\n\nThe votes are in: *${order.length}* of *${round.players.length}* players voted.\n` +
        "One by one, each player will now reveal who they believe is a *Traitor*.",
    ),
  ];
  if (absent.length) blocks.push(context(`Did not vote: ${absent.map((p) => esc(p.name)).join(", ")}`));
  if (round.test) blocks.push(context("🧪 This is a test run. The votes were cast by the host, not the players."));
  return { text: `${round.test ? "[TEST] " : ""}The Round Table: ${round.title}. The votes are in.`, blocks };
}

function teaseMessage(round: Round, step: Extract<Step, { kind: "tease" }>): Message {
  const who = esc(playerName(round)(step.voterId));
  const last = step.n === step.total;
  const line = last ? `*The final vote.* *${who}* ${TEASES[0]}` : `*${who}* ${TEASES[(step.n - 1) % TEASES.length]}`;
  return { text: `${who} is about to reveal their vote…`, blocks: [section(`🪶 ${line}`), context(`Vote ${step.n} of ${step.total}`)] };
}

function revealMessage(round: Round, step: Extract<Step, { kind: "reveal" }>): Message {
  const name = playerName(round);
  const voter = esc(name(step.voterId));
  const target = esc(name(step.targetId).toUpperCase());
  const self = step.voterId === step.targetId;
  const line = self ? `*${voter}* votes for… *${target}*. Themselves?! 😳` : `*${voter}* votes for… *${target}*`;
  return {
    text: `${name(step.voterId)} votes for ${name(step.targetId)}`,
    blocks: [section(`🗡️ ${line}`, playerById(round, step.targetId)), context(`Vote ${step.n} of ${step.total}`)],
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

function finalMessage(round: Round, order: VotePair[]): Message {
  const name = playerName(round);
  const header = {
    type: "header",
    text: { type: "plain_text", text: `${round.test ? "🧪 TEST · " : "⚖️ "}The votes have been counted`, emoji: true },
  };
  if (!order.length) {
    return { text: "No votes were cast.", blocks: [header, section("No votes were cast. Nobody is banished… tonight.")] };
  }
  const w = winners(order);
  const plural = w.count === 1 ? "vote" : "votes";
  const verdict =
    w.ids.length === 1
      ? `With *${w.count}* ${plural}, *${esc(name(w.ids[0]).toUpperCase())}*, you have been banished from the Round Table.`
      : `It's a tie! ${w.ids.map((id) => `*${esc(name(id))}*`).join(" and ")} have *${w.count}* ${plural} each.\nThe host will decide what happens next.`;
  return {
    text: w.ids.length === 1 ? `${name(w.ids[0])} has been banished.` : "It's a tie.",
    blocks: [
      header,
      section(verdict, w.ids.length === 1 ? playerById(round, w.ids[0]) : undefined),
      { type: "divider" },
      section(`*Final count*\n\n${tallyLines(round, order)}`),
    ],
  };
}

/* ---------------- Plan ---------------- */

export function buildPlan(order: VotePair[], intervalSec: number, standingsEvery: number): Step[] {
  const pause = clamp(Math.round(intervalSec * 0.35), 3, 10);
  const steps: Step[] = [{ kind: "intro", delayAfter: 8 }];
  order.forEach((v, i) => {
    const n = i + 1;
    const total = order.length;
    const last = n === total;
    const standings = !last && standingsEvery > 0 && n % standingsEvery === 0;
    steps.push({ kind: "tease", voterId: v.voterId, n, total, delayAfter: last ? pause + 4 : pause });
    steps.push({
      kind: "reveal",
      voterId: v.voterId,
      targetId: v.targetId,
      n,
      total,
      delayAfter: last ? 6 : standings ? 4 : intervalSec,
    });
    if (standings) steps.push({ kind: "standings", upTo: n, delayAfter: intervalSec });
  });
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

export function toView(state: RevealState | null, round: Round): RevealView | null {
  if (!state) return null;
  const name = playerName(round);
  const done = state.plan.slice(0, state.next);
  const view: RevealView = {
    status: state.status,
    channelName: state.channelName,
    stepsDone: state.next,
    stepsTotal: state.plan.length,
    msUntilNext: state.status === "running" ? Math.max(0, Date.parse(state.nextAt) - Date.now()) : 0,
    error: state.error,
    revealed: done.flatMap((s) =>
      s.kind === "reveal" ? [{ n: s.n, total: s.total, voter: name(s.voterId), target: name(s.targetId) }] : [],
    ),
  };
  if (state.status === "done") {
    view.result = {
      tally: tally(state.order).map(([id, count]) => ({ name: name(id), count })),
      banished: winners(state.order).ids.map(name),
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
  if (!settings.channel) throw new RoundError("Choose a channel to reveal in.");

  const intervalSec = clamp(Math.round(settings.intervalSec || 20), 5, 300);
  const standingsEvery = clamp(Math.round(settings.standingsEvery ?? 3), 0, 50);
  const eligible = new Set(round.players.map((p) => p.id));
  const votes = (await store.getVotes(roundId))
    .filter((v) => eligible.has(v.voterId) && eligible.has(v.targetId))
    .map((v) => ({ voterId: v.voterId, targetId: v.targetId }));
  const order = suspensefulOrder(votes);

  const now = Date.now();
  const state: RevealState = {
    roundId,
    runId: crypto.randomUUID().slice(0, 8),
    channel: settings.channel,
    channelName: settings.channelName,
    intervalSec,
    standingsEvery,
    order,
    plan: buildPlan(order, intervalSec, standingsEvery),
    next: 0,
    nextAt: new Date(now).toISOString(),
    status: "running",
    startedAt: new Date(now).toISOString(),
    attempt: 0,
    tsByVoter: {},
  };
  await store.setJSON(stateKey(roundId), state);
  await store.setJSON(DEFAULTS_KEY, {
    channel: state.channel,
    channelName: state.channelName,
    intervalSec,
    standingsEvery,
  } satisfies RevealSettings);
  return stepReveal(roundId);
}

async function perform(step: Step, state: RevealState, round: Round): Promise<Record<string, string>> {
  const ch = state.channel;
  switch (step.kind) {
    case "intro":
      await slack.postMessage(ch, introMessage(round, state.order));
      return {};
    case "tease":
      return { [step.voterId]: await slack.postMessage(ch, teaseMessage(round, step)) };
    case "reveal": {
      const ts = state.tsByVoter[step.voterId];
      if (ts) await slack.updateMessage(ch, ts, revealMessage(round, step));
      else await slack.postMessage(ch, revealMessage(round, step));
      return {};
    }
    case "standings":
      await slack.postMessage(ch, standingsMessage(round, state.order, step.upTo));
      return {};
    case "final":
      await slack.postMessage(ch, finalMessage(round, state.order));
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

/** Forget the reveal so it can be run again. Messages already posted in Slack stay. */
export async function resetReveal(roundId: string) {
  await loadRound(roundId);
  await getStore().setJSON(stateKey(roundId), null);
  return null;
}
