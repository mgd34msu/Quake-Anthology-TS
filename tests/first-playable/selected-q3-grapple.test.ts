import { expect, test } from "bun:test";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../src/content/catalog/index.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { applicationPreset, loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { createSimulation } from "../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { ActorId } from "../../src/contracts/identity.ts";
import type { UserCommand } from "../../src/contracts/protocol.ts";
import type { Vec3 } from "../../src/contracts/math.ts";
import { decodeSaveImage, encodeSaveImage } from "../../src/persistence/index.ts";
import { qvmAngleVectors } from "../../src/core/qvm-math.ts";
import { add3, scale3 } from "../../src/core/math.ts";

function command(kind: UserCommand["kind"], time: number, buttons: number, angles: Vec3): UserCommand {
  const words: readonly [number, number, number] = [Math.trunc(angles.x * 65536 / 360), Math.trunc(angles.y * 65536 / 360), 0];
  switch (kind) {
    case "q1-netquake": return { kind, acknowledgedServerTimeSeconds: time / 1000, viewAngles: angles, forwardMove: 0, sideMove: 0, upMove: 0, buttons, impulse: 0 };
    case "q1-quakeworld": return { kind, milliseconds: 25, angles, forwardMove: 0, sideMove: 0, upMove: 0, buttons, impulse: 0 };
    case "q2-classic": return { kind, milliseconds: 25, angleShorts: words, forwardMove: 0, sideMove: 0, upMove: 0, buttons, impulse: 0, lightLevel: 0 };
    case "q2-rerelease": return { kind, milliseconds: 25, angles, forwardMove: 0, sideMove: 0, buttons, serverFrame: Math.trunc(time / 25) };
    case "q3": return { kind, serverTimeMilliseconds: time, angleWords: words, forwardMove: 0, rightMove: 0, upMove: 0, buttons, weapon: 10 };
  }
}

for (const movement of ["q1", "qw", "q2", "q2-rerelease-baseq2", "q3"]) test(`stock Q3 grapple attaches and pulls with ${movement} movement in a foreign world`, async () => {
  const parsed = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "start", "--movement", movement, "--character", "q2", "--dedicated"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false });
  const preset = applicationPreset(catalog, parsed.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: {
    kind: "selected", value: [{ provider: "q3:official", content: catalog.require("q3-baseq3").id }] } } });
  const content = await loadApplicationContent(parsed.options, recipe), identity = createIdentityOwner(`stock-grapple-${movement}`);
  const options = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "singleplayer", seed: 1, maxClients: 1 } satisfies Parameters<typeof createSimulation>[0];
  let simulation = createSimulation(options);
  try {
    const client = identity.client(0, 0), seat = identity.seat(0);
    let actor = simulation.admitPlayer(client).actor;
    const player = simulation.movementPlayer(actor); if (player === null) throw new Error("Missing player");
    const kind = player.profile.kind;
    simulation.inventory.configure(player.actor, { item: "q3:weapon/grapple", count: 1, capacity: 1 });
    expect(simulation.requestWeapon(actor, { provider: player.arsenal.provider, item: "q3:weapon/grapple" })).toBe(true);
    let sequence = 0, hook: ActorId | null = null, attached = false, cable = false, launches = 0;
    let aim: Vec3 = { x: 0, y: 90, z: 0 };
    const step = (buttons: number) => {
      simulation.step({ elapsedMilliseconds: 25, commands: [{ actor, source: { kind: "local-seat", client, seat }, sequence: sequence++,
        command: command(kind, Math.round(simulation.timeSeconds * 1000) + 25, buttons, aim) }] });
      for (const source of simulation.drainPresentationEvents()) if (source.kind === "q3-ballistics" && source.event.weapon === 10) {
        const event = source.event;
        if (event.kind === "fire") launches++;
        if (event.kind === "projectile") hook = event.actor;
        if (event.kind === "impact") attached = true;
        if (event.kind === "trail" && Math.hypot(event.end.x - event.origin.x, event.end.y - event.origin.y, event.end.z - event.origin.z) >= 64) cable = true;
      }
    };
    for (let frame = 0; frame < 24; frame++) step(0);
    const view = simulation.playerView(actor), before = view.origin, eye = { ...before, z: before.z + view.viewHeight };
    const numeric = content.recipe.timing.find(profile => profile.provider === "q3:official")?.numeric;
    if (numeric === undefined) throw new Error("Missing Q3 arithmetic profile");
    const candidate = [-30, 0, 30].flatMap(x => [0, 90, 180, 270].map(y => ({ x, y, z: 0 }))).find(angles => {
      const trace = simulation.scene.trace({ start: eye, end: add3(eye, scale3(qvmAngleVectors(angles).forward, 1024)),
        target: { kind: "world" }, shape: { kind: "point" }, passActor: actor, numeric,
        policy: { kind: "q3", contentsMask: 0x6000001, curves: true, playerCurveClip: true } });
      return trace.kind === "q3" && trace.fraction > 0.1 && trace.fraction < 0.8 && (trace.surfaceFlags & 16) === 0;
    });
    if (candidate === undefined) throw new Error("No reachable solid grapple surface");
    aim = candidate;
    for (let frame = 0; frame < 32 && !attached; frame++) step(1);
    expect(attached).toBe(true); expect(hook).not.toBeNull(); expect(cable).toBe(true);
    for (let frame = 0; frame < 6; frame++) step(1);
    const pulled = simulation.playerView(actor).origin;
    expect(Math.hypot(pulled.x - before.x, pulled.y - before.y, pulled.z - before.z)).toBeGreaterThan(10);
    expect(launches).toBe(1);
    if (movement === "q2") {
      const saved = decodeSaveImage(encodeSaveImage(simulation.checkpoint()));
      simulation.close(); simulation = createSimulation({ ...options, restore: saved, restoredClients: [client] });
      const restored = simulation.players()[0]; if (restored === undefined) throw new Error("Missing restored player");
      actor = restored;
      step(1); expect(launches).toBe(1);
      expect(simulation.actors.ownedBy("q3:official").some(entity => simulation.actors.observe(entity.id)?.definition === "q3:projectile")).toBe(true);
    }
    step(0);
    expect(simulation.actors.ownedBy("q3:official").filter(entity => simulation.actors.observe(entity.id)?.definition === "q3:projectile")).toHaveLength(0);
  } finally { simulation.close(); await content.close(); }
}, 30000);
