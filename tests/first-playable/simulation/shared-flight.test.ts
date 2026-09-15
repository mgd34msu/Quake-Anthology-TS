import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { applicationPreset, loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ProviderId } from "../../../src/contracts/identity.ts";
import type { MovementProfile } from "../../../src/contracts/movement.ts";
import type { UserCommand } from "../../../src/contracts/protocol.ts";
import { decodeSaveImage, encodeSaveImage } from "../../../src/persistence/index.ts";
import { playerMovementEnvironment, playerPostures } from "../../../src/app/bootstrap/simulation/player-movement.ts";
import { captureMovementPlayer, readMovementPlayer } from "../../../src/app/bootstrap/simulation/player-checkpoint.ts";
import { SaveReader } from "../../../src/persistence/value.ts";
import { nativeProviderTiming } from "../../../src/content/catalog/timing.ts";
import type { ProviderTiming } from "../../../src/contracts/content.ts";
import { CommandBuffer } from "../../../src/core/commands/index.ts";
import { registerQ1ClientCommands } from "../../../src/app/bootstrap/q1-client-commands.ts";

const corpus = resolve(import.meta.dir, "../../../../qfiles");
const movements: readonly { readonly catalog: string; readonly provider: ProviderId }[] = [
  { catalog: "q1-classic-id1", provider: "q1:movement" }, { catalog: "q1-quakeworld", provider: "q1:movement" },
  { catalog: "q2-classic-baseq2", provider: "q2:movement" }, { catalog: "q2-rerelease-baseq2", provider: "q2:movement" },
  { catalog: "q3-baseq3", provider: "q3:movement" },
];
function command(kind: MovementProfile["kind"], time: number, up: number): UserCommand {
  const axes = { x: 0, y: 0, z: 0 };
  switch (kind) {
    case "q1-netquake": return { kind, acknowledgedServerTimeSeconds: time / 1000, viewAngles: axes, forwardMove: 0, sideMove: 0, upMove: up, buttons: 0, impulse: 0 };
    case "q1-quakeworld": return { kind, milliseconds: 100, angles: axes, forwardMove: 0, sideMove: 0, upMove: up, buttons: 0, impulse: 0 };
    case "q2-classic": return { kind, milliseconds: 100, angleShorts: [0, 0, 0], forwardMove: 0, sideMove: 0, upMove: up, buttons: 0, impulse: 0, lightLevel: 128 };
    case "q2-rerelease": return { kind, milliseconds: 100, angles: axes, forwardMove: 0, sideMove: 0, buttons: up > 0 ? 8 : up < 0 ? 16 : 0, serverFrame: time / 100 };
    case "q3": return { kind, serverTimeMilliseconds: time, angleWords: [0, 0, 0], forwardMove: 0, rightMove: 0, upMove: Math.sign(up) * 127, buttons: 0, weapon: 0 };
  }
}
for (const movement of movements) test(`Q1 fly command preserves ${movement.catalog} collision movement and survives a fresh save`, async () => {
  const family = movement.provider.startsWith("q2:") ? "q2" : movement.provider.startsWith("q3:") ? "q3" : "q1";
  const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q1-classic-id1", "--map", "e1m1", "--movement", family, "--character", "q3", "--mode", "singleplayer"]);
  if (launch.kind !== "run") throw new Error("Expected Q1 launch");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), base = applicationPreset(catalog, launch.options);
  const product = catalog.require(movement.catalog), selectedMovement = { provider: movement.provider, content: product.id };
  const sourceTiming = nativeProviderTiming(selectedMovement, product.expectation.family, product.expectation.edition === "rerelease");
  const movementTiming: ProviderTiming = movement.catalog === "q1-quakeworld" ? { ...sourceTiming, clock: { kind: "q1-quakeworld", maximumCommandMilliseconds: 255 } } : sourceTiming;
  const preset = { ...base, timing: base.timing.map(timing => timing.provider === movement.provider ? movementTiming : timing) };
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), movement: { kind: "selected", value: { provider: movement.provider, content: catalog.require(movement.catalog).id } } } });
  const content = await loadApplicationContent(launch.options, recipe), identity = createIdentityOwner(`shared-flight-${movement.catalog}`), client = identity.client(0, 0);
  const options = { identity, recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "singleplayer", seed: 1, maxClients: 1 } satisfies Parameters<typeof createSimulation>[0];
  const simulation = createSimulation(options);
  try {
    const actor = simulation.admitPlayer(client).actor, player = simulation.movementPlayer(actor);
    if (player === null) throw new Error("Missing flight player");
    let sequence = 0;
    const step = (up: number) => { sequence++; simulation.step({ elapsedMilliseconds: 100, commands: [{ actor, sequence, source: { kind: "remote-client", client }, command: command(player.profile.kind, sequence * 100, up) }] }); };
    for (let index = 0; index < 5; index++) step(0);
    const origin = simulation.bodies.read(actor)?.origin;
    if (origin === undefined) throw new Error("Missing player body");
    simulation.playerCommand(actor, "fly", []);
    expect(player.flight).toBe(true);
    for (let index = 0; index < 5; index++) step(320);
    const raised = simulation.bodies.read(actor)?.origin;
    if (raised === undefined) throw new Error("Missing flying body");
    expect(raised.z).toBeGreaterThan(origin.z);
    expect(player.bounds).toEqual(player.standingBounds);
    const saved = decodeSaveImage(encodeSaveImage(simulation.checkpoint()));
    const restored = createSimulation({ ...options, restore: saved, restoredClients: [client] });
    try {
      const restoredActor = restored.players()[0], restoredPlayer = restoredActor === undefined ? null : restored.movementPlayer(restoredActor);
      if (restoredActor === undefined || restoredPlayer === null) throw new Error("Missing restored flyer");
      expect(restoredPlayer.flight).toBe(true);
      expect(restoredPlayer.profile.kind).toBe(player.profile.kind);
      const combat = { health: 100, invulnerable: false }, powerup = { health: 100, flight: true, haste: false, invulnerable: false, gravityMultiplier: 1 };
      restored.playerCommand(restoredActor, "fly", []);
      expect(restoredPlayer.flight).toBe(false);
      expect(playerMovementEnvironment({ ...restoredPlayer, sourceEnvironment: powerup }, combat).flight).toBe(true);
      restored.playerCommand(restoredActor, "fly", []);
      expect(playerMovementEnvironment({ ...restoredPlayer, sourceEnvironment: { ...powerup, flight: false } }, combat).flight).toBe(true);
      restored.playerCommand(restoredActor, "noclip", []);
      expect(restoredPlayer.flight).toBe(false);
    } finally { restored.close(); }
    const { flight: _flight, ...older } = captureMovementPlayer(player);
    expect(readMovementPlayer(new SaveReader(older), reference => simulation.actors.referenceSaved(reference)).flight).toBe(false);
    for (let index = 0; index < 5; index++) step(-320);
    expect(simulation.bodies.read(actor)?.origin.z).toBeLessThan(raised.z);
    expect(player.bounds).toEqual(player.profile.kind === "q3" ? playerPostures(player).crouched.bounds : player.standingBounds);
    simulation.playerCommand(actor, "fly", []);
    expect(player.flight).toBe(false);
    const hovering = simulation.bodies.read(actor);
    if (hovering === null) throw new Error("Missing walking body");
    simulation.bodies.write(player.actor, { ...hovering, origin: { ...hovering.origin, z: hovering.origin.z + 32 }, velocity: { x: 0, y: 0, z: 0 }, ground: null });
    step(0);
    expect(simulation.bodies.read(actor)?.velocity.z).toBeLessThan(0);
    simulation.playerCommand(actor, "fly", []);
    const source = simulation.q1Source(), world = source?.game.world;
    if (source === null || world === undefined || world === null) throw new Error("Missing source world");
    source.game.damage(actor, world.actor.id, world.actor.id, 10000);
    expect(player.flight).toBe(false);
  } finally { simulation.close(); await content.close(); }
}, 20000);

