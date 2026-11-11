import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, relative } from "@/lib/format";
import { getRsvps } from "@/lib/meeting";
import { getReveal, getRevealDefaults, toView } from "@/lib/reveal";
import { roundStatus } from "@/lib/rounds";
import { listChannels, type Channel } from "@/lib/slack";
import { getStore } from "@/lib/store";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DeleteRoundButton } from "@/components/DeleteRoundButton";
import { MeetingPanel } from "@/components/MeetingPanel";
import { Avatar } from "@/components/Avatar";
import { RevealPanel } from "@/components/RevealPanel";
import { TestVotePanel } from "@/components/TestVotePanel";
import { RoundActions } from "@/components/RoundActions";
import { StatusPill } from "@/components/StatusPill";
import { TopBar } from "@/components/TopBar";

export const dynamic = "force-dynamic";

export default async function RoundPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const store = getStore();
  const round = await store.getRound(id);
  if (!round) notFound();

  const votes = await store.getVotes(id);
  const votedAt = new Map(votes.map((v) => [v.voterId, v.at]));
  const now = Date.now();
  const status = roundStatus(round, now);
  let channels: Channel[] = [];
  let channelsError: string | null = null;
  try {
    channels = await listChannels();
  } catch (e) {
    channelsError = e instanceof Error ? e.message : String(e);
  }
  const [reveal, revealDefaults] = await Promise.all([getReveal(id), getRevealDefaults()]);

  const pct = Math.round((votes.length / round.players.length) * 100);

  // Meeting banishments: RSVPs, advance votes and the in-meeting vote.
  const m = round.format === "meeting" ? round.meeting : undefined;
  const rsvps = m ? await getRsvps(id) : {};
  const requestedAt = m?.requestedAt ? Date.parse(m.requestedAt) : Infinity;
  const isAdvance = (at: string) => Date.parse(at) < requestedAt;
  const advanceVotes = votes.filter((v) => isAdvance(v.at)).length;
  const voting = !!m?.requestedAt && !m.finishedAt;
  const closedAt = round.closedEarlyAt && Date.parse(round.closedEarlyAt) < Date.parse(round.closesAt) ? round.closedEarlyAt : round.closesAt;

  return (
    <div className="shell">
      {(status === "open" || status === "scheduled" || voting) && <AutoRefresh seconds={voting ? 2 : 5} />}
      <TopBar />
      <Link href="/" className="back">← All rounds</Link>

      <div className="detail-head">
        <div>
          <h1>{round.test && <span className="test-tag big">Test</span>}{round.title}</h1>
          <div className="facts">
            <span><StatusPill status={status} /></span>
            {m ? (
              <span>🗣️ Meeting <b>{formatDateTime(m.at)}</b>{Date.parse(m.at) > now && ` (${relative(m.at, now)})`}</span>
            ) : (
              <>
                <span>Opens <b>{formatDateTime(round.opensAt)}</b>{status === "scheduled" && ` (${relative(round.opensAt, now)})`}</span>
                <span>
                  {status === "closed" ? "Closed" : "Closes"} <b>{formatDateTime(status === "closed" ? closedAt : round.closesAt)}</b>
                  {status === "open" && ` (${relative(round.closesAt, now)})`}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="actions">
          <RoundActions id={round.id} status={status} canClose={!m} />
          <DeleteRoundButton id={round.id} title={round.title} active={!round.test && (status === "open" || status === "scheduled")} redirectHome />
        </div>
      </div>

      <div className="grid">
        <section className="panel">
          <h2 className="panel-title">Players</h2>
          <p className="panel-sub">Each player can vote once, for any player on this list (including themselves).</p>
          <table className="players-table">
            <thead>
              <tr><th>Player</th>{m ? <th>RSVP</th> : <th>Slack DM</th>}<th>Vote</th></tr>
            </thead>
            <tbody>
              {round.players.map((p) => {
                const d = round.delivery[p.id];
                const at = votedAt.get(p.id);
                return (
                  <tr key={p.id}>
                    <td><span className="who"><Avatar player={p} />{p.name}</span></td>
                    {m ? (
                      <td>
                        {round.test ? <span className="muted">Test</span>
                          : rsvps[p.id]?.answer === "yes" ? <span className="okc">✅ Coming</span>
                          : rsvps[p.id]?.answer === "no" ? <span className="muted">❌ Can&apos;t come</span>
                          : d?.error ? <span className="errc" title={d.error}>DM failed</span>
                          : <span className="faint">{status === "scheduled" ? "Not sent yet" : "No reply"}</span>}
                      </td>
                    ) : (
                    <td>
                      {round.test ? <span className="muted">Test, not sent</span>
                        : d?.error ? <span className="errc" title={d.error}>Failed: {d.error.replace(/^Slack /, "")}</span>
                        : d?.ts ? <span className="muted">Sent</span>
                        : d?.scheduledId ? <span className="muted">{status === "scheduled" ? "Scheduled" : "Sent"}</span>
                        : <span className="muted">—</span>}
                    </td>
                    )}
                    <td>
                      {at ? <span className="okc">✓ Voted <span className="muted">{m && isAdvance(at) ? "in advance" : formatDateTime(at).split(", ").pop()}</span></span>
                        : <span className="muted">{status === "open" ? "Waiting…" : status === "scheduled" ? "—" : "Didn't vote"}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <div className="side">
          {m && (
            <MeetingPanel
              roundId={round.id}
              status={status}
              meetingLabel={formatDateTime(m.at)}
              rsvpOpensLabel={formatDateTime(m.rsvpOpensAt)}
              rsvpClosesLabel={formatDateTime(m.rsvpClosesAt)}
              rsvpOpen={!m.requestedAt && now >= Date.parse(m.rsvpOpensAt) && now < Date.parse(m.rsvpClosesAt)}
              rsvpClosed={now >= Date.parse(m.rsvpClosesAt)}
              counts={{
                coming: round.players.filter((pl) => rsvps[pl.id]?.answer === "yes").length,
                cantCome: round.players.filter((pl) => rsvps[pl.id]?.answer === "no").length,
                advanceVotes,
                noReply: round.players.filter((pl) => !rsvps[pl.id]).length,
                players: round.players.length,
              }}
              requestedAt={m.requestedAt}
              votingClosesAt={m.votingClosesAt}
              finished={!!m.finishedAt || (status === "closed" && !voting)}
              votesIn={votes.length}
              meetingVotes={votes.length - advanceVotes}
              test={!!round.test}
            />
          )}
          {round.test && status === "open" && (
            <TestVotePanel
              roundId={round.id}
              players={round.players}
              votedIds={votes.map((v) => v.voterId)}
            />
          )}
          <section className="panel">
            <h2 className="panel-title">Turnout</h2>
            <div className="stat"><span className="big">{votes.length}</span><span className="muted">of {round.players.length} have voted</span></div>
            <div className="progress"><span style={{ width: `${pct}%` }} /></div>
          </section>
          <RevealPanel
            roundId={round.id}
            roundStatus={status}
            votesCast={votes.length}
            channels={channels}
            channelsError={channelsError}
            defaults={m ? { ...revealDefaults, mode: "in-person" } : revealDefaults}
            initialView={toView(reveal, round)}
          />
        </div>
      </div>
    </div>
  );
}
