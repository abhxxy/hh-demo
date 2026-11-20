// Registration: confirm phone + email, upload an ID photo, pay tourist tax +
// deposit in ONE Mollie test payment. If Mollie is not configured, the guest
// sees a clear notice and (test mode only) can continue without payment.
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { createMolliePayment } from "@/lib/mollie";
import { isMollieConfigured } from "@/lib/config";
import { registrationAmounts } from "@/lib/tools";

export const dynamic = "force-dynamic";

function uploadsDir(): string {
  return process.env.UPLOADS_DIR || "/data/uploads";
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const reservation = await prisma.reservation.findUnique({ where: { portalToken: token } });
  if (!reservation) {
    return NextResponse.json({ error: "reservation_not_found" }, { status: 404 });
  }
  if (reservation.registered) {
    return NextResponse.json({ registered: true, message: "Already registered." });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Could not read the form. Please try again." }, { status: 400 });
  }
  const phone = String(form.get("phone") || "").trim();
  const email = String(form.get("email") || "").trim();
  const testBypass = String(form.get("testBypass") || "") === "1";
  const file = form.get("idPhoto") as File | null;

  if (!phone || !/^[+0-9][0-9 ()-]{6,}$/.test(phone)) {
    return NextResponse.json({ error: "invalid_phone", message: "Please enter a valid phone number, e.g. +32412345678." }, { status: 400 });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "invalid_email", message: "Please enter a valid email address." }, { status: 400 });
  }

  // ID photo (optional but expected): store under the uploads dir.
  let idPhotoPath: string | undefined;
  if (file && file.size > 0) {
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "file_too_large", message: "The ID photo must be smaller than 10 MB." }, { status: 400 });
    }
    const ext = (file.name.split(".").pop() || "jpg").replace(/[^a-zA-Z0-9]/g, "").slice(0, 5) || "jpg";
    const filename = `${reservation.id}-${Date.now()}.${ext}`;
    const dir = uploadsDir();
    await fs.mkdir(dir, { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(dir, filename), buffer);
    idPhotoPath = filename;
  }

  await prisma.reservation.update({
    where: { id: reservation.id },
    data: { guestPhone: phone, guestEmail: email, ...(idPhotoPath ? { idPhotoPath } : {}) },
  });
  await prisma.timelineEvent.create({
    data: { reservationId: reservation.id, kind: "message", text: `Guest registered details: phone ${phone}, email ${email}${idPhotoPath ? ", ID photo uploaded" : ", no ID photo yet"}.` },
  });

  const amounts = registrationAmounts(reservation);

  // Test-mode bypass (only when Mollie is not configured): lets the demo run
  // end-to-end without keys. Clearly labelled in the UI and the timeline.
  if (testBypass && !isMollieConfigured()) {
    await prisma.payment.create({
      data: { reservationId: reservation.id, kind: "registration", amount: amounts.total, currency: "EUR", status: "paid", paidAt: new Date() },
    });
    await prisma.reservation.update({ where: { id: reservation.id }, data: { registered: true } });
    await prisma.timelineEvent.create({
      data: { reservationId: reservation.id, kind: "payment", text: `Registration marked paid in TEST MODE (Mollie not configured): tourist tax €${amounts.touristTax.toFixed(2)} + deposit €${amounts.deposit.toFixed(2)} = €${amounts.total.toFixed(2)}. No real payment was taken.` },
    });
    await prisma.chatMessage.create({
      data: { reservationId: reservation.id, role: "assistant", text: "Thank you — your registration is complete, including the tourist tax and deposit. What time do you expect to arrive?" },
    });
    console.log(`[demo] registration test-bypass for reservation ${reservation.id}`);
    return NextResponse.json({ registered: true, testMode: true });
  }

  if (!isMollieConfigured()) {
    return NextResponse.json({
      error: "mollie_not_configured",
      message: "Test payments aren't set up yet (Mollie test key missing). Your details are saved — use the test-mode button to continue the demo, or ask the team to set up Mollie.",
      amounts,
    }, { status: 503 });
  }

  try {
    const payment = await createMolliePayment({
      amount: amounts.total,
      description: `Home & Hill — Tourist tax + deposit, ${reservation.propertyId} (${reservation.checkinDate})`,
      redirectPath: `/g/${token}?paid=1`,
      metadata: { reservationId: reservation.id, kind: "registration" },
    });
    await prisma.payment.create({
      data: { mollieId: payment.id, reservationId: reservation.id, kind: "registration", amount: amounts.total, currency: "EUR", status: "open" },
    });
    await prisma.timelineEvent.create({
      data: { reservationId: reservation.id, kind: "payment", text: `Registration payment created (€${amounts.total.toFixed(2)}: tourist tax €${amounts.touristTax.toFixed(2)} + deposit €${amounts.deposit.toFixed(2)}) — Mollie checkout link sent.` },
    });
    return NextResponse.json({ checkoutUrl: payment.checkoutUrl, mollieId: payment.id, amounts });
  } catch (e) {
    console.warn(`[mollie] registration payment failed: ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "payment_create_failed", message: "Could not start the test payment. Please try again." }, { status: 502 });
  }
}
