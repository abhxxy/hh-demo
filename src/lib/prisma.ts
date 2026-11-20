// Prisma client singleton, using the better-sqlite3 driver adapter (Prisma 7).
// The database file comes from DATABASE_URL (default: the persistent /data volume).
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function databasePath(): string {
  const url = process.env.DATABASE_URL || "file:/data/demo.db";
  return url.replace(/^file:/, "");
}

function createClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: databasePath() });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
