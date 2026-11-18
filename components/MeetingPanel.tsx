"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { meetingAction } from "./meetingApi";

type Props = {
  roundId: string;
  status: "scheduled" | "open" | "closed" | "cancelled";
  meetingLabel: string;
  rsvpOpensLabel: string;
  rsvpClosesLabel: string;
  rsvpOpen: boolean;
  rsvpClosed: boolean;
  counts: {
    office: number;
    dialIn: number;
    /** Coming, but haven't said whether in the office or dialling in. */
    undecided: number;
    cantCome: number;
    advanceVotes: number;
    noReply: number;
    players: number;
  };
  joinLocksLabel: string;
  joinLocked: boolean;
  joinAskedLabel?: string;
  /** Everyone dials in: no office, no paper votes. */
  virtual: boolean;
  requestedAt?: string;
  votingClosesAt?: string;
  finished: boolean;
  votesIn: number;
  slackVotes: number;
  paperVotes: number;
  test: boolean;
};

/** Meeting banishments: RSVP progress, then the one-minute vote in the meeting. */
export function MeetingPanel(p: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const finishing = useRef(false);

  const [note, setNote] = useState<string | null>(null);

  async function send(action: "request" | "finish" | "end-now" | "ask-join" | "virtual", extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const data = await meetingAction(p.roundId, { action, ...extra });
      if (action === "ask-join") {
        setNote(
          `Asked ${data.asked} ${data.asked === 1 ? "player" : "players"}.` +
            (data.failed?.length ? ` Couldn't DM ${data.failed.join(", ")}.` : ""),
        );
      }
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

  // Ballots go to everyone who hasn't voted, except the office.
  const ballots = Math.max(0, p.counts.players - p.votesIn - p.counts.office);
  const canAskJoin = !p.virtual && !p.test && p.status === "open" && !p.requestedAt && !p.joinLocked && p.counts.undecided > 0;
  const canToggle = (p.status === "open" || p.status === "scheduled") && !p.requestedAt;

  function toggleVirtual(virtual: boolean) {
    if (virtual === p.virtual) return;
    const sent = p.status !== "scheduled" && !p.test;
    const ok = window.confirm(
      virtual
        ? `Make this an all-virtual meeting? Nobody is asked about the office: everyone coming gets a Slack ballot in the meeting.` +
            (sent ? " RSVP DMs already sent are updated where possible; anyone who already picked the office or dialling in just counts as coming." : "")
        : `Bring back the office? Attendees can say whether they're in the office (paper vote) or dialling in (Slack vote).` +
            (sent ? " RSVP DMs already sent are updated where possible. Anyone already coming may need asking how they're joining." : ""),
    );
    if (ok) send("virtual", { virtual });
  }

  return (
    <section className="panel meeting-panel">
      <div className="reveal-head">
        <h2 className="panel-title">🗣️ Meeting banishment</h2>
      </div>
      <p className="panel-sub">Meeting <b>{p.meetingLabel}</b>.</p>

      {canToggle ? (
        <div className="field" style={{ marginBottom: 12 }}>
          <div className="chips">
            <button type="button" className={`chip${!p.virtual ? " on" : ""}`} disabled={busy} onClick={() => toggleVirtual(false)}>🏢💻 Office or dialling in</button>
            <button type="button" className={`chip${p.virtual ? " on" : ""}`} disabled={busy} onClick={() => toggleVirtual(true)}>💻 Everyone dials in</button>
          </div>
        </div>
      ) : p.virtual ? (
        <p className="hint" style={{ marginTop: 0 }}>💻 All virtual: everyone dials in.</p>
      ) : null}

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
          {p.virtual ? (
          <div className="tiles small">
            <div className="tile"><span className="tile-n">{p.counts.dialIn}</span><span className="tile-label">✅ Coming</span></div>
            <div className="tile"><span className="tile-n">{p.counts.cantCome}</span><span className="tile-label">Can&apos;t come</span></div>
            <div className="tile"><span className="tile-n">{p.counts.advanceVotes}</span><span className="tile-label">Advance votes</span></div>
            <div className="tile"><span className="tile-n">{p.counts.noReply}</span><span className="tile-label">No reply</span></div>
          </div>
          ) : (
          <div className="tiles small six">
            <div className="tile"><span className="tile-n">{p.counts.office}</span><span className="tile-label">🏢 In the office</span></div>
            <div className="tile"><span className="tile-n">{p.counts.dialIn}</span><span className="tile-label">💻 Dialling in</span></div>
            <div className="tile"><span className="tile-n">{p.counts.undecided}</span><span className="tile-label">Coming, not said how</span></div>
            <div className="tile"><span className="tile-n">{p.counts.cantCome}</span><span className="tile-label">Can&apos;t come</span></div>
            <div className="tile"><span className="tile-n">{p.counts.advanceVotes}</span><span className="tile-label">Advance votes</span></div>
            <div className="tile"><span className="tile-n">{p.counts.noReply}</span><span className="tile-label">No reply</span></div>
          </div>
          )}
          {!p.requestedAt && !p.virtual && (
            <p className="hint">
              {p.joinLocked
                ? `Office or dialling in locked at ${p.joinLocksLabel}. You can still change anyone in the RSVP column.`
                : `Attendees can switch between the office and dialling in until ${p.joinLocksLabel}. You can change anyone in the RSVP column.`}
            </p>
          )}
          {canAskJoin && (
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn block"
                disabled={busy}
                onClick={() =>
                  window.confirm(
                    `DM the ${p.counts.undecided} ${p.counts.undecided === 1 ? "player who's" : "players who are"} coming but haven't said how, asking if they'll be in the office or dialling in?`,
                  ) && send("ask-join")
                }
              >
                🏢💻 Ask {p.counts.undecided} how they&apos;re joining
              </button>
              <p className="hint">
                {p.joinAskedLabel ? `Last asked ${p.joinAskedLabel}. ` : ""}
                Anyone who doesn&apos;t answer gets a Slack ballot in the meeting, like dialling in.
              </p>
            </div>
          )}
          {note && <p className="done-note" style={{ marginTop: 8 }}>✓ {note}</p>}
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
                `Send ballots now to the ${ballots} ${ballots === 1 ? "player who hasn't" : "players who haven't"} voted${p.counts.office ? ` and ${ballots === 1 ? "isn't" : "aren't"} in the office` : ""}? They'll have one minute. ` +
                  `${p.counts.office ? `The ${p.counts.office} in the office vote on paper. ` : ""}Advance voting closes.`,
              ) && send("request")
            }
          >
            {busy ? "Sending…" : "⏱️ Request votes (1 minute)"}
          </button>
          <p className="hint">
            {p.virtual
              ? "Press this in the meeting. Everyone who hasn't voted yet gets a ballot in Slack."
              : "Press this in the meeting. Everyone who hasn't voted yet, except the office, gets a ballot in Slack. The office votes on paper at the same time."}
          </p>
        </div>
      )}

      {voting && (
        <div className="countdown">
          <div className="countdown-n" aria-live="polite">{left === null ? "" : `0:${String(left).padStart(2, "0")}`}</div>
          <div className="muted">
            {p.slackVotes} {p.slackVotes === 1 ? "vote" : "votes"} in on Slack · {p.votesIn} of {p.counts.players} in total
          </div>
          <button type="button" className="btn small" disabled={busy} onClick={() => send("end-now")}>End voting now</button>
        </div>
      )}

      {p.finished && (
        <div className="summary" style={{ marginTop: 16, marginBottom: 0 }}>
          Slack voting closed: <b>{p.counts.advanceVotes}</b> in advance and <b>{p.slackVotes}</b> on Slack in the meeting
          {p.counts.office ? <>, plus <b>{p.counts.office}</b> in the office on paper</> : null}. Run the face-to-face script below
          {p.counts.office ? ". As each office paper is revealed, enter it in the Players list (a second person can do this on their own screen)." : "."}
        </div>
      )}
    </section>
  );
}
