// Shared guard for admin API routes.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE, isAdminSession } from "./auth";
import { isAdminConfigured } from "./config";

export async function requireAdmin(): Promise<NextResponse | null> {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "admin_not_configured", message: "ADMIN_PASSWORD is not set — the dashboard is locked until it is." },
      { status: 503 },
    );
  }
  const store = await cookies();
  if (!isAdminSession(store.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "unauthorized", message: "Please log in to the dashboard." }, { status: 401 });
  }
  return null;
}
