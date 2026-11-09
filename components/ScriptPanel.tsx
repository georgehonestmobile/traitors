"use client";

import { useEffect } from "react";
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
      {card.expect && (
        <div className="script-expect">
          <span>Recorded vote <em>(host only)</em></span>
          <strong>{card.expect}</strong>
        </div>
      )}
      <div className="script-say">
        {card.say.map((line, i) => (
          <p key={i}>“{line}”</p>
        ))}
      </div>
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
};

/** Face-to-face reveal: the host steps through a script. Nothing is posted in Slack. */
export function ScriptPanel({ view, busy, error, onAction }: Props) {
  const script = view.script ?? [];
  const index = Math.max(0, view.stepsDone - 1);
  const card = script[index];
  const done = view.status === "done";

  // Arrow keys / space to move through the script.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      if (el instanceof HTMLElement && el.closest("input, textarea, select, button")) return;
      if ((e.key === "ArrowRight" || e.key === " ") && !done && !busy) {
        e.preventDefault();
        onAction("next");
      } else if (e.key === "ArrowLeft" && index > 0 && !busy) {
        e.preventDefault();
        onAction("prev");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done, busy, index, onAction]);

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

      <div className="script-nav">
        <button className="btn" disabled={busy || index === 0} onClick={() => onAction("prev")}>← Back</button>
        {!done ? (
          <button className="btn primary" disabled={busy} onClick={() => onAction("next")}>
            {index + 2 === script.length ? "Verdict →" : "Next →"}
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
              {c.call ? (
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
