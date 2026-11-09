import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { createRound, RoundError } from "@/lib/rounds";

export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  try {
    const body = await req.json();
    const round = await createRound({
      title: body.title,
      playerIds: Array.isArray(body.playerIds) ? body.playerIds.map(String) : [],
      opensAt: body.opensAt || undefined,
      closesAt: String(body.closesAt ?? ""),
      test: body.test === true,
    });
    return NextResponse.json({ id: round.id });
  } catch (e) {
    const status = e instanceof RoundError ? 400 : 500;
    if (status === 500) console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status });
  }
}
