// Demo seed data. Dates are relative to the seed day (Europe/Brussels):
// the demo guest arrives tomorrow for 2 nights. A previous guest checks out
// of the same property that morning, and the next guest arrives at Loft 7 on
// the day the demo guest leaves — so the availability rules have real conflicts.
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { addDays, nightsBetween, todayBrussels } from "./brussels";

function token(): string {
  return crypto.randomBytes(16).toString("hex");
}

export async function seedDemo() {
  const today = todayBrussels();
  const arrival = addDays(today, 1);
  const departure = addDays(arrival, 2);
  const nights = nightsBetween(arrival, departure);

  // Properties
  const loft4 = await prisma.property.create({
    data: { name: "Loft 4", bedrooms: 1, isUpgradeTarget: false, defaultCheckin: "16:00", defaultCheckout: "10:00", cleaningMinutes: 120 },
  });
  const loft7 = await prisma.property.create({
    data: { name: "Loft 7", bedrooms: 2, isUpgradeTarget: false, defaultCheckin: "16:00", defaultCheckout: "10:00", cleaningMinutes: 120 },
  });
  const suite2 = await prisma.property.create({
    data: { name: "Suite 2", bedrooms: 3, isUpgradeTarget: false, defaultCheckin: "16:00", defaultCheckout: "10:00", cleaningMinutes: 120 },
  });
  const loft9 = await prisma.property.create({
    data: { name: "Loft 9", bedrooms: 2, isUpgradeTarget: true, defaultCheckin: "16:00", defaultCheckout: "10:00", cleaningMinutes: 120 },
  });

  // Pricing tables
  const pricing: Array<{ key: string; scope: string; value: Record<string, unknown> }> = [
    { key: "early_checkin", scope: "1", value: { "12:00": 40, "13:00": 30, "14:00": 20, "15:00": 10 } },
    { key: "early_checkin", scope: "2", value: { "12:00": 50, "13:00": 35, "14:00": 25, "15:00": 15 } },
    { key: "early_checkin", scope: "3", value: { "12:00": 60, "13:00": 45, "14:00": 30, "15:00": 20 } },
    { key: "late_checkout", scope: "1", value: { "11:00": 10, "12:00": 20, "13:00": 30 } },
    { key: "late_checkout", scope: "2", value: { "11:00": 15, "12:00": 25, "13:00": 35 } },
    { key: "late_checkout", scope: "3", value: { "11:00": 20, "12:00": 30, "13:00": 45 } },
    { key: "breakfast", scope: "all", value: { pricePerPerson: 15, deliveryTimes: ["08:00", "09:00", "10:00"] } },
    { key: "upgrade", scope: "Loft 4", value: { target: "Loft 9", perNight: 40 } },
  ];
  for (const p of pricing) {
    await prisma.pricing.create({ data: { ...p, value: p.value as Prisma.InputJsonValue } });
  }

  // Previous reservation: checks out of Loft 4 on arrival day at 10:00.
  const prev = await prisma.reservation.create({
    data: {
      guestName: "Previous Guest",
      guests: 2,
      propertyId: loft4.id,
      checkinDate: addDays(arrival, -2),
      checkoutDate: arrival,
      channel: "booking.com",
      touristTaxCollectedByPlatform: false,
      portalToken: token(),
      status: "confirmed",
      checkinTime: "16:00",
      checkoutTime: "10:00",
      registered: true,
    },
  });

  // Demo reservation: Test Guest, Loft 4, arriving tomorrow for 2 nights.
  const demo = await prisma.reservation.create({
    data: {
      guestName: "Test Guest",
      guests: 2,
      propertyId: loft4.id,
      checkinDate: arrival,
      checkoutDate: departure,
      channel: "booking.com",
      touristTaxCollectedByPlatform: false,
      portalToken: token(),
      status: "confirmed",
      checkinTime: "16:00",
      checkoutTime: "10:00",
      registered: false,
    },
  });

  // Next reservation: arrives at Loft 7 on the day the demo guest leaves.
  const next = await prisma.reservation.create({
    data: {
      guestName: "Next Guest",
      guests: 2,
      propertyId: loft7.id,
      checkinDate: departure,
      checkoutDate: addDays(departure, 2),
      channel: "booking.com",
      touristTaxCollectedByPlatform: false,
      portalToken: token(),
      status: "confirmed",
      checkinTime: "16:00",
      checkoutTime: "10:00",
      registered: true,
    },
  });

  // Housekeeping tasks: one per arrival.
  await prisma.housekeepingTask.create({
    data: {
      propertyId: loft4.id,
      date: arrival,
      readyBy: "16:00",
      status: "pending",
      reservationId: demo.id,
      history: [{ at: new Date().toISOString(), text: `Task created for ${demo.guestName} arrival (ready by 16:00).` }],
    },
  });
  await prisma.housekeepingTask.create({
    data: {
      propertyId: loft7.id,
      date: departure,
      readyBy: "16:00",
      status: "pending",
      reservationId: next.id,
      history: [{ at: new Date().toISOString(), text: `Task created for ${next.guestName} arrival (ready by 16:00).` }],
    },
  });

  await prisma.timelineEvent.create({
    data: { reservationId: demo.id, kind: "system", text: `Demo data seeded: ${demo.guestName}, ${loft4.name}, ${arrival} → ${departure} (${nights} nights, ${demo.guests} guests).` },
  });
  await prisma.timelineEvent.create({
    data: { reservationId: prev.id, kind: "system", text: `Previous stay seeded: checks out of ${loft4.name} on ${arrival} at 10:00.` },
  });
  await prisma.timelineEvent.create({
    data: { reservationId: next.id, kind: "system", text: `Next stay seeded: arrives at ${loft7.name} on ${departure}.` },
  });

  console.log(`[demo] seeded: demo guest ${demo.guestName} in Loft 4, ${arrival} → ${departure}`);
  return { demo, prev, next, loft4, loft7, suite2, loft9 };
}

/** Seed only when the database is empty (first boot). Safe to call often. */
export async function ensureSeed() {
  const count = await prisma.property.count();
  if (count === 0) {
    console.log("[demo] empty database — seeding demo data");
    await seedDemo();
  }
}

/** Wipe everything and re-seed (the "Reset demo" button). */
export async function resetDemo() {
  // Delete in FK-safe order (children first).
  await prisma.reportEvent.deleteMany();
  await prisma.timelineEvent.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.message.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.hold.deleteMany();
  await prisma.extra.deleteMany();
  await prisma.housekeepingTask.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.pricing.deleteMany();
  await prisma.property.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.conversation.deleteMany();
  console.log("[demo] demo data reset");
  return seedDemo();
}
