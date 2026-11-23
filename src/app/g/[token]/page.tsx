"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

interface PortalData {
  reservation: {
    id: string;
    guestName: string;
    guests: number;
    property: string;
    bedrooms: number;
    checkinDate: string;
    checkoutDate: string;
    checkinTime: string;
    checkoutTime: string;
    channel: string;
    status: string;
    registered: boolean;
    arrived: boolean;
    accessReleaseTime: string | null;
    guestPhone: string | null;
    guestEmail: string | null;
    idPhotoPath: string | null;
    touristTaxCollectedByPlatform: boolean;
  };
  amounts: { touristTax: number; deposit: number; total: number; nights: number };
  extras: Array<{ type: string; amount: number; details: unknown }>;
  payments: Array<{ id: string; kind: string; extraType: string | null; amount: number; status: string }>;
  holds: Array<{ id: string; extraType: string; slot: string; amount: number; expiresAt: string }>;
  chatMessages: Array<{ id: string; role: string; text: string; createdAt: string }>;
  tasks: Array<{ id: string; readyBy: string; status: string }>;
  config: { llm: boolean; llmProvider: string; mollie: boolean };
}

function eur(n: number) {
  return `€${n.toFixed(2)}`;
}

function fmtDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, day)));
}

function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="underline break-all text-emerald-800">
        {p}
      </a>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export default function GuestPortal({ params }: { params: Promise<{ token: string }> }) {
  const search = useSearchParams();
  const [token, setToken] = useState("");
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueText, setIssueText] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [registering, setRegistering] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (t: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/portal/${t}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.message || "Could not load this portal link.");
        return;
      }
      setData(json);
    } catch {
      setError("Could not reach the server. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    params.then((p) => {
      setToken(p.token);
      setPhone("");
      void load(p.token);
    });
  }, [params, load]);

  useEffect(() => {
    if (search.get("paid") === "1") {
      setNotice("Payment received — thank you! Your booking has been updated below.");
      if (token) void load(token);
    }
  }, [search, token, load]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.chatMessages.length]);

  async function register() {
    if (!data) return;
    setRegistering(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.set("phone", phone);
      form.set("email", email);
      if (photo) form.set("idPhoto", photo);
      const res = await fetch(`/api/portal/${token}/register`, { method: "POST", body: form });
      const json = await res.json();
      if (json.checkoutUrl) {
        window.location.href = json.checkoutUrl;
        return;
      }
      if (json.registered) {
        setNotice("Registration complete — thank you!");
        await load(token);
        return;
      }
      setError(json.message || "Registration failed. Please try again.");
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setRegistering(false);
    }
  }

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || sending) return;
    setSending(true);
    setChatInput("");
    setData((d) => (d ? { ...d, chatMessages: [...d.chatMessages, { id: `tmp-${Date.now()}`, role: "user", text, createdAt: new Date().toISOString() }] } : d));
    try {
      const res = await fetch(`/api/portal/${token}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.message || "The chat is unavailable right now.");
      } else {
        await load(token);
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function markArrived() {
    const res = await fetch(`/api/portal/${token}/arrived`, { method: "POST" });
    const json = await res.json();
    setNotice(json.message || "Welcome! You're marked as arrived.");
    await load(token);
  }

  async function reportIssue() {
    const details = issueText.trim();
    if (!details) return;
    const res = await fetch(`/api/portal/${token}/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ details }),
    });
    const json = await res.json();
    setNotice(json.message || "Thanks — we've passed that on to our team.");
    setIssueText("");
    setIssueOpen(false);
    await load(token);
  }

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-10">
        <p className="text-stone-500">Loading your stay…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-6 pb-16">
      <header className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800">Home &amp; Hill</p>
        <h1 className="mt-1 text-2xl font-bold">Your stay</h1>
      </header>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}
      {notice && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>
      )}

      {!data && !error && <p className="text-stone-500">Nothing here yet.</p>}

      {data && (
        <>
          {/* Stay summary */}
          <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{data.reservation.property}</h2>
                <p className="text-sm text-stone-600">
                  {fmtDate(data.reservation.checkinDate)} → {fmtDate(data.reservation.checkoutDate)} · {data.amounts.nights}{" "}
                  {data.amounts.nights === 1 ? "night" : "nights"} · {data.reservation.guests} guests · via {data.reservation.channel}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700">
                {data.reservation.status === "cancelled" ? "Cancelled" : data.reservation.arrived ? "Arrived" : data.reservation.registered ? "Registered" : "Not registered"}
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-stone-500">Check-in</dt>
                <dd className="font-semibold">{data.reservation.checkinTime}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Check-out</dt>
                <dd className="font-semibold">{data.reservation.checkoutTime}</dd>
              </div>
              {data.reservation.accessReleaseTime && (
                <div>
                  <dt className="text-stone-500">Door access released</dt>
                  <dd className="font-semibold">{data.reservation.accessReleaseTime} on arrival day</dd>
                </div>
              )}
              {data.tasks[0] && (
                <div>
                  <dt className="text-stone-500">Ready by</dt>
                  <dd className="font-semibold">
                    {data.tasks[0].readyBy} ({data.tasks[0].status})
                  </dd>
                </div>
              )}
            </dl>
            {data.extras.length > 0 && (
              <div className="mt-4 border-t border-stone-100 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Your extras</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {data.extras.map((e, i) => (
                    <li key={i} className="flex justify-between">
                      <span className="capitalize">{e.type.replace(/_/g, " ")}</span>
                      <span className="font-semibold">{eur(e.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {!data.reservation.registered ? (
            /* ---------------- Registration ---------------- */
            <section className="mt-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold">Complete your registration</h2>
              <p className="mt-1 text-sm text-stone-600">
                Confirm your contact details and upload a photo of your ID. Then pay the tourist tax and deposit in one
                test payment.
              </p>
              <div className="mt-4 space-y-2 rounded-xl bg-stone-50 p-4 text-sm">
                <div className="flex justify-between">
                  <span>
                    Tourist tax ({data.reservation.guests} guests × {data.amounts.nights} nights × €6)
                  </span>
                  <span className="font-semibold">{eur(data.amounts.touristTax)}</span>
                </div>
                {data.reservation.touristTaxCollectedByPlatform && (
                  <p className="text-xs text-stone-500">Already collected by {data.reservation.channel} — €0.00 owed.</p>
                )}
                <div className="flex justify-between">
                  <span>Security deposit (refundable)</span>
                  <span className="font-semibold">{eur(data.amounts.deposit)}</span>
                </div>
                <div className="flex justify-between border-t border-stone-200 pt-2 text-base">
                  <span className="font-semibold">Total due now</span>
                  <span className="font-bold">{eur(data.amounts.total)}</span>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <label className="block text-sm">
                  <span className="font-medium">Phone (WhatsApp)</span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+32412345678"
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">ID photo</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setPhoto(e.target.files?.[0] || null)}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  />
                  <span className="text-xs text-stone-500">A photo of your passport or ID card. Stored securely, only used for check-in.</span>
                </label>
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button
                  onClick={() => void register()}
                  disabled={registering}
                  className="flex-1 rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-50"
                >
                  {registering ? "Please wait…" : `Pay ${eur(data.amounts.total)} (${data.config.mollie ? "Mollie test" : "demo"})`}
                </button>
              </div>
              <p className="mt-3 text-xs text-stone-500">
                {data.config.mollie
                  ? "Test payment — use a Mollie test card at checkout. You'll be redirected back here afterwards."
                  : "Demo payment — no card is needed and no money moves. You'll be returned here afterwards."}
              </p>
            </section>
          ) : (
            /* ---------------- Chat ---------------- */
            <section className="mt-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">Chat with Home &amp; Hill</h2>
                {!data.reservation.arrived && (
                  <button onClick={() => void markArrived()} className="rounded-full bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white">
                    I&apos;ve arrived
                  </button>
                )}
              </div>
              {!data.config.llm && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  The AI assistant isn&apos;t configured yet — answers come from the built-in price guide, which uses the same
                  live prices and availability.
                </p>
              )}
              <div className="mt-3 max-h-96 space-y-3 overflow-y-auto pr-1">
                {data.chatMessages.length === 0 && (
                  <p className="text-sm text-stone-500">
                    Hi {data.reservation.guestName.split(" ")[0]}! Welcome to Home &amp; Hill. What time do you expect to
                    arrive? Check-in is from 16:00, but earlier may be possible.
                  </p>
                )}
                {data.chatMessages.map((m) => (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${
                        m.role === "user" ? "bg-emerald-800 text-white" : "bg-stone-100 text-stone-900"
                      }`}
                    >
                      {linkify(m.text)}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <form
                className="mt-4 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendChat();
                }}
              >
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask about early check-in, breakfast, an upgrade…"
                  className="flex-1 rounded-xl border border-stone-300 px-3 py-2.5 text-sm"
                />
                <button type="submit" disabled={sending} className="rounded-xl bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                  Send
                </button>
              </form>
              <div className="mt-3 flex gap-2">
                <button onClick={() => setIssueOpen((v) => !v)} className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700">
                  Report an issue
                </button>
                {data.reservation.arrived && (
                  <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">✓ Arrived</span>
                )}
              </div>
              {issueOpen && (
                <div className="mt-3 space-y-2">
                  <textarea
                    value={issueText}
                    onChange={(e) => setIssueText(e.target.value)}
                    placeholder="Describe the issue — e.g. the heating isn't working…"
                    rows={3}
                    className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm"
                  />
                  <button onClick={() => void reportIssue()} className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white">
                    Send report
                  </button>
                </div>
              )}
              {data.holds.length > 0 && (
                <p className="mt-3 text-xs text-stone-500">
                  Active hold: {data.holds[0].extraType.replace(/_/g, " ")} {data.holds[0].slot} — {eur(data.holds[0].amount)} — expires{" "}
                  {new Date(data.holds[0].expiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.
                </p>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
