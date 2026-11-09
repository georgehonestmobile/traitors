"use client";

import { useEffect, useRef, useState } from "react";
import type { RevealSettings, RevealView } from "@/lib/reveal";
import type { RoundStatus } from "@/lib/rounds";
import type { Channel } from "@/lib/slack";
import { estimateSeconds, MAX_GAP, MIN_GAP } from "@/lib/pacing";
const STANDINGS = [
  { label: "Never", value: 0 },
  { label: "Every 2", value: 2 },
  { label: "Every 3", value: 3 },
  { label: "Every 5", value: 5 },
];

type Props = {
  roundId: string;
  roundStatus: RoundStatus;
  votesCast: number;
  channels: Channel[];
  channelsError: string | null;
  defaults: Partial<RevealSettings>;
  initialView: RevealView | null;
};

function estimate(votes: number, every: number) {
  const secs = estimateSeconds(votes, every);
  return secs < 90 ? `${secs} seconds` : `${Math.round(secs / 60)} minutes`;
}

export function RevealPanel({ roundId, roundStatus, votesCast, channels, channelsError, defaults, initialView }: Props) {
  const [view, setView] = useState<RevealView | null>(initialView);
  const [channel, setChannel] = useState(
    channels.some((c) => c.id === defaults.channel) ? defaults.channel! : (channels[0]?.id ?? ""),
  );
  const [every, setEvery] = useState(defaults.standingsEvery ?? 3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const receivedAt = useRef(Date.now());

  async function act(action: string, extra: Record<string, unknown> = {}) {
    const res = await fetch(`/api/rounds/${roundId}/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    receivedAt.current = Date.now();
    return (data.view ?? null) as RevealView | null;
  }

  async function run(action: string, extra?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      setView(await act(action, extra));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Drive the reveal: whenever a step is due, ask the server to post it.
  useEffect(() => {
    if (view?.status !== "running") return;
    let cancelled = false;
    const wait = Math.max(400, view.msUntilNext - (Date.now() - receivedAt.current));
    const timer = setTimeout(async () => {
      try {
        const next = await act("step");
        if (!cancelled) setView(next);
      } catch (e) {
        if (cancelled) return;
        setError(`${e instanceof Error ? e.message : e}. Retrying…`);
        setTimeout(() => !cancelled && setView((v) => (v ? { ...v } : v)), 3000);
      }
    }, wait);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Countdown text.
  useEffect(() => {
    if (view?.status !== "running") return;
    const tick = () =>
      setCountdown(Math.max(0, Math.ceil((view.msUntilNext - (Date.now() - receivedAt.current)) / 1000)));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [view]);

  if (roundStatus === "cancelled") {
    return (
      <section className="panel">
        <h2 className="panel-title">The reveal</h2>
        <p className="panel-sub">This round was cancelled.</p>
      </section>
    );
  }

  /* ---------- Not started: settings ---------- */
  if (!view) {
    const canStart = roundStatus === "closed" && !!channel && !busy;
    const chosen = channels.find((c) => c.id === channel);
    return (
      <section className="panel">
        <h2 className="panel-title">The reveal</h2>
        <p className="panel-sub">
          Votes are revealed one at a time in a Slack channel, in the order that keeps everyone guessing longest.
        </p>

        {channelsError ? (
          <div className="error">Couldn&apos;t load Slack channels: {channelsError}</div>
        ) : (
          <div className="field">
            <label className="label" htmlFor="channel">Channel</label>
            <select id="channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.isPrivate ? "🔒 " : "#"}
                  {c.name}
                </option>
              ))}
            </select>
            <p className="hint">Private channels only appear once you&apos;ve invited the bot: <code>/invite @Round Table</code></p>
          </div>
        )}

        <div className="field">
          <div className="label"><span>Pace</span></div>
          <p className="hint" style={{ marginTop: 0 }}>
            Starts quickly, about {MIN_GAP}s between the early votes, then slows down as the count builds, up to{" "}
            {MAX_GAP}s before each of the final three. If it ends in a tie, the tiebreak recount runs at a quicker pace.
          </p>
        </div>

        <div className="field">
          <div className="label"><span>Post the running count</span></div>
          <div className="chips">
            {STANDINGS.map((s) => (
              <button type="button" key={s.value} className={`chip${every === s.value ? " on" : ""}`} onClick={() => setEvery(s.value)}>
                {s.label}
                {s.value ? " votes" : ""}
              </button>
            ))}
          </div>
        </div>

        <div className="summary">
          {roundStatus !== "closed" ? (
            <>Voting is still open. Close it, or wait for the deadline, before revealing.</>
          ) : (
            <>
              <b>{votesCast}</b> {votesCast === 1 ? "vote" : "votes"} will be revealed in{" "}
              <b>{chosen ? `${chosen.isPrivate ? "🔒 " : "#"}${chosen.name}` : "…"}</b>, taking about{" "}
              <b>{estimate(votesCast, every)}</b>. Keep this page open while it runs: closing it pauses the
              reveal.
            </>
          )}
        </div>

        {error && <div className="error">{error}</div>}
        <div className="sealed" style={{ margin: "0 0 14px" }}>🔒 Who voted for whom stays sealed until the reveal.</div>
        <button
          className="btn primary block"
          disabled={!canStart}
          onClick={() =>
            run("start", { channel, channelName: chosen?.name ?? "", standingsEvery: every })
          }
        >
          {busy ? "Starting…" : "Begin the reveal"}
        </button>
      </section>
    );
  }

  /* ---------- Running / paused / done ---------- */
  const pct = Math.round((view.stepsDone / Math.max(1, view.stepsTotal)) * 100);
  const max = Math.max(1, ...(view.result?.tally.map((t) => t.count) ?? [1]));

  return (
    <section className="panel">
      <div className="reveal-head">
        <h2 className="panel-title">The reveal</h2>
        <span className={`status ${view.status === "running" ? "open" : view.status === "paused" ? "scheduled" : "closed"}`}>
          {view.status === "running" ? "Live" : view.status === "paused" ? "Paused" : "Finished"}
        </span>
      </div>
      <p className="panel-sub">
        In #{view.channelName} · step {view.stepsDone} of {view.stepsTotal}
        {view.status === "running" && <> · next post in {countdown}s</>}
      </p>
      <div className="progress" style={{ marginBottom: 16 }}><span style={{ width: `${pct}%` }} /></div>

      {(error || view.error) && <div className="error">{view.error ?? error}</div>}

      <div className="actions" style={{ marginBottom: 18 }}>
        {view.status === "running" && (
          <>
            <button className="btn" disabled={busy} onClick={() => run("pause")}>Pause</button>
            <button className="btn ghost" disabled={busy} onClick={() => run("next")}>Post next now</button>
          </>
        )}
        {view.status === "paused" && (
          <button className="btn primary" disabled={busy} onClick={() => run("resume")}>Resume</button>
        )}
        {view.status !== "running" && (
          <button
            className="btn danger small"
            disabled={busy}
            onClick={() =>
              window.confirm("Reset the reveal so it can be run again? Posts already in Slack will stay.") && run("reset")
            }
          >
            Reset
          </button>
        )}
      </div>

      {view.result && (
        <div className="result">
          <div className="label"><span>{view.result.recount ? "Original count" : "Final count"}</span></div>
          {view.result.tally.map((t) => (
            <div key={t.name} className={`bar-row${!view.result!.recount && view.result!.banished.includes(t.name) ? " top" : ""}`}>
              <span className="bar-name">{t.name}</span>
              <span className="bar"><span style={{ width: `${(t.count / max) * 100}%` }} /></span>
              <span className="bar-n">{t.count}</span>
            </div>
          ))}
          {view.result.recount && (
            <>
              <div className="label" style={{ marginTop: 16 }}>
                <span>Tiebreak recount: {view.result.recount.tied.join(" v ")}</span>
              </div>
              {view.result.recount.tally.length === 0 && <p className="hint">No votes left to recount.</p>}
              {view.result.recount.tally.map((t) => (
                <div key={t.name} className={`bar-row${!view.result!.unresolved && view.result!.banished.includes(t.name) ? " top" : ""}`}>
                  <span className="bar-name">{t.name}</span>
                  <span className="bar">
                    <span style={{ width: `${(t.count / Math.max(1, ...view.result!.recount!.tally.map((x) => x.count))) * 100}%` }} />
                  </span>
                  <span className="bar-n">{t.count}</span>
                </div>
              ))}
            </>
          )}
          <p className="verdict">
            {view.result.banished.length === 0
              ? "No votes were cast."
              : !view.result.unresolved
                ? `${view.result.banished[0]} is banished${view.result.recount ? " after the tiebreak" : ""}.`
                : `Still tied: ${view.result.banished.join(" and ")}. Your call.`}
          </p>
        </div>
      )}

      {view.revealed.length > 0 && (
        <>
          <div className="label"><span>Revealed so far</span></div>
          <ol className="revealed">
            {[...view.revealed].reverse().map((r) => (
              <li key={r.key} className={r.recount ? "recount" : undefined}>
                <span className="muted">{r.recount ? `Recount ${r.n}.` : `${r.n}.`}</span> <b>{r.voter}</b>{" "}
                <span className="muted">voted for</span> <b>{r.target}</b>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
