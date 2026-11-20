// Date/time helpers. All demo dates are "YYYY-MM-DD" strings and times "HH:MM"
// strings, always interpreted in Europe/Brussels.

const TZ = "Europe/Brussels";

function partsInBrussels(d: Date): { y: number; m: number; day: number; hh: number; mm: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  return {
    y: Number(p.year),
    m: Number(p.month),
    day: Number(p.day),
    hh: Number(p.hour),
    mm: Number(p.minute),
  };
}

/** Today in Europe/Brussels as "YYYY-MM-DD". */
export function todayBrussels(now = new Date()): string {
  const p = partsInBrussels(now);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Current time in Europe/Brussels as "HH:MM". */
export function nowBrusselsHHMM(now = new Date()): string {
  const p = partsInBrussels(now);
  return `${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")}`;
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function nightsBetween(checkin: string, checkout: string): number {
  const [y1, m1, d1] = checkin.split("-").map(Number);
  const [y2, m2, d2] = checkout.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** "2026-11-20" -> "20 November" (day + long month, no year — as used in alerts). */
export function formatDateLong(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long" }).format(dt);
}

/** "2026-11-20" -> "Fri 20 Nov 2026". */
export function formatDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(dt);
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function addMinutesToTime(t: string, mins: number): string {
  return minutesToTime(timeToMinutes(t) + mins);
}

export function eur(n: number): string {
  return `€${n.toFixed(2)}`;
}
