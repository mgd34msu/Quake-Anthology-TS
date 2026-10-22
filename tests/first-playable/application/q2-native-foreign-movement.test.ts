import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";

// A native Q2 DLL world must keep executing its own game code while the
// selected foreign movement provider steps the player inside the guest's
// Pmove calls: trajectories follow the selected provider's speeds, the
// guest player state keeps its spawn view angles, and the run is not
// silently swapped to the TS implementation or back to Q2 movement.
async function runLane(game: string, library: string, movement: string): Promise<{
  displacement: number; peakSpeed: number; yaw: number; health: number; provider: string; artifact: string | null;
}> {
  const root = await mkdtemp(join(tmpdir(), "quake-native-foreign-move-"));
  let app: Application | null = null;
  try {
    const parsed = parseApplicationCommand(["--game", game, "--map", "base1", "--q2-game", library,
      "--movement", movement, "--character", "q2", "--renderer", "cpu", "--hidden",
      "--width", "320", "--height", "240", "--user-content-root", root]);
    if (parsed.kind !== "run") throw new Error("Missing launch options");
    app = await Application.open(parsed.options, { saveDirectory: join(root, "saves"), print: () => undefined });
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    const native = app.simulation.q2Native(); if (native === null) throw new Error("Native source was not admitted");
    for (let i = 0; i < 20; i++) await app.step(50);
    const start = app.simulation.playerView(local.actor).origin;
    const yaw = app.simulation.playerView(local.actor).angles.y;
    app.input({ seat: local.seat.id, kind: "key", code: 119, down: true, repeat: false, timeMilliseconds: performance.now() });
    let peak = 0; let previous = start;
    for (let i = 0; i < 120; i++) {
      await app.step(50);
      const now = app.simulation.playerView(local.actor).origin;
      peak = Math.max(peak, Math.hypot(now.x - previous.x, now.y - previous.y) / 0.05);
      previous = now;
    }
    app.input({ seat: local.seat.id, kind: "key", code: 119, down: false, repeat: false, timeMilliseconds: performance.now() });
    const end = app.simulation.playerView(local.actor).origin;
    return { displacement: Math.hypot(end.x - start.x, end.y - start.y), peakSpeed: peak, yaw,
      health: app.simulation.playerUi(local.actor).health,
      provider: app.simulation.recipe.movement.provider, artifact: native.module.artifactPath };
  } finally { try { await app?.close(); } finally { await rm(root, { recursive: true, force: true }); } }
}

test("classic native DLL runs genuine Q2 movement as the baseline", async () => {
  const lane = await runLane("q2-classic-baseq2", "gamex86.dll", "q2");
  expect(lane.artifact).toBe("gamex86.dll");
  expect(lane.provider).toBe("q2:movement");
  expect(lane.yaw).toBe(135);
  expect(lane.displacement).toBeGreaterThan(300);
  expect(lane.health).toBeGreaterThan(0);
}, 240_000);

test("classic native DLL runs with Quake 1 movement interposed at Pmove", async () => {
  const lane = await runLane("q2-classic-baseq2", "gamex86.dll", "q1");
  expect(lane.artifact).toBe("gamex86.dll");
  expect(lane.provider).toBe("q1:movement");
  // The guest player state must keep its spawn yaw: Pmove owns viewangles.
  expect(lane.yaw).toBe(135);
  // The player actually traverses the map under Q1 physics, whose ground
  // speed stays below the Q2 run profile measured in the baseline lane.
  expect(lane.displacement).toBeGreaterThan(300);
  expect(lane.peakSpeed).toBeGreaterThan(200);
  expect(lane.peakSpeed).toBeLessThan(360);
  expect(lane.health).toBeGreaterThan(0);
}, 240_000);

test("classic native DLL with Q3 movement turns, jumps, crouches and stands", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-native-foreign-actions-"));
  let app: Application | null = null;
  try {
    const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--q2-game", "gamex86.dll",
      "--movement", "q3", "--character", "q2", "--renderer", "cpu", "--hidden",
      "--width", "320", "--height", "240", "--user-content-root", root]);
    if (parsed.kind !== "run") throw new Error("Missing launch options");
    app = await Application.open(parsed.options, { saveDirectory: join(root, "saves"), print: () => undefined });
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    if (app.simulation.q2Native() === null) throw new Error("Native source was not admitted");
    const key = (code: number, down: boolean): void => { app?.input({ seat: local.seat.id, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
    const view = () => { const v = app?.simulation.playerView(local.actor); if (v === undefined) throw new Error("Missing view"); return v; };
    for (let i = 0; i < 20; i++) await app.step(50);
    const standingHeight = view().viewHeight, spawnYaw = view().angles.y;
    // Mouse yaw must reach the guest player state through the interposed
    // Pmove: aim comes from this frame's command, not last frame's state.
    app.input({ seat: local.seat.id, kind: "mouse-motion", position: { x: 0, y: 0 }, delta: { x: 400, y: 0 }, timeMilliseconds: performance.now() });
    for (let i = 0; i < 4; i++) await app.step(50);
    expect(Math.abs(view().angles.y - spawnYaw)).toBeGreaterThan(10);
    // Jump leaves and returns to the floor.
    const groundZ = view().origin.z;
    key(32, true);
    let peakZ = groundZ;
    for (let i = 0; i < 20; i++) { await app.step(50); peakZ = Math.max(peakZ, view().origin.z); if (i === 2) key(32, false); }
    expect(peakZ - groundZ).toBeGreaterThan(20);
    expect(view().origin.z).toBeCloseTo(groundZ, 0);
    // Crouch (the game profile binds it to C) lowers the eye, and releasing
    // it stands back up instead of sticking at crouch height.
    key(99, true);
    for (let i = 0; i < 10; i++) await app.step(50);
    expect(view().viewHeight).toBeLessThan(standingHeight);
    key(99, false);
    for (let i = 0; i < 10; i++) await app.step(50);
    expect(view().viewHeight).toBe(standingHeight);
    expect(app.simulation.playerUi(local.actor).health).toBeGreaterThan(0);
  } finally { try { await app?.close(); } finally { await rm(root, { recursive: true, force: true }); } }
}, 240_000);

test("rerelease native DLL runs with Quake 1 movement interposed at Pmove", async () => {
  const lane = await runLane("q2-rerelease-baseq2", "game_x64.dll", "q1");
  expect(lane.artifact).toBe("game_x64.dll");
  expect(lane.provider).toBe("q1:movement");
  expect(lane.yaw).toBe(135);
  expect(lane.displacement).toBeGreaterThan(300);
  expect(lane.peakSpeed).toBeGreaterThan(200);
  expect(lane.peakSpeed).toBeLessThan(360);
  expect(lane.health).toBeGreaterThan(0);
}, 240_000);
