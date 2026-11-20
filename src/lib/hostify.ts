// Hostify adapter. All reservations, availability and housekeeping tasks go
// through this interface. The mock adapter is the local database (default).
// RealHostifyAdapter is a stub: when HOSTIFY_API_KEY is set it logs a clear
// TODO warning and delegates to the mock so the demo keeps working.
import { prisma } from "./prisma";
import { isHostifyConfigured } from "./config";
import { Prisma } from "@prisma/client";

export interface TaskPatch {
  readyBy?: string;
  status?: string;
  historyEntry?: string;
}

export interface HostifyAdapter {
  name: string;
  listReservations(): Promise<unknown[]>;
  getReservation(id: string): Promise<unknown | null>;
  listTasks(propertyId?: string, date?: string): Promise<unknown[]>;
  updateTask(id: string, patch: TaskPatch): Promise<unknown>;
}

export class MockHostifyAdapter implements HostifyAdapter {
  name = "mock";
  listReservations() {
    return prisma.reservation.findMany({ include: { property: true }, orderBy: { checkinDate: "asc" } });
  }
  getReservation(id: string) {
    return prisma.reservation.findUnique({ where: { id }, include: { property: true } });
  }
  listTasks(propertyId?: string, date?: string) {
    return prisma.housekeepingTask.findMany({
      where: { ...(propertyId ? { propertyId } : {}), ...(date ? { date } : {}) },
      include: { property: true },
      orderBy: [{ date: "asc" }, { readyBy: "asc" }],
    });
  }
  async updateTask(id: string, patch: TaskPatch) {
    const task = await prisma.housekeepingTask.findUnique({ where: { id } });
    if (!task) throw new Error("task_not_found");
    const history = Array.isArray(task.history) ? [...(task.history as unknown[])] : [];
    if (patch.historyEntry) {
      history.push({ at: new Date().toISOString(), text: patch.historyEntry });
    }
    return prisma.housekeepingTask.update({
      where: { id },
      data: {
        ...(patch.readyBy ? { readyBy: patch.readyBy } : {}),
        ...(patch.status ? { status: patch.status } : {}),
        history: history as Prisma.InputJsonValue,
      },
    });
  }
}

export class RealHostifyAdapter implements HostifyAdapter {
  name = "real-stub";
  private mock = new MockHostifyAdapter();
  private warn(method: string) {
    console.warn(`[hostify] TODO: RealHostifyAdapter.${method} is a stub — HOSTIFY_API_KEY is set but the real Hostify API is not wired up yet. Delegating to the local mock so the demo keeps working.`);
  }
  listReservations() {
    this.warn("listReservations");
    return this.mock.listReservations();
  }
  getReservation(id: string) {
    this.warn("getReservation");
    return this.mock.getReservation(id);
  }
  listTasks(propertyId?: string, date?: string) {
    this.warn("listTasks");
    return this.mock.listTasks(propertyId, date);
  }
  updateTask(id: string, patch: TaskPatch) {
    this.warn("updateTask");
    return this.mock.updateTask(id, patch);
  }
}

export function getHostifyAdapter(): HostifyAdapter {
  return isHostifyConfigured() ? new RealHostifyAdapter() : new MockHostifyAdapter();
}
