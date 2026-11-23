// Shared payment outcomes — used by the Mollie webhook AND by the demo
// controls (test-mode "mark paid"). One place, so the behaviour is identical.
import { prisma } from "./prisma";
import { sendOutbound } from "./whatsapp";
import { formatDateLong } from "./brussels";
import { checkUpgrade, getEarlyCheckinOptions, getLateCheckoutOptions } from "./availability";
import { getHostifyAdapter } from "./hostify";
import { isMollieConfigured } from "./config";

async function timeline(reservationId: string, kind: string, text: string) {
  await prisma.timelineEvent.create({ data: { reservationId, kind, text } });
}

async function alertOpsAndCleaner(reservationId: string, body: string) {
  const contacts = await prisma.contact.findMany({
    where: { role: { in: ["cleaner", "ops"] } },
  });
  for (const c of contacts) {
    await sendOutbound({ to: c.phone, body, reservationId });
  }
  if (contacts.length === 0) {
    console.warn(`[mollie] No cleaner/ops contacts registered — alert not sent: ${body.slice(0, 80)}`);
    await timeline(reservationId, "warning", "Cleaner/ops alert could not be sent — no cleaner or ops phone registered yet (send \"cleaner\" / \"ops\" to the WhatsApp number).");
  }
}

/** Exact alert format for a paid extra. Date = arrival date, e.g. "20 November". */
export function extraPaidMessage(propertyName: string, arrivalDate: string, extraType: string, detail: string): string {
  const date = formatDateLong(arrivalDate);
  const title =
    extraType === "early_checkin"
      ? "Early check-in paid"
      : extraType === "late_checkout"
        ? "Late check-out paid"
        : extraType === "breakfast"
          ? "Breakfast paid"
          : "Upgrade paid";
  return `${propertyName} · ${date} · ${title}\n${detail}`;
}

function slotStillAvailableCheck(
  extraType: string,
  slot: string,
  options: Array<{ time: string; available: boolean }>,
): boolean {
  if (extraType === "breakfast" || extraType === "upgrade") return true;
  const opt = options.find((o) => o.time === slot);
  return Boolean(opt?.available);
}

/**
 * A Mollie payment for an extra came back paid. Confirm it only if the hold is
 * still valid AND the slot is still free. Otherwise flag for refund + alert ops.
 */
