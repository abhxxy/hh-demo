// Admin login: POST {password} sets a signed httpOnly cookie.
// GET reports whether the dashboard is configured and the session is valid.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, createAdminSessionValue, isAdminSession } from "@/lib/auth";
import { isAdminConfigured } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = await cookies();
  return NextResponse.json({
    configured: isAdminConfigured(),
    authenticated: isAdminSession(store.get(ADMIN_COOKIE)?.value),
  });
}

export async function POST(req: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "admin_not_configured", message: "ADMIN_PASSWORD is not set — the dashboard is locked until it is." }, { status: 503 });
  }
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (body.password !== process.env.ADMIN_PASSWORD) {
    console.warn("[admin] failed login attempt");
    return NextResponse.json({ error: "wrong_password", message: "Wrong password." }, { status: 401 });
  }
  const value = createAdminSessionValue()!;
  const store = await cookies();
  store.set(ADMIN_COOKIE, value, {
    httpOnly: true,
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  console.log("[admin] login ok");
  return NextResponse.json({ ok: true });
}
