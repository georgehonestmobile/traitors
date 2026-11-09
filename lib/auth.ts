import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const SESSION_COOKIE = "rt_admin";

/** With no ADMIN_PASSWORD set, the admin is open, but only in local development. */
export const authDisabled = () => !process.env.ADMIN_PASSWORD && process.env.NODE_ENV !== "production";

function sessionToken(): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  return crypto.createHmac("sha256", pw).update("round-table-admin-v1").digest("hex");
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function checkPassword(candidate: string): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw || !safeEqual(candidate, pw)) return null;
  return sessionToken();
}

export async function isAdmin(): Promise<boolean> {
  if (authDisabled()) return true;
  const token = sessionToken();
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  return !!token && !!cookie && safeEqual(cookie, token);
}

/** For pages: bounce to the login screen. */
export async function requireAdmin() {
  if (!(await isAdmin())) redirect("/login");
}
