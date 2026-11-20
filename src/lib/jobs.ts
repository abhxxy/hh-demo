// Scheduled jobs (node-cron, Europe/Brussels). Runs every minute; jobs are
// idempotent via flags (followupSent) and timestamps (hold expiry).
import cron from "node-cron";
import { prisma } from "./prisma";
import { sendOutbound } from "./whatsapp";
import { nowBrusselsHHMM, todayBrussels } from "./brussels";

const FOLLOWUP_TEXT = "Hi, how's everything going? Is everything okay with the accommodation?";

/** Expire holds past their 15-minute window. */
export async function expireHolds() {
  const expired = await prisma.hold.findMany({
    where: { status: "active", expiresAt: { lt: new Date() } },
    include: { reservation: true },
  });
  for (const h of expired) {
    await prisma.hold.update({ where: { id: h.id }, data: { status: "expired" } });
    await prisma.timelineEvent.create({
      data: { reservationId: h.reservationId, kind: "offer", text: `Hold expired: ${h.extraType} ${h.slot} (€${h.amount.toFixed(2)}) was not paid within 15 minutes.` },
    });
    console.log(`[jobs] hold expired: ${h.id} (${h.extraType} ${h.slot})`);
  }
  return expired.length;
}

/**
 * The 21:00 follow-up. For every reservation arriving today that has not had
 * its follow-up yet: if arrived, send the WhatsApp check-in; if not arrived,
 * alert ops instead. `force` runs it immediately regardless of the clock
 * (demo control "trigger 21:00 follow-up now").
 */
export async function runFollowups(opts?: { force?: boolean; reservationId?: string }) {
  const today = todayBrussels();
  const nowHHMM = nowBrusselsHHMM();
  if (!opts?.force && nowHHMM < "21:00") return 0;
  // Forced runs (demo control) target the named reservation regardless of
  // its arrival date, so the follow-up can be shown live during the demo.
  const where: Record<string, unknown> = {
    ...(opts?.force && opts?.reservationId ? {} : { checkinDate: today }),
    status: "confirmed",
    followupSent: false,
    ...(opts?.reservationId ? { id: opts.reservationId } : {}),
  };
  const reservations = await prisma.reservation.findMany({ where, include: { property: true } });
  let sent = 0;
  for (const r of reservations) {
    await prisma.reservation.update({ where: { id: r.id }, data: { followupSent: true, needsFollowUp: !r.arrived } });
    if (r.arrived && r.guestPhone) {
      const result = await sendOutbound({ to: r.guestPhone, body: FOLLOWUP_TEXT, reservationId: r.id });
      await prisma.timelineEvent.create({
        data: { reservationId: r.id, kind: "message", text: result.sent ? `21:00 follow-up sent to guest via ${result.channel}.` : `21:00 follow-up could not be sent (${result.reason}) — see warning.` },
      });
      sent++;
    } else {
      const contacts = await prisma.contact.findMany({ where: { role: "ops" } });
      const body = `${r.property.name} · ${r.guestName} has not arrived\nThe guest was due today and has not marked themselves arrived by 21:00. Please check in with them.`;
      for (const c of contacts) {
        await sendOutbound({ to: c.phone, body, reservationId: r.id });
      }
      await prisma.timelineEvent.create({
        data: { reservationId: r.id, kind: "warning", text: `21:00: guest has not arrived — ops alerted${contacts.length === 0 ? " (no ops contact registered)" : ""}.` },
      });
      console.log(`[jobs] 21:00 follow-up: ${r.guestName} not arrived — ops alerted`);
      sent++;
    }
  }
  return sent;
}

/** Everything due right now: hold expiry + 21:00 follow-ups. */
export async function runDueJobs() {
  try {
    await expireHolds();
    await runFollowups();
  } catch (e) {
    console.error("[jobs] runDueJobs failed:", e);
  }
}

let started = false;

export function startScheduler() {
  if (started) return;
  started = true;
  cron.schedule("* * * * *", () => {
    void runDueJobs();
  }, { timezone: "Europe/Brussels" });
  console.log("[jobs] scheduler started (Europe/Brussels, every minute)");
}
