# hh-demo — WhatsApp ping bot (Home & Hill)

Tiny Node.js + Express app to test a Twilio WhatsApp number.

## Routes

- `GET /api/health` → `ok`
- `POST /api/webhooks/twilio` → Twilio WhatsApp inbound webhook. Replies
  `pong 🏓` to `ping` (any case), otherwise
  `Home & Hill test bot is working ✅ You said: <message>`.
- `POST /api/webhooks/twilio/status` → Twilio status callback, logs
  MessageSid / MessageStatus / ErrorCode, returns 200.

## Signature validation

Both webhook routes validate the `X-Twilio-Signature` header with
`TWILIO_AUTH_TOKEN` and the full public URL built from `PUBLIC_BASE_URL`.
If `TWILIO_AUTH_TOKEN` is not set, validation is skipped and a warning is
logged.

## Run locally

```bash
cp .env.example .env   # fill in TWILIO_AUTH_TOKEN
npm install
npm start              # listens on PORT (default 3000)
```

## Deploy

Dockerfile-based app on Coolify, domain `hh-demo.apps.autozenixai.com`
(HTTPS via Coolify's proxy). Environment variables in Coolify:

- `PORT=3000`
- `PUBLIC_BASE_URL=https://hh-demo.apps.autozenixai.com`
- `TWILIO_AUTH_TOKEN=<your Twilio auth token>`

## Twilio webhook URLs

- Incoming messages (HTTP POST):
  `https://hh-demo.apps.autozenixai.com/api/webhooks/twilio`
- Status callback (HTTP POST):
  `https://hh-demo.apps.autozenixai.com/api/webhooks/twilio/status`
