// Housekeeping tasks per property and date, with history. PATCH updates status.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-api";
import { getHostifyAdapter } from "@/lib/hostify";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const date = req.nextUrl.searchParams.get("date") || undefined;
  const propertyId = req.nextUrl.searchParams.get("propertyId") || undefined;
  const adapter = getHostifyAdapter();
  const tasks = (await adapter.listTasks(propertyId, date)) as Array<Record<string, unknown>>;
  return NextResponse.json({ tasks });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  let body: { id?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const { id, status } = body;
  if (!id || !status || !["pending", "ready", "done", "cancelled"].includes(status)) {
    return NextResponse.json({ error: "bad_request", message: "Valid id and status (pending/ready/done/cancelled) are required." }, { status: 400 });
  }
  const adapter = getHostifyAdapter();
  const task = await adapter.updateTask(id, { status, historyEntry: `Status changed to ${status} by staff.` });
  // Keep the reservation timeline in sync.
  const row = await prisma.housekeepingTask.findUnique({ where: { id } });
  if (row?.reservationId) {
    await prisma.timelineEvent.create({
      data: { reservationId: row.reservationId, kind: "task", text: `Housekeeping task for ${row.date} marked ${status} by staff.` },
    });
  }
  return NextResponse.json({ task });
}
