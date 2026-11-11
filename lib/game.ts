import crypto from "node:crypto";
import { parseSchedule, type Departure, type ScheduleItem, type ScheduleKind } from "./schedule";
import { getStore, type Player } from "./store";

/**
 * A game runs from start to finish: a cast of players, each Faithful or a Traitor
 * (some recruited along the way), who leave by banishment or murder until the host
 * ends the game. Every change is logged on the game's timeline.
 *
 * Separately, some people are never playing (e.g. the host): they're hidden from
 * every player list.
 */

export type Role = "faithful" | "traitor";
export type CastStatus = "in" | "banished" | "murdered";

export type CastMember = {
  playerId: string;
  name: string;
  avatar?: string;
  role: Role;
  /** Set when a Faithful was recruited as a Traitor mid-game. */
  recruitedAt?: string;
  status: CastStatus;
  outAt?: string;
  /** The round whose reveal banished them. */
  outRoundId?: string;
};

export type GameEventKind =
  | "started"
  | "joined"
  | "left"
  | "role"
  | "recruited"
  | "banished"
  | "murdered"
  | "restored"
  | "ended"
  | "reopened";

export type GameEvent = { id: string; at: string; kind: GameEventKind; text: string; playerId?: string; roundId?: string };

export type Winner = "faithful" | "traitors";

export type Game = {
  id: string;
  name: string;
  createdAt: string;
  status: "active" | "ended";
  endedAt?: string;
  winner?: Winner;
  cast: CastMember[];
  /** Newest last. */
  events: GameEvent[];
  /** Planned murders, banishments and the end game. */
  schedule?: ScheduleItem[];
  /** Players expected at the start of the schedule. */
  plannedStart?: number;
};

/** Games saved before the cast existed only had a banished list. */
type LegacyGame = Partial<Game> & { id: string; name: string; createdAt: string; banished?: { playerId: string; name: string; at: string; roundId?: string }[] };

const CURRENT_GAME = "game:current";
const gameKey = (id: string) => `game:${id}`;
const NOT_PLAYING = "settings:not-playing";
const MAX_EVENTS = 500;

/** Who's never playing, until the host edits the list in the admin panel. */
const DEFAULT_NOT_PLAYING_IDS = [
  "U0BPJ31LJP5", // Adam Parker
  "U05JLLS4Q7M", // Fi
  "U05NPDYL8ES", // George (host)
  "U0A0YBAV58V", // Lauren Tenner
  "U09U17U68KT", // Precious
];
/** Matched by first name when the list is first created (no Slack ID to hand). */
const DEFAULT_NOT_PLAYING_FIRST_NAMES = ["tarik"];

export const roleLabel = (m: Pick<CastMember, "role" | "recruitedAt">) =>
  m.role === "traitor" ? (m.recruitedAt ? "Recruited Traitor" : "Traitor") : "Faithful";

function normalize(raw: LegacyGame): Game {
  if (raw.cast && raw.events && raw.status) return raw as Game;
  const cast: CastMember[] = (raw.banished ?? []).map((b) => ({
    playerId: b.playerId,
    name: b.name,
    role: "faithful",
    status: "banished",
    outAt: b.at,
    ...(b.roundId ? { outRoundId: b.roundId } : {}),
  }));
  return {
    id: raw.id,
    name: raw.name,
    createdAt: raw.createdAt,
    status: raw.status ?? "active",
    cast: raw.cast ?? cast,
    events: raw.events ?? [{ id: "start", at: raw.createdAt, kind: "started", text: `${raw.name} began.` }],
  };
}

function log(game: Game, kind: GameEventKind, text: string, extra: { playerId?: string; roundId?: string } = {}) {
  game.events.push({ id: crypto.randomUUID().slice(0, 8), at: new Date().toISOString(), kind, text, ...extra });
  if (game.events.length > MAX_EVENTS) game.events = game.events.slice(-MAX_EVENTS);
}

