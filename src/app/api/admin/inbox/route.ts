// Inbox: WhatsApp-style conversations. GET lists conversations (or one thread
// with ?phone=). POST replies as staff. PATCH toggles "Pause AI".
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-api";
import { sendOutbound } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const phone = req.nextUrl.searchParams.get("phone");
  if (phone) {
    const messages = await prisma.message.findMany({
      where: { OR: [{ from: { contains: phone } }, { to: { contains: phone } }] },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    const conversation = await prisma.conversation.findUnique({ where: { phone } });
    const reservation = await prisma.reservation.findFirst({
      where: { guestPhone: phone, status: "confirmed" },
      orderBy: { checkinDate: "asc" },
      include: { property: true },
    });
    const contact = await prisma.contact.findUnique({ where: { phone } });
    return NextResponse.json({ phone, paused: conversation?.paused ?? false, role: contact?.role ?? "guest", messages, reservation });
  }
  const conversations = await prisma.conversation.findMany({ orderBy: { id: "asc" } });
  const list = [];
  for (const c of conversations) {
    const last = await prisma.message.findFirst({
      where: { OR: [{ from: { contains: c.phone } }, { to: { contains: c.phone } }] },
      orderBy: { createdAt: "desc" },
    });
    const reservation = await prisma.reservation.findFirst({
      where: { guestPhone: c.phone, status: "confirmed" },
      orderBy: { checkinDate: "asc" },
      include: { property: true },
    });
    const contact = await prisma.contact.findUnique({ where: { phone: c.phone } });
    list.push({
      phone: c.phone,
      paused: c.paused,
      role: contact?.role ?? "guest",
      lastMessage: last ? { body: last.body, direction: last.direction, at: last.createdAt, status: last.status } : null,
      reservation: reservation ? { id: reservation.id, guestName: reservation.guestName, property: reservation.property.name, checkinDate: reservation.checkinDate } : null,
    });
  }
  return NextResponse.json({ conversations: list });
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  let body: { phone?: string; body?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const phone = String(body.phone || "").trim();
  const text = String(body.body || "").trim().slice(0, 2000);
  if (!phone || !text) return NextResponse.json({ error: "bad_request", message: "Phone and message are required." }, { status: 400 });
  const reservation = await prisma.reservation.findFirst({ where: { guestPhone: phone, status: "confirmed" }, orderBy: { checkinDate: "asc" } });
  const result = await sendOutbound({ to: phone, body: text, reservationId: reservation?.id ?? null });
  if (!result.sent) {
    return NextResponse.json({ sent: false, reason: result.reason, detail: result.detail, message: result.reason === "outside_24h" ? "Outside the 24h WhatsApp window — the guest must message us first. The attempt was logged." : "Could not send — see the warning in the dashboard." }, { status: 200 });
  }
  if (reservation) {
    await prisma.timelineEvent.create({ data: { reservationId: reservation.id, kind: "message", text: `Staff replied on WhatsApp (${result.channel}): ${text.slice(0, 200)}` } });
  }
  return NextResponse.json({ sent: true, channel: result.channel });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  let body: { phone?: string; paused?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const phone = String(body.phone || "").trim();
  if (!phone || typeof body.paused !== "boolean") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const conv = await prisma.conversation.upsert({
    where: { phone },
    update: { paused: body.paused },
    create: { phone, paused: body.paused },
  });
  return NextResponse.json({ phone: conv.phone, paused: conv.paused });
}
