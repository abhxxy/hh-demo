// Twilio sending via the REST API (plain fetch, no SDK needed).
// All sends go through lib/whatsapp.ts so the 24h window + SMS fallback apply;
// this module only talks to Twilio.
import { isTwilioConfigured, publicBaseUrl, smsFrom, whatsappFrom } from "./config";

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

const CHECKIN_TEMPLATE_NAME = "hh_demo_checkin_v1";
let checkinContentSid: string | null = null;

async function getCheckinContentSid(): Promise<string | null> {
  if (checkinContentSid) return checkinContentSid;
  const headers = { Authorization: authHeader() };
  const list = await fetch("https://content.twilio.com/v1/Content?PageSize=100", { headers });
  if (!list.ok) return null;
  const { contents = [] } = (await list.json()) as { contents?: { sid: string; friendly_name: string }[] };
  const existing = contents.find((c) => c.friendly_name === CHECKIN_TEMPLATE_NAME);
  if (existing) {
    checkinContentSid = existing.sid;
    return existing.sid;
  }
  const created = await fetch("https://content.twilio.com/v1/Content", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      friendly_name: CHECKIN_TEMPLATE_NAME,
      language: "en",
      variables: { "1": "there", "2": "Loft 4", "3": "token" },
      types: {
        "twilio/call-to-action": {
          body: "Hi {{1}}, thank you for confirming your stay with Home & Hill at {{2}}.\n\nPlease check in now to confirm your booking and make your arrival easy. It only takes a couple of minutes.\n\nTap the button below to get started.",
          actions: [{ type: "URL", title: "Check in", url: `${publicBaseUrl()}/g/{{3}}` }],
        },
      },
    }),
  });
  if (!created.ok) {
    console.warn(`[twilio] check-in template create failed: HTTP ${created.status}`);
    return null;
  }
  const { sid } = (await created.json()) as { sid: string };
  checkinContentSid = sid;
  return sid;
}

async function messageWasRejected(messageSid: string): Promise<boolean> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}.json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const res = await fetch(url, { headers: { Authorization: authHeader() } }).catch(() => null);
    if (!res?.ok) continue;
    const { status } = (await res.json()) as { status?: string };
    if (status === "failed" || status === "undelivered") return true;
    if (status === "delivered" || status === "read") return false;
  }
  return false;
}

export async function sendCheckinButton(
  to: string,
  vars: { name: string; property: string; portalToken: string },
): Promise<TwilioSendResult> {
  if (!isTwilioConfigured()) return { ok: false, error: "twilio_not_configured" };
  try {
    const contentSid = await getCheckinContentSid();
    if (!contentSid) return { ok: false, error: "checkin_template_unavailable" };
    const sent = await postMessage({
      To: `whatsapp:${to.replace(/^whatsapp:/, "")}`,
      From: whatsappFrom(),
      ContentSid: contentSid,
      ContentVariables: JSON.stringify({ "1": vars.name, "2": vars.property, "3": vars.portalToken }),
    });
    if (sent.ok && sent.sid && (await messageWasRejected(sent.sid))) {
      return { ok: false, sid: sent.sid, error: "checkin_button_rejected" };
    }
    return sent;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/** Send an SMS. `to` is E.164. */
export function sendSms(to: string, body: string): Promise<TwilioSendResult> {
  const clean = to.replace(/^whatsapp:/, "");
  return postMessage({ To: clean, From: smsFrom(), Body: body });
}
