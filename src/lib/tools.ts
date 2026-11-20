// The 9 AI tools. Each is a real function against the database; the LLM may
// only answer price/availability questions through these tools — it never
// invents prices or times. Every tool call is logged as a timeline event.
import { prisma } from "./prisma";
import { sendOutbound } from "./whatsapp";
import { createMolliePayment } from "./mollie";
import { isMollieConfigured, publicBaseUrl } from "./config";
import {
  checkUpgrade,
  DEPOSIT_EUR,
  getBreakfastOptions,
  getEarlyCheckinOptions,
  getLateCheckoutOptions,
  getReservationWithProperty,
  touristTaxOwed,
} from "./availability";
import { eur, formatDateShort, nightsBetween } from "./brussels";

export type ToolResult = Record<string, unknown>;

async function timeline(reservationId: string, kind: string, text: string) {
  await prisma.timelineEvent.create({ data: { reservationId, kind, text } });
}

async function recordShown(extraType: string, propertyType: string, slot: string) {
  await prisma.reportEvent.create({ data: { kind: "shown", extraType, propertyType, slot, revenue: 0 } });
}

async function getReservation(reservationId: string): Promise<ToolResult> {
  const res = await getReservationWithProperty(reservationId);
  if (!res) return { error: "reservation_not_found" };
  const nights = nightsBetween(res.checkinDate, res.checkoutDate);
  const extras = await prisma.extra.findMany({ where: { reservationId, status: "confirmed" } });
  return {
    guestName: res.guestName,
    property: res.property.name,
    bedrooms: res.property.bedrooms,
    checkinDate: formatDateShort(res.checkinDate),
    checkoutDate: formatDateShort(res.checkoutDate),
    checkinTime: res.checkinTime,
    checkoutTime: res.checkoutTime,
    guests: res.guests,
    nights,
    registered: res.registered,
    arrived: res.arrived,
    accessReleaseTime: res.accessReleaseTime,
    touristTaxOwed: touristTaxOwed(res.guests, nights, res.touristTaxCollectedByPlatform),
    depositOwed: DEPOSIT_EUR,
    extras: extras.map((e) => ({ type: e.type, amount: e.amount, details: e.details })),
  };
}

async function getEarlyCheckinOptionsTool(reservationId: string): Promise<ToolResult> {
  const res = await getReservationWithProperty(reservationId);
  if (!res) return { error: "reservation_not_found" };
  const options = await getEarlyCheckinOptions(reservationId);
  const propertyType = `${res.property.bedrooms} bed`;
  for (const o of options) await recordShown("early_checkin", propertyType, o.time);
  await recordShown("early_checkin", propertyType, "16:00");
  await timeline(reservationId, "offer", `Early check-in options shown: ${options.map((o) => `${o.time} ${eur(o.price)}${o.available ? "" : " (unavailable)"}`).join(", ")}; 16:00 included.`);
  return { property: res.property.name, defaultCheckin: "16:00", options };
}

async function getLateCheckoutOptionsTool(reservationId: string): Promise<ToolResult> {
  const res = await getReservationWithProperty(reservationId);
  if (!res) return { error: "reservation_not_found" };
  const options = await getLateCheckoutOptions(reservationId);
  const propertyType = `${res.property.bedrooms} bed`;
  for (const o of options) await recordShown("late_checkout", propertyType, o.time);
  await recordShown("late_checkout", propertyType, "10:00");
  await timeline(reservationId, "offer", `Late check-out options shown: ${options.map((o) => `${o.time} ${eur(o.price)}${o.available ? "" : " (unavailable)"}`).join(", ")}; 10:00 included.`);
  return { property: res.property.name, defaultCheckout: "10:00", options };
}

async function getBreakfastOptionsTool(reservationId: string): Promise<ToolResult> {
  const res = await getReservationWithProperty(reservationId);
  if (!res) return { error: "reservation_not_found" };
  const opts = await getBreakfastOptions();
  const propertyType = `${res.property.bedrooms} bed`;
  for (const t of opts.deliveryTimes) await recordShown("breakfast", propertyType, t);
  await timeline(reservationId, "offer", `Breakfast options shown: ${eur(opts.pricePerPerson)} per person, delivery ${opts.deliveryTimes.join(", ")}.`);
  return { ...opts };
}

async function checkUpgradeTool(reservationId: string): Promise<ToolResult> {
  const res = await getReservationWithProperty(reservationId);
  if (!res) return { error: "reservation_not_found" };
  const up = await checkUpgrade(reservationId);
  if (up.targetProperty) {
    await recordShown("upgrade", `${res.property.bedrooms} bed`, "upgrade");
    await timeline(reservationId, "offer", `Upgrade ${res.property.name} → ${up.targetProperty} shown: ${eur(up.perNight)}/night × ${up.nights} nights = ${eur(up.total)} (${up.available ? "available" : "unavailable"}).`);
  }
  return { ...up };
}

