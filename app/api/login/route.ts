import { NextResponse } from "next/server";
import { checkPassword, SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: Request) {
  const form = await req.formData();
  const token = checkPassword(String(form.get("password") ?? ""));
  if (!token) return NextResponse.redirect(new URL("/login?error=1", req.url), 303);

  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
