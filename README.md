# Home & Hill — demo

A working demo for **Home & Hill** (short-stay apartments in Belgium): a guest portal
with registration + Mollie test payments and an AI concierge, Twilio WhatsApp,
and a staff dashboard — all on clearly labelled test data.

This replaces the earlier tiny ping bot in this repo. The fixed routes are kept:
`GET /api/health` → `ok`, `POST /api/webhooks/twilio`, `POST /api/webhooks/twilio/status`,
plus the new `POST /api/webhooks/mollie`.

## Stack

- Next.js 16 (App Router, TypeScript), Tailwind, React 19
- Prisma 7 + SQLite (better-sqlite3 driver adapter), DB file on the persistent volume `/data`
- Twilio (WhatsApp + SMS fallback), Mollie API (test mode), OpenAI/Anthropic (tool calling)
- node-cron for the 21:00 follow-up (Europe/Brussels)

## Run locally

```bash
cp .env.example .env        # fill in the keys you have; the app degrades gracefully without them
npm install
DATABASE_URL=file:./dev.db npx prisma migrate dev --name init   # first time: creates the DB + migration
DATABASE_URL=file:./dev.db npm run seed                        # or let the app seed on first boot
DATABASE_URL=file:./dev.db npm run dev
```

Open http://localhost:3000. The guest portal link comes from the dashboard
(`/admin` → Reservations → detail) or by sending `demo` to the WhatsApp number.

Useful commands:

```bash
npm run build     # prisma generate + next build
npm start         # production server (PORT env, default 3000)
npm run seed      # re-seed demo data (DATABASE_URL must be set)
```

## Environment variables

See `.env.example` — every variable the app reads, with a comment. The important ones:

| Variable | What it's for |
|---|---|
| `PUBLIC_BASE_URL` | Portal links, Mollie redirect/webhook URLs, Twilio signature validation |
| `DATABASE_URL` | SQLite file, e.g. `file:/data/demo.db` (Docker) or `file:./dev.db` (local) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio WhatsApp/SMS + webhook signature validation |
| `TWILIO_WHATSAPP_FROM` | Sender, `whatsapp:+32460201874` |
| `MOLLIE_API_KEY` | Mollie test key (`test_…`) |
| `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL` | `openai` or `anthropic` chat with tool calling |
| `ADMIN_PASSWORD` | Staff dashboard login |
| `HOSTIFY_API_KEY` | Optional — when set, the (stub) real Hostify adapter is used |

**Graceful degradation:** if Twilio, Mollie or the LLM key is missing, the app keeps
running and says so clearly — the portal explains the AI isn't configured (a built-in
price guide answers instead), payments offer a test-mode bypass, and outbound WhatsApp
is skipped with a warning in the dashboard. No crashes.

## How the demo works

1. **Guest** sends `demo` to the WhatsApp number → gets a personal portal link.
   `cleaner` / `ops` register those phones for alerts.
2. **Guest portal** (`/g/{token}`): confirm phone + email, upload an ID photo, pay
   tourist tax (€6/person/night) + deposit (€75) in one Mollie test payment.
3. **AI chat**: asks arrival time, quotes early check-in / late check-out / breakfast /
   upgrade from live prices and availability (tools, never invented), creates a 15-minute
   hold + Mollie payment link. `I've arrived` button. `Report an issue` alerts ops.
4. **On payment** (Mollie webhook): the extra is confirmed, reservation times, access
   release time and the housekeeping task are updated, and the cleaner + ops get a
   WhatsApp alert. Paid after the hold expired → flagged for refund, ops alerted.
5. **21:00 on arrival day** (Europe/Brussels): arrived guests get a WhatsApp check-in;
   if not arrived, ops is alerted instead. Replies land in the dashboard inbox.
6. **Staff dashboard** (`/admin`): reservations with status chips, detail timeline,
   inbox with staff replies + Pause AI, housekeeping tasks, pricing editor, reporting
   (tourist tax/deposits shown separately, never as extras revenue), and demo controls
   (send portal link, trigger follow-up, mark arrived, change dates, cancel, simulate
   failed WhatsApp, reset demo).

## WhatsApp 24-hour rule

Free-form WhatsApp only works within 24 hours of the recipient messaging us.
Before every outbound message the app checks the contact's last inbound message;
outside the window it skips WhatsApp, logs it clearly and shows a warning in the
dashboard. If WhatsApp fails, the same text goes by SMS; if that fails too, ops is flagged.

## Deploy (Coolify)

Dockerfile app, port 3000, health check on `/api/health`. The container runs
`prisma migrate deploy` on start (migrations in `prisma/migrations/`) and seeds demo
data on first boot if the database is empty. Mount a persistent volume at `/data`
(DB file + uploaded ID photos). Set the env vars in Coolify — never in the repo.

## Project layout

```
prisma/                 schema + seed + migrations
src/lib/                prisma, config, brussels dates, twilio, whatsapp, mollie,
                        llm, tools, availability, hostify, payments, jobs, seed, auth
src/app/api/            health, webhooks (twilio, twilio/status, mollie),
                        portal/[token] (register, chat, arrived, issue),
                        uploads/[file], admin/*
src/app/g/[token]/      guest portal
src/app/admin/          login + dashboard
src/instrumentation.ts  seeds on boot + starts the cron scheduler
```
