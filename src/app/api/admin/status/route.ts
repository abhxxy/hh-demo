// Dashboard status: which integrations are configured, recent warnings
// (e.g. WhatsApp skipped outside the 24h window), and key counts.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getConfigStatus } from "@/lib/config";
import { requireAdmin } from "@/lib/admin-api";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const warnings = await prisma.timelineEvent.findMany({
    where: { kind: "warning" },
    orderBy: { at: "desc" },
    take: 10,
    include: { reservation: { select: { guestName: true, property: { select: { name: true } } } } },
  });
  const [reservations, conversations, tasks, failedMessages] = await Promise.all([
    prisma.reservation.count(),
    prisma.conversation.count(),
    prisma.housekeepingTask.count({ where: { status: "pending" } }),
    prisma.message.count({ where: { status: "failed" } }),
  ]);
  return NextResponse.json({
    config: getConfigStatus(),
    counts: { reservations, conversations, pendingTasks: tasks, failedMessages },
    warnings: warnings.map((w) => ({ id: w.id, text: w.text, at: w.at, guest: w.reservation?.guestName, property: w.reservation?.property.name })),
  });
}
