// Availability rules — used by the AI tools AND the dashboard.
// All rules work on "HH:MM" times and "YYYY-MM-DD" dates (Europe/Brussels).
import { prisma } from "./prisma";
import { addMinutesToTime, nightsBetween, timeToMinutes } from "./brussels";

export interface SlotOption {
  time: string;
  price: number;
  available: boolean;
  reason?: string;
}

export async function getPricingValue(key: string, scope: string): Promise<Record<string, unknown> | null> {
  const row = await prisma.pricing.findUnique({ where: { key_scope: { key, scope } } });
  if (!row) return null;
  return row.value as Record<string, unknown>;
}

export async function getReservationWithProperty(reservationId: string) {
  return prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { property: true },
  });
}

/**
 * Early check-in: a slot is available only if the previous guest's check-out
 * (on the same property, checking out on our arrival day) + cleaning duration
 * is at or before the slot. No previous guest -> every slot is available.
 */
export async function getEarlyCheckinOptions(reservationId: string): Promise<SlotOption[]> {
  const res = await getReservationWithProperty(reservationId);
  if (!res) return [];
  const table = (await getPricingValue("early_checkin", String(res.property.bedrooms))) || {};
  const slots = ["12:00", "13:00", "14:00", "15:00"];
  const cleaning = res.property.cleaningMinutes;

  const previous = await prisma.reservation.findMany({
    where: {
      propertyId: res.propertyId,
      checkoutDate: res.checkinDate,
      status: "confirmed",
      id: { not: res.id },
    },
  });
  let readyAt: string | null = null;
  for (const p of previous) {
    const ready = addMinutesToTime(p.checkoutTime, cleaning);
    if (!readyAt || timeToMinutes(ready) > timeToMinutes(readyAt)) readyAt = ready;
  }

  return slots.map((time) => {
    const price = Number(table[time] ?? 0);
    if (!readyAt) return { time, price, available: true };
    const available = timeToMinutes(readyAt) <= timeToMinutes(time);
    return {
      time,
      price,
      available,
      reason: available ? undefined : `Previous guest checks out at ${previous[0]?.checkoutTime ?? "?"} and cleaning takes ${cleaning} minutes, so the earliest possible check-in is ${readyAt}.`,
    };
  });
}

/**
 * Late check-out: a slot is available only if the next arrival on the same
 * property (checking in on our check-out day, including any early check-in
 * they already bought — reflected in their checkinTime) minus cleaning
 * duration is after the slot. No next guest -> every slot is available.
 */
export async function getLateCheckoutOptions(reservationId: string): Promise<SlotOption[]> {
  const res = await getReservationWithProperty(reservationId);
  if (!res) return [];
  const table = (await getPricingValue("late_checkout", String(res.property.bedrooms))) || {};
  const slots = ["11:00", "12:00", "13:00"];
  const cleaning = res.property.cleaningMinutes;

  const next = await prisma.reservation.findMany({
    where: {
      propertyId: res.propertyId,
      checkinDate: res.checkoutDate,
      status: "confirmed",
      id: { not: res.id },
    },
  });
  let latest: string | null = null;
  for (const n of next) {
    if (!latest || timeToMinutes(n.checkinTime) < timeToMinutes(latest)) latest = n.checkinTime;
  }

  return slots.map((time) => {
    const price = Number(table[time] ?? 0);
    if (!latest) return { time, price, available: true };
    const cleanFrom = timeToMinutes(latest) - cleaning;
    const available = cleanFrom > timeToMinutes(time);
    return {
      time,
      price,
      available,
      reason: available
        ? undefined
        : `The next guest arrives at ${latest} and cleaning takes ${cleaning} minutes, so check-out must be before ${Math.floor(cleanFrom / 60)}:${String(cleanFrom % 60).padStart(2, "0")}.`,
    };
  });
}

export interface UpgradeOption {
  targetProperty: string | null;
  perNight: number;
  nights: number;
  total: number;
  available: boolean;
  reason?: string;
}

export async function checkUpgrade(reservationId: string): Promise<UpgradeOption> {
  const res = await getReservationWithProperty(reservationId);
  if (!res) return { targetProperty: null, perNight: 0, nights: 0, total: 0, available: false, reason: "Reservation not found." };
  const cfg = (await getPricingValue("upgrade", res.property.name)) || {};
  const targetName = cfg.target as string | undefined;
  const perNight = Number(cfg.perNight ?? 0);
  const nights = nightsBetween(res.checkinDate, res.checkoutDate);
  if (!targetName || !perNight) {
    return { targetProperty: null, perNight: 0, nights, total: 0, available: false, reason: `No upgrade is configured for ${res.property.name}.` };
  }
  const target = await prisma.property.findUnique({ where: { name: targetName } });
  if (!target) {
    return { targetProperty: targetName, perNight, nights, total: perNight * nights, available: false, reason: `Upgrade property ${targetName} does not exist.` };
  }
  const overlapping = await prisma.reservation.findMany({
    where: {
      propertyId: target.id,
      status: "confirmed",
      checkinDate: { lt: res.checkoutDate },
      checkoutDate: { gt: res.checkinDate },
    },
  });
  if (overlapping.length > 0) {
    return {
      targetProperty: targetName,
      perNight,
      nights,
      total: perNight * nights,
      available: false,
      reason: `${targetName} is already booked for part of your stay.`,
    };
  }
  return { targetProperty: targetName, perNight, nights, total: perNight * nights, available: true };
}

export interface BreakfastOptions {
  pricePerPerson: number;
  deliveryTimes: string[];
}

export async function getBreakfastOptions(): Promise<BreakfastOptions> {
  const cfg = (await getPricingValue("breakfast", "all")) || {};
  return {
    pricePerPerson: Number(cfg.pricePerPerson ?? 15),
    deliveryTimes: (cfg.deliveryTimes as string[] | undefined) || ["08:00", "09:00", "10:00"],
  };
}

/** Tourist tax owed for a reservation (6 EUR/person/night, unless the platform collected it). */
export function touristTaxOwed(guests: number, nights: number, collectedByPlatform: boolean): number {
  return collectedByPlatform ? 0 : guests * nights * 6;
}

export const DEPOSIT_EUR = 75;
