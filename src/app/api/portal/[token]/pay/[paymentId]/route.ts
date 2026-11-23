import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isMollieConfigured } from "@/lib/config";
import { confirmExtraPayment, confirmRegistrationPayment, failPayment } from "@/lib/payments";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ token: string; paymentId: string }> };

async function findPayment({ params }: RouteParams) {
  if (isMollieConfigured()) return null;
  const { token, paymentId } = await params;
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { reservation: { include: { property: true } } },
  });
  if (!payment || payment.mollieId || payment.reservation.portalToken !== token) return null;
  return payment;
}

export async function GET(_req: NextRequest, context: RouteParams) {
  const payment = await findPayment(context);
  if (!payment) return NextResponse.json({ error: "not_found", message: "This demo checkout link is not valid." }, { status: 404 });
  return NextResponse.json({
    kind: payment.kind,
    extraType: payment.extraType,
    amount: payment.amount,
    status: payment.status,
    property: payment.reservation.property.name,
    guestName: payment.reservation.guestName,
  });
}

export async function POST(req: NextRequest, context: RouteParams) {
  const payment = await findPayment(context);
  if (!payment) return NextResponse.json({ error: "not_found", message: "This demo checkout link is not valid." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { outcome?: string };
  if (body.outcome !== "paid" && body.outcome !== "failed") {
    return NextResponse.json({ error: "bad_request", message: "Choose an outcome." }, { status: 400 });
  }
  const claimed = await prisma.payment.updateMany({
    where: { id: payment.id, status: "open" },
    data: { status: "processing" },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "already_processed", message: "This checkout has already been completed." }, { status: 409 });
  }
  if (body.outcome === "failed") {
    await failPayment(payment.id, "failed");
    return NextResponse.json({ paid: false, message: "Payment failed. Nothing was charged." });
  }
  if (payment.kind === "registration") {
    await confirmRegistrationPayment(payment.id);
    return NextResponse.json({ paid: true });
  }
  const result = await confirmExtraPayment(payment.id);
  if (!result.confirmed) {
    return NextResponse.json({
      paid: false,
      message: result.reason === "hold_expired"
        ? "The 15-minute hold expired, so this extra was not confirmed. The team has been alerted to refund it."
        : "This slot is no longer available, so it was not confirmed. The team has been alerted to refund it.",
    });
  }
  return NextResponse.json({ paid: true });
}