for (const family of ["q2", "q3"] satisfies readonly ("q2" | "q3")[]) test(`${family} registered fly obeys source gates and moves with collision`, async () => {
  const launch = parseApplicationCommand(["--content-root", corpus, "--game", family === "q2" ? "q2-classic-baseq2" : "q3-baseq3", "--map", family === "q2" ? "base1" : "q3dm1", "--movement", family, "--character", family, "--mode", "deathmatch"]);
  if (launch.kind !== "run") throw new Error("Missing source flight launch");
  const content = await loadApplicationContent(launch.options), identity = createIdentityOwner(`source-flight-${family}`), client = identity.client(0, 0);
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "deathmatch", seed: 1, maxClients: 1 });
  try {
    const actor = simulation.admitPlayer(client).actor, player = simulation.movementPlayer(actor);
    if (player === null) throw new Error("Missing source player");
    const dialect = family === "q2" ? "q2-classic" : "q3", commands = new CommandBuffer({ dialect, context: { session: identity.session, origin: { kind: "remote-client", client } } });
    registerQ1ClientCommands(commands, dialect, (name, args) => simulation.playerCommand(actor, name, args));
    const run = (name: string) => { commands.append(`${name}\n`); commands.execute(); };
    run("fly"); expect(player.flight).toBe(false);
    const cvars = simulation.q2ServerCvars() ?? simulation.q3Source()?.host.cvars;
    if (cvars == null) throw new Error("Missing source cheat authority");
    cvars.set(family === "q2" ? "cheats" : "sv_cheats", "1", true);
    simulation.step({ elapsedMilliseconds: 100, commands: [] });
    const q3 = simulation.q3Source();
    if (q3 !== null) {
      simulation.drainPresentationEvents();
      q3.level.intermissionTime = 1;
      run("fly");
      expect(player.flight).toBe(false);
      const feedback = simulation.drainPresentationEvents().flatMap(event => event.kind === "q3-source" && event.event.kind === "server-command" ? [event.event.text] : []);
      expect(feedback.some(text => text.startsWith("chat ") && text.includes("fly"))).toBe(true);
      expect(feedback.some(text => text.includes("fly ON"))).toBe(false);
      q3.level.intermissionTime = 0;
    }
    run("noclip"); run("fly"); expect(player.flight).toBe(true);
    const start = simulation.bodies.read(actor)?.origin;
    if (start === undefined) throw new Error("Missing flight origin");
    for (let sequence = 1; sequence <= 5; sequence++) simulation.step({ elapsedMilliseconds: 100, commands: [{ actor, sequence, source: { kind: "remote-client", client }, command: command(player.profile.kind, (sequence + 1) * 100, 320) }] });
    expect(simulation.bodies.read(actor)?.origin.z).toBeGreaterThan(start.z);
    const state = player.readState();
    expect(state.kind === "q3" ? state.movementType : state.kind === "q2-classic" ? state.type : -1).toBe(0);
    run("noclip"); expect(player.flight).toBe(false);
  } finally { simulation.close(); await content.close(); }
}, 20000);
