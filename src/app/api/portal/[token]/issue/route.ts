// Report an issue from the portal chat.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { executeTool } from "@/lib/tools";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const reservation = await prisma.reservation.findUnique({ where: { portalToken: token } });
  if (!reservation) return NextResponse.json({ error: "reservation_not_found" }, { status: 404 });
  let body: { details?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const details = String(body.details || "").trim().slice(0, 1000);
  if (!details) return NextResponse.json({ error: "empty_details", message: "Please describe the issue." }, { status: 400 });
  const result = await executeTool("report_issue", { details }, reservation.id);
  return NextResponse.json(result);
}