export async function confirmExtraPayment(paymentId: string): Promise<{ confirmed: boolean; reason?: string }> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { reservation: { include: { property: true } }, hold: true },
  });
  if (!payment || !payment.reservation || !payment.hold) {
    return { confirmed: false, reason: "payment_or_hold_not_found" };
  }
  const { reservation, hold } = payment;
  const extraType = payment.extraType || hold.extraType;
  const slot = hold.slot;

  // Hold validity.
  if (hold.status !== "active" || new Date(hold.expiresAt).getTime() < Date.now()) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "refund_flagged" } });
    await prisma.hold.update({ where: { id: hold.id }, data: { status: "expired" } });
    await timeline(reservation.id, "payment", `Payment ${payment.mollieId} arrived after the hold expired — NOT confirmed, flagged for refund.`);
    await alertOpsAndCleaner(
      reservation.id,
      `${reservation.property.name} · ${formatDateLong(reservation.checkinDate)} · Payment after hold expired\nA payment of €${payment.amount.toFixed(2)} for ${extraType} arrived after the 15-minute hold expired. Do NOT confirm — flag for refund.`,
    );
    return { confirmed: false, reason: "hold_expired" };
  }

  // Slot still free?
  if (extraType === "early_checkin") {
    const options = await getEarlyCheckinOptions(reservation.id);
    if (!slotStillAvailableCheck(extraType, slot, options)) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "refund_flagged" } });
      await prisma.hold.update({ where: { id: hold.id }, data: { status: "expired" } });
      await timeline(reservation.id, "payment", `Payment ${payment.mollieId} for early check-in ${slot} arrived but the slot is gone — NOT confirmed, flagged for refund.`);
      await alertOpsAndCleaner(reservation.id, `${reservation.property.name} · ${formatDateLong(reservation.checkinDate)} · Payment for unavailable slot\nA payment of €${payment.amount.toFixed(2)} for early check-in ${slot} arrived but the slot is no longer available. Do NOT confirm — flag for refund.`);
      return { confirmed: false, reason: "slot_gone" };
    }
  }
  if (extraType === "late_checkout") {
    const options = await getLateCheckoutOptions(reservation.id);
    if (!slotStillAvailableCheck(extraType, slot, options)) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "refund_flagged" } });
      await prisma.hold.update({ where: { id: hold.id }, data: { status: "expired" } });
      await timeline(reservation.id, "payment", `Payment ${payment.mollieId} for late check-out ${slot} arrived but the slot is gone — NOT confirmed, flagged for refund.`);
      await alertOpsAndCleaner(reservation.id, `${reservation.property.name} · ${formatDateLong(reservation.checkinDate)} · Payment for unavailable slot\nA payment of €${payment.amount.toFixed(2)} for late check-out ${slot} arrived but the slot is no longer available. Do NOT confirm — flag for refund.`);
      return { confirmed: false, reason: "slot_gone" };
    }
  }
  if (extraType === "upgrade") {
    const up = await checkUpgrade(reservation.id);
    if (!up.available) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "refund_flagged" } });
      await prisma.hold.update({ where: { id: hold.id }, data: { status: "expired" } });
      await timeline(reservation.id, "payment", `Payment ${payment.mollieId} for the upgrade arrived but ${up.targetProperty} is no longer free — NOT confirmed, flagged for refund.`);
      await alertOpsAndCleaner(reservation.id, `${reservation.property.name} · ${formatDateLong(reservation.checkinDate)} · Payment for unavailable upgrade\nA payment of €${payment.amount.toFixed(2)} for the upgrade arrived but the target property is no longer free. Do NOT confirm — flag for refund.`);
      return { confirmed: false, reason: "slot_gone" };
    }
  }

  // Confirm: hold -> confirmed, extra created, reservation + task updated.
  await prisma.hold.update({ where: { id: hold.id }, data: { status: "confirmed" } });
  await prisma.payment.update({ where: { id: payment.id }, data: { status: "paid", paidAt: new Date() } });

  let detail = "";
  const adapter = getHostifyAdapter();
  if (extraType === "early_checkin") {
    await prisma.extra.create({ data: { reservationId: reservation.id, type: "early_checkin", details: { slot }, amount: payment.amount, status: "confirmed" } });
    await prisma.reservation.update({ where: { id: reservation.id }, data: { checkinTime: slot, accessReleaseTime: slot } });
    // Housekeeping: property must be ready by the new check-in time.
    const tasks = (await adapter.listTasks(reservation.propertyId, reservation.checkinDate)) as Array<{ id: string }>;
    if (tasks[0]) {
      await adapter.updateTask(tasks[0].id, { readyBy: slot, historyEntry: `Early check-in paid — ready by ${slot} instead of 16:00.` });
    }
    detail = `Check-in confirmed for ${slot}. Please have ${reservation.property.name} ready by ${slot}. The housekeeping task has been updated.`;
    await timeline(reservation.id, "payment", `Early check-in ${slot} paid (€${payment.amount.toFixed(2)}). Check-in time updated to ${slot}; access release ${slot}; housekeeping task updated.`);
  } else if (extraType === "late_checkout") {
    await prisma.extra.create({ data: { reservationId: reservation.id, type: "late_checkout", details: { slot }, amount: payment.amount, status: "confirmed" } });
    await prisma.reservation.update({ where: { id: reservation.id }, data: { checkoutTime: slot } });
    const tasks = (await adapter.listTasks(reservation.propertyId, reservation.checkoutDate)) as Array<{ id: string }>;
    if (tasks[0]) {
      await adapter.updateTask(tasks[0].id, { historyEntry: `Late check-out paid — cleaning can start from ${slot}.` });
    } else {
      await prisma.housekeepingTask.create({
        data: { propertyId: reservation.propertyId, date: reservation.checkoutDate, readyBy: "16:00", status: "pending", reservationId: reservation.id, history: [{ at: new Date().toISOString(), text: `Late check-out paid — cleaning can start from ${slot}.` }] },
      });
    }
    detail = `Cleaning can start from ${slot}. The housekeeping task has been updated.`;
    await timeline(reservation.id, "payment", `Late check-out ${slot} paid (€${payment.amount.toFixed(2)}). Check-out time updated to ${slot}; housekeeping task updated.`);
  } else if (extraType === "breakfast") {
    const parts = slot.split(":"); // breakfast:{people}:{HH}:{MM} -> people, time
    const people = Number(parts[1] ?? reservation.guests);
    const time = parts.length >= 4 ? `${parts[2]}:${parts[3]}` : "08:00";
    await prisma.extra.create({ data: { reservationId: reservation.id, type: "breakfast", details: { people, deliveryTime: time }, amount: payment.amount, status: "confirmed" } });
    detail = `Breakfast basket for ${people} ${people === 1 ? "person" : "people"}, delivery at ${time}.`;
    await timeline(reservation.id, "payment", `Breakfast paid (€${payment.amount.toFixed(2)}): ${people} people, delivery ${time}.`);
  } else if (extraType === "upgrade") {
    const up = await checkUpgrade(reservation.id);
    const target = await prisma.property.findUnique({ where: { name: up.targetProperty || "" } });
    await prisma.extra.create({ data: { reservationId: reservation.id, type: "upgrade", details: { from: reservation.property.name, to: up.targetProperty, nights: up.nights }, amount: payment.amount, status: "confirmed" } });
    if (target) {
      // Move the stay to the upgrade property and (re)create its task.
      const oldTasks = (await adapter.listTasks(reservation.propertyId, reservation.checkinDate)) as Array<{ id: string }>;
      if (oldTasks[0]) {
        await adapter.updateTask(oldTasks[0].id, { status: "cancelled", historyEntry: `Guest upgraded to ${target.name} — this task is cancelled.` });
      }
      await prisma.reservation.update({ where: { id: reservation.id }, data: { propertyId: target.id, accessReleaseTime: reservation.checkinTime } });
      await prisma.housekeepingTask.create({
        data: { propertyId: target.id, date: reservation.checkinDate, readyBy: reservation.checkinTime, status: "pending", reservationId: reservation.id, history: [{ at: new Date().toISOString(), text: `Upgrade paid — prepare ${target.name} for ${reservation.guestName} (ready by ${reservation.checkinTime}).` }] },
      });
      detail = `Guest upgraded to ${target.name} for the stay. Please prepare ${target.name} instead. The housekeeping task has been updated.`;
    }
    await timeline(reservation.id, "payment", `Upgrade to ${up.targetProperty} paid (€${payment.amount.toFixed(2)}). Stay moved to ${up.targetProperty}; housekeeping tasks updated.`);
  }

  // Reporting: for breakfast the slot is the delivery time (e.g. "09:00"),
  // not the internal hold slot ("breakfast:2:09:00").
  const reportSlot =
    extraType === "breakfast"
      ? (() => {
          const parts = slot.split(":");
          return parts.length >= 4 ? `${parts[2]}:${parts[3]}` : slot;
        })()
      : slot;
  await prisma.reportEvent.create({
    data: { kind: "purchased", extraType, propertyType: `${reservation.property.bedrooms} bed`, slot: reportSlot, revenue: payment.amount },
  });

  // Notify cleaner + ops in the exact demo format.
  const msg = extraPaidMessage(reservation.property.name, reservation.checkinDate, extraType, detail);
  await alertOpsAndCleaner(reservation.id, msg);

  // Tell the guest in the portal chat.
  await prisma.chatMessage.create({
    data: { reservationId: reservation.id, role: "assistant", text: `Payment confirmed — thank you! ${detail}` },
  });

  console.log(`[mollie] extra confirmed: ${extraType} ${slot} for reservation ${reservation.id}`);
  return { confirmed: true };
}

