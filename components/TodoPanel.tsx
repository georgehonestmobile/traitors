import Link from "next/link";
import type { Todo } from "@/lib/todo";

const BADGE: Record<Todo["urgency"], string> = { overdue: "Overdue", now: "Do now", soon: "Coming up" };

export function TodoPanel({ todos }: { todos: Todo[] }) {
  return (
    <section className="panel todo-panel">
      <h2 className="panel-title">To do</h2>
      {todos.length === 0 ? (
        <p className="panel-sub" style={{ margin: 0 }}>✓ Nothing to do right now.</p>
      ) : (
        <ul className="todos">
          {todos.map((t) => (
            <li key={t.id} className={t.urgency}>
              <span className={`todo-badge ${t.urgency}`}>{BADGE[t.urgency]}</span>
              <div className="todo-body">
                <strong>{t.title}</strong>
                <span className="muted">{t.detail}</span>
              </div>
              {t.href && t.action && (
                t.href.startsWith("#") ? (
                  <a className="btn small" href={t.href}>{t.action}</a>
                ) : (
                  <Link className={`btn small${t.urgency !== "soon" ? " primary" : ""}`} href={t.href}>{t.action}</Link>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
