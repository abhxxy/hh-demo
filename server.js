// Tiny WhatsApp ping bot (Home & Hill) — Twilio webhook test app.
// Single file, minimal dependencies: express + twilio.

const express = require('express');
const twilio = require('twilio');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';

// Twilio posts form-encoded bodies.
app.use(express.urlencoded({ extended: false }));
// Behind Coolify's proxy, so forwarded proto/host are real.
app.set('trust proxy', true);

function fullUrl(req) {
  const base = PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  return base + req.originalUrl;
}

// Validate the X-Twilio-Signature header. If no auth token is configured,
// skip validation but say so loudly in the logs.
function validateTwilio(req, res, next) {
  if (!TWILIO_AUTH_TOKEN) {
    console.warn('[twilio] WARNING: TWILIO_AUTH_TOKEN not set, skipping signature validation');
    return next();
  }
  const signature = req.get('X-Twilio-Signature') || '';
  const url = fullUrl(req);
  const valid = twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, url, req.body || {});
  if (!valid) {
    console.warn(`[twilio] Invalid signature for ${req.method} ${req.originalUrl} from ${req.ip}`);
    return res.status(403).send('Forbidden: invalid Twilio signature');
  }
  next();
}

// Health check — used by Coolify/uptime checks and by us to verify the deploy.
app.get('/api/health', (req, res) => {
  res.send('ok');
});

// Incoming WhatsApp messages from Twilio.
app.post('/api/webhooks/twilio', validateTwilio, (req, res) => {
  const from = req.body.From || '';
  const body = (req.body.Body || '').trim();
  console.log(`[twilio] inbound from=${from} body=${JSON.stringify(body)}`);

  const twiml = new twilio.twiml.MessagingResponse();
  if (body.toLowerCase() === 'ping') {
    twiml.message('pong 🏓');
  } else {
    twiml.message(`Home & Hill test bot is working ✅ You said: ${body}`);
  }
  res.type('text/xml').status(200).send(twiml.toString());
});

// Twilio delivery status callbacks.
app.post('/api/webhooks/twilio/status', validateTwilio, (req, res) => {
  const { MessageSid, MessageStatus, ErrorCode } = req.body;
  console.log(`[twilio] status MessageSid=${MessageSid} MessageStatus=${MessageStatus} ErrorCode=${ErrorCode || ''}`);
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`[hh-demo] listening on port ${PORT} (PUBLIC_BASE_URL=${PUBLIC_BASE_URL || '(not set)'})`);
});
