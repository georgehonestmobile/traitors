"use client";

import { useEffect, useRef, useState } from "react";
import type { RevealView } from "@/lib/reveal";
import type { ScriptCard } from "@/lib/script";

function Tally({ rows }: { rows: { name: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="script-tally">
      {rows.map((r, i) => (
        <div key={r.name} className={`bar-row${i === 0 && (rows[1]?.count ?? 0) < r.count ? " top" : ""}`}>
          <span className="bar-name">{r.name}</span>
          <span className="bar"><span style={{ width: `${(r.count / max) * 100}%` }} /></span>
          <span className="bar-n">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

/** Before the verdict: office votes still to come in. The helper usually enters them; the host can too. */
function Clarify({
  missing,
  players,
  busy,
  onPaper,
}: {
  missing: { id: string; name: string }[];
  players: { id: string; name: string }[];
  busy: boolean;
  onPaper: Props["onPaper"];
}) {
  const names = missing.map((m) => m.name);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return (
    <div className="script-card clarify">
      <div className="script-heading">Before the verdict</div>
      <div className="script-say">
        <p>“{list}, can you confirm who you voted for?”</p>
      </div>
      <p className="hint">
        {names.length === 1 ? "This paper vote hasn't" : "These paper votes haven't"} been entered yet. The verdict waits until
        they&apos;re in. They usually get entered in the Players list; you can enter them here instead.
      </p>
      {missing.map((m) => (
        <div key={m.id} className="paper-picker">
          <div className="label"><span>{m.name} voted for</span></div>
          <div className="paper-names">
            {players.map((o) => (
              <button key={o.id} type="button" className="chip" disabled={busy} onClick={() => onPaper(m.id, o.id)}>
                {o.id === m.id ? `${o.name} (self)` : o.name}
              </button>
            ))}
            <button type="button" className="chip faint-chip" disabled={busy} onClick={() => onPaper(m.id, null)}>
              Blank / no vote
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

type Revote = NonNullable<RevealView["revote"]>;
export type RevoteAction = "revote-request" | "revote-finish" | "revote-end-now";

/** On the tie card: request the tiebreak re-vote, watch it come in, and enter paper re-votes. */
function Tiebreak({
  revote,
  busy,
  onRevote,
  onRevotePaper,
}: {
  revote: Revote;
  busy: boolean;
  onRevote: (action: RevoteAction) => void;
  onRevotePaper: (voterId: string, targetId: string | null) => void;
}) {
  const [left, setLeft] = useState<number | null>(null);
  const finishing = useRef(false);
  const open = revote.requested && !revote.closed;
  useEffect(() => {
    if (!open || !revote.closesAt) return;
    const end = Date.parse(revote.closesAt);
    const tick = () => {
      const ms = end - Date.now();
      setLeft(Math.max(0, Math.ceil(ms / 1000)));
      if (ms <= -3500 && !finishing.current) {
        finishing.current = true;
        onRevote("revote-finish");
      }
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, revote.closesAt]);

  if (!revote.voters.length) return null;
  const onSlack = revote.voters.filter((v) => !v.paper);
  const onPaper = revote.voters.filter((v) => v.paper);
  const tied = revote.tied.map((t) => t.name).join(" or ");
  const slackIn = onSlack.filter((v) => v.voted).length;

  return (
    <div className="script-card tiebreak">
      <div className="script-heading">Tiebreak vote · {revote.tied.map((t) => t.name).join(" v ")}</div>
      {!revote.requested ? (
        <>
          <button
            type="button"
            className="btn primary block"
            disabled={busy}
            onClick={() =>
              window.confirm(
                (onSlack.length
                  ? `Send a one-minute tiebreak ballot (${tied} only) to ${onSlack.map((v) => v.name).join(", ")}?`
                  : "Start the tiebreak vote?") +
                  (onPaper.length ? ` ${onPaper.map((v) => v.name).join(", ")} re-vote${onPaper.length === 1 ? "s" : ""} on paper.` : ""),
              ) && onRevote("revote-request")
            }
          >
            {onSlack.length ? "⏱️ Request tiebreak votes (1 minute)" : "📝 Start the tiebreak vote (on paper)"}
          </button>
          <p className="hint">
            {onSlack.length ? "Players dialling in get a Slack ballot with only the tied players on it. " : ""}
            {onPaper.length ? "The office writes their tiebreak vote on paper. " : ""}
            Then press Next to count.
          </p>
        </>
      ) : open ? (
        <div className="countdown">
          <div className="countdown-n" aria-live="polite">{left === null ? "" : `0:${String(left).padStart(2, "0")}`}</div>
          <div className="muted">{slackIn} of {onSlack.length} in on Slack</div>
          <button type="button" className="btn small" disabled={busy} onClick={() => onRevote("revote-end-now")}>End the tiebreak vote now</button>
        </div>
      ) : null}

      <ul className="revote-list">
        {revote.voters.map((v) => {
          const canEnter = revote.requested && !revote.settled && (v.paper || (v.failed && !v.voted) || (v.entered !== undefined));
          return (
            <li key={v.id}>
              <span className="revote-name">{v.name}</span>
              <span className="revote-status">
                {v.paper || v.entered !== undefined
                  ? v.entered === undefined
                    ? <span className="faint">📝 {revote.requested ? "not entered yet" : "on paper"}</span>
                    : <span className="okc">📝 {v.entered ?? "Blank"}</span>
                  : v.voted
                    ? <span className="okc">✓ Voted on Slack</span>
                    : v.failed
                      ? <span className="errc">DM failed</span>
                      : !revote.requested
                        ? <span className="faint">💻 Slack</span>
                        : revote.closed
                          ? <span className="muted">Didn&apos;t vote</span>
                          : <span className="faint">Waiting…</span>}
              </span>
              {canEnter && (
                <span className="paper-names">
                  {revote.tied.map((t) => (
                    <button key={t.id} type="button" className={`chip${v.entered === t.name ? " on" : ""}`} disabled={busy} onClick={() => onRevotePaper(v.id, t.id)}>
                      {t.name}
                    </button>
                  ))}
                  <button type="button" className={`chip faint-chip${v.entered === null ? " on" : ""}`} disabled={busy} onClick={() => onRevotePaper(v.id, null)}>
                    Blank
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {revote.requested && onPaper.length > 0 && !revote.settled && (
        <p className="hint">Paper tiebreak votes can be entered here or in the Players list.</p>
      )}
    </div>
  );
}

function Card({ card }: { card: ScriptCard }) {
  return (
    <div className={`script-card ${card.kind}`}>
      <div className="script-heading">{card.heading}</div>
      {card.call && (
        <div className="script-call">
          <span className="label"><span>Call on</span></span>
          <div className="script-name">{card.call}</div>
        </div>
      )}
      {card.expect && !card.paper && (
        <div className="script-expect">
          <span>{card.expectLabel ?? "Recorded vote"} <em>(host only)</em></span>
          <strong>{card.expect}</strong>
        </div>
      )}
      <div className="script-say">
        {card.say.map((line, i) => (
          <p key={i}>“{line}”</p>
        ))}
      </div>
      {card.paper && (
        <p className={`paper-status${card.paper.targetId === undefined ? " pending" : ""}`}>
          {card.paper.targetId === undefined
            ? "📝 Paper vote not entered yet"
            : card.paper.targetId === null
              ? "📝 Paper entered: blank, no vote"
              : <>📝 Paper entered: <b>{card.expect}</b></>}
        </p>
      )}
      {card.note && <p className="hint">{card.note}</p>}
      {card.tally && card.tally.length > 0 && (
        <>
          <div className="label" style={{ marginTop: 14 }}>
            <span>{card.tallyLabel ?? (card.kind === "recount" ? "Recount so far" : card.kind === "vote" ? "Count so far" : "The count")}</span>
          </div>
          <Tally rows={card.tally} />
        </>
      )}
    </div>
  );
}

type Props = {
  view: RevealView;
  busy: boolean;
  error: string | null;
  onAction: (action: "next" | "prev" | "reset") => void;
  /** Enter the name on an office voter's paper (null: blank or spoilt). */
  onPaper: (voterId: string, targetId: string | null) => void;
  onRevote: (action: RevoteAction) => void;
  /** Enter a tiebreak paper re-vote (null: blank). */
  onRevotePaper: (voterId: string, targetId: string | null) => void;
};

/** Face-to-face reveal: the host steps through a script. Nothing is posted in Slack. */
export function ScriptPanel({ view, busy, error, onAction, onPaper, onRevote, onRevotePaper }: Props) {
  const script = view.script ?? [];
  const index = Math.max(0, view.stepsDone - 1);
  const card = script[index];
  const done = view.status === "done";
  // The verdict waits for every office paper vote. Pressing Next on the last vote without them all
  // asks the room to confirm the missing ones.
  const missing = view.missingPaper ?? [];
  const atLastVote = view.lastVoteIndex !== undefined && index === view.lastVoteIndex;
  const [clarifyAt, setClarifyAt] = useState<number | null>(null);
  const clarifying = clarifyAt === index && atLastVote && missing.length > 0;
  const waiting = atLastVote && missing.length > 0;
  // A tie: Next waits for the tiebreak re-vote.
  const rv = view.revote;
  const atTie = !!rv && index === rv.tieIndex && !rv.settled;
  const tieWait =
    atTie && rv.voters.length > 0
      ? !rv.requested
        ? "Request the tiebreak votes first"
        : !rv.closed
          ? "Tiebreak vote open…"
          : rv.missing.length
            ? `Waiting for ${rv.missing.length} tiebreak paper ${rv.missing.length === 1 ? "vote" : "votes"}`
            : null
      : null;
  const next = () => (tieWait ? undefined : waiting ? setClarifyAt(index) : onAction("next"));

  // Arrow keys / space to move through the script.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      if (el instanceof HTMLElement && el.closest("input, textarea, select, button")) return;
      if ((e.key === "ArrowRight" || e.key === " ") && !done && !busy) {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft" && index > 0 && !busy) {
        e.preventDefault();
        onAction("prev");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <section className="panel script-panel">
      <div className="reveal-head">
        <h2 className="panel-title">Face-to-face script</h2>
        <span className={`status ${done ? "closed" : "open"}`}>{done ? "Finished" : "Live"}</span>
      </div>
      <p className="panel-sub">
        Card {index + 1} of {script.length} · nothing is posted in Slack · use ← → to move
      </p>
      <div className="progress" style={{ marginBottom: 16 }}>
        <span style={{ width: `${((index + 1) / Math.max(1, script.length)) * 100}%` }} />
      </div>

      {error && <div className="error">{error}</div>}
      {card && <Card card={card} />}
      {clarifying && <Clarify missing={missing} players={view.players ?? []} busy={busy} onPaper={onPaper} />}
      {rv && index === rv.tieIndex && <Tiebreak revote={rv} busy={busy} onRevote={onRevote} onRevotePaper={onRevotePaper} />}

      <div className="script-nav">
        <button className="btn" disabled={busy || index === 0} onClick={() => onAction("prev")}>← Back</button>
        {!done ? (
          <button className="btn primary" disabled={busy || clarifying || !!tieWait} onClick={next}>
            {tieWait
              ? tieWait
              : atTie
                ? "Count the tiebreak →"
                : clarifying
              ? `Waiting for ${missing.length} paper ${missing.length === 1 ? "vote" : "votes"}`
              : index + 2 === script.length
                ? "Verdict →"
                : "Next →"}
          </button>
        ) : (
          <button
            className="btn danger small"
            disabled={busy}
            onClick={() => window.confirm("Reset the reveal so it can be run again?") && onAction("reset")}
          >
            Reset
          </button>
        )}
      </div>

      <details className="full-script">
        <summary>Full script (shows every vote)</summary>
        <ol>
          {script.map((c, i) => (
            <li key={i} className={i === index ? "current" : i < index ? "past" : undefined}>
              <b>{c.heading}</b>
              {c.paper ? (
                <>: call on <b>{c.call}</b>, paper {c.paper.targetId === undefined ? "not entered yet" : c.paper.targetId === null ? "blank" : <>says <b>{c.expect}</b></>}</>
              ) : c.call ? (
                <>: call on <b>{c.call}</b>, voted for <b>{c.expect}</b></>
              ) : (
                <>: {c.say.join(" ")}</>
              )}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
