// DEMO CONTROLS — the buttons on the dashboard that drive the live demo.
// Date changes and cancellations update tasks and send new cleaner alerts.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-api";
import { publicBaseUrl } from "@/lib/config";
import { sendOutbound } from "@/lib/whatsapp";
import { resetDemo } from "@/lib/seed";
import { runFollowups } from "@/lib/jobs";
import { confirmExtraPayment } from "@/lib/payments";
import { addDays, formatDateLong, formatDateShort } from "@/lib/brussels";
import { getHostifyAdapter } from "@/lib/hostify";

export const dynamic = "force-dynamic";

async function demoReservation() {
  return prisma.reservation.findFirst({
    where: { guestName: "Test Guest", status: "confirmed" },
    orderBy: { checkinDate: "asc" },
    include: { property: true },
  });
}

async function alertCleanerOps(reservationId: string, body: string) {
  const contacts = await prisma.contact.findMany({ where: { role: { in: ["cleaner", "ops"] } } });
  for (const c of contacts) {
    await sendOutbound({ to: c.phone, body, reservationId });
  }
  return contacts.length;
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  let body: { action?: string; days?: number; holdId?: string; reservationId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const action = body.action || "";
  const base = publicBaseUrl();

  if (action === "reset") {
    const seeded = await resetDemo();
    return NextResponse.json({
      ok: true,
      message: "Demo data reset.",
      portalUrl: `${base}/g/${seeded.demo.portalToken}`,
      reservationId: seeded.demo.id,
    });
  }

  const demo = body.reservationId
    ? await prisma.reservation.findUnique({ where: { id: body.reservationId }, include: { property: true } })
    : await demoReservation();
  if (!demo && action !== "reset") {
    return NextResponse.json({ error: "no_demo_reservation", message: "No demo reservation found — reset the demo first." }, { status: 404 });
  }

  switch (action) {
    case "send-portal-link": {
      const portalUrl = `${base}/g/${demo!.portalToken}`;
      if (!demo!.guestPhone) {
        return NextResponse.json({ ok: false, sent: false, portalUrl, message: "No guest phone linked yet — send \"demo\" to the WhatsApp number from the guest's phone first, then use this button. Portal link (copy it manually): " + portalUrl });
      }
      const result = await sendOutbound({ to: demo!.guestPhone, body: `Hi! Here's your Home & Hill guest portal: ${portalUrl} — please register and complete your check-in there.`, reservationId: demo!.id });
      await prisma.timelineEvent.create({ data: { reservationId: demo!.id, kind: "message", text: result.sent ? `Portal link sent to guest via ${result.channel} (demo control).` : `Portal link could not be sent (${result.reason}) — see warning.` } });
      return NextResponse.json({ ok: result.sent, sent: result.sent, reason: result.sent ? undefined : result.reason, portalUrl });
    }
    case "trigger-followup": {
      const sent = await runFollowups({ force: true, reservationId: demo!.id });
      return NextResponse.json({ ok: true, message: sent > 0 ? "21:00 follow-up triggered." : "Follow-up already sent for this stay." });
    }
    case "mark-arrived": {
      await prisma.reservation.update({ where: { id: demo!.id }, data: { arrived: true } });
      await prisma.timelineEvent.create({ data: { reservationId: demo!.id, kind: "arrival", text: "Guest marked as arrived (demo control)." } });
      return NextResponse.json({ ok: true, message: "Guest marked as arrived." });
    }
    case "change-dates": {
      const days = Number(body.days || 1);
      const newCheckin = addDays(demo!.checkinDate, days);
      const newCheckout = addDays(demo!.checkoutDate, days);
      await prisma.reservation.update({ where: { id: demo!.id }, data: { checkinDate: newCheckin, checkoutDate: newCheckout } });
      // Move the housekeeping task to the new arrival date.
      const adapter = getHostifyAdapter();
      const tasks = (await adapter.listTasks(demo!.propertyId, demo!.checkinDate)) as Array<{ id: string; reservationId?: string | null }>;
      for (const t of tasks.filter((t) => t.reservationId === demo!.id)) {
        await prisma.housekeepingTask.update({ where: { id: t.id }, data: { date: newCheckin } });
      }
      await prisma.timelineEvent.create({
        data: { reservationId: demo!.id, kind: "task", text: `Booking dates changed (demo control): stay moved to ${formatDateShort(newCheckin)} → ${formatDateShort(newCheckout)}. Housekeeping task moved to ${formatDateShort(newCheckin)}.` },
      });
      const n = await alertCleanerOps(
        demo!.id,
        `${demo!.property.name} · ${formatDateLong(newCheckin)} · Booking date changed\nThe stay moved to ${formatDateShort(newCheckin)} → ${formatDateShort(newCheckout)}. Check-in ${demo!.checkinTime}. The housekeeping task has been updated.`,
      );
      return NextResponse.json({ ok: true, message: `Dates moved to ${formatDateShort(newCheckin)} → ${formatDateShort(newCheckout)}.${n === 0 ? " (No cleaner/ops contacts registered — no alerts sent.)" : ""}` });
    }
    case "cancel": {
      await prisma.reservation.update({ where: { id: demo!.id }, data: { status: "cancelled" } });
      const tasks = await prisma.housekeepingTask.findMany({ where: { reservationId: demo!.id } });
      for (const t of tasks) {
        await prisma.housekeepingTask.update({ where: { id: t.id }, data: { status: "cancelled", history: [...(Array.isArray(t.history) ? t.history : []), { at: new Date().toISOString(), text: "Booking cancelled — task cancelled." }] } });
      }
      await prisma.timelineEvent.create({ data: { reservationId: demo!.id, kind: "task", text: `Booking cancelled (demo control). ${tasks.length} housekeeping task(s) cancelled.` } });
      const n = await alertCleanerOps(
        demo!.id,
        `${demo!.property.name} · ${formatDateLong(demo!.checkinDate)} · Booking cancelled\nThe stay for ${formatDateShort(demo!.checkinDate)} → ${formatDateShort(demo!.checkoutDate)} was cancelled. The housekeeping task has been cancelled.`,
      );
      return NextResponse.json({ ok: true, message: `Booking cancelled; tasks cancelled.${n === 0 ? " (No cleaner/ops contacts registered — no alerts sent.)" : ""}` });
    }
    case "simulate-failed-whatsapp": {
      const phone = demo!.guestPhone || "+32000000000";
      await prisma.message.create({
        data: { reservationId: demo!.id, direction: "out", channel: "whatsapp", body: "[Simulated] Early check-in confirmation", status: "failed", from: "whatsapp:+32460201874", to: `whatsapp:${phone}` },
      });
      await prisma.timelineEvent.create({
        data: { reservationId: demo!.id, kind: "warning", text: `Simulated failed WhatsApp delivery to ${phone} (demo control). In production this would fall back to SMS and alert ops if that fails too.` },
      });
      console.log(`[demo] simulated failed WhatsApp delivery to ${phone}`);
      return NextResponse.json({ ok: true, message: "Simulated a failed WhatsApp delivery — see the warning in the dashboard." });
    }
    case "mark-hold-paid": {
      // Test-mode only: confirm the latest active hold without Mollie.
      const hold = body.holdId
        ? await prisma.hold.findUnique({ where: { id: body.holdId } })
        : await prisma.hold.findFirst({ where: { reservationId: demo!.id, status: "active" }, orderBy: { createdAt: "desc" } });
      if (!hold) {
        return NextResponse.json({ error: "no_active_hold", message: "No active hold to confirm — create one from the guest chat first." }, { status: 404 });
      }
      const payment = await prisma.payment.create({
        data: { reservationId: demo!.id, kind: "extra", extraType: hold.extraType, amount: hold.amount, currency: "EUR", status: "open", holdId: hold.id },
      });
      const result = await confirmExtraPayment(payment.id);
      if (!result.confirmed) {
        return NextResponse.json({ ok: false, message: `Could not confirm: ${result.reason}. The payment was flagged for refund.` });
      }
      return NextResponse.json({ ok: true, message: `Hold confirmed as paid (test mode, no Mollie): ${hold.extraType} ${hold.slot} — €${hold.amount.toFixed(2)}.` });
    }
    default:
      return NextResponse.json({ error: "unknown_action", message: `Unknown demo action: ${action}` }, { status: 400 });
  }
}
