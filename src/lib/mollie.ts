// Mollie API (test mode) via plain fetch — no SDK needed.
// Docs: https://docs.mollie.com/reference/create-payment
import { isMollieConfigured, publicBaseUrl } from "./config";

export interface MolliePayment {
  id: string;
  status: string;
  amount: { currency: string; value: string };
  description: string;
  checkoutUrl?: string;
  _links?: { checkout?: { href: string } };
  metadata?: Record<string, unknown>;
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.MOLLIE_API_KEY}`,
    "Content-Type": "application/json",
  };
}

export async function createMolliePayment(opts: {
  amount: number;
  description: string;
  redirectPath: string;
  metadata: Record<string, string>;
}): Promise<MolliePayment> {
  if (!isMollieConfigured()) throw new Error("mollie_not_configured");
  const base = publicBaseUrl();
  const res = await fetch("https://api.mollie.com/v2/payments", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      amount: { currency: "EUR", value: opts.amount.toFixed(2) },
      description: opts.description.slice(0, 255),
      redirectUrl: base + opts.redirectPath,
      webhookUrl: base + "/api/webhooks/mollie",
      metadata: opts.metadata,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (json as { detail?: string; title?: string }).detail || (json as { title?: string }).title || `Mollie HTTP ${res.status}`;
    console.warn(`[mollie] create payment failed: ${detail}`);
    throw new Error(`mollie_create_failed: ${detail}`);
  }
  const p = json as MolliePayment;
  return { ...p, checkoutUrl: p._links?.checkout?.href };
}

export async function getMolliePayment(id: string): Promise<MolliePayment> {
  if (!isMollieConfigured()) throw new Error("mollie_not_configured");
  const res = await fetch(`https://api.mollie.com/v2/payments/${encodeURIComponent(id)}`, {
    headers: headers(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`mollie_get_failed: HTTP ${res.status}`);
  }
  const p = json as MolliePayment;
  return { ...p, checkoutUrl: p._links?.checkout?.href };
}
