import crypto from "node:crypto";
import type { Player } from "./store";

const API = "https://slack.com/api/";

/** Demo mode: no Slack token configured, so use a fake cast and log DMs instead of sending them. */
export const isDemo = () => !process.env.SLACK_BOT_TOKEN;

type SlackResponse = { ok: boolean; error?: string; [k: string]: unknown };

async function call<T extends SlackResponse>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(API + method, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json()) as T;
  if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error ?? res.status}`);
  return data;
}

const DEMO_PLAYERS: Player[] = [
  "Jack", "Ciara", "Adam", "Priya", "Tom", "Niamh", "Marcus", "Sofia", "Elliot", "Hannah",
].map((name, i) => ({ id: `UDEMO${String(i + 1).padStart(3, "0")}`, name }));

type SlackUser = {
  id: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
  real_name?: string;
  profile?: { display_name?: string; real_name?: string; image_72?: string };
};

/** All real (non-bot, non-deleted) people in the workspace. */
export async function listPlayers(): Promise<Player[]> {
  if (isDemo()) return DEMO_PLAYERS;

  const players: Player[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ limit: "200" });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`${API}users.list?${params}`, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
      cache: "no-store",
    });
    const data = (await res.json()) as SlackResponse & {
      members?: SlackUser[];
      response_metadata?: { next_cursor?: string };
    };
    if (!data.ok) throw new Error(`Slack users.list failed: ${data.error}`);
    for (const u of data.members ?? []) {
      if (u.deleted || u.is_bot || u.is_app_user || u.id === "USLACKBOT") continue;
      players.push({
        id: u.id,
        name: u.profile?.display_name || u.profile?.real_name || u.real_name || u.id,
        avatar: u.profile?.image_72,
      });
    }
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return players.sort((a, b) => a.name.localeCompare(b.name));
}

export type Channel = { id: string; name: string; isPrivate: boolean };

/** Public channels, plus private channels the bot has been invited to. */
export async function listChannels(): Promise<Channel[]> {
  if (isDemo()) {
    return [
      { id: "CDEMO001", name: "round-table", isPrivate: false },
      { id: "CDEMO002", name: "general", isPrivate: false },
      { id: "GDEMO003", name: "traitors-hosts", isPrivate: true },
    ];
  }
  const channels: Channel[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({
      limit: "1000",
      exclude_archived: "true",
      types: "public_channel,private_channel",
    });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`${API}conversations.list?${params}`, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
      cache: "no-store",
    });
    const data = (await res.json()) as SlackResponse & {
      channels?: { id: string; name: string; is_private?: boolean }[];
      response_metadata?: { next_cursor?: string };
    };
    if (!data.ok) throw new Error(`Slack conversations.list failed: ${data.error}`);
    for (const c of data.channels ?? []) channels.push({ id: c.id, name: c.name, isPrivate: !!c.is_private });
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return channels.sort((a, b) => a.name.localeCompare(b.name));
}

export async function openDm(userId: string): Promise<string> {
  if (isDemo()) return `DDEMO-${userId}`;
  const res = await call<SlackResponse & { channel: { id: string } }>("conversations.open", { users: userId });
  return res.channel.id;
}

type Message = { text: string; blocks: unknown[] };

export async function postMessage(channel: string, msg: Message): Promise<string> {
  if (isDemo()) {
    console.log(`[demo] DM to ${channel}: ${msg.text}`);
    return `${Date.now() / 1000}`;
  }
  const res = await call<SlackResponse & { ts: string }>("chat.postMessage", { channel, ...msg });
  return res.ts;
}

export async function scheduleMessage(channel: string, postAt: Date, msg: Message): Promise<string> {
  if (isDemo()) {
    console.log(`[demo] DM to ${channel} scheduled for ${postAt.toISOString()}: ${msg.text}`);
    return `QDEMO-${channel}`;
  }
  const res = await call<SlackResponse & { scheduled_message_id: string }>("chat.scheduleMessage", {
    channel,
    post_at: Math.floor(postAt.getTime() / 1000),
    ...msg,
  });
  return res.scheduled_message_id;
}

export async function deleteScheduledMessage(channel: string, scheduledId: string): Promise<void> {
  if (isDemo()) {
    console.log(`[demo] Deleted scheduled DM ${scheduledId}`);
    return;
  }
  await call("chat.deleteScheduledMessage", { channel, scheduled_message_id: scheduledId });
}

export async function updateMessage(channel: string, ts: string, msg: Message): Promise<void> {
  if (isDemo()) {
    console.log(`[demo] Updated DM ${channel}/${ts}: ${msg.text}`);
    return;
  }
  await call("chat.update", { channel, ts, ...msg });
}

/** Replace the message a player interacted with, via the interaction's response_url. */
export async function respond(responseUrl: string, msg: Message): Promise<void> {
  if (isDemo() && !responseUrl.startsWith("https://hooks.slack.com/")) {
    console.log(`[demo] Response: ${msg.text}`);
    return;
  }
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ replace_original: true, ...msg }),
  });
}

/** https://api.slack.com/authentication/verifying-requests-from-slack */
export function verifySlackRequest(rawBody: string, timestamp: string | null, signature: string | null): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 60 * 5) return false;
  const expected =
    "v0=" + crypto.createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
