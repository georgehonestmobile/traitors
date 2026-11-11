import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, relative } from "@/lib/format";
import { gameStats, getCurrentGame, getNotPlaying } from "@/lib/game";
import { roundStatus } from "@/lib/rounds";
import { listPlayers } from "@/lib/slack";
import { getStore, type Player, type Round } from "@/lib/store";
import { CastPanel } from "@/components/CastPanel";
import { DeleteRoundButton } from "@/components/DeleteRoundButton";
import { GameHeader } from "@/components/GameHeader";
import { NotPlayingPanel } from "@/components/NotPlayingPanel";
import { StatusPill } from "@/components/StatusPill";
import { Timeline } from "@/components/Timeline";
import { TopBar } from "@/components/TopBar";

export const dynamic = "force-dynamic";

function RoundCard({ round, votes, now }: { round: Round; votes: number; now: number }) {
  const status = roundStatus(round, now);
  const pct = Math.round((votes / round.players.length) * 100);
  return (
    <div className="round-card">
      <Link href={`/rounds/${round.id}`} className="round-link">
        <div className="top">
          <span className="name">{round.test && <span className="test-tag">Test</span>}{round.title}</span>
          <StatusPill status={status} />
        </div>
        <div className="meta">
          <span>{votes} of {round.players.length} voted</span>
          {status === "scheduled" && <span>Opens {relative(round.opensAt, now)}</span>}
          {status === "open" && <span>Closes {relative(round.closesAt, now)}</span>}
          {(status === "closed" || status === "cancelled") && <span>{formatDateTime(round.opensAt)}</span>}
        </div>
        <div className="progress" style={{ marginTop: 10 }}><span style={{ width: `${pct}%` }} /></div>
      </Link>
      <div className="foot">
        <DeleteRoundButton id={round.id} title={round.title} active={!round.test && (status === "open" || status === "scheduled")} />
      </div>
    </div>
  );
}

export default async function Home() {
  await requireAdmin();
  const store = getStore();

  let everyone: Player[] = [];
  let slackError: string | null = null;
  try {
    everyone = await listPlayers();
  } catch (e) {
    slackError = e instanceof Error ? e.message : String(e);
  }

  const [game, notPlayingIds, rounds] = await Promise.all([
    getCurrentGame(),
    getNotPlaying(everyone),
    store.listRounds(100),
  ]);
  const notPlaying = new Set(notPlayingIds);
  const directory = everyone.filter((p) => !notPlaying.has(p.id));
  const castIds = new Set(game.cast.map((c) => c.playerId));

  const voteCounts = new Map(
    await Promise.all(rounds.map(async (r) => [r.id, (await store.getVotes(r.id)).length] as const)),
  );
  const roundTitles = new Map(rounds.map((r) => [r.id, r.title]));
  const thisGame = rounds.filter((r) => r.gameId === game.id);
  const earlier = rounds.filter((r) => r.gameId !== game.id);
  const now = Date.now();
  const gameNumber = Number(game.name.match(/^Game (\d+)$/)?.[1]);

  const outLabels = Object.fromEntries(
    game.cast
      .filter((c) => c.status !== "in")
      .map((c) => [c.playerId, (c.outRoundId && roundTitles.get(c.outRoundId)) || (c.outAt ? formatDateTime(c.outAt) : "")]),
  );

  return (
    <div className="shell">
      <TopBar />
      <GameHeader
        name={game.name}
        startedAt={formatDateTime(game.createdAt)}
        status={game.status}
        winner={game.winner}
        castSize={game.cast.length}
        stats={gameStats(game)}
        nextName={gameNumber ? `Game ${gameNumber + 1}` : "New game"}
      />

      <div className="grid">
        <div className="side">
          {slackError ? (
            <div className="panel">
              <h2 className="panel-title">Couldn&apos;t load Slack members</h2>
              <div className="error" style={{ marginTop: 12 }}>{slackError}</div>
              <p className="panel-sub">Check SLACK_BOT_TOKEN and that the app has the users:read scope.</p>
            </div>
          ) : null}
          <CastPanel
            cast={game.cast}
            addable={directory.filter((p) => !castIds.has(p.id))}
            ended={game.status === "ended"}
            outLabels={outLabels}
          />
        </div>

        <div className="side">
          <section className="panel">
            <div className="reveal-head">
              <h2 className="panel-title">Rounds</h2>
              {game.status === "active" && <Link className="btn ghost small" href="/rounds/new">+ Call a vote</Link>}
            </div>
            <p className="panel-sub">This game, most recent first.</p>
            <div className="rounds">
              {!thisGame.length && <div className="empty">No rounds in this game yet.</div>}
              {thisGame.map((r) => (
                <RoundCard key={r.id} round={r} votes={voteCounts.get(r.id) ?? 0} now={now} />
              ))}
            </div>
            {earlier.length > 0 && (
              <details className="earlier">
                <summary>Earlier rounds ({earlier.length})</summary>
                <div className="rounds">
                  {earlier.map((r) => (
                    <RoundCard key={r.id} round={r} votes={voteCounts.get(r.id) ?? 0} now={now} />
                  ))}
                </div>
              </details>
            )}
          </section>

          <Timeline events={game.events} />

          {!slackError && (
            <NotPlayingPanel hidden={everyone.filter((p) => notPlaying.has(p.id))} others={directory} />
          )}
        </div>
      </div>
    </div>
  );
}