/** A Mollie payment for registration came back paid. */
export async function confirmRegistrationPayment(paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { reservation: true },
  });
  if (!payment || !payment.reservation) return;
  await prisma.payment.update({ where: { id: payment.id }, data: { status: "paid", paidAt: new Date() } });
  await prisma.reservation.update({ where: { id: payment.reservationId }, data: { registered: true } });
  await timeline(payment.reservationId, "payment", `Registration paid (€${payment.amount.toFixed(2)}): tourist tax + deposit. Guest is registered.`);
  await prisma.chatMessage.create({
    data: { reservationId: payment.reservationId, role: "assistant", text: "Thank you — your registration is complete, including the tourist tax and deposit. What time do you expect to arrive?" },
  });
  console.log(`[mollie] registration confirmed for reservation ${payment.reservationId}`);
}

export async function completeSimulatedPayment(
  paymentId: string,
): Promise<{ paid: boolean; alreadyProcessed?: boolean; message?: string }> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.mollieId) return { paid: false, message: "This payment link is not valid." };
  const claimed = await prisma.payment.updateMany({
    where: { id: payment.id, status: "open" },
    data: { status: "processing" },
  });
  if (claimed.count === 0) {
    return { paid: false, alreadyProcessed: true, message: "This payment has already been completed." };
  }
  if (payment.kind === "registration") {
    await confirmRegistrationPayment(payment.id);
    return { paid: true };
  }
  const result = await confirmExtraPayment(payment.id);
  if (result.confirmed) return { paid: true };
  return {
    paid: false,
    message: result.reason === "hold_expired"
      ? "The 15-minute hold expired, so this extra was not confirmed. The team has been alerted to refund it."
      : "This slot is no longer available, so it was not confirmed. The team has been alerted to refund it.",
  };
}

