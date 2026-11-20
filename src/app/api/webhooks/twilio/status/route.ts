// Twilio delivery status callback. Updates the stored message status.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { twilioSignedUrl, twilioSignatureValid } from "@/lib/twilio-validate";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => {
    params[k] = String(v);
  });
  const signature = req.headers.get("X-Twilio-Signature") || "";
  const url = twilioSignedUrl("/api/webhooks/twilio/status");
  if (!twilioSignatureValid(process.env.TWILIO_AUTH_TOKEN, signature, url, params)) {
    console.warn("[twilio] Invalid signature for POST /api/webhooks/twilio/status");
    return new NextResponse("Forbidden: invalid Twilio signature", { status: 403 });
  }
  const { MessageSid, MessageStatus, ErrorCode } = params;
  console.log(`[twilio] status MessageSid=${MessageSid} MessageStatus=${MessageStatus} ErrorCode=${ErrorCode || ""}`);
  if (MessageSid) {
    await prisma.message.updateMany({
      where: { twilioSid: MessageSid },
      data: { status: MessageStatus || "unknown" },
    });
  }
  return new NextResponse("ok", { status: 200 });
}
