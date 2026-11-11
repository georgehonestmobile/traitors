"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  roundId: string;
  status: "scheduled" | "open" | "closed" | "cancelled";
  meetingLabel: string;
  rsvpOpensLabel: string;
  rsvpClosesLabel: string;
  rsvpOpen: boolean;
  rsvpClosed: boolean;
  counts: { coming: number; cantCome: number; advanceVotes: number; noReply: number; players: number };
  requestedAt?: string;
  votingClosesAt?: string;
  finished: boolean;
  votesIn: number;
  meetingVotes: number;
  test: boolean;
};

/** Meeting banishments: RSVP progress, then the one-minute vote in the meeting. */
export function MeetingPanel(p: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const finishing = useRef(false);

  async function send(action: "request" | "finish" | "end-now") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rounds/${p.roundId}/meeting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Countdown during the one-minute vote; close it when time's up.
  const voting = !!p.requestedAt && !p.finished;
  useEffect(() => {
    if (!voting || !p.votingClosesAt) return;
    const end = Date.parse(p.votingClosesAt);
    const tick = () => {
      const ms = end - Date.now();
      setLeft(Math.max(0, Math.ceil(ms / 1000)));
      if (ms <= -1500 && !finishing.current) {
        finishing.current = true;
        send("finish");
      }
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voting, p.votingClosesAt]);

  const waitingFor = p.counts.players - p.votesIn;

  return (
    <section className="panel meeting-panel">
      <div className="reveal-head">
        <h2 className="panel-title">🗣️ Meeting banishment</h2>
      </div>
      <p className="panel-sub">Meeting <b>{p.meetingLabel}</b>.</p>

      {!p.test && (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            {p.status === "scheduled"
              ? `RSVPs go out ${p.rsvpOpensLabel}, replies by ${p.rsvpClosesLabel}.`
              : p.rsvpOpen
                ? `RSVPs are open until ${p.rsvpClosesLabel}.`
                : p.requestedAt
                  ? "RSVPs and advance voting closed when votes were requested."
                  : `RSVPs closed ${p.rsvpClosesLabel}. Advance votes can still come in until you request votes.`}
          </p>
          <div className="tiles small">
            <div className="tile"><span className="tile-n">{p.counts.coming}</span><span className="tile-label">Coming</span></div>
            <div className="tile"><span className="tile-n">{p.counts.cantCome}</span><span className="tile-label">Can&apos;t come</span></div>
            <div className="tile"><span className="tile-n">{p.counts.advanceVotes}</span><span className="tile-label">Advance votes</span></div>
            <div className="tile"><span className="tile-n">{p.counts.noReply}</span><span className="tile-label">No reply</span></div>
          </div>
        </>
      )}

      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

      {p.status === "open" && !p.requestedAt && (
        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn primary block"
            disabled={busy}
            onClick={() =>
              window.confirm(
                `Send ballots now to the ${waitingFor} ${waitingFor === 1 ? "player who hasn't" : "players who haven't"} voted? They'll have one minute. Advance voting closes.`,
              ) && send("request")
            }
          >
            {busy ? "Sending…" : "⏱️ Request votes (1 minute)"}
          </button>
          <p className="hint">Press this in the meeting. Everyone who hasn&apos;t voted yet gets a ballot in Slack.</p>
        </div>
      )}

      {voting && (
        <div className="countdown">
          <div className="countdown-n" aria-live="polite">{left === null ? "" : `0:${String(left).padStart(2, "0")}`}</div>
          <div className="muted">
            {p.meetingVotes} {p.meetingVotes === 1 ? "vote" : "votes"} in from the meeting · {p.votesIn} of {p.counts.players} in total
          </div>
          <button type="button" className="btn small" disabled={busy} onClick={() => send("end-now")}>End voting now</button>
        </div>
      )}

      {p.finished && (
        <div className="summary" style={{ marginTop: 16, marginBottom: 0 }}>
          Voting closed: <b>{p.votesIn}</b> {p.votesIn === 1 ? "vote" : "votes"} ({p.counts.advanceVotes} in advance, {p.meetingVotes} in the meeting). Run the
          face-to-face script below to reveal them.
        </div>
      )}
    </section>
  );
}
