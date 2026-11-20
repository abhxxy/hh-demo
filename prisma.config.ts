// Prisma 7 config: connection URL lives here (not in schema.prisma).
// DATABASE_URL is read from the environment (Coolify env vars in production,
// .env locally). Default is the persistent volume path used in Docker.
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL || "file:/data/demo.db",
  },
});
