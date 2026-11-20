// Mollie webhook. Idempotent: keyed on the Mollie payment id, duplicates are
// ignored, and every call answers 200 fast. The payment id arrives as a
// form-encoded `id` field; we fetch the payment from Mollie to get its status.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getMolliePayment } from "@/lib/mollie";
import { confirmExtraPayment, confirmRegistrationPayment, failPayment } from "@/lib/payments";
import { isMollieConfigured } from "@/lib/config";

export const dynamic = "force-dynamic";

const TERMINAL = new Set(["paid", "failed", "canceled", "expired", "refund_flagged"]);

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const mollieId = String(form.get("id") || "");
  if (!mollieId) {
    console.warn("[mollie] webhook called without an id — ignoring");
    return new NextResponse("ok", { status: 200 });
  }
  if (!isMollieConfigured()) {
    console.warn(`[mollie] webhook for payment ${mollieId} but MOLLIE_API_KEY is not set — ignoring`);
    return new NextResponse("ok", { status: 200 });
  }

  let payment;
  try {
    payment = await getMolliePayment(mollieId);
  } catch (e) {
    console.warn(`[mollie] could not fetch payment ${mollieId}: ${e instanceof Error ? e.message : e}`);
    return new NextResponse("ok", { status: 200 });
  }
  console.log(`[mollie] webhook payment=${mollieId} status=${payment.status}`);

  const row = await prisma.payment.findUnique({ where: { mollieId } });
  if (!row) {
    console.warn(`[mollie] no local payment for Mollie id ${mollieId} — ignoring (not created by this demo)`);
    return new NextResponse("ok", { status: 200 });
  }
  // Idempotency: already terminal with the same outcome.
  if (TERMINAL.has(row.status)) {
    console.log(`[mollie] duplicate webhook for ${mollieId} (already ${row.status}) — ignoring`);
    return new NextResponse("ok", { status: 200 });
  }

  const status = payment.status;
  try {
    if (status === "paid") {
      if (row.kind === "registration") {
        await confirmRegistrationPayment(row.id);
      } else {
        await confirmExtraPayment(row.id);
      }
    } else if (status === "failed" || status === "canceled" || status === "expired") {
      await failPayment(row.id, status);
    } else {
      // pending / open / authorized: nothing to do yet.
      console.log(`[mollie] payment ${mollieId} is ${status} — waiting`);
    }
  } catch (e) {
    console.error(`[mollie] handling payment ${mollieId} failed:`, e);
  }
  return new NextResponse("ok", { status: 200 });
}
