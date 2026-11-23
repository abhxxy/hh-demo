import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isMollieConfigured } from "@/lib/config";
import { completeSimulatedPayment } from "@/lib/payments";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ token: string; paymentId: string }> };

export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { token, paymentId } = await params;
  const payment = isMollieConfigured()
    ? null
    : await prisma.payment.findUnique({ where: { id: paymentId }, include: { reservation: true } });
  if (!payment || payment.mollieId || payment.reservation.portalToken !== token) {
    return NextResponse.json({ error: "not_found", message: "This payment link is not valid." }, { status: 404 });
  }
  const result = await completeSimulatedPayment(payment.id);
  if (result.alreadyProcessed) {
    return NextResponse.json({ error: "already_processed", alreadyProcessed: true, message: result.message }, { status: 409 });
  }
  return NextResponse.json(result);
}
