/*
 * Whole-frame profile harness: boots a real Application per scenario, warms
 * up, then measures per-step wall time with the player driving forward and
 * firing. Run with the Bun CPU profiler for hotspots:
 * 
 *   QTS_TEST_CORPUS=/path/to/qfiles bun --cpu-prof-md tools/profile-frame.ts q1-classic
 * 
 * Scenarios: q1-classic, q1-rerelease, q1-horde, q2-classic, q2-rerelease,
 * q3, mixed-q3-weapons, custom-q1-ctf. Extra args: --frames N (default 600),
 * --renderer cpu|gl (default cpu), --width/--height.
 */
import { Application } from "../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../src/app/bootstrap/options.ts";
import { WorldSeatPresentation } from "../src/app/bootstrap/presentation.ts";
import { InputRouter } from "../src/input/router.ts";

const corpus = process.env["QTS_TEST_CORPUS"] ?? "/home/buzzkill/Projects/qfiles";
const args = Bun.argv.slice(2);
const scenario = args[0] ?? "q1-classic";
const option = (name: string, fallback: string): string => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};
const frames = Number(option("frames", "600"));
const renderer = option("renderer", "cpu");
const width = option("width", "640"), height = option("height", "480");

const scenarios: Readonly<Record<string, readonly string[]>> = {
  "q1-classic": ["--game", "q1-classic-id1", "--map", "e1m1", "--movement", "q1", "--character", "q1", "--mode", "singleplayer"],
  "q1-rerelease": ["--game", "q1-rerelease-id1", "--map", "e1m1", "--movement", "q1", "--character", "q1", "--mode", "singleplayer"],
  "q1-horde": ["--game", "q1-rerelease-mg1", "--map", "horde1", "--movement", "q1", "--character", "q1", "--mode", "singleplayer", "--rules", "horde"],
  "q2-classic": ["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q2", "--character", "q2", "--mode", "singleplayer"],
  "q2-rerelease": ["--game", "q2-rerelease-baseq2", "--map", "base1", "--movement", "q2", "--character", "q2", "--mode", "singleplayer"],
  "q3": ["--game", "q3-baseq3", "--map", "q3dm1", "--movement", "q3", "--character", "q3", "--mode", "deathmatch"],
  "mixed-q3-weapons": ["--game", "q1-classic-id1", "--map", "e1m1", "--movement", "q1", "--character", "q1", "--weapons", "q3-baseq3", "--mode", "singleplayer"],
  "custom-q1-ctf": ["--game", "q1-classic-id1", "--map-game", "q1-classic-ctf", "--map", "ctf1", "--movement", "q1", "--character", "q1", "--mode", "deathmatch", "--rules", "ctf"],
};
const base = scenarios[scenario];
if (base === undefined) { console.error(`Unknown scenario ${scenario}; known: ${Object.keys(scenarios).join(", ")}`); process.exit(2); }

const dedicated = args.includes("--sim-only");
const parsed = parseApplicationCommand(["--content-root", corpus, ...base, "--renderer", renderer, "--hidden", "--width", width, "--height", height,
  ...(dedicated ? ["--dedicated"] : [])]);
if (parsed.kind !== "run") throw new Error("Missing launch");
const bootStart = performance.now();
const app = await Application.open(parsed.options, { print: () => undefined });
const bootMs = performance.now() - bootStart;
try {
  const local = app.localPlayers[0];
  let key = (_scancode: number, _keycode: number, _down: boolean): void => undefined;
  let click = (_down: boolean): void => undefined;
  if (!dedicated) {
    if (local === undefined || !(local.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing local presentation");
    const router = new InputRouter({ seats: [{ input: local.seat.presentation.ui.local.input, controller: { kind: "none" } }],
      keyboardSeat: local.seat.id, controllers: null, now: () => performance.now(), ticks: () => 0, subframe: false, unhandled: () => undefined });
    key = (scancode: number, keycode: number, down: boolean): void =>
      router.handlePlatform({ kind: "key", timestamp: 0, scancode, keycode, modifiers: 0, down, repeat: false });
    click = (down: boolean): void => router.handlePlatform({ kind: "mouse-button", timestamp: 0, button: 1, down, clicks: down ? 1 : 0, x: 0, y: 0 });
  }
  for (let index = 0; index < 60; index++) await app.step(16);
  key(26, 119, true); // W / +forward
  click(true);
  const samples: number[] = [];
  for (let index = 0; index < frames; index++) {
    const start = performance.now();
    await app.step(16);
    samples.push(performance.now() - start);
  }
  key(26, 119, false);
  click(false);
  samples.sort((a, b) => a - b);
  const at = (q: number): number => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))] ?? 0;
  const total = samples.reduce((sum, value) => sum + value, 0);
  const ui = local === undefined ? null : app.simulation.playerUi(local.actor);
  console.log(JSON.stringify({ scenario, renderer, dedicated, frames, bootMs: Math.round(bootMs),
    stepMs: { median: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1), mean: total / samples.length },
    health: ui?.health ?? null, weapon: ui?.activeWeapon ?? null }));
} finally { await app.close(); }