async function createHoldTool(reservationId: string, args: ToolResult): Promise<ToolResult> {
  const res = await getReservationWithProperty(reservationId);
  if (!res) return { error: "reservation_not_found" };
  const extraType = String(args.extraType || "");
  const slot = String(args.slot || "");
  let amount = 0;
  let label = "";

  if (extraType === "early_checkin") {
    const options = await getEarlyCheckinOptions(reservationId);
    const opt = options.find((o) => o.time === slot);
    if (!opt) return { error: "invalid_slot", message: `There is no early check-in slot at ${slot}.` };
    if (!opt.available) return { error: "slot_unavailable", message: opt.reason || `Early check-in at ${slot} is not available.` };
    amount = opt.price;
    label = `Early check-in ${slot}`;
  } else if (extraType === "late_checkout") {
    const options = await getLateCheckoutOptions(reservationId);
    const opt = options.find((o) => o.time === slot);
    if (!opt) return { error: "invalid_slot", message: `There is no late check-out slot at ${slot}.` };
    if (!opt.available) return { error: "slot_unavailable", message: opt.reason || `Late check-out at ${slot} is not available.` };
    amount = opt.price;
    label = `Late check-out ${slot}`;
  } else if (extraType === "breakfast") {
    const people = Number(args.people || res.guests);
    const deliveryTime = String(args.deliveryTime || "08:00");
    const opts = await getBreakfastOptions();
    if (!opts.deliveryTimes.includes(deliveryTime)) return { error: "invalid_slot", message: `Breakfast delivery is only available at ${opts.deliveryTimes.join(", ")}.` };
    if (!people || people < 1 || people > res.guests + 2) return { error: "invalid_people", message: "Please tell me how many people the breakfast is for." };
    amount = people * opts.pricePerPerson;
    label = `Breakfast for ${people}, delivery ${deliveryTime}`;
  } else if (extraType === "upgrade") {
    const up = await checkUpgrade(reservationId);
    if (!up.available) return { error: "slot_unavailable", message: up.reason || "The upgrade is not available." };
    amount = up.total;
    label = `Upgrade to ${up.targetProperty}`;
  } else {
    return { error: "invalid_extra_type" };
  }

  // One active hold per extra type at a time — release any older one.
  await prisma.hold.updateMany({
    where: { reservationId, extraType, status: "active" },
    data: { status: "released" },
  });
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const hold = await prisma.hold.create({
    data: { reservationId, extraType, slot: extraType === "breakfast" ? `breakfast:${Number(args.people || res.guests)}:${String(args.deliveryTime || "08:00")}` : slot, amount, expiresAt, status: "active" },
  });
  await timeline(reservationId, "offer", `Hold created: ${label} — ${eur(amount)}, 15 minutes (until ${expiresAt.toISOString().slice(11, 16)}).`);
  return { holdId: hold.id, extraType, slot: hold.slot, amount, currency: "EUR", expiresAt: expiresAt.toISOString(), label };
}

async function createPaymentTool(reservationId: string, args: ToolResult): Promise<ToolResult> {
  const holdId = String(args.holdId || "");
  const hold = await prisma.hold.findUnique({ where: { id: holdId }, include: { reservation: true } });
  if (!hold || hold.reservationId !== reservationId) return { error: "hold_not_found" };
  if (hold.status !== "active" || new Date(hold.expiresAt).getTime() < Date.now()) {
    await prisma.hold.update({ where: { id: hold.id }, data: { status: "expired" } });
    return { error: "hold_expired", message: "That hold has expired. I can create a fresh one if you still want it." };
  }
  if (!isMollieConfigured()) {
    return {
      error: "mollie_not_configured",
      message: "Payments are not configured yet (Mollie test key missing). The hold is saved for 15 minutes — staff can confirm it from the dashboard.",
      holdId: hold.id,
      amount: hold.amount,
    };
  }
  const res = hold.reservation;
  const payment = await createMolliePayment({
    amount: hold.amount,
    description: `Home & Hill — ${hold.extraType} ${hold.slot} (${res.propertyId})`,
    redirectPath: `/g/${res.portalToken}?paid=1`,
    metadata: { reservationId, holdId: hold.id, kind: "extra" },
  });
  await prisma.payment.create({
    data: { mollieId: payment.id, reservationId, kind: "extra", extraType: hold.extraType, amount: hold.amount, currency: "EUR", status: "open", holdId: hold.id },
  });
  await timeline(reservationId, "payment", `Mollie payment created for ${hold.extraType} (${eur(hold.amount)}) — checkout link sent to guest.`);
  return { checkoutUrl: payment.checkoutUrl, mollieId: payment.id, amount: hold.amount, currency: "EUR" };
}

