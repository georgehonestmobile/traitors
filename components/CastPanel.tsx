"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CastMember } from "@/lib/game";
import type { Player } from "@/lib/store";
import { Avatar } from "./Avatar";
import { gameAction } from "./gameApi";

type Props = {
  cast: CastMember[];
  /** Slack members who could still be added (not in the cast, not hidden). */
  addable: Player[];
  ended: boolean;
  /** Formatted "out" dates, keyed by player id. */
  outLabels: Record<string, string>;
};

type Action = { value: string; label: string; confirm?: (name: string) => string };

function actionsFor(m: CastMember): Action[] {
  const list: Action[] = [];
  if (m.status === "in") {
    if (m.role === "faithful") {
      list.push({ value: "role:traitor", label: "Make a Traitor (original)" });
      list.push({ value: "recruit", label: "Recruit as a Traitor", confirm: (n) => `Record that ${n} has been recruited as a Traitor?` });
    } else {
      list.push({ value: "role:faithful", label: "Make Faithful" });
    }
    list.push({ value: "banish", label: "Banish", confirm: (n) => `Banish ${n}? They'll be out of the game.` });
    if (m.role === "faithful") list.push({ value: "murder", label: "Murder", confirm: (n) => `Record that ${n} was murdered?` });
  } else {
    list.push({ value: "restore", label: "Bring back into the game", confirm: (n) => `Bring ${n} back into the game?` });
    list.push({ value: m.role === "traitor" ? "role:faithful" : "role:traitor", label: m.role === "traitor" ? "Correct role: Faithful" : "Correct role: Traitor" });
  }
  list.push({ value: "remove", label: "Remove from game", confirm: (n) => `Remove ${n} from this game entirely? (Use this for mistakes, not banishments.)` });
  return list;
}

export function CastPanel({ cast, addable, ended, outLabels }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(cast.length === 0);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    // Alphabetical within each group, so the order never hints at roles.
    const byName = (a: CastMember, b: CastMember) => a.name.localeCompare(b.name);
    return [...cast.filter((c) => c.status === "in").sort(byName), ...cast.filter((c) => c.status !== "in").sort((a, b) => (b.outAt ?? "").localeCompare(a.outAt ?? ""))];
  }, [cast]);
  const inCount = cast.filter((c) => c.status === "in").length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? addable.filter((p) => p.name.toLowerCase().includes(q)) : addable;
  }, [addable, query]);

  async function send(key: string, body: Record<string, unknown>) {
    setBusy(key);
    setError(null);
    try {
      await gameAction(body);
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  function onAction(m: CastMember, value: string) {
    const action = actionsFor(m).find((a) => a.value === value);
    if (!action) return;
    if (action.confirm && !window.confirm(action.confirm(m.name))) return;
    const [kind, role] = value.split(":");
    send(m.playerId, kind === "role" ? { action: "role", playerId: m.playerId, role } : { action: kind, playerId: m.playerId });
  }

  return (
    <section className="panel">
      <div className="reveal-head">
        <h2 className="panel-title">The cast</h2>
        {!adding && !ended && (
          <button type="button" className="btn ghost small" onClick={() => setAdding(true)}>+ Add players</button>
        )}
      </div>
      <p className="panel-sub">
        {cast.length
          ? `${inCount} of ${cast.length} still in. Set each player's role, record recruitments, banishments and murders.`
          : "Add the players taking part. Until you do, any Slack member can be picked for a vote."}
      </p>

      {error && <div className="error">{error}</div>}

      {adding && (
        <div className="add-players">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Slack members…" aria-label="Search Slack members" />
          <div className="chips" style={{ marginTop: 10 }}>
            <button type="button" className="chip" onClick={() => setPicked(new Set(visible.map((p) => p.id)))}>Select {query ? "shown" : "all"}</button>
            <button type="button" className="chip" disabled={!picked.size} onClick={() => setPicked(new Set())}>Clear</button>
          </div>
          <div className="players" role="group" aria-label="Players to add">
            {visible.map((p) => {
              const on = picked.has(p.id);
              return (
                <button
                  type="button"
                  key={p.id}
                  className={`player${on ? " on" : ""}`}
                  aria-pressed={on}
                  onClick={() =>
                    setPicked((s) => {
                      const next = new Set(s);
                      if (next.has(p.id)) next.delete(p.id);
                      else next.add(p.id);
                      return next;
                    })
                  }
                >
                  <Avatar player={p} />
                  <span className="name">{p.name}</span>
                  <span className="tick">{on ? "✓" : ""}</span>
                </button>
              );
            })}
            {!visible.length && <div className="empty">{addable.length ? `No one matches “${query}”.` : "Everyone is already in the game."}</div>}
          </div>
          <div className="inline" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn primary small"
              disabled={!picked.size || !!busy}
              onClick={async () => {
                if (await send("add", { action: "add", playerIds: [...picked] })) {
                  setPicked(new Set());
                  setAdding(false);
                }
              }}
            >
              Add {picked.size || ""} to the game
            </button>
            {cast.length > 0 && (
              <button type="button" className="btn ghost small" onClick={() => setAdding(false)}>Done</button>
            )}
          </div>
        </div>
      )}

      {sorted.length > 0 && (
        <table className="players-table cast-table">
          <thead>
            <tr><th>Player</th><th>Role</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {sorted.map((m) => (
              <tr key={m.playerId} className={m.status !== "in" ? "out" : undefined}>
                <td>
                  <span className="who">
                    <Avatar player={{ id: m.playerId, name: m.name, avatar: m.avatar }} />
                    <span>
                      {m.name}
                      <span className={`cast-status-mobile ${m.status === "in" ? "okc" : m.status === "murdered" ? "errc" : "muted"}`}>
                        {m.status === "in" ? "In" : m.status === "banished" ? "Banished" : "Murdered"}
                      </span>
                    </span>
                  </span>
                </td>
                <td>
                  <span className={`role-badge role ${m.role}`}>
                    {m.role === "traitor" ? "🗡️ " : "🛡️ "}
                    {m.role === "traitor" ? (m.recruitedAt ? "Recruited" : "Traitor") : "Faithful"}
                  </span>
                </td>
                <td>
                  {m.status === "in" ? (
                    <span className="okc">In</span>
                  ) : (
                    <span className={m.status === "murdered" ? "errc" : "muted"}>
                      {m.status === "banished" ? "Banished" : "Murdered"}
                      {outLabels[m.playerId] && <span className="faint"> · {outLabels[m.playerId]}</span>}
                    </span>
                  )}
                </td>
                <td className="cast-actions">
                  <select
                    value=""
                    disabled={!!busy}
                    aria-label={`Actions for ${m.name}`}
                    onChange={(e) => onAction(m, e.target.value)}
                  >
                    <option value="">{busy === m.playerId ? "Saving…" : "Change…"}</option>
                    {actionsFor(m).map((a) => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
