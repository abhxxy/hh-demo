"use client";

import { useCallback, useEffect, useState } from "react";

type Tab = "reservations" | "inbox" | "tasks" | "pricing" | "reports" | "demo";

interface StatusData {
  config: { twilio: boolean; mollie: boolean; llm: boolean; llmProvider: string; llmModel: string; admin: boolean; hostify: boolean; hostifyMode: string };
  counts: { reservations: number; conversations: number; pendingTasks: number; failedMessages: number };
  warnings: Array<{ id: string; text: string; at: string; guest?: string; property?: string }>;
}

interface ReservationRow {
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
  needsFollowUp: boolean;
  followupSent: boolean;
  accessReleaseTime: string | null;
  guestPhone: string | null;
  guestEmail: string | null;
  idPhotoPath: string | null;
  portalToken: string;
  extras: Array<{ type: string; amount: number; details: unknown; status: string }>;
  payments: Array<{ id: string; kind: string; extraType: string | null; amount: number; status: string }>;
  activeHolds: Array<{ id: string; extraType: string; slot: string; amount: number; expiresAt: string }>;
  tasks: Array<{ id: string; date: string; readyBy: string; status: string }>;
}

function eur(n: number) {
  return `€${n.toFixed(2)}`;
}

function Chip({ label, tone }: { label: string; tone: "green" | "amber" | "red" | "stone" | "blue" }) {
  const colors = {
    green: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
    stone: "bg-stone-100 text-stone-700",
    blue: "bg-sky-100 text-sky-800",
  } as const;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${colors[tone]}`}>{label}</span>;
}

export default function AdminDashboard() {
  const [tab, setTab] = useState<Tab>("reservations");
  const [status, setStatus] = useState<StatusData | null>(null);
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [inboxList, setInboxList] = useState<Array<Record<string, unknown>>>([]);
  const [thread, setThread] = useState<Record<string, unknown> | null>(null);
  const [threadPhone, setThreadPhone] = useState("");
  const [replyText, setReplyText] = useState("");
  const [tasks, setTasks] = useState<Array<Record<string, unknown>>>([]);
  const [pricing, setPricing] = useState<Array<{ id: string; key: string; scope: string; value: Record<string, unknown> }>>([]);
  const [reports, setReports] = useState<{ rows: Array<Record<string, unknown>>; totals: Record<string, number> } | null>(null);
  const [demoMsg, setDemoMsg] = useState("");
  const [demoBusy, setDemoBusy] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const loadAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [s, r, i, t, p, rep] = await Promise.all([
        fetch("/api/admin/status").then((x) => x.json()),
        fetch("/api/admin/reservations").then((x) => x.json()),
        fetch("/api/admin/inbox").then((x) => x.json()),
        fetch("/api/admin/tasks").then((x) => x.json()),
        fetch("/api/admin/pricing").then((x) => x.json()),
        fetch("/api/admin/reports").then((x) => x.json()),
      ]);
      setStatus(s);
      setReservations(r.reservations || []);
      setInboxList(i.conversations || []);
      setTasks(t.tasks || []);
      setPricing(p.pricing || []);
      setReports(rep);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function loadDetail(id: string) {
    setSelectedId(id);
    const res = await fetch(`/api/admin/reservations/${id}`);
    setDetail(await res.json());
  }

  async function loadThread(phone: string) {
    setThreadPhone(phone);
    const res = await fetch(`/api/admin/inbox?phone=${encodeURIComponent(phone)}`);
    setThread(await res.json());
  }

  async function sendReply() {
    const text = replyText.trim();
    if (!text || !threadPhone) return;
    const res = await fetch("/api/admin/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: threadPhone, body: text }),
    });
    const json = await res.json();
    if (!json.sent) {
      alert(json.message || "Could not send the reply.");
      return;
    }
    setReplyText("");
    await loadThread(threadPhone);
    await loadAll();
  }

  async function togglePause(phone: string, paused: boolean) {
    await fetch("/api/admin/inbox", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, paused }),
    });
    await loadThread(phone);
    await loadAll();
  }

  async function setTaskStatus(id: string, status: string) {
    await fetch("/api/admin/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    await loadAll();
  }

  async function savePricing(key: string, scope: string, value: Record<string, unknown>) {
    await fetch("/api/admin/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, scope, value }),
    });
    await loadAll();
  }

  async function demoAction(action: string, extra?: Record<string, unknown>) {
    setDemoBusy(action);
    setDemoMsg("");
    try {
      const res = await fetch("/api/admin/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(extra || {}) }),
      });
      const json = await res.json();
      setDemoMsg(json.message || json.error || "Done.");
      await loadAll();
    } catch {
      setDemoMsg("Demo action failed — could not reach the server.");
    } finally {
      setDemoBusy("");
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/admin/login";
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "reservations", label: "Reservations" },
    { id: "inbox", label: "Inbox" },
    { id: "tasks", label: "Housekeeping" },
    { id: "pricing", label: "Pricing" },
    { id: "reports", label: "Reports" },
    { id: "demo", label: "Demo controls" },
  ];

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 pb-16">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800">Home &amp; Hill</p>
          <h1 className="mt-1 text-2xl font-bold">Staff dashboard</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void loadAll()} disabled={refreshing} className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50">
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button onClick={() => void logout()} className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold">
            Log out
          </button>
        </div>
      </header>

      {/* Config status + warnings */}
      {status && (
        <section className="mt-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-2 text-xs">
            <Chip label={status.config.twilio ? "Twilio: on" : "Twilio: NOT SET"} tone={status.config.twilio ? "green" : "amber"} />
            <Chip label={status.config.mollie ? "Mollie test: on" : "Mollie: NOT SET"} tone={status.config.mollie ? "green" : "amber"} />
            <Chip label={status.config.llm ? `AI: ${status.config.llmProvider} (${status.config.llmModel})` : "AI: NOT SET (built-in guide)"} tone={status.config.llm ? "green" : "amber"} />
            <Chip label={`Hostify: ${status.config.hostifyMode}`} tone="stone" />
            <Chip label={`${status.counts.pendingTasks} pending tasks`} tone="stone" />
            {status.counts.failedMessages > 0 && <Chip label={`${status.counts.failedMessages} failed messages`} tone="red" />}
          </div>
          {status.warnings.length > 0 && (
            <div className="mt-3 space-y-1 border-t border-stone-100 pt-3">
              {status.warnings.slice(0, 5).map((w) => (
                <p key={w.id} className="text-xs text-amber-900">
                  ⚠ {w.text} {w.property ? `(${w.property})` : ""}
                </p>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Tabs */}
      <nav className="mt-4 flex flex-wrap gap-1 rounded-xl bg-stone-200/70 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === t.id ? "bg-white shadow-sm" : "text-stone-600"}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* ---------------- Reservations ---------------- */}
      {tab === "reservations" && (
        <section className="mt-4 space-y-3">
          {reservations.map((r) => (
            <article key={r.id} className="cursor-pointer rounded-2xl border border-stone-200 bg-white p-4 shadow-sm" onClick={() => void loadDetail(r.id)}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">
                    {r.guestName} · {r.property}
                  </h2>
                  <p className="text-sm text-stone-600">
                    {r.checkinDate} → {r.checkoutDate} · {r.guests} guests · {r.channel}
                  </p>
                </div>
                <span className="text-xs text-stone-500">Check-in {r.checkinTime} · Check-out {r.checkoutTime}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Chip label={r.registered ? "Registered" : "Not registered"} tone={r.registered ? "green" : "amber"} />
                <Chip label={r.payments.some((p) => p.status === "paid") ? "Paid" : "Unpaid"} tone={r.payments.some((p) => p.status === "paid") ? "green" : "stone"} />
                {r.extras.length > 0 && <Chip label={`${r.extras.length} extra${r.extras.length > 1 ? "s" : ""}: ${eur(r.extras.reduce((s, e) => s + e.amount, 0))}`} tone="blue" />}
                {r.accessReleaseTime && <Chip label={`Access ${r.accessReleaseTime}`} tone="blue" />}
                {r.arrived && <Chip label="Arrived" tone="green" />}
                {r.needsFollowUp && <Chip label="Needs follow-up" tone="red" />}
                {r.status === "cancelled" && <Chip label="Cancelled" tone="red" />}
                {r.activeHolds.length > 0 && <Chip label={`Hold: ${r.activeHolds[0].extraType.replace(/_/g, " ")} ${r.activeHolds[0].slot}`} tone="amber" />}
              </div>
            </article>
          ))}
          {reservations.length === 0 && <p className="text-sm text-stone-500">No reservations yet.</p>}

          {selectedId && detail && (
            <div className="rounded-2xl border border-emerald-700 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <h3 className="font-semibold">Reservation detail</h3>
                <button onClick={() => { setSelectedId(null); setDetail(null); }} className="text-sm text-stone-500">Close</button>
              </div>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-stone-50 p-3 text-xs">
                {JSON.stringify(detail, null, 2)}
              </pre>
              <p className="mt-2 text-xs text-stone-500">
                Portal link: <a className="underline" href={`/g/${(detail as { reservation?: { portalToken?: string } }).reservation?.portalToken}`} target="_blank" rel="noreferrer">open guest portal</a>
              </p>
            </div>
          )}
        </section>
      )}

      {/* ---------------- Inbox ---------------- */}
      {tab === "inbox" && (
        <section className="mt-4 grid gap-4 md:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            {inboxList.map((c) => {
              const conv = c as { phone: string; paused: boolean; role: string; lastMessage?: { body: string; direction: string } | null; reservation?: { guestName: string; property: string; checkinDate: string } | null };
              return (
                <button key={conv.phone} onClick={() => void loadThread(conv.phone)} className={`w-full rounded-xl border p-3 text-left ${threadPhone === conv.phone ? "border-emerald-700 bg-white" : "border-stone-200 bg-white"}`}>
                  <p className="text-sm font-semibold">
                    {conv.phone} {conv.role !== "guest" ? `(${conv.role})` : ""}
                  </p>
                  {conv.reservation && <p className="text-xs text-stone-500">{conv.reservation.guestName} · {conv.reservation.property} · {conv.reservation.checkinDate}</p>}
                  {conv.lastMessage && <p className="mt-1 truncate text-xs text-stone-600">{conv.lastMessage.direction === "out" ? "You: " : ""}{conv.lastMessage.body}</p>}
                  {conv.paused && <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">AI paused</span>}
                </button>
              );
            })}
            {inboxList.length === 0 && <p className="text-sm text-stone-500">No conversations yet — guests appear here once they message the WhatsApp number.</p>}
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
            {!thread ? (
              <p className="text-sm text-stone-500">Pick a conversation on the left.</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold">{threadPhone}</h3>
                  <label className="flex items-center gap-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={Boolean((thread as { paused?: boolean }).paused)}
                      onChange={(e) => void togglePause(threadPhone, e.target.checked)}
                    />
                    Pause AI
                  </label>
                </div>
                {(thread as { reservation?: { guestName: string; property: string; checkinDate: string; checkoutDate: string } | null }).reservation && (
                  <p className="mt-1 text-xs text-stone-500">
                    Booking: {(thread as { reservation: { guestName: string; property: string; checkinDate: string; checkoutDate: string } }).reservation.guestName} ·{" "}
                    {(thread as { reservation: { property: string } }).reservation.property} ·{" "}
                    {(thread as { reservation: { checkinDate: string; checkoutDate: string } }).reservation.checkinDate} →{" "}
                    {(thread as { reservation: { checkoutDate: string } }).reservation.checkoutDate}
                  </p>
                )}
                <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
                  {((thread as { messages?: Array<{ id: string; direction: string; body: string; channel: string; status: string; createdAt: string }> }).messages || []).map((m) => (
                    <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.direction === "out" ? "bg-emerald-800 text-white" : "bg-stone-100"}`}>
                        <p>{m.body}</p>
                        <p className={`mt-1 text-[10px] ${m.direction === "out" ? "text-emerald-100" : "text-stone-500"}`}>
                          {m.channel} · {m.status} · {new Date(m.createdAt).toLocaleString("en-GB")}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <form
                  className="mt-3 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void sendReply();
                  }}
                >
                  <input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Reply as staff…" className="flex-1 rounded-xl border border-stone-300 px-3 py-2 text-sm" />
                  <button type="submit" className="rounded-xl bg-emerald-800 px-4 py-2 text-sm font-semibold text-white">Send</button>
                </form>
                <p className="mt-2 text-xs text-stone-500">Replies go out on WhatsApp. If the guest hasn&apos;t messaged in the last 24h, the send is skipped and logged.</p>
              </>
            )}
          </div>
        </section>
      )}

      {/* ---------------- Housekeeping ---------------- */}
      {tab === "tasks" && (
        <section className="mt-4 space-y-2">
          {tasks.map((t) => {
            const task = t as { id: string; property?: { name: string }; date: string; readyBy: string; status: string; history?: Array<{ at: string; text: string }> };
            return (
              <article key={task.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">{task.property?.name} · {task.date}</h3>
                    <p className="text-sm text-stone-600">Ready by {task.readyBy} · status: {task.status}</p>
                  </div>
                  <div className="flex gap-1">
                    {(["ready", "done"] as const).map((s) => (
                      <button key={s} onClick={() => void setTaskStatus(task.id, s)} className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs font-semibold capitalize">
                        Mark {s}
                      </button>
                    ))}
                  </div>
                </div>
                {task.history && task.history.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-stone-100 pt-2 text-xs text-stone-600">
                    {task.history.map((h, i) => (
                      <li key={i}>
                        {new Date(h.at).toLocaleString("en-GB")}: {h.text}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
          {tasks.length === 0 && <p className="text-sm text-stone-500">No housekeeping tasks yet.</p>}
        </section>
      )}

      {/* ---------------- Pricing ---------------- */}
      {tab === "pricing" && (
        <section className="mt-4 space-y-4">
          {["early_checkin", "late_checkout", "breakfast", "upgrade"].map((key) => {
            const rows = pricing.filter((p) => p.key === key);
            if (rows.length === 0) return null;
            return (
              <div key={key} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                <h3 className="font-semibold capitalize">{key.replace(/_/g, " ")}</h3>
                {rows.map((row) => (
                  <PricingRow key={row.id} row={row} onSave={(value) => void savePricing(row.key, row.scope, value)} />
                ))}
              </div>
            );
          })}
          <p className="text-xs text-stone-500">Prices are in EUR. Early check-in / late check-out are keyed by bedrooms (1/2/3); breakfast is per person; upgrade is per night for the named property.</p>
        </section>
      )}

      {/* ---------------- Reports ---------------- */}
      {tab === "reports" && reports && (
        <section className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-stone-500">Extras revenue</p>
              <p className="text-xl font-bold">{eur(reports.totals.extrasRevenue || 0)}</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-stone-500">Tourist tax (separate)</p>
              <p className="text-xl font-bold">{eur(reports.totals.touristTax || 0)}</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-stone-500">Deposits (separate)</p>
              <p className="text-xl font-bold">{eur(reports.totals.deposits || 0)}</p>
            </div>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                  <th className="px-3 py-2">Extra</th>
                  <th className="px-3 py-2">Property</th>
                  <th className="px-3 py-2">Slot</th>
                  <th className="px-3 py-2">Shown</th>
                  <th className="px-3 py-2">Purchased</th>
                  <th className="px-3 py-2">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {reports.rows.map((r, i) => (
                  <tr key={i} className="border-b border-stone-100">
                    <td className="px-3 py-2 capitalize">{String(r.extraType).replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">{String(r.propertyType)}</td>
                    <td className="px-3 py-2">{String(r.slot)}</td>
                    <td className="px-3 py-2">{Number(r.shown)}</td>
                    <td className="px-3 py-2">{Number(r.purchased)}</td>
                    <td className="px-3 py-2">{eur(Number(r.revenue))}</td>
                  </tr>
                ))}
                {reports.rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-stone-500">No extras shown or purchased yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-stone-500">Tourist tax and deposits are shown separately and never counted as extras revenue.</p>
        </section>
      )}

      {/* ---------------- Demo controls ---------------- */}
      {tab === "demo" && (
        <section className="mt-4 space-y-3">
          <p className="text-sm text-stone-600">
            These drive the live demo. Date changes and cancellations update housekeeping tasks and send new cleaner alerts.
          </p>
          {demoMsg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{demoMsg}</div>}
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { action: "send-portal-link", label: "Send portal link now", hint: "WhatsApp the guest their portal link" },
              { action: "trigger-followup", label: "Trigger 21:00 follow-up now", hint: "Runs tonight's follow-up immediately" },
              { action: "mark-arrived", label: "Mark guest arrived", hint: "Sets arrived = true" },
              { action: "change-dates", label: "Simulate booking date change (+1 day)", hint: "Moves the stay, updates tasks + alerts" },
              { action: "cancel", label: "Simulate cancellation", hint: "Cancels the stay, tasks + alerts" },
              { action: "simulate-failed-whatsapp", label: "Simulate failed WhatsApp delivery", hint: "Logs a failed send + warning" },
              { action: "mark-hold-paid", label: "Mark latest hold as paid (test)", hint: "Confirms the newest hold without Mollie" },
              { action: "reset", label: "Reset demo data", hint: "Wipes everything and re-seeds" },
            ].map((b) => (
              <button
                key={b.action}
                onClick={() => void demoAction(b.action, b.action === "change-dates" ? { days: 1 } : undefined)}
                disabled={demoBusy !== ""}
                className="rounded-2xl border border-stone-200 bg-white p-4 text-left shadow-sm hover:border-emerald-700 disabled:opacity-50"
              >
                <span className="block font-semibold">{demoBusy === b.action ? "Working…" : b.label}</span>
                <span className="mt-0.5 block text-xs text-stone-500">{b.hint}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function PricingRow({ row, onSave }: { row: { key: string; scope: string; value: Record<string, unknown> }; onSave: (v: Record<string, unknown>) => void }) {
  const [text, setText] = useState(JSON.stringify(row.value));
  const [saved, setSaved] = useState(false);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <span className="w-16 font-mono text-xs text-stone-500">{row.scope}</span>
      <input value={text} onChange={(e) => { setText(e.target.value); setSaved(false); }} className="min-w-0 flex-1 rounded-lg border border-stone-300 px-2 py-1.5 font-mono text-xs" />
      <button
        onClick={() => {
          try {
            onSave(JSON.parse(text) as Record<string, unknown>);
            setSaved(true);
          } catch {
            alert("Not valid JSON — check the value and try again.");
          }
        }}
        className="rounded-lg bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white"
      >
        {saved ? "Saved ✓" : "Save"}
      </button>
    </div>
  );
}
