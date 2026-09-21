import { expect, test } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation, type SimulationOptions } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { UserCommand } from "../../../src/contracts/protocol.ts";
import { decodeSaveImage, encodeSaveImage } from "../../../src/persistence/index.ts";

for (const movement of ["q1", "q2"]) test(`MG1 shake cleanup writes source roll with ${movement} movement and continues after save`, async () => {
  const launch = parseApplicationCommand(["--game", "q1-rerelease-mg1", "--map", "start", "--movement", movement, "--character", "q3", "--dedicated"]);
  if (launch.kind !== "run") throw new Error("Missing launch");
  const content = await loadApplicationContent(launch.options), identity = createIdentityOwner(`roll-${movement}`);
  const options = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts, mode: "singleplayer", skill: 1, seed: 17, maxClients: 1 } satisfies SimulationOptions;
  let simulation = createSimulation(options);
  try {
    const client = identity.client(0, 0), actor = simulation.admitPlayer(client).actor;
    const source = simulation.q1Source(); if (source === null) throw new Error("Missing MG1 source");
    const input: UserCommand = movement === "q1" ? { kind: "q1-netquake", acknowledgedServerTimeSeconds: 0, viewAngles: { x: 17, y: 63, z: 11 },
      forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 }
      : { kind: "q2-classic", milliseconds: 100, angleShorts: [3095, 11468, 2002], forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0, lightLevel: 0 };
    simulation.step({ elapsedMilliseconds: 100, commands: [{ actor, source: { kind: "local-seat", client, seat: identity.seat(0) }, sequence: 0, angleSpace: "absolute", command: input }] });
    const before = simulation.playerView(actor).angles;
    expect(before.z).toBeGreaterThan(1);
    const shaker = source.game.create("trigger_screenshake", { properties: [{ key: "classname", value: "trigger_screenshake" },
      { key: "spawnflags", value: "1" }, { key: "dmg", value: "12" }, { key: "wait", value: "0.1" }] });
    source.game.spawnEntity(shaker); simulation.callbacks.use(shaker.actor, actor, actor);
    simulation.step({ elapsedMilliseconds: 100, commands: [] });
    const punch = simulation.playerView(actor).kickAngles;
    expect(Math.hypot(punch?.x ?? 0, punch?.y ?? 0, punch?.z ?? 0)).toBeGreaterThan(1);
    const pending = decodeSaveImage(encodeSaveImage(simulation.checkpoint()));
    simulation.close();
    const resumed = createIdentityOwner(`roll-restored-${movement}`), resumedClient = resumed.client(0, 1);
    simulation = createSimulation({ ...options, identity: resumed, restore: pending, restoredClients: [resumedClient] });
    const target = simulation.players()[0]; if (target === undefined) throw new Error("Missing restored actor");
    simulation.drainPresentationEvents();
    simulation.step({ elapsedMilliseconds: 100, commands: [] });
    const state = simulation.q1Source()?.game.player(target); if (state == null) throw new Error("Missing restored source player");
    expect(state.viewAngles.z).toBe(0);
    expect(simulation.playerView(target).angles).toEqual({ ...before, z: 0 });
    expect(Math.hypot(state.punchAngles.x, state.punchAngles.y, state.punchAngles.z)).toBeGreaterThan(0);
    expect(simulation.drainPresentationEvents().some(event => event.kind === "view-reset")).toBe(false);
    expect(simulation.modClients.command(resumedClient)?.input.command).toEqual(input);
    const cleaned = decodeSaveImage(encodeSaveImage(simulation.checkpoint()));
    simulation.close(); const again = createIdentityOwner(`roll-cleaned-${movement}`), nextClient = again.client(0, 2);
    simulation = createSimulation({ ...options, identity: again, restore: cleaned, restoredClients: [nextClient] });
    const next = simulation.players()[0]; if (next === undefined) throw new Error("Missing cleanup actor");
    expect(simulation.playerView(next).angles.z).toBe(0);
    simulation.step({ elapsedMilliseconds: 100, commands: [{ actor: next, source: { kind: "local-seat", client: nextClient, seat: again.seat(0) },
      sequence: 1, angleSpace: "absolute", command: input }] });
    expect(simulation.playerView(next).angles).toEqual(before);
  } finally { simulation.close(); await content.close(); }
}, 30000);

test("original QC view-roll write preserves punch, fixangle and accepted input", async () => {
  const launch = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "start", "--progs", "progs.dat", "--movement", "q2", "--character", "q1", "--dedicated"]);
  if (launch.kind !== "run") throw new Error("Missing launch");
  const content = await loadApplicationContent(launch.options), identity = createIdentityOwner("qc-roll");
  if (content.preparedQuakeC === null) throw new Error("Missing original QC");
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts, preparedQuakeC: content.preparedQuakeC,
    dedicated: true, mode: "singleplayer", skill: 1, seed: 17, maxClients: 1 });
  try {
    const actor = simulation.admitPlayer(identity.client(0, 0)).actor, source = simulation.quakecSource();
    if (source === null) throw new Error("Missing QC source");
    const words = source.entities.at(1), angle = source.machine.fieldOffset("v_angle"), fix = source.machine.fieldOffset("fixangle");
    const value = { x: 17, y: 63, z: 11 }, punch = { x: 3, y: 4, z: 2 };
    words.setVector(angle, value); words.setFloat(fix, 0); source.setClientPunchAngles(actor, punch);
    source.setClientViewRoll(actor, 0);
    expect(words.vector(angle)).toEqual({ ...value, z: 0 });
    expect(source.clientPunchAngles(actor)).toEqual(punch); expect(words.float(fix)).toBe(0);
    source.clientInput(actor, { kind: "q1-netquake", acknowledgedServerTimeSeconds: 0, viewAngles: value,
      forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 });
    expect(words.vector(angle)).toEqual(value);
    simulation.disconnectPlayer(actor);
    const replacement = simulation.admitPlayer(identity.client(0, 1)).actor;
    expect(replacement.equals(actor)).toBe(false);
    expect(() => source.setClientViewRoll(actor, 0)).toThrow("admitted client");
  } finally { simulation.close(); await content.close(); }
}, 30000);
