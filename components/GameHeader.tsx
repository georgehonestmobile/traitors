"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GameStats, Winner } from "@/lib/game";
import { gameAction } from "./gameApi";
import { RoleToggle } from "./RoleToggle";

type Props = {
  name: string;
  startedAt: string;
  status: "active" | "ended";
  winner?: Winner;
  castSize: number;
  stats: GameStats;
  nextName: string;
};

const winnerLabel = (w: Winner) => (w === "faithful" ? "The Faithful win" : "The Traitors win");

export function GameHeader({ name, startedAt, status, winner, castSize, stats, nextName }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<"end" | "new" | null>(null);
  const [pick, setPick] = useState<Winner>(stats.suggestion?.winner ?? "faithful");
  const [newName, setNewName] = useState(nextName);
  const [copyCast, setCopyCast] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await gameAction(body);
      setForm(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const ended = status === "ended";
  const tiles = [
    { label: "Still in", value: stats.inPlay },
    { label: "Faithful left", value: stats.faithfulIn, role: true },
    { label: "Traitors left", value: stats.traitorsIn, role: true, traitor: true },
    { label: "Banished", value: stats.banished },
    { label: "Murdered", value: stats.murdered },
  ];

  return (
    <section className="panel game-header">
      <div className="game-title-row">
        <div>
          <div className="eyebrow">{ended ? "Game over" : "Game in progress"} · started {startedAt}</div>
          <h1>{name}</h1>
          {ended && winner && <div className={`winner ${winner}`}>{winnerLabel(winner)}</div>}
        </div>
        <div className="actions">
          <RoleToggle />
          {!ended && <Link className="btn primary" href="/rounds/new">Call a vote</Link>}
          {!ended && (
            <button type="button" className="btn" onClick={() => setForm(form === "end" ? null : "end")}>End game</button>
          )}
          {ended && (
            <button type="button" className="btn ghost" disabled={busy} onClick={() => send({ action: "reopen" })}>Reopen</button>
          )}
          <button type="button" className={`btn ${ended ? "primary" : "ghost"}`} onClick={() => setForm(form === "new" ? null : "new")}>
            New game
          </button>
        </div>
      </div>

      {castSize > 0 && (
        <div className="tiles">
          {tiles.map((t) => (
            <div key={t.label} className={`tile${t.traitor ? " traitor" : ""}`}>
              <span className={`tile-n${t.role ? " role" : ""}`}>{t.value}</span>
              <span className="tile-label">{t.label}</span>
            </div>
          ))}
        </div>
      )}

      {stats.suggestion && !form && (
        <div className="suggestion role">
          <span>⚖️ {stats.suggestion.reason}</span>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setPick(stats.suggestion!.winner);
              setForm("end");
            }}
          >
            End the game
          </button>
        </div>
      )}

      {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}

      {form === "end" && (
        <div className="inline-form">
          <div className="label"><span>Who won?</span></div>
          <div className="chips">
            <button type="button" className={`chip${pick === "faithful" ? " on" : ""}`} onClick={() => setPick("faithful")}>🛡️ The Faithful</button>
            <button type="button" className={`chip${pick === "traitors" ? " on" : ""}`} onClick={() => setPick("traitors")}>🗡️ The Traitors</button>
          </div>
          <div className="inline" style={{ marginTop: 12 }}>
            <button type="button" className="btn primary small" disabled={busy} onClick={() => send({ action: "end", winner: pick })}>
              End {name}
            </button>
            <button type="button" className="btn ghost small" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}

      {form === "new" && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            send({ action: "new", name: newName, copyCast });
          }}
        >
          <div className="label"><span>New game</span></div>
          <div className="inline">
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New game name" maxLength={60} autoFocus />
            <button className="btn primary small" type="submit" disabled={busy}>Start</button>
            <button className="btn ghost small" type="button" onClick={() => setForm(null)}>Cancel</button>
          </div>
          {castSize > 0 && (
            <label className="check">
              <input type="checkbox" checked={copyCast} onChange={(e) => setCopyCast(e.target.checked)} />
              Start with the same {castSize} players (everyone back in, all Faithful)
            </label>
          )}
          <p className="hint">{name} and its rounds are kept under “Earlier rounds”.</p>
        </form>
      )}
    </section>
  );
}
