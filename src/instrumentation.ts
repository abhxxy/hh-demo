// Runs once when the Next.js server boots.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { ensureSeed } = await import("./lib/seed");
    await ensureSeed();
  } catch (e) {
    console.error("[demo] seed on boot failed (non-fatal):", e);
  }
  try {
    const { startScheduler } = await import("./lib/jobs");
    startScheduler();
  } catch (e) {
    console.error("[jobs] scheduler failed to start (non-fatal):", e);
  }
}
