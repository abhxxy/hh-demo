"use client";

import { use, useEffect, useState } from "react";

interface Checkout {
  kind: string;
  extraType: string | null;
  amount: number;
  status: string;
  property: string;
  guestName: string;
}

export default function DemoCheckout({ params }: { params: Promise<{ token: string; paymentId: string }> }) {
  const { token, paymentId } = use(params);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/portal/${token}/pay/${paymentId}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          setMessage(json.message || "This demo checkout link is not valid.");
          return;
        }
        setCheckout(json);
        if (json.status !== "open") {
          setMessage("This checkout has already been completed.");
          setDone(true);
        }
      })
      .catch(() => setMessage("Could not reach the server."));
  }, [token, paymentId]);

  async function complete(outcome: "paid" | "failed") {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/portal/${token}/pay/${paymentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
      const json = await res.json();
      if (json.paid) {
        window.location.assign(`/g/${token}?paid=1`);
        return;
      }
      setMessage(json.message || "The payment could not be completed.");
      setDone(true);
    } catch {
      setMessage("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const title = checkout?.kind === "registration"
    ? "Tourist tax and deposit"
    : (checkout?.extraType || "Extra").replace(/_/g, " ");

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800">Home &amp; Hill</p>
      <h1 className="mt-1 text-2xl font-bold">Demo checkout</h1>
      <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Simulated payment. No card is needed and no money moves.
      </p>
      {checkout && (
        <section className="mt-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-stone-600">{checkout.guestName} · {checkout.property}</p>
          <div className="mt-3 flex items-baseline justify-between gap-3">
            <span className="font-semibold capitalize">{title}</span>
            <span className="text-xl font-bold">€{checkout.amount.toFixed(2)}</span>
          </div>
          {!done && (
            <div className="mt-5 flex flex-col gap-2">
              <button onClick={() => void complete("paid")} disabled={busy} className="rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-50">
                {busy ? "Processing…" : "Simulate successful payment"}
              </button>
              <button onClick={() => void complete("failed")} disabled={busy} className="rounded-xl border border-stone-300 px-4 py-3 font-semibold text-stone-700 disabled:opacity-50">
                Simulate failed payment
              </button>
            </div>
          )}
        </section>
      )}
      {message && <p className="mt-4 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-800">{message}</p>}
      {(done || !checkout) && (
        <a href={`/g/${token}`} className="mt-4 inline-block text-sm font-semibold text-emerald-800 underline">
          Back to your stay
        </a>
      )}
    </main>
  );
}
