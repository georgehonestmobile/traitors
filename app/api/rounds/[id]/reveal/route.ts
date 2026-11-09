import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { RoundError } from "@/lib/rounds";
import { pauseReveal, resetReveal, resumeReveal, startReveal, stepReveal } from "@/lib/reveal";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "start":
        return NextResponse.json({
          view: await startReveal(id, {
            channel: String(body.channel ?? ""),
            channelName: String(body.channelName ?? ""),
            intervalSec: Number(body.intervalSec),
            standingsEvery: Number(body.standingsEvery),
          }),
        });
      case "step":
        return NextResponse.json({ view: await stepReveal(id) });
      case "next":
        return NextResponse.json({ view: await stepReveal(id, { force: true }) });
      case "pause":
        return NextResponse.json({ view: await pauseReveal(id) });
      case "resume":
        return NextResponse.json({ view: await resumeReveal(id) });
      case "reset":
        return NextResponse.json({ view: await resetReveal(id) });
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    const status = e instanceof RoundError ? 400 : 500;
    if (status === 500) console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status });
  }
}
