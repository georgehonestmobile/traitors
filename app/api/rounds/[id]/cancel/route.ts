import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { cancelRound, RoundError } from "@/lib/rounds";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  try {
    const { id } = await params;
    await cancelRound(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = e instanceof RoundError ? 400 : 500;
    if (status === 500) console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status });
  }
}
