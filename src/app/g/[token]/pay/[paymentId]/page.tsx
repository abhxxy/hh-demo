"use client";

import { use, useEffect, useRef, useState } from "react";

export default function ProcessPayment({ params }: { params: Promise<{ token: string; paymentId: string }> }) {
  const { token, paymentId } = use(params);
  const [message, setMessage] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetch(`/api/portal/${token}/pay/${paymentId}`, { method: "POST" })
      .then(async (res) => {
        const json = await res.json();
        if (json.paid) {
          window.location.replace(`/g/${token}?paid=1`);
          return;
        }
        if (json.alreadyProcessed) {
          window.location.replace(`/g/${token}`);
          return;
        }
        setMessage(json.message || "The payment could not be completed.");
      })
      .catch(() => setMessage("Could not reach the server."));
  }, [token, paymentId]);

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800">Home &amp; Hill</p>
      <h1 className="mt-1 text-2xl font-bold">{message ? "Payment not completed" : "Processing your payment…"}</h1>
      {message && (
        <>
          <p className="mt-4 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-800">{message}</p>
          <a href={`/g/${token}`} className="mt-4 inline-block text-sm font-semibold text-emerald-800 underline">
            Back to your stay
          </a>
        </>
      )}
    </main>
  );
}
