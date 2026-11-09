import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { banish, getCurrentGame, startNewGame, unbanish } from "@/lib/game";
import { listPlayers } from "@/lib/slack";

/** Body: { action: "new", name } | { action: "banish", playerId } | { action: "unbanish", playerId } */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "new") {
      const game = await startNewGame(String(body.name ?? ""));
      return NextResponse.json({ id: game.id });
    }
    const game = await getCurrentGame();
    const playerId = String(body.playerId ?? "");
    if (body.action === "banish") {
      const player = (await listPlayers()).find((p) => p.id === playerId);
      if (!player) return NextResponse.json({ error: "Unknown player." }, { status: 400 });
      await banish(game.id, player);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "unbanish") {
      await unbanish(game.id, { playerId });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
  }
}
