import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";

// A foreign selected character must be what a native Q2 DLL world draws for
// its clients: the guest stays authoritative for the player's body, combat
// and death, while the selected character's model and animation replace the
// guest player model (never a silent fallback to male/grunt).
async function runLane(game: string, library: string, character: string): Promise<{
  bodies: readonly { path: string; family: string; content: string }[];
  runFrames: readonly string[]; characterViews: number; health: number;
}> {
  const root = await mkdtemp(join(tmpdir(), "quake-native-foreign-character-"));
  let app: Application | null = null;
  try {
    const parsed = parseApplicationCommand(["--game", game, "--map", "base1", "--q2-game", library,
      "--movement", "q2", "--character", character, "--renderer", "cpu", "--hidden",
      "--width", "320", "--height", "240", "--user-content-root", root]);
    if (parsed.kind !== "run") throw new Error("Missing launch options");
    app = await Application.open(parsed.options, { saveDirectory: join(root, "saves"), print: () => undefined });
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    if (app.simulation.q2Native() === null) throw new Error("Native source was not admitted");
    for (let i = 0; i < 20; i++) await app.step(50);
    const frames = new Set<string>();
    app.input({ seat: local.seat.id, kind: "key", code: 119, down: true, repeat: false, timeMilliseconds: performance.now() });
    for (let i = 0; i < 60; i++) {
      await app.step(50);
      for (const p of app.simulation.presentations()) if (p.actor.equals(local.actor) && !p.viewWeapon) frames.add(`${p.path}#${p.frame}`);
      for (const v of app.simulation.characterViews()) frames.add(`q3#${v.animation.legs}`);
    }
    app.input({ seat: local.seat.id, kind: "key", code: 119, down: false, repeat: false, timeMilliseconds: performance.now() });
    const bodies = app.simulation.presentations()
      .filter(p => p.actor.equals(local.actor) && !p.viewWeapon)
      .map(p => ({ path: p.path, family: p.family, content: p.content }));
    return { bodies, runFrames: [...frames], characterViews: app.simulation.characterViews().length,
      health: app.simulation.playerUi(local.actor).health };
  } finally { try { await app?.close(); } finally { await rm(root, { recursive: true, force: true }); } }
}

test("classic native DLL draws the Quake 1 character with running animation", async () => {
  const lane = await runLane("q2-classic-baseq2", "gamex86.dll", "q1");
  expect(lane.bodies).toEqual([{ path: "progs/player.mdl", family: "q1", content: "q1:classic:id1:installed" }]);
  expect(lane.runFrames.length).toBeGreaterThan(2);
  expect(lane.health).toBeGreaterThan(0);
}, 240_000);

test("rerelease native DLL draws the Quake 1 character", async () => {
  const lane = await runLane("q2-rerelease-baseq2", "game_x64.dll", "q1");
  expect(lane.bodies).toEqual([{ path: "progs/player.mdl", family: "q1", content: "q1:classic:id1:installed" }]);
  expect(lane.runFrames.length).toBeGreaterThan(2);
  expect(lane.health).toBeGreaterThan(0);
}, 240_000);

test("foreign movement and character survive a save and load on a native DLL world", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-native-foreign-restore-"));
  let app: Application | null = null;
  try {
    const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--q2-game", "gamex86.dll",
      "--movement", "q1", "--character", "q1", "--renderer", "cpu", "--hidden",
      "--width", "320", "--height", "240", "--user-content-root", root]);
    if (parsed.kind !== "run") throw new Error("Missing launch options");
    app = await Application.open(parsed.options, { saveDirectory: join(root, "saves"), print: () => undefined });
    const first = app.localPlayers[0]; if (first === undefined) throw new Error("Missing local player");
    let local: Exclude<typeof first, undefined> = first;
    const bodies = (): string[] => app?.simulation.presentations().filter(p => p.actor.equals(local.actor) && !p.viewWeapon).map(p => p.path) ?? [];
    for (let i = 0; i < 20; i++) await app.step(50);
    expect(bodies()).toEqual(["progs/player.mdl"]);
    const save = join(root, "saves", "slot.sav");
    await app.saveGame(save);
    await app.loadGame(save);
    const restored = app.localPlayers[0]; if (restored !== undefined) local = restored;
    for (let i = 0; i < 10; i++) await app.step(50);
    // Neither selection silently falls back to the guest's own choices.
    expect(bodies()).toEqual(["progs/player.mdl"]);
    expect(app.simulation.recipe.movement.provider).toBe("q1:movement");
    const start = app.simulation.playerView(local.actor).origin;
    app.input({ seat: local.seat.id, kind: "key", code: 119, down: true, repeat: false, timeMilliseconds: performance.now() });
    let peak = 0; let previous = start;
    for (let i = 0; i < 60; i++) {
      await app.step(50);
      const now = app.simulation.playerView(local.actor).origin;
      peak = Math.max(peak, Math.hypot(now.x - previous.x, now.y - previous.y) / 0.05); previous = now;
    }
    app.input({ seat: local.seat.id, kind: "key", code: 119, down: false, repeat: false, timeMilliseconds: performance.now() });
    const end = app.simulation.playerView(local.actor).origin;
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeGreaterThan(300);
    expect(peak).toBeGreaterThan(200);
    expect(peak).toBeLessThan(360);
    expect(app.simulation.playerUi(local.actor).health).toBeGreaterThan(0);
  } finally { try { await app?.close(); } finally { await rm(root, { recursive: true, force: true }); } }
}, 240_000);

test("classic native DLL draws the Quake III character through character views", async () => {
  const lane = await runLane("q2-classic-baseq2", "gamex86.dll", "q3");
  // The guest MD2 body is suppressed; the Q3 character renderer owns the body.
  expect(lane.bodies).toEqual([]);
  expect(lane.characterViews).toBe(1);
  expect(lane.runFrames.length).toBeGreaterThan(1);
  expect(lane.health).toBeGreaterThan(0);
}, 240_000);
