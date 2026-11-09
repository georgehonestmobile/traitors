import Link from "next/link";
import { authDisabled } from "@/lib/auth";
import { isDemo } from "@/lib/slack";
import { getStore } from "@/lib/store";

export function TopBar() {
  const demo = isDemo();
  const memory = getStore().kind === "memory";
  return (
    <header className="topbar">
      <Link href="/" className="wordmark"><span className="sigil">✦</span>ROUND TABLE</Link>
      <div className="topbar-right">
        {demo && <span className="badge warn" title="No SLACK_BOT_TOKEN set: fake players, DMs are logged instead of sent">Demo mode</span>}
        {memory && <span className="badge warn" title="No Redis configured: data is lost on restart">In-memory storage</span>}
        {!authDisabled() && (
          <form action="/api/logout" method="post">
            <button className="btn ghost small" type="submit">Log out</button>
          </form>
        )}
      </div>
    </header>
  );
}
