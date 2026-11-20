// Pricing editor: GET all pricing rows, POST upserts one (key + scope + value).
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-api";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const rows = await prisma.pricing.findMany({ orderBy: [{ key: "asc" }, { scope: "asc" }] });
  return NextResponse.json({ pricing: rows });
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  let body: { key?: string; scope?: string; value?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const { key, scope, value } = body;
  if (!key || !scope || !value || typeof value !== "object") {
    return NextResponse.json({ error: "bad_request", message: "key, scope and value are required." }, { status: 400 });
  }
  const row = await prisma.pricing.upsert({
    where: { key_scope: { key, scope } },
    update: { value: value as Prisma.InputJsonValue },
    create: { key, scope, value: value as Prisma.InputJsonValue },
  });
  return NextResponse.json({ pricing: row });
}
