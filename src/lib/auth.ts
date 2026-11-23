// Staff dashboard auth: a signed httpOnly cookie. The signature is an HMAC
// keyed by ADMIN_PASSWORD itself, so there is nothing else to store.
// Demo mode: if ADMIN_PASSWORD is unset, the dashboard is open to everyone
// (no login). Set ADMIN_PASSWORD to lock it behind the login page.
import crypto from "crypto";

export const ADMIN_COOKIE = "hh_admin";

/** True when no admin password is configured: the dashboard is wide open (demo mode). */
export function isDemoOpen(): boolean {
  return !process.env.ADMIN_PASSWORD;
}

function expectedValue(): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  return crypto.createHmac("sha256", pw).update("home-and-hill-admin").digest("hex");
}

export function createAdminSessionValue(): string | null {
  return expectedValue();
}

export function isAdminSession(value: string | undefined | null): boolean {
  // Demo mode: no password configured means no login is required.
  if (isDemoOpen()) return true;
  if (!value) return false;
  const expected = expectedValue();
  if (!expected) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
