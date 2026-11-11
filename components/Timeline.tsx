import type { GameEvent } from "@/lib/game";
import { formatDateTime } from "@/lib/format";

const ICON: Record<GameEvent["kind"], string> = {
  started: "🕯️",
  joined: "👤",
  left: "➖",
  role: "🎭",
  recruited: "🩸",
  banished: "🗡️",
  murdered: "🔪",
  restored: "↩️",
  ended: "🏁",
  reopened: "🔓",
};

/** Event text, with the parts that give away roles marked so "Hide roles" can blur them. */
function Text({ event }: { event: GameEvent }) {
  if (event.kind === "role" || event.kind === "recruited") return <span className="role">{event.text}</span>;
  const marker = event.kind === "ended" ? " The Traitors were" : " They were";
  const i = event.text.indexOf(marker);
  if (i < 0) return <>{event.text}</>;
  return (
    <>
      {event.text.slice(0, i)} <span className="role">{event.text.slice(i + 1)}</span>
    </>
  );
}

export function Timeline({ events }: { events: GameEvent[] }) {
  const list = [...events].reverse();
  return (
    <section className="panel">
      <h2 className="panel-title">Timeline</h2>
      <p className="panel-sub">Everything that has happened in this game, newest first.</p>
      <ol className="timeline">
        {list.map((e) => (
          <li key={e.id} className={e.kind}>
            <span className="t-icon" aria-hidden>{ICON[e.kind]}</span>
            <span className="t-text"><Text event={e} /></span>
            <span className="t-time">{formatDateTime(e.at)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