async function reportIssueTool(reservationId: string, args: ToolResult): Promise<ToolResult> {
  const res = await getReservationWithProperty(reservationId);
  if (!res) return { error: "reservation_not_found" };
  const details = String(args.details || "").slice(0, 1000);
  await timeline(reservationId, "message", `Guest reported an issue: ${details}`);
  const contacts = await prisma.contact.findMany({ where: { role: "ops" } });
  const body = `${res.property.name} · ${res.guestName} reported an issue\n${details}\nPlease check the dashboard inbox.`;
  for (const c of contacts) {
    await sendOutbound({ to: c.phone, body, reservationId });
  }
  if (contacts.length === 0) {
    await timeline(reservationId, "warning", "Issue reported but no ops contact is registered — no WhatsApp alert sent (send \"ops\" to the WhatsApp number).");
  }
  return { ok: true, message: "Thanks — I've passed that on to our team and they'll look into it." };
}

async function confirmArrivalTool(reservationId: string): Promise<ToolResult> {
  const res = await prisma.reservation.update({ where: { id: reservationId }, data: { arrived: true } });
  await timeline(reservationId, "arrival", `${res.guestName} marked as arrived.`);
  return { ok: true, message: "Welcome! Enjoy your stay — message me here any time if you need anything." };
}

export const TOOL_NAMES = [
  "get_reservation",
  "get_early_checkin_options",
  "get_late_checkout_options",
  "get_breakfast_options",
  "check_upgrade",
  "create_hold",
  "create_payment",
  "report_issue",
  "confirm_arrival",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** JSON-schema style tool definitions (OpenAI format; converted for Anthropic). */
export const TOOL_DEFINITIONS: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [
  { name: "get_reservation", description: "Get the guest's reservation: property, dates, check-in/out times, guests, registration and payment status, extras already bought.", parameters: { type: "object", properties: {} } },
  { name: "get_early_checkin_options", description: "List early check-in slots with prices and availability for this reservation. Default check-in is 16:00 (included).", parameters: { type: "object", properties: {} } },
  { name: "get_late_checkout_options", description: "List late check-out slots with prices and availability. Default check-out is 10:00 (included).", parameters: { type: "object", properties: {} } },
  { name: "get_breakfast_options", description: "Breakfast basket price per person and delivery times.", parameters: { type: "object", properties: {} } },
  { name: "check_upgrade", description: "Check whether an upgrade to a larger property is available for the whole stay, and its price.", parameters: { type: "object", properties: {} } },
  { name: "create_hold", description: "Hold an extra for 15 minutes so the guest can pay. extraType is early_checkin, late_checkout, breakfast or upgrade. slot is the time (HH:MM) for check-in/check-out, or 'upgrade' for an upgrade. For breakfast also pass people and deliveryTime.", parameters: { type: "object", properties: { extraType: { type: "string" }, slot: { type: "string" }, people: { type: "number" }, deliveryTime: { type: "string" } }, required: ["extraType", "slot"] } },
  { name: "create_payment", description: "Create a Mollie test payment link for a hold. Pass the holdId from create_hold. Returns a checkout URL to show the guest.", parameters: { type: "object", properties: { holdId: { type: "string" } }, required: ["holdId"] } },
  { name: "report_issue", description: "Report a problem in the apartment. Pass the guest's description. Alerts the ops contact.", parameters: { type: "object", properties: { details: { type: "string" } }, required: ["details"] } },
  { name: "confirm_arrival", description: "Mark the guest as arrived.", parameters: { type: "object", properties: {} } },
];

export async function executeTool(name: string, args: ToolResult, reservationId: string): Promise<ToolResult> {
  console.log(`[tools] ${name} ${JSON.stringify(args)} (reservation ${reservationId})`);
  switch (name) {
    case "get_reservation":
      return getReservation(reservationId);
    case "get_early_checkin_options":
      return getEarlyCheckinOptionsTool(reservationId);
    case "get_late_checkout_options":
      return getLateCheckoutOptionsTool(reservationId);
    case "get_breakfast_options":
      return getBreakfastOptionsTool(reservationId);
    case "check_upgrade":
      return checkUpgradeTool(reservationId);
    case "create_hold":
      return createHoldTool(reservationId, args);
    case "create_payment":
      return createPaymentTool(reservationId, args);
    case "report_issue":
      return reportIssueTool(reservationId, args);
    case "confirm_arrival":
      return confirmArrivalTool(reservationId);
    default:
      return { error: "unknown_tool", message: `Unknown tool: ${name}` };
  }
}

export function registrationAmounts(reservation: { guests: number; checkinDate: string; checkoutDate: string; touristTaxCollectedByPlatform: boolean }): { touristTax: number; deposit: number; total: number; nights: number } {
  const nights = nightsBetween(reservation.checkinDate, reservation.checkoutDate);
  const touristTax = touristTaxOwed(reservation.guests, nights, reservation.touristTaxCollectedByPlatform);
  return { touristTax, deposit: DEPOSIT_EUR, total: touristTax + DEPOSIT_EUR, nights };
}

export { publicBaseUrl };
