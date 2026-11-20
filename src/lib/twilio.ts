// Twilio sending via the REST API (plain fetch, no SDK needed).
// All sends go through lib/whatsapp.ts so the 24h window + SMS fallback apply;
// this module only talks to Twilio.
import { isTwilioConfigured, smsFrom, whatsappFrom } from "./config";

export interface TwilioSendResult {
  ok: boolean;
  sid?: string;
  error?: string;
}

function authHeader(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

async function postMessage(params: Record<string, string>): Promise<TwilioSendResult> {
  if (!isTwilioConfigured()) {
    return { ok: false, error: "twilio_not_configured" };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (json as { message?: string }).message || `Twilio HTTP ${res.status}`;
      console.warn(`[twilio] send failed: ${msg}`);
      return { ok: false, error: msg };
    }
    return { ok: true, sid: (json as { sid?: string }).sid };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "network error";
    console.warn(`[twilio] send exception: ${msg}`);
    return { ok: false, error: msg };
  }
}

/** Send a WhatsApp message. `to` is E.164 without the whatsapp: prefix. */
export function sendWhatsApp(to: string, body: string): Promise<TwilioSendResult> {
  const clean = to.replace(/^whatsapp:/, "");
  return postMessage({ To: `whatsapp:${clean}`, From: whatsappFrom(), Body: body });
}

/** Send an SMS. `to` is E.164. */
export function sendSms(to: string, body: string): Promise<TwilioSendResult> {
  const clean = to.replace(/^whatsapp:/, "");
  return postMessage({ To: clean, From: smsFrom(), Body: body });
}
