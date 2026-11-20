// Staff dashboard auth: a signed httpOnly cookie. The signature is an HMAC
// keyed by ADMIN_PASSWORD itself, so there is nothing else to store.
// If ADMIN_PASSWORD is unset, nobody can log in (and the login page says so).
import crypto from "crypto";

export const ADMIN_COOKIE = "hh_admin";

function expectedValue(): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  return crypto.createHmac("sha256", pw).update("home-and-hill-admin").digest("hex");
}

export function createAdminSessionValue(): string | null {
  return expectedValue();
}

export function isAdminSession(value: string | undefined | null): boolean {
  if (!value) return false;
  const expected = expectedValue();
  if (!expected) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
