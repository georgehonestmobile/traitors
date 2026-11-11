import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getCurrentGame, getNotPlaying } from "@/lib/game";
import { listPlayers } from "@/lib/slack";
import { getStore, type Player } from "@/lib/store";
import { NewRoundForm } from "@/components/NewRoundForm";
import { TopBar } from "@/components/TopBar";

export const dynamic = "force-dynamic";

export default async function NewRoundPage() {
  await requireAdmin();

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
    getStore().listRounds(20),
  ]);
  const notPlaying = new Set(notPlayingIds);

  // With a cast, the vote is between cast members (those who are out are greyed out).
  // Without one, any Slack member who isn't marked "not playing" can take part.
  const players: Player[] = game.cast.length
    ? game.cast
        .filter((c) => !notPlaying.has(c.playerId))
        .map((c) => ({ id: c.playerId, name: c.name, avatar: c.avatar }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : everyone.filter((p) => !notPlaying.has(p.id));
  const outIds = game.cast.filter((c) => c.status !== "in").map((c) => c.playerId);
  const lastRound = rounds.find((r) => r.gameId === game.id);

  return (
    <div className="shell narrow">
      <TopBar />
      <Link href="/" className="back">← {game.name}</Link>
      <div style={{ marginTop: 14 }}>
        {slackError && !game.cast.length ? (
          <div className="panel">
            <h2 className="panel-title">Couldn&apos;t load Slack members</h2>
            <div className="error" style={{ marginTop: 12 }}>{slackError}</div>
          </div>
        ) : game.status === "ended" ? (
          <div className="panel">
            <h2 className="panel-title">{game.name} has ended</h2>
            <p className="panel-sub">Start a new game from the dashboard to call another vote.</p>
          </div>
        ) : (
          <NewRoundForm
            players={players}
            banishedIds={outIds}
            lastRoundPlayerIds={lastRound?.players.map((p) => p.id) ?? []}
            // With a cast, everyone still in the game is ticked to start with.
            preselectedIds={players.map((p) => p.id).filter((id) => !outIds.includes(id) && game.cast.length > 0)}
          />
        )}
      </div>
    </div>
  );
}
