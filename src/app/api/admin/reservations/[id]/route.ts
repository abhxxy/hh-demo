// Reservation detail: timeline of every message, payment, offer and task change.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-api";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await params;
  const r = await prisma.reservation.findUnique({
    where: { id },
    include: { property: true },
  });
  if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const [timeline, messages, payments, extras, holds, chatMessages, tasks] = await Promise.all([
    prisma.timelineEvent.findMany({ where: { reservationId: id }, orderBy: { at: "desc" }, take: 100 }),
    prisma.message.findMany({ where: { reservationId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.payment.findMany({ where: { reservationId: id }, orderBy: { createdAt: "desc" } }),
    prisma.extra.findMany({ where: { reservationId: id }, orderBy: { createdAt: "desc" } }),
    prisma.hold.findMany({ where: { reservationId: id }, orderBy: { createdAt: "desc" } }),
    prisma.chatMessage.findMany({ where: { reservationId: id }, orderBy: { createdAt: "asc" }, take: 100 }),
    prisma.housekeepingTask.findMany({ where: { reservationId: id }, orderBy: { date: "asc" } }),
  ]);
  return NextResponse.json({
    reservation: {
      id: r.id,
      guestName: r.guestName,
      guests: r.guests,
      property: r.property.name,
      bedrooms: r.property.bedrooms,
      checkinDate: r.checkinDate,
      checkoutDate: r.checkoutDate,
      checkinTime: r.checkinTime,
      checkoutTime: r.checkoutTime,
      channel: r.channel,
      status: r.status,
      registered: r.registered,
      arrived: r.arrived,
      needsFollowUp: r.needsFollowUp,
      followupSent: r.followupSent,
      accessReleaseTime: r.accessReleaseTime,
      guestPhone: r.guestPhone,
      guestEmail: r.guestEmail,
      idPhotoPath: r.idPhotoPath,
      portalToken: r.portalToken,
    },
    timeline,
    messages,
    payments,
    extras,
    holds,
    chatMessages,
    tasks,
  });
}
