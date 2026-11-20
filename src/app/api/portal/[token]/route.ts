// Guest portal data: reservation, extras, payments, chat, tasks, config flags.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getConfigStatus } from "@/lib/config";
import { registrationAmounts } from "@/lib/tools";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  await ensureSeed().catch(() => undefined);
  const { token } = await params;
  const reservation = await prisma.reservation.findUnique({
    where: { portalToken: token },
    include: { property: true, extras: true, payments: { orderBy: { createdAt: "desc" } } },
  });
  if (!reservation) {
    return NextResponse.json({ error: "reservation_not_found", message: "This portal link is not valid. Please ask the team for a new link." }, { status: 404 });
  }
  const chatMessages = await prisma.chatMessage.findMany({
    where: { reservationId: reservation.id },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  const holds = await prisma.hold.findMany({
    where: { reservationId: reservation.id, status: "active", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  const tasks = await prisma.housekeepingTask.findMany({
    where: { propertyId: reservation.propertyId, date: reservation.checkinDate },
  });
  const amounts = registrationAmounts(reservation);
  const config = getConfigStatus();
  return NextResponse.json({
    reservation: {
      id: reservation.id,
      guestName: reservation.guestName,
      guests: reservation.guests,
      property: reservation.property.name,
      bedrooms: reservation.property.bedrooms,
      checkinDate: reservation.checkinDate,
      checkoutDate: reservation.checkoutDate,
      checkinTime: reservation.checkinTime,
      checkoutTime: reservation.checkoutTime,
      channel: reservation.channel,
      status: reservation.status,
      registered: reservation.registered,
      arrived: reservation.arrived,
      accessReleaseTime: reservation.accessReleaseTime,
      guestPhone: reservation.guestPhone,
      guestEmail: reservation.guestEmail,
      idPhotoPath: reservation.idPhotoPath,
      touristTaxCollectedByPlatform: reservation.touristTaxCollectedByPlatform,
    },
    amounts,
    extras: reservation.extras,
    payments: reservation.payments.map((p) => ({ id: p.id, kind: p.kind, extraType: p.extraType, amount: p.amount, status: p.status, createdAt: p.createdAt })),
    holds: holds.map((h) => ({ id: h.id, extraType: h.extraType, slot: h.slot, amount: h.amount, expiresAt: h.expiresAt })),
    chatMessages: chatMessages.map((m) => ({ id: m.id, role: m.role, text: m.text, createdAt: m.createdAt })),
    tasks: tasks.map((t) => ({ id: t.id, readyBy: t.readyBy, status: t.status })),
    config: { llm: config.llm, llmProvider: config.llmProvider, mollie: config.mollie },
  });
}
