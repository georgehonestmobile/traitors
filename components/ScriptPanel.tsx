"use client";

import { useEffect, useState } from "react";
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
            <span>{card.kind === "recount" ? "Recount so far" : card.kind === "vote" ? "Count so far" : "The count"}</span>
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
};

/** Face-to-face reveal: the host steps through a script. Nothing is posted in Slack. */
export function ScriptPanel({ view, busy, error, onAction, onPaper }: Props) {
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
  const next = () => (waiting ? setClarifyAt(index) : onAction("next"));

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

      <div className="script-nav">
        <button className="btn" disabled={busy || index === 0} onClick={() => onAction("prev")}>← Back</button>
        {!done ? (
          <button className="btn primary" disabled={busy || clarifying} onClick={next}>
            {clarifying
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
