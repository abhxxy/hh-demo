// X-Twilio-Signature validation, ported from the original ping bot (server.js).
// Twilio signs: HMAC-SHA1 over (full URL + each POST param key+value, keys sorted
// alphabetically), base64-encoded, using TWILIO_AUTH_TOKEN as the key.
// If the token is unset, validation is skipped with a loud warning (as before).
import crypto from "crypto";

export function twilioSignatureValid(
  authToken: string | undefined,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!authToken) {
    console.warn("[twilio] WARNING: TWILIO_AUTH_TOKEN not set, skipping signature validation");
    return true;
  }
  if (!signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = crypto.createHmac("sha1", authToken).update(data, "utf-8").digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Full URL Twilio signed: PUBLIC_BASE_URL + path (proxy-safe). */
export function twilioSignedUrl(pathname: string): string {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return base ? base + pathname : pathname;
}