async function load(id: string): Promise<Game | null> {
  const raw = await getStore().getJSON<LegacyGame>(gameKey(id));
  return raw ? normalize(raw) : null;
}

async function save(game: Game) {
  await getStore().setJSON(gameKey(game.id), game);
}

export class GameError extends Error {}

/** Load, change and save a game. */
async function update(gameId: string, fn: (game: Game) => void): Promise<Game> {
  const game = await load(gameId);
  if (!game) throw new GameError("Game not found.");
  fn(game);
  await save(game);
  return game;
}

const member = (game: Game, playerId: string) => {
  const m = game.cast.find((c) => c.playerId === playerId);
  if (!m) throw new GameError("That player isn't in this game.");
  return m;
};

/* ---------------- Reading ---------------- */

/** The game in progress, creating "Game 1" the first time. */
export async function getCurrentGame(): Promise<Game> {
  const id = await getStore().getJSON<string>(CURRENT_GAME);
  const game = id ? await load(id) : null;
  return game ?? startNewGame("Game 1");
}

export type GameStats = {
  inPlay: number;
  faithfulIn: number;
  traitorsIn: number;
  banished: number;
  murdered: number;
  /** A suggested winner once the game looks decided, for the host to confirm. */
  suggestion?: { winner: Winner; reason: string };
};

export function gameStats(game: Game): GameStats {
  const inPlay = game.cast.filter((c) => c.status === "in");
  const traitorsIn = inPlay.filter((c) => c.role === "traitor").length;
  const faithfulIn = inPlay.length - traitorsIn;
  const everTraitor = game.cast.some((c) => c.role === "traitor");
  let suggestion: GameStats["suggestion"];
  if (game.status === "active" && everTraitor && traitorsIn === 0) {
    suggestion = { winner: "faithful", reason: "Every Traitor has been banished." };
  } else if (game.status === "active" && traitorsIn > 0 && traitorsIn >= faithfulIn) {
    suggestion = { winner: "traitors", reason: "The Traitors now match or outnumber the Faithful." };
  }
  return {
    inPlay: inPlay.length,
    faithfulIn,
    traitorsIn,
    banished: game.cast.filter((c) => c.status === "banished").length,
    murdered: game.cast.filter((c) => c.status === "murdered").length,
    suggestion,
  };
}

/** IDs of cast members still in the game. Empty cast means "anyone can play". */
export function activeIds(game: Game) {
  return game.cast.filter((c) => c.status === "in").map((c) => c.playerId);
}

