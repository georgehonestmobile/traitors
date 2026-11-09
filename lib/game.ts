import crypto from "node:crypto";
import { getStore, type Player } from "./store";

/**
 * A game is a series of rounds. Players banished in a game can't be picked for
 * that game's later rounds. Starting a new game clears the banished list.
 *
 * Separately, some people are never playing (e.g. the host): they're hidden from
 * the player picker in every game.
 */

export type Banished = {
  playerId: string;
  name: string;
  at: string;
  /** Set when a reveal banished them; missing when the host added them by hand. */
  roundId?: string;
};

export type Game = { id: string; name: string; createdAt: string; banished: Banished[] };

const CURRENT_GAME = "game:current";
const gameKey = (id: string) => `game:${id}`;
const NOT_PLAYING = "settings:not-playing";

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

async function saveGame(game: Game) {
  await getStore().setJSON(gameKey(game.id), game);
}

/** The game in progress, creating "Game 1" the first time. */
export async function getCurrentGame(): Promise<Game> {
  const store = getStore();
  const id = await store.getJSON<string>(CURRENT_GAME);
  const game = id ? await store.getJSON<Game>(gameKey(id)) : null;
  if (game) return game;
  return startNewGame("Game 1");
}

export async function startNewGame(name: string): Promise<Game> {
  const game: Game = {
    id: crypto.randomUUID().slice(0, 8),
    name: name.trim().slice(0, 60) || "New game",
    createdAt: new Date().toISOString(),
    banished: [],
  };
  await saveGame(game);
  await getStore().setJSON(CURRENT_GAME, game.id);
  return game;
}

export async function banish(gameId: string, player: Player, roundId?: string) {
  const game = await getStore().getJSON<Game>(gameKey(gameId));
  if (!game) return;
  // A round banishes one person: re-running its reveal replaces its earlier result.
  game.banished = game.banished.filter((b) => b.playerId !== player.id && (!roundId || b.roundId !== roundId));
  game.banished.push({ playerId: player.id, name: player.name, at: new Date().toISOString(), ...(roundId ? { roundId } : {}) });
  await saveGame(game);
}

export async function unbanish(gameId: string, match: { playerId?: string; roundId?: string }) {
  const game = await getStore().getJSON<Game>(gameKey(gameId));
  if (!game) return;
  game.banished = game.banished.filter(
    (b) => !((match.playerId && b.playerId === match.playerId) || (match.roundId && b.roundId === match.roundId)),
  );
  await saveGame(game);
}

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
