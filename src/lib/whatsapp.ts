// Outbound WhatsApp with the rules that matter for this demo:
//  - Free-form WhatsApp only works within 24h of the recipient messaging us.
//    Outside that window we SKIP the send, log it clearly and record a warning
//    the dashboard surfaces.
//  - If WhatsApp fails, fall back to SMS with the same text.
//  - If SMS fails too, log it and flag it for ops.
// Every outbound attempt is stored as a Message row so the inbox/timeline show it.
import { prisma } from "./prisma";
import { sendSms, sendWhatsApp } from "./twilio";
import { isTwilioConfigured } from "./config";

// Normalize a phone to E.164: trim, drop spaces, ensure a leading "+".
// (Form-encoded "+" can arrive as a space from sloppy senders.)
export function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/^whatsapp:/, "").replace(/[\s()-]/g, "");
  if (!cleaned) return cleaned;
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("00")) return `+${cleaned.slice(2)}`;
  if (cleaned.startsWith("0")) return `+32${cleaned.slice(1)}`;
  return `+${cleaned}`;
}

export type OutboundResult =
  | { sent: true; channel: "whatsapp" | "sms"; sid?: string }
  | { sent: false; reason: "not_configured" | "outside_24h" | "failed"; detail?: string };

export async function lastInboundWithin24h(phone: string): Promise<boolean> {
  const contact = await prisma.contact.findUnique({ where: { phone } });
  if (!contact?.lastInboundAt) return false;
  return Date.now() - new Date(contact.lastInboundAt).getTime() < 24 * 60 * 60 * 1000;
}

async function warn(reservationId: string | null, text: string) {
  console.warn(`[whatsapp] ${text}`);
  if (reservationId) {
    await prisma.timelineEvent.create({
      data: { reservationId, kind: "warning", text },
    });
  }
}

/**
 * Send an outbound message, honouring the 24h window and SMS fallback.
 * `reservationId` may be null (e.g. cleaner/ops messages not tied to a booking);
 * warnings are still logged, and a TimelineEvent is written when a reservation
 * is known. Returns whether anything was actually sent.
 */
export async function sendOutbound(opts: {
  to: string;
  body: string;
  reservationId?: string | null;
  skipWindowCheck?: boolean; // only for demo-control simulations
}): Promise<OutboundResult> {
  const { to, body } = opts;
  const reservationId = opts.reservationId ?? null;
  const phone = normalizePhone(to);

  if (!isTwilioConfigured()) {
    console.warn(`[whatsapp] Twilio not configured — message NOT sent to ${phone}: ${body.slice(0, 80)}`);
    await warn(reservationId, `WhatsApp not sent to ${phone} — Twilio is not configured (set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).`);
    return { sent: false, reason: "not_configured" };
  }

  if (!opts.skipWindowCheck && !(await lastInboundWithin24h(phone))) {
    console.warn(`[whatsapp] Skipping WhatsApp to ${phone} — outside the 24h window (no inbound message in the last 24h).`);
    await warn(
      reservationId,
      `WhatsApp to ${phone} skipped — outside the 24h window (they have not messaged us in the last 24h).`,
    );
    return { sent: false, reason: "outside_24h" };
  }

  const wa = await sendWhatsApp(phone, body);
  if (wa.ok) {
    await prisma.message.create({
      data: {
        reservationId,
        direction: "out",
        channel: "whatsapp",
        body,
        status: "sent",
        from: "whatsapp:+32460201874",
        to: `whatsapp:${phone}`,
        twilioSid: wa.sid,
      },
    });
    console.log(`[whatsapp] sent to ${phone} sid=${wa.sid}`);
    return { sent: true, channel: "whatsapp", sid: wa.sid };
  }

  console.warn(`[whatsapp] WhatsApp to ${phone} failed (${wa.error}) — falling back to SMS.`);
  const sms = await sendSms(phone, body);
  if (sms.ok) {
    await prisma.message.create({
      data: {
        reservationId,
        direction: "out",
        channel: "sms",
        body,
        status: "sent",
        from: "+32460201874",
        to: phone,
        twilioSid: sms.sid,
      },
    });
    console.log(`[whatsapp] SMS fallback sent to ${phone} sid=${sms.sid}`);
    return { sent: true, channel: "sms", sid: sms.sid };
  }

  await warn(
    reservationId,
    `Delivery failed to ${phone}: WhatsApp failed (${wa.error}) and SMS fallback failed (${sms.error}). Ops should follow up.`,
  );
  await prisma.message.create({
    data: {
      reservationId,
      direction: "out",
      channel: "whatsapp",
      body,
      status: "failed",
      from: "whatsapp:+32460201874",
      to: `whatsapp:${phone}`,
    },
  });
  return { sent: false, reason: "failed", detail: `${wa.error} / SMS: ${sms.error}` };
}

/** Record an inbound WhatsApp message + update the contact's 24h window. */
export async function recordInbound(opts: {
  from: string;
  body: string;
  sid?: string;
  reservationId?: string | null;
}) {
  const phone = normalizePhone(opts.from);
  await prisma.contact.upsert({
    where: { phone },
    update: { lastInboundAt: new Date() },
    create: { phone, role: "guest", lastInboundAt: new Date() },
  });
  await prisma.conversation.upsert({
    where: { phone },
    update: {},
    create: { phone, paused: false },
  });
  await prisma.message.create({
    data: {
      reservationId: opts.reservationId ?? null,
      direction: "in",
      channel: "whatsapp",
      body: opts.body,
      status: "received",
      from: `whatsapp:${phone}`,
      to: "whatsapp:+32460201874",
      twilioSid: opts.sid,
    },
  });
}
