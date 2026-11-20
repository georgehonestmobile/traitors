import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { RoundError } from "@/lib/rounds";
import { moveScript, pauseReveal, resetReveal, resumeReveal, startReveal, stepReveal } from "@/lib/reveal";
import { enterRevotePaper, finishRevote, requestRevote } from "@/lib/revote";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "start":
        return NextResponse.json({
          view: await startReveal(id, {
            mode: body.mode === "in-person" ? "in-person" : "slack",
            channel: String(body.channel ?? ""),
            channelName: String(body.channelName ?? ""),
            standingsEvery: Number(body.standingsEvery),
          }),
        });
      case "step":
        return NextResponse.json({ view: await stepReveal(id) });
      case "next":
        return NextResponse.json({ view: await stepReveal(id, { force: true }) });
      case "prev":
        return NextResponse.json({ view: await moveScript(id, -1) });
      case "pause":
        return NextResponse.json({ view: await pauseReveal(id) });
      case "resume":
        return NextResponse.json({ view: await resumeReveal(id) });
      // Face-to-face meetings: the tiebreak re-vote.
      case "revote-request":
        await requestRevote(id);
        return NextResponse.json({ view: await stepReveal(id) });
      case "revote-finish":
        await finishRevote(id);
        return NextResponse.json({ view: await stepReveal(id) });
      case "revote-end-now":
        await finishRevote(id, { now: true });
        return NextResponse.json({ view: await stepReveal(id) });
      case "revote-paper":
        await enterRevotePaper(id, String(body.voterId ?? ""), body.targetId ? String(body.targetId) : null);
        return NextResponse.json({ view: await stepReveal(id) });
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
