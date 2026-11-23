// Portal AI chat. The guest must be registered first. Uses the LLM when
// configured, otherwise the rule-based responder (which says so honestly).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isLlmConfigured } from "@/lib/config";
import { ruleBasedReply, runLlmChat } from "@/lib/llm";
import { handlePaymentDoneMessage } from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const reservation = await prisma.reservation.findUnique({ where: { portalToken: token } });
  if (!reservation) {
    return NextResponse.json({ error: "reservation_not_found" }, { status: 404 });
  }
  if (!reservation.registered) {
    return NextResponse.json({ error: "not_registered", message: "Please complete registration first — then the chat opens." }, { status: 403 });
  }
  let body: { message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Could not read your message." }, { status: 400 });
  }
  const message = String(body.message || "").trim().slice(0, 2000);
  if (!message) {
    return NextResponse.json({ error: "empty_message", message: "Please type a message." }, { status: 400 });
  }
  await prisma.chatMessage.create({ data: { reservationId: reservation.id, role: "user", text: message } });
  const paymentReply = await handlePaymentDoneMessage(reservation.id, message);
  if (paymentReply) {
    return NextResponse.json({ reply: paymentReply, llmConfigured: isLlmConfigured() });
  }
  const history = await prisma.chatMessage.findMany({
    where: { reservationId: reservation.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const turns = history.reverse().map((m) => ({ role: m.role as "user" | "assistant", text: m.text }));
  const reply = isLlmConfigured()
    ? await runLlmChat(reservation.id, turns.slice(0, -1), message)
    : await ruleBasedReply(reservation.id, message);
  await prisma.chatMessage.create({ data: { reservationId: reservation.id, role: "assistant", text: reply } });
  return NextResponse.json({ reply, llmConfigured: isLlmConfigured() });
}
