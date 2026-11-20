// "I've arrived" button + "report an issue" from the portal.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { executeTool } from "@/lib/tools";

export const dynamic = "force-dynamic";

async function load(req: NextRequest, params: Promise<{ token: string }>) {
  const { token } = await params;
  return prisma.reservation.findUnique({ where: { portalToken: token } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const reservation = await load(req, params);
  if (!reservation) return NextResponse.json({ error: "reservation_not_found" }, { status: 404 });
  const url = req.nextUrl;
  if (url.pathname.endsWith("/arrived")) {
    const result = await executeTool("confirm_arrival", {}, reservation.id);
    return NextResponse.json(result);
  }
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