const PAYMENT_DONE_PATTERNS = [
  /^(?:(?:ok|okay|yes|done) )?(?:(?:i|we)(?:'?ve| have)? )?(?:just |already )?paid(?: it| now| already| the payment)?$/,
  /^(?:ok |okay |yes )?(?:the |my |our )?payment (?:is |has been |was )?(?:done|complete|completed|made|finished|successful)(?: now)?$/,
  /^(?:(?:i|we)(?:'?ve| have)? )?(?:just )?(?:made|done|completed) (?:the |my |our )?payment$/,
  /^done(?: with)? (?:the )?payment$/,
  /^(?:j'ai|nous avons) pay[ée]$|^paiement (?:effectu[ée]|fait)$/,
  /^(?:ik heb |we hebben )?betaald$|^betaling (?:is )?(?:gedaan|voltooid)$/,
];

export function saysPaymentDone(text: string): boolean {
  const normalized = text.toLowerCase().replace(/’/g, "'").replace(/[.!,]+/g, " ").replace(/\s+/g, " ").trim();
  return PAYMENT_DONE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export async function handlePaymentDoneMessage(reservationId: string, text: string): Promise<string | null> {
  if (isMollieConfigured() || !saysPaymentDone(text)) return null;
  const open = await prisma.payment.findFirst({
    where: { reservationId, status: "open", mollieId: null },
    orderBy: { createdAt: "desc" },
  });
  const result = open
    ? await completeSimulatedPayment(open.id)
    : { paid: false, message: "I don't see a payment waiting right now. Tell me what you'd like to book and I'll set it up." };
  if (result.paid) {
    const confirmation = await prisma.chatMessage.findFirst({
      where: { reservationId, role: "assistant" },
      orderBy: { createdAt: "desc" },
    });
    return confirmation?.text || "Payment confirmed — thank you!";
  }
  const reply = result.message || "That payment could not be completed.";
  await prisma.chatMessage.create({ data: { reservationId, role: "assistant", text: reply } });
  return reply;
}

/** A payment failed / was cancelled / expired: release the hold, tell the guest. */
export async function failPayment(paymentId: string, status: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { reservation: true, hold: true },
  });
  if (!payment) return;
  await prisma.payment.update({ where: { id: payment.id }, data: { status } });
  if (payment.hold) {
    await prisma.hold.update({ where: { id: payment.hold.id }, data: { status: "released" } });
  }
  if (payment.reservation) {
    await timeline(payment.reservationId, "payment", `Payment ${payment.mollieId || payment.id} ${status} — hold released. Guest can try again.`);
    if (payment.kind === "extra") {
      await prisma.chatMessage.create({
        data: { reservationId: payment.reservationId, role: "assistant", text: "That payment didn't go through, so I've released the hold — nothing was charged. Just let me know if you'd like to try again." },
      });
    }
  }
  console.log(`[mollie] payment ${payment.mollieId || payment.id} ${status}, hold released`);
}
