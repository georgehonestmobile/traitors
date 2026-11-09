import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, relative } from "@/lib/format";
import { roundStatus } from "@/lib/rounds";
import { listPlayers } from "@/lib/slack";
import { getStore, type Player } from "@/lib/store";
import { NewRoundForm } from "@/components/NewRoundForm";
import { StatusPill } from "@/components/StatusPill";
import { TopBar } from "@/components/TopBar";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireAdmin();
  const store = getStore();

  let players: Player[] = [];
  let slackError: string | null = null;
  try {
    players = await listPlayers();
  } catch (e) {
    slackError = e instanceof Error ? e.message : String(e);
  }

  const rounds = await store.listRounds(30);
  const voteCounts = await Promise.all(rounds.map((r) => store.getVotes(r.id).then((v) => v.length)));
  const now = Date.now();

  return (
    <div className="shell">
      <TopBar />
      <div className="grid">
        {slackError ? (
          <div className="panel">
            <h2 className="panel-title">Couldn&apos;t load Slack members</h2>
            <div className="error" style={{ marginTop: 12 }}>{slackError}</div>
            <p className="panel-sub">Check SLACK_BOT_TOKEN and that the app has the users:read scope.</p>
          </div>
        ) : (
          <NewRoundForm players={players} lastRoundPlayerIds={rounds[0]?.players.map((p) => p.id) ?? []} />
        )}

        <section className="panel">
          <h2 className="panel-title">Rounds</h2>
          <p className="panel-sub">Most recent first.</p>
          <div className="rounds">
            {!rounds.length && <div className="empty">No rounds yet. Call your first vote.</div>}
            {rounds.map((r, i) => {
              const status = roundStatus(r, now);
              const pct = Math.round((voteCounts[i] / r.players.length) * 100);
              return (
                <Link key={r.id} href={`/rounds/${r.id}`} className="round-card">
                  <div className="top">
                    <span className="name">{r.title}</span>
                    <StatusPill status={status} />
                  </div>
                  <div className="meta">
                    <span>{voteCounts[i]} of {r.players.length} voted</span>
                    {status === "scheduled" && <span>Opens {relative(r.opensAt, now)}</span>}
                    {status === "open" && <span>Closes {relative(r.closesAt, now)}</span>}
                    {(status === "closed" || status === "cancelled") && <span>{formatDateTime(r.opensAt)}</span>}
                  </div>
                  <div className="progress" style={{ marginTop: 10 }}><span style={{ width: `${pct}%` }} /></div>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
