"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDay, PROPOSED_SCHEDULE, type ScheduleKind, type ScheduleRow, type ScheduleSummary } from "@/lib/schedule";
import { gameAction } from "./gameApi";

const KIND_LABEL: Record<ScheduleKind, string> = { murder: "🔪 Murder", banishment: "🗡️ Banishment", end: "🏁 End game" };
const KIND_SHORT: Record<ScheduleKind, string> = { murder: "Murder", banishment: "Banishment", end: "End game" };

type Props = { summary: ScheduleSummary; plannedStart?: number; today: string; ended: boolean };

function Result({ row }: { row: ScheduleRow }) {
  if (row.status === "skipped") return <span className="muted">Skipped</span>;
  if (row.kind === "end") return row.status === "today" ? <span className="today-tag">Today</span> : null;
  if (row.actual) {
    return (
      <span className={row.mismatch ? "errc" : "okc"} title={row.mismatch ? "A different kind of event to the one planned" : undefined}>
        {row.mismatch ? "⚠ " : "✓ "}
        {row.actual.name} {row.actual.how}
      </span>
    );
  }
  if (row.status === "overdue") return <span className="errc">Not recorded</span>;
  if (row.status === "today") return <span className="today-tag">Today</span>;
  return null;
}

export function SchedulePanel({ summary, plannedStart, today, ended }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [newDate, setNewDate] = useState(today);
  const [newKind, setNewKind] = useState<ScheduleKind>("banishment");

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await gameAction(body);
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const rows = summary.rows;
  const offDays = rows.filter((r) => r.offDay && !r.skipped);
  const pasteForm = (
    <div className="inline-form" style={{ marginTop: 12 }}>
      <label className="label" htmlFor="schedule-paste"><span>Paste rows from a spreadsheet</span></label>
      <textarea
        id="schedule-paste"
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Wednesday\t9th December\tBanishment\t6\t5\nThursday\t12th November\tMurder\t26\t25"}
      />
      <p className="hint">One event per line: a date (like “9th December”) and Murder, Banishment or End Game. A number after it is read as the players remaining at the start.</p>
      <div className="inline" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="btn primary small"
          disabled={busy || !text.trim()}
          onClick={async () => {
            if (rows.length && !window.confirm("Replace the current schedule?")) return;
            if (await send({ action: "schedule-import", text })) {
              setText("");
              setPasting(false);
            }
          }}
        >
          Import
        </button>
        <button type="button" className="btn ghost small" onClick={() => setPasting(false)}>Cancel</button>
      </div>
    </div>
  );

  if (!rows.length) {
    return (
      <section className="panel">
        <h2 className="panel-title">Schedule</h2>
        <p className="panel-sub">Plan when the murders and banishments happen, then track the game against it.</p>
        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button type="button" className="btn primary small" disabled={busy} onClick={() => send({ action: "schedule-import", text: PROPOSED_SCHEDULE })}>
            Load the proposed schedule (12 Nov – 9 Dec)
          </button>
          <button type="button" className="btn ghost small" onClick={() => setPasting(true)}>Paste from a spreadsheet</button>
        </div>
        {pasting && pasteForm}
      </section>
    );
  }

  const planned = summary.plannedEnd !== undefined ? summary.plannedEnd - summary.skipped : undefined;

  return (
    <section className="panel">
      <div className="reveal-head">
        <h2 className="panel-title">Schedule</h2>
        <div className="actions">
          <button type="button" className="btn ghost small" onClick={() => setPasting((p) => !p)}>Replace…</button>
          <button
            type="button"
            className="btn ghost small"
            disabled={busy}
            onClick={() => window.confirm("Clear the whole schedule?") && send({ action: "schedule-clear" })}
          >
            Clear
          </button>
        </div>
      </div>
      <p className="panel-sub">
        <label className="start-input">
          Starting with{" "}
          <input
            type="number"
            min={1}
            max={500}
            defaultValue={plannedStart ?? ""}
            key={plannedStart}
            aria-label="Players at the start of the schedule"
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (v && v !== plannedStart) send({ action: "schedule-start", value: v });
            }}
          />{" "}
          players
        </label>
        {planned !== undefined && summary.endDate && (
          <> · {planned} planned for the end game on {formatDay(summary.endDate)}</>
        )}
      </p>
      {pasting && pasteForm}
      {error && <div className="error">{error}</div>}

      {!ended && summary.next && (
        <div className="next-up">
          <span className="eyebrow">Next</span>
          <strong>{formatDay(summary.next.date)} · {KIND_LABEL[summary.next.kind]}</strong>
          {summary.next.kind !== "end" && <span className="muted">{summary.next.before} → {summary.next.after} players</span>}
        </div>
      )}

      <div className="schedule-notes">
        {summary.overdue > 0 && (
          <p className="errc">⚠ {summary.overdue} past {summary.overdue === 1 ? "event hasn't" : "events haven't"} been recorded. Record murders and banishments in the cast.</p>
        )}
        {summary.skipped > 0 && summary.plannedEnd !== undefined && (
          <p>
            ↩️ {summary.skipped} skipped (e.g. a recruitment instead of a murder): <b>{summary.plannedEnd}</b> would reach the end game instead of {planned}.
            Add an extra murder or banishment to get back on track.
          </p>
        )}
        {summary.extra > 0 && <p>➕ {summary.extra} more {summary.extra === 1 ? "player has" : "players have"} left than the schedule plans for.</p>}
        {offDays.length > 0 && (
          <p className="muted">
            📅 {offDays.length} {offDays.length === 1 ? "banishment isn't" : "banishments aren't"} on a Wednesday or Friday:{" "}
            {offDays.map((r) => formatDay(r.date)).join(", ")}.
          </p>
        )}
      </div>

      <div className="schedule-scroll">
        <table className="players-table schedule-table">
          <thead>
            <tr><th>Date</th><th>Event</th><th>Players</th><th><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`${r.status} ${r.kind}${r.id === summary.next?.id ? " next" : ""}`}>
                <td>
                  <span className="date-cell">
                    <button
                      type="button"
                      className={`date-btn${r.offDay ? " offday" : ""}`}
                      title={r.offDay ? "Banishment not on a Wednesday or Friday. Click to move." : "Click to move"}
                      disabled={busy}
                      onClick={(e) => {
                        const input = e.currentTarget.nextElementSibling as HTMLInputElement | null;
                        try {
                          input?.showPicker();
                        } catch {
                          input?.focus();
                        }
                      }}
                    >
                      {formatDay(r.date)}
                    </button>
                    <input
                      type="date"
                      value={r.date}
                      tabIndex={-1}
                      aria-label={`Move ${formatDay(r.date)} ${r.kind}`}
                      disabled={busy}
                      onChange={(e) => e.target.value && send({ action: "schedule-update", id: r.id, date: e.target.value })}
                    />
                  </span>
                </td>
                <td>
                  <select
                    value={r.kind}
                    disabled={busy}
                    aria-label="Event type"
                    onChange={(e) => send({ action: "schedule-update", id: r.id, kind: e.target.value })}
                  >
                    {(Object.keys(KIND_SHORT) as ScheduleKind[]).map((k) => (
                      <option key={k} value={k}>{KIND_SHORT[k]}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <span className="nowrap muted">{r.kind === "end" ? `${r.before} left` : `${r.before} → ${r.after}`}</span>
                  <div className="row-result"><Result row={r} /></div>
                </td>
                <td className="row-actions">
                  {r.kind !== "end" && !r.actual && (
                    <button
                      type="button"
                      className="link-btn"
                      disabled={busy}
                      title={r.skipped ? "Count this event again" : "Nobody left (e.g. a recruitment instead of a murder)"}
                      onClick={() => send({ action: "schedule-update", id: r.id, skipped: !r.skipped })}
                    >
                      {r.skipped ? "Unskip" : "Skip"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="link-btn danger"
                    disabled={busy}
                    aria-label={`Delete ${formatDay(r.date)} ${r.kind}`}
                    onClick={() => window.confirm(`Delete ${formatDay(r.date)} ${r.kind}?`) && send({ action: "schedule-delete", id: r.id })}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="inline" style={{ marginTop: 14 }}>
        <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} aria-label="New event date" />
        <select value={newKind} onChange={(e) => setNewKind(e.target.value as ScheduleKind)} aria-label="New event type">
          {(Object.keys(KIND_LABEL) as ScheduleKind[]).map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </select>
        <button type="button" className="btn small" disabled={busy || !newDate} onClick={() => send({ action: "schedule-add", date: newDate, kind: newKind })}>
          Add
        </button>
      </div>
    </section>
  );
}
