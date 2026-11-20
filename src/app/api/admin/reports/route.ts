// Reporting: per extra, property type and time slot — shown, purchased, revenue.
// Tourist tax and deposits are reported separately and NEVER counted as extras
// revenue.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-api";
import { touristTaxOwed, DEPOSIT_EUR } from "@/lib/availability";
import { nightsBetween } from "@/lib/brussels";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const events = await prisma.reportEvent.findMany({ orderBy: { at: "asc" } });
  const byKey = new Map<string, { extraType: string; propertyType: string; slot: string; shown: number; purchased: number; revenue: number }>();
  for (const e of events) {
    const key = `${e.extraType}|${e.propertyType}|${e.slot}`;
    const row = byKey.get(key) || { extraType: e.extraType, propertyType: e.propertyType, slot: e.slot, shown: 0, purchased: 0, revenue: 0 };
    if (e.kind === "shown") row.shown += 1;
    if (e.kind === "purchased") {
      row.purchased += 1;
      row.revenue += e.revenue;
    }
    byKey.set(key, row);
  }
  const extrasRevenue = [...byKey.values()].reduce((s, r) => s + r.revenue, 0);

  // Tourist tax + deposits, from paid registration payments (never extras revenue).
  const regPayments = await prisma.payment.findMany({ where: { kind: "registration", status: "paid" }, include: { reservation: true } });
  let touristTax = 0;
  let deposits = 0;
  for (const p of regPayments) {
    const r = p.reservation;
    touristTax += touristTaxOwed(r.guests, nightsBetween(r.checkinDate, r.checkoutDate), r.touristTaxCollectedByPlatform);
    deposits += DEPOSIT_EUR;
  }
  return NextResponse.json({
    rows: [...byKey.values()].sort((a, b) => `${a.extraType}${a.propertyType}${a.slot}`.localeCompare(`${b.extraType}${b.propertyType}${b.slot}`)),
    totals: { extrasRevenue, touristTax, deposits, registrationPayments: regPayments.length },
  });
}
