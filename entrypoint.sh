#!/bin/sh
# Container entrypoint: apply Prisma migrations, then start Next.js.
# The app seeds demo data on first boot if the database is empty.
set -e
mkdir -p /data /data/uploads
echo "[demo] starting Home & Hill demo (DATABASE_URL=${DATABASE_URL:-file:/data/demo.db}, PORT=${PORT:-3000})"
echo "[demo] running prisma migrate deploy..."
npx prisma migrate deploy || echo "[demo] WARNING: migrate deploy failed — continuing anyway (the app seeds on boot if the DB is empty)"
echo "[demo] starting next server"
exec npm start
