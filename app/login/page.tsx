import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isAdmin()) redirect("/");
  const { error } = await searchParams;
  return (
    <main className="login-wrap">
      <div className="login">
        <div className="wordmark"><span className="sigil">✦</span>ROUND TABLE<span className="sigil">✦</span></div>
        <p>Host access only.</p>
        <form action="/api/login" method="post">
          {error && <div className="error">That password isn&apos;t right.</div>}
          <input type="password" name="password" placeholder="Password" aria-label="Password" autoFocus required />
          <button className="btn primary block" type="submit">Enter</button>
        </form>
      </div>
    </main>
  );
}
