// Twilio incoming WhatsApp webhook. Fixed route — Twilio is already pointed here.
// Validates X-Twilio-Signature (ported from the original ping bot), stores the
// message, handles the demo/cleaner/ops keywords, and replies with TwiML.
// Non-keyword messages get a short AI reply sent via the API after responding
// (keeps the webhook fast).
import { after, NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordInbound, sendOutbound, normalizePhone } from "@/lib/whatsapp";
import { twilioSignedUrl, twilioSignatureValid } from "@/lib/twilio-validate";
import { isLlmConfigured, publicBaseUrl } from "@/lib/config";
import { ruleBasedReply, runLlmChat } from "@/lib/llm";

export const dynamic = "force-dynamic";

function twiml(message?: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}

function xmlResponse(message?: string) {
  return new NextResponse(twiml(message), { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

async function findDemoReservation() {
  // The demo reservation is the "Test Guest" stay; fall back to the next
  // upcoming confirmed reservation.
  const demo = await prisma.reservation.findFirst({
    where: { guestName: "Test Guest", status: "confirmed" },
    orderBy: { checkinDate: "asc" },
    include: { property: true },
  });
  if (demo) return demo;
  return prisma.reservation.findFirst({
    where: { status: "confirmed" },
    orderBy: { checkinDate: "asc" },
    include: { property: true },
  });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => {
    params[k] = String(v);
  });
  const signature = req.headers.get("X-Twilio-Signature") || "";
  const url = twilioSignedUrl("/api/webhooks/twilio");
  if (!twilioSignatureValid(process.env.TWILIO_AUTH_TOKEN, signature, url, params)) {
    console.warn(`[twilio] Invalid signature for POST /api/webhooks/twilio from ${req.headers.get("x-forwarded-for") || "unknown"}`);
    return new NextResponse("Forbidden: invalid Twilio signature", { status: 403 });
  }

  const from = params.From || "";
  const body = (params.Body || "").trim();
  const sid = params.MessageSid || undefined;
  const phone = normalizePhone(from);
  console.log(`[twilio] inbound from=${from} body=${JSON.stringify(body)}`);

  // Link to a reservation by phone, if we know this guest.
  const linked = phone
    ? await prisma.reservation.findFirst({ where: { guestPhone: phone, status: "confirmed" }, orderBy: { checkinDate: "asc" } })
    : null;
  await recordInbound({ from, body, sid, reservationId: linked?.id ?? null });

  const keyword = body.toLowerCase();
  const base = publicBaseUrl();

  if (keyword === "demo") {
    const demo = await findDemoReservation();
    if (!demo) {
      return xmlResponse("Sorry — there is no demo reservation set up right now. Please ask the team to reset the demo.");
    }
    await prisma.reservation.update({ where: { id: demo.id }, data: { guestPhone: phone } });
    await prisma.contact.upsert({
      where: { phone },
      update: { role: "guest", lastInboundAt: new Date() },
      create: { phone, role: "guest", lastInboundAt: new Date() },
    });
    await prisma.timelineEvent.create({
      data: { reservationId: demo.id, kind: "message", text: `Guest linked by WhatsApp "demo" keyword: ${phone}. Portal link sent.` },
    });
    const reply =
      `Welcome to Home & Hill! You're linked to the demo stay in ${demo.property.name} as our test guest.\n` +
      `Your personal guest portal: ${base}/g/${demo.portalToken}\n` +
      `Open it to register, upload your ID and pay the tourist tax and deposit — then you can chat with our assistant about your stay.`;
    console.log(`[twilio] demo keyword: linked ${phone} to reservation ${demo.id}`);
    return xmlResponse(reply);
  }

  if (keyword === "cleaner") {
    await prisma.contact.upsert({
      where: { phone },
      update: { role: "cleaner", lastInboundAt: new Date() },
      create: { phone, role: "cleaner", lastInboundAt: new Date() },
    });
    console.log(`[twilio] cleaner keyword: registered ${phone} as cleaner`);
    return xmlResponse(
      "You're registered as the cleaner for all Home & Hill demo properties. You'll get a WhatsApp alert whenever a guest pays for an extra or a booking changes.",
    );
  }

  if (keyword === "ops") {
    await prisma.contact.upsert({
      where: { phone },
      update: { role: "ops", lastInboundAt: new Date() },
      create: { phone, role: "ops", lastInboundAt: new Date() },
    });
    console.log(`[twilio] ops keyword: registered ${phone} as ops contact`);
    return xmlResponse(
      "You're registered as the operations contact for the Home & Hill demo. You'll get alerts for reported issues, failed payments and guests who haven't arrived by 21:00.",
    );
  }

  if (keyword === "ping") {
    return xmlResponse("pong 🏓");
  }

  // Any other message: short AI reply via the API (after the fast TwiML 200),
  // unless the conversation is paused.
  after(async () => {
    try {
      const conv = await prisma.conversation.findUnique({ where: { phone } });
      if (conv?.paused) {
        console.log(`[twilio] conversation ${phone} is paused — no AI reply`);
        return;
      }
      if (linked) {
        const history = await prisma.chatMessage.findMany({
          where: { reservationId: linked.id },
          orderBy: { createdAt: "desc" },
          take: 10,
        });
        const turns = history.reverse().map((m) => ({ role: m.role as "user" | "assistant", text: m.text }));
        const reply = isLlmConfigured()
          ? await runLlmChat(linked.id, turns, body)
          : await ruleBasedReply(linked.id, body);
        const full = `${reply}\n\nYour portal: ${base}/g/${linked.portalToken}`;
        await sendOutbound({ to: phone, body: full, reservationId: linked.id });
      } else {
        await sendOutbound({
          to: phone,
          body: "Hi! If you're our demo guest, send \"demo\" and I'll send you your personal guest portal link. Staff can send \"cleaner\" or \"ops\" to register for alerts.",
          reservationId: null,
        });
      }
    } catch (e) {
      console.error("[twilio] AI reply failed:", e);
    }
  });

  return xmlResponse();
}