/** Players who have left the game, in order. */
export function departures(game: Game): Departure[] {
  return game.cast
    .filter((c) => c.status !== "in" && c.outAt)
    .map((c) => ({ playerId: c.playerId, name: c.name, how: c.status as Departure["how"], at: c.outAt! }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/* ---------------- Schedule ---------------- */

const KINDS: ScheduleKind[] = ["murder", "banishment", "end"];
const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const newId = () => crypto.randomUUID().slice(0, 8);

/** Replace the schedule with one pasted from a spreadsheet. */
export const importSchedule = (gameId: string, text: string) =>
  update(gameId, (g) => {
    const { items, plannedStart } = parseSchedule(text, g.createdAt.slice(0, 10));
    if (!items.length) throw new GameError("Couldn't find any dates with Murder, Banishment or End Game in that text.");
    g.schedule = items.map((it) => ({ ...it, id: newId() }));
    g.plannedStart = plannedStart ?? g.plannedStart ?? (g.cast.length || undefined);
  });

export const clearSchedule = (gameId: string) =>
  update(gameId, (g) => {
    g.schedule = [];
  });

export const setPlannedStart = (gameId: string, n: number) =>
  update(gameId, (g) => {
    if (!Number.isInteger(n) || n < 1 || n > 500) throw new GameError("Enter a number of players.");
    g.plannedStart = n;
  });

export const addScheduleItem = (gameId: string, date: string, kind: ScheduleKind) =>
  update(gameId, (g) => {
    if (!validDate(date)) throw new GameError("Choose a date.");
    if (!KINDS.includes(kind)) throw new GameError("Unknown event type.");
    g.schedule = [...(g.schedule ?? []), { id: newId(), date, kind }];
  });

export const updateScheduleItem = (gameId: string, id: string, patch: { date?: string; kind?: ScheduleKind; skipped?: boolean }) =>
  update(gameId, (g) => {
    const it = (g.schedule ?? []).find((x) => x.id === id);
    if (!it) throw new GameError("That event isn't in the schedule.");
    if (patch.date !== undefined) {
      if (!validDate(patch.date)) throw new GameError("Choose a date.");
      it.date = patch.date;
    }
    if (patch.kind !== undefined) {
      if (!KINDS.includes(patch.kind)) throw new GameError("Unknown event type.");
      it.kind = patch.kind;
      if (patch.kind === "end") it.skipped = undefined;
    }
    if (patch.skipped !== undefined) it.skipped = patch.skipped || undefined;
  });

export const deleteScheduleItem = (gameId: string, id: string) =>
  update(gameId, (g) => {
    g.schedule = (g.schedule ?? []).filter((x) => x.id !== id);
  });

/* ---------------- Game lifecycle ---------------- */

export async function startNewGame(name: string, copyCastFrom?: Game): Promise<Game> {
  const title = name.trim().slice(0, 60) || "New game";
  const game: Game = {
    id: crypto.randomUUID().slice(0, 8),
    name: title,
    createdAt: new Date().toISOString(),
    status: "active",
    cast: (copyCastFrom?.cast ?? []).map((c) => ({ playerId: c.playerId, name: c.name, avatar: c.avatar, role: "faithful", status: "in" })),
    events: [],
  };
  log(game, "started", `${title} began${game.cast.length ? ` with ${game.cast.length} players` : ""}.`);
  await save(game);
  await getStore().setJSON(CURRENT_GAME, game.id);
  return game;
}

export const endGame = (gameId: string, winner: Winner) =>
  update(gameId, (g) => {
    g.status = "ended";
    g.endedAt = new Date().toISOString();
    g.winner = winner;
    const traitors = g.cast.filter((c) => c.role === "traitor").map((c) => c.name);
    log(g, "ended", `Game over: the ${winner === "faithful" ? "Faithful" : "Traitors"} win.${traitors.length ? ` The Traitors were ${traitors.join(", ")}.` : ""}`);
  });

export const reopenGame = (gameId: string) =>
  update(gameId, (g) => {
    g.status = "active";
    g.endedAt = undefined;
    g.winner = undefined;
    log(g, "reopened", "The game was reopened.");
  });

/* ---------------- Cast ---------------- */

export const addPlayers = (gameId: string, players: Player[]) =>
  update(gameId, (g) => {
    for (const p of players) {
      if (g.cast.some((c) => c.playerId === p.id)) continue;
      g.cast.push({ playerId: p.id, name: p.name, avatar: p.avatar, role: "faithful", status: "in" });
      log(g, "joined", `${p.name} joined the game.`, { playerId: p.id });
    }
  });

export const removePlayer = (gameId: string, playerId: string) =>
  update(gameId, (g) => {
    const m = member(g, playerId);
    g.cast = g.cast.filter((c) => c !== m);
    log(g, "left", `${m.name} was removed from the game.`, { playerId });
  });

/** Set someone's role (e.g. choosing the original Traitors, or fixing a mistake). */
export const setRole = (gameId: string, playerId: string, role: Role) =>
  update(gameId, (g) => {
    const m = member(g, playerId);
    if (m.role === role && !m.recruitedAt) return;
    m.role = role;
    m.recruitedAt = undefined;
    log(g, "role", role === "traitor" ? `${m.name} is a Traitor.` : `${m.name} is Faithful.`, { playerId });
  });

export const recruit = (gameId: string, playerId: string) =>
  update(gameId, (g) => {
    const m = member(g, playerId);
    if (m.status !== "in") throw new GameError(`${m.name} is no longer in the game.`);
    if (m.role === "traitor") throw new GameError(`${m.name} is already a Traitor.`);
    m.role = "traitor";
    m.recruitedAt = new Date().toISOString();
    log(g, "recruited", `${m.name} was recruited as a Traitor.`, { playerId });
  });

function markOut(g: Game, m: CastMember, how: "banished" | "murdered", round?: { id: string; title: string }) {
  m.status = how;
  m.outAt = new Date().toISOString();
  m.outRoundId = round?.id;
  const verb = how === "banished" ? "was banished" : "was murdered";
  const where = round ? ` in “${round.title}”` : "";
  log(g, how, `${m.name} ${verb}${where}. They were ${m.role === "traitor" ? "a Traitor" : "Faithful"}.`, {
    playerId: m.playerId,
    ...(round ? { roundId: round.id } : {}),
  });
}

export const murder = (gameId: string, playerId: string) =>
  update(gameId, (g) => {
    const m = member(g, playerId);
    if (m.status !== "in") throw new GameError(`${m.name} is no longer in the game.`);
    if (m.role === "traitor") throw new GameError(`${m.name} is a Traitor. Traitors can't be murdered.`);
    markOut(g, m, "murdered");
  });

/** Banish someone, by hand or from a round's reveal. Adds them to the cast if needed. */
export async function banish(gameId: string, player: Player, round?: { id: string; title: string }) {
  await update(gameId, (g) => {
    // A round banishes one person: re-running its reveal replaces its earlier result.
    if (round) {
      for (const c of g.cast) {
        if (c.outRoundId === round.id && c.playerId !== player.id) restoreMember(g, c);
      }
    }
    let m = g.cast.find((c) => c.playerId === player.id);
    if (!m) {
      m = { playerId: player.id, name: player.name, avatar: player.avatar, role: "faithful", status: "in" };
      g.cast.push(m);
    }
    if (m.status === "banished" && m.outRoundId === round?.id) return;
    markOut(g, m, "banished", round);
  });
}

function restoreMember(g: Game, m: CastMember) {
  if (m.status === "in") return;
  m.status = "in";
  m.outAt = undefined;
  m.outRoundId = undefined;
  log(g, "restored", `${m.name} was brought back into the game.`, { playerId: m.playerId });
}

/** Bring someone back: by player, or whoever a given round banished. */
export const unbanish = (gameId: string, match: { playerId?: string; roundId?: string }) =>
  update(gameId, (g) => {
    for (const c of g.cast) {
      if ((match.playerId && c.playerId === match.playerId) || (match.roundId && c.outRoundId === match.roundId)) {
        restoreMember(g, c);
      }
    }
  });

/* ---------------- Not playing ---------------- */

/** Slack IDs of people who are never playing. Seeds the defaults the first time. */
export async function getNotPlaying(directory: Player[]): Promise<string[]> {
  const store = getStore();
  const saved = await store.getJSON<string[]>(NOT_PLAYING);
  if (saved) return saved;
  const byName = directory
    .filter((p) => DEFAULT_NOT_PLAYING_FIRST_NAMES.includes(p.name.trim().split(/\s+/)[0].toLowerCase()))
    .map((p) => p.id);
  const ids = [...new Set([...DEFAULT_NOT_PLAYING_IDS, ...byName])];
  // Only save once we've seen the real Slack directory, so name matches aren't lost.
  if (directory.length) await store.setJSON(NOT_PLAYING, ids);
  return ids;
}

export async function setNotPlaying(playerId: string, notPlaying: boolean, directory: Player[]) {
  const ids = new Set(await getNotPlaying(directory));
  if (notPlaying) ids.add(playerId);
  else ids.delete(playerId);
  await getStore().setJSON(NOT_PLAYING, [...ids]);
}
