import * as msg from "./messages";
import { roundStatus } from "./rounds";
import * as slack from "./slack";
import { getStore } from "./store";

/**
 * A player has left the game (murdered or banished). Take them out of every open or upcoming
 * round in that game: their vote no longer counts, pending DMs to them are withdrawn, and anyone
 * who voted for them is asked to vote again. Returns the titles of the rounds affected.
 */
export async function removeFromOpenRounds(
  gameId: string,
  player: { id: string; name: string },
  opts: { exceptRoundId?: string } = {},
): Promise<string[]> {
  const store = getStore();
  const rounds = (await store.listRounds(100)).filter((r) => {
    const status = roundStatus(r);
    return (
      r.gameId === gameId &&
      r.id !== opts.exceptRoundId &&
      (status === "open" || status === "scheduled") &&
      r.players.some((p) => p.id === player.id)
    );
  });

  for (const round of rounds) {
    const status = roundStatus(round);
    const votes = await store.getVotes(round.id);
    if (votes.some((v) => v.voterId === player.id)) await store.deleteVote(round.id, player.id);

    // Their DM for this round: withdraw it if it hasn't gone out, otherwise update it.
    const d = round.delivery[player.id];
    if (!round.test && d?.channel) {
      if (status === "scheduled" && d.scheduledId) {
        await slack.deleteScheduledMessage(d.channel, d.scheduledId).catch(() => {});
        d.scheduledId = undefined;
      } else if (d.ts) {
        await slack.updateMessage(d.channel, d.ts, msg.outOfRoundMessage(round)).catch(() => {});
      }
      if (d.closeScheduledId) {
        await slack.deleteScheduledMessage(d.channel, d.closeScheduledId).catch(() => {});
        d.closeScheduledId = undefined;
      }
    }

    round.players = round.players.filter((p) => p.id !== player.id);
    await store.saveRound(round);

    // Votes for them no longer count: ask those voters to vote again.
    for (const v of votes.filter((v) => v.targetId === player.id && v.voterId !== player.id)) {
      await store.deleteVote(round.id, v.voterId);
      const voter = round.players.find((p) => p.id === v.voterId);
      if (round.test || !voter) continue;
      try {
        const channel = round.delivery[voter.id]?.channel ?? (await slack.openDm(voter.id));
        await slack.postMessage(channel, msg.revoteMessage(round, voter, player.name));
      } catch (e) {
        console.error(e);
      }
    }
  }
  return rounds.map((r) => r.title);
}

/** Tell a murdered player they're out, and that their votes no longer count. */
export async function notifyMurdered(player: { id: string; name: string }, roundTitles: string[]) {
  const channel = await slack.openDm(player.id);
  await slack.postMessage(channel, msg.murderedMessage(player.name, roundTitles));
}
