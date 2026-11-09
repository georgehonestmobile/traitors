import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { setNotPlaying } from "@/lib/game";
import { listPlayers } from "@/lib/slack";

/** Body: { playerId, notPlaying: boolean } */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    const directory = await listPlayers();
    const playerId = String(body.playerId ?? "");
    if (!directory.some((p) => p.id === playerId)) return NextResponse.json({ error: "Unknown player." }, { status: 400 });
    await setNotPlaying(playerId, body.notPlaying === true, directory);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
  }
}
