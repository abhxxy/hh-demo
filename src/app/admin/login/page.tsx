"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLogin() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Demo mode: no password is configured, so there is no login — go straight in.
  useEffect(() => {
    fetch("/api/admin/login")
      .then((r) => r.json())
      .then((j) => {
        if (!j.configured) router.push("/admin");
      })
      .catch(() => {});
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (res.ok) {
        router.push("/admin");
        router.refresh();
      } else {
        setError(json.message || "Login failed.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800">Home &amp; Hill</p>
      <h1 className="mt-1 text-2xl font-bold">Staff dashboard</h1>
      <p className="mt-1 text-sm text-stone-600">Enter the admin password to continue.</p>
      <form onSubmit={submit} className="mt-6 space-y-3 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <label className="block text-sm">
          <span className="font-medium">Admin password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
          />
        </label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-xl bg-emerald-800 px-4 py-2.5 font-semibold text-white disabled:opacity-50">
          {busy ? "Checking…" : "Log in"}
        </button>
      </form>
      <p className="mt-4 text-xs text-stone-500">
        The password comes from the ADMIN_PASSWORD environment variable. If it isn&apos;t set, the dashboard is open with no login (demo mode).
      </p>
    </main>
  );
}
