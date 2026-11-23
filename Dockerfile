# syntax=docker/dockerfile:1
# Home & Hill demo — Next.js + Prisma/SQLite.
# Multi-stage: deps -> builder (prisma generate + next build) -> runner.
# The runner keeps the full node_modules so the Prisma client, the
# better-sqlite3 native binding and the Prisma engines travel with it.
# SQLite lives on the persistent volume mounted at /data (Coolify volume).

FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl python3 make g++
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# postinstall downloads the Prisma schema engine (~9 MB) — needs network.
RUN npm ci

FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
RUN mkdir -p /data /data/uploads
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DATABASE_URL=file:/data/demo.db
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=file:/data/demo.db
ENV PUBLIC_BASE_URL=https://hh-demo.apps.autozenixai.com
RUN mkdir -p /data /data/uploads
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/package.json ./package.json
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh
EXPOSE 3000
CMD ["./entrypoint.sh"]
