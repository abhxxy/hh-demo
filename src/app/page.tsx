import Link from "next/link";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800">Home &amp; Hill</p>
        <h1 className="mt-2 text-3xl font-bold leading-tight">Short-stay apartments in Belgium</h1>
        <p className="mt-2 text-stone-600">
          This is the demo guest portal and staff dashboard. Everything here runs on clearly labelled test data —
          no real bookings, no real payments.
        </p>
      </header>

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Are you the demo guest?</h2>
        <p className="mt-1 text-sm text-stone-600">
          Send <span className="font-mono font-semibold text-stone-800">demo</span> on WhatsApp to{" "}
          <span className="font-mono font-semibold text-stone-800">+32 460 20 18 74</span> and you&apos;ll get your personal
          portal link back. Open it to register, pay the tourist tax and deposit, and chat with the assistant about
          your stay.
        </p>
        <p className="mt-3 text-sm text-stone-600">
          Staff can send <span className="font-mono font-semibold text-stone-800">cleaner</span> or{" "}
          <span className="font-mono font-semibold text-stone-800">ops</span> to the same number to register for alerts.
        </p>
      </section>

      <section className="mt-4 grid grid-cols-2 gap-4">
        <Link href="/admin" className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm hover:border-emerald-700">
          <h2 className="text-base font-semibold">Staff dashboard</h2>
          <p className="mt-1 text-sm text-stone-600">Reservations, inbox, housekeeping, pricing, reports and demo controls.</p>
        </Link>
        <a href="/api/health" className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm hover:border-emerald-700">
          <h2 className="text-base font-semibold">Health check</h2>
          <p className="mt-1 text-sm text-stone-600">GET /api/health — should return “ok”.</p>
        </a>
      </section>

      <footer className="mt-8 text-xs text-stone-500">
        <p>Home &amp; Hill demo · All times Europe/Brussels · Payments run in Mollie test mode · WhatsApp via Twilio.</p>
      </footer>
    </main>
  );
}
