import { Redis } from "@upstash/redis";

export type Player = { id: string; name: string; avatar?: string };

export type Delivery = {
  /** DM channel id between the bot and this player */
  channel?: string;
  /** Set when the DM was posted immediately */
  ts?: string;
  /** Set when the DM was scheduled for the opening time */
  scheduledId?: string;
  /** The "voting has closed" DM scheduled for the deadline */
  closeScheduledId?: string;
  error?: string;
};

export type Round = {
  id: string;
  title: string;
  /** ISO timestamps (UTC) */
  opensAt: string;
  closesAt: string;
  createdAt: string;
  players: Player[];
  delivery: Record<string, Delivery>;
  closedEarlyAt?: string;
  cancelledAt?: string;
  /** Test round: no Slack DMs; the host casts votes from the admin panel. */
  test?: boolean;
  /** The game this round belongs to (missing on rounds from before games existed). */
  gameId?: string;
};

export type Vote = { voterId: string; targetId: string; at: string };

export interface Store {
  readonly kind: "redis" | "memory";
  saveRound(round: Round): Promise<void>;
  getRound(id: string): Promise<Round | null>;
  listRounds(limit?: number): Promise<Round[]>;
  /** Records a vote only if this voter hasn't voted in this round. Returns false if they already had. */
  castVote(roundId: string, vote: Vote): Promise<boolean>;
  getVotes(roundId: string): Promise<Vote[]>;
  /** Removes the round, its votes and the given extra keys. */
  deleteRound(id: string, extraKeys?: string[]): Promise<void>;
  getJSON<T>(key: string): Promise<T | null>;
  setJSON(key: string, value: unknown): Promise<void>;
  /** Atomic "claim": true for the first caller only, until ttl expires. */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
}

const roundKey = (id: string) => `round:${id}`;
const votesKey = (id: string) => `votes:${id}`;
const ROUNDS_INDEX = "rounds";

class RedisStore implements Store {
  readonly kind = "redis" as const;
  constructor(private redis: Redis) {}

  async saveRound(round: Round) {
    await this.redis.set(roundKey(round.id), round);
    await this.redis.zadd(ROUNDS_INDEX, { score: Date.parse(round.createdAt), member: round.id });
  }

  async getRound(id: string) {
    return (await this.redis.get<Round>(roundKey(id))) ?? null;
  }

  async listRounds(limit = 50) {
    const ids = await this.redis.zrange<string[]>(ROUNDS_INDEX, 0, limit - 1, { rev: true });
    if (!ids.length) return [];
    const rounds = await this.redis.mget<(Round | null)[]>(...ids.map(roundKey));
    return rounds.filter((r): r is Round => !!r);
  }

  async castVote(roundId: string, vote: Vote) {
    const added = await this.redis.hsetnx(votesKey(roundId), vote.voterId, vote);
    return added === 1;
  }

  async getVotes(roundId: string) {
    const all = await this.redis.hgetall<Record<string, Vote>>(votesKey(roundId));
    return Object.values(all ?? {});
  }

  async deleteRound(id: string, extraKeys: string[] = []) {
    await this.redis.del(roundKey(id), votesKey(id), ...extraKeys);
    await this.redis.zrem(ROUNDS_INDEX, id);
  }

  async getJSON<T>(key: string) {
    return (await this.redis.get<T>(key)) ?? null;
  }
  async setJSON(key: string, value: unknown) {
    await this.redis.set(key, value);
  }
  async claim(key: string, ttlSeconds: number) {
    return (await this.redis.set(key, 1, { nx: true, ex: ttlSeconds })) === "OK";
  }
}

/** Dev-only fallback. Data is lost when the server restarts. */
class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private rounds = new Map<string, Round>();
  private votes = new Map<string, Map<string, Vote>>();

  async saveRound(round: Round) {
    this.rounds.set(round.id, structuredClone(round));
  }
  async getRound(id: string) {
    const r = this.rounds.get(id);
    return r ? structuredClone(r) : null;
  }
  async listRounds(limit = 50) {
    return [...this.rounds.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((r) => structuredClone(r));
  }
  async castVote(roundId: string, vote: Vote) {
    const m = this.votes.get(roundId) ?? new Map<string, Vote>();
    this.votes.set(roundId, m);
    if (m.has(vote.voterId)) return false;
    m.set(vote.voterId, vote);
    return true;
  }
  async getVotes(roundId: string) {
    return [...(this.votes.get(roundId)?.values() ?? [])];
  }
  async deleteRound(id: string, extraKeys: string[] = []) {
    this.rounds.delete(id);
    this.votes.delete(id);
    for (const k of extraKeys) this.kv.delete(k);
  }
  private kv = new Map<string, unknown>();
  private claims = new Map<string, number>();
  async getJSON<T>(key: string) {
    const v = this.kv.get(key);
    return v === undefined ? null : (structuredClone(v) as T);
  }
  async setJSON(key: string, value: unknown) {
    this.kv.set(key, structuredClone(value));
  }
  async claim(key: string, ttlSeconds: number) {
    const until = this.claims.get(key);
    if (until && until > Date.now()) return false;
    this.claims.set(key, Date.now() + ttlSeconds * 1000);
    return true;
  }
}

const g = globalThis as unknown as { __roundTableStore?: Store };

export function getStore(): Store {
  if (g.__roundTableStore) return g.__roundTableStore;

  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    g.__roundTableStore = new RedisStore(new Redis({ url, token }));
  } else {
    if (process.env.VERCEL) {
      throw new Error(
        "No Redis configured. Add Upstash Redis to this Vercel project (Storage tab) so KV_REST_API_URL and KV_REST_API_TOKEN are set.",
      );
    }
    g.__roundTableStore = new MemoryStore();
  }
  return g.__roundTableStore;
}
