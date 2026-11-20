// Reservations list for the dashboard, with status chips data.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-api";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  await ensureSeed().catch(() => undefined);
  const reservations = await prisma.reservation.findMany({
    orderBy: { checkinDate: "asc" },
    include: {
      property: true,
      extras: true,
      payments: true,
      holds: { where: { status: "active" } },
    },
  });
  const tasks = await prisma.housekeepingTask.findMany({ include: { property: true } });
  return NextResponse.json({
    reservations: reservations.map((r) => ({
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
      extras: r.extras.map((e) => ({ type: e.type, amount: e.amount, details: e.details, status: e.status })),
      payments: r.payments.map((p) => ({ id: p.id, kind: p.kind, extraType: p.extraType, amount: p.amount, status: p.status })),
      activeHolds: r.holds.map((h) => ({ id: h.id, extraType: h.extraType, slot: h.slot, amount: h.amount, expiresAt: h.expiresAt })),
      tasks: tasks.filter((t) => t.reservationId === r.id).map((t) => ({ id: t.id, date: t.date, readyBy: t.readyBy, status: t.status })),
    })),
  });
}
