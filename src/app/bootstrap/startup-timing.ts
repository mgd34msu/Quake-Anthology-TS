/** Opt-in startup phase timing: QTS_STARTUP_TIMING=1 prints each phase to stderr. */
const started = performance.now();
let last = started;
export function startupStamp(label: string): void {
  if (process.env["QTS_STARTUP_TIMING"] === undefined) return;
  const now = performance.now();
  process.stderr.write(`[startup] ${label}: +${(now - last).toFixed(0)}ms (total ${(now - started).toFixed(0)}ms)\n`);
  last = now;
}
