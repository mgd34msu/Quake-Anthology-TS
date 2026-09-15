import { expect, test } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { decodeSaveImage, encodeSaveImage } from "../../../src/persistence/index.ts";
import type { UserCommand } from "../../../src/contracts/protocol.ts";
import { cameraWithCharacterDeath } from "../../../src/app/bootstrap/presentation.ts";
import { anglesToAxis } from "../../../src/core/math.ts";
import { perspectiveProjection } from "../../../src/render/scene/view.ts";
import type { SceneCamera } from "../../../src/contracts/render.ts";

function idleCommand(kind: UserCommand["kind"], time: number): UserCommand {
  const angles = { x: 0, y: 90, z: 0 };
  switch (kind) {
    case "q1-netquake": return { kind, acknowledgedServerTimeSeconds: time / 1000, viewAngles: angles, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 };
    case "q1-quakeworld": return { kind, milliseconds: 100, angles, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 };
    case "q2-classic": return { kind, milliseconds: 100, angleShorts: [0, 16384, 0], forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0, lightLevel: 0 };
    case "q2-rerelease": return { kind, milliseconds: 100, angles, forwardMove: 0, sideMove: 0, buttons: 0, serverFrame: Math.round(time / 100) };
    case "q3": return { kind, serverTimeMilliseconds: time, angleWords: [0, 16384, 0], forwardMove: 0, rightMove: 0, upMove: 0, buttons: 0, weapon: 0 };
  }
}

for (const movement of ["q1", "q2", "q3"]) for (const character of ["q1", "q2", "q3"]) {
  for (const health of [-17, -40, -41]) test(`Q2 map ${movement} movement ${character} character presents death at ${health}`, async () => {
    const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", movement, "--character", character, "--dedicated"]);
    if (parsed.kind !== "run") throw new Error("Missing launch");
    const content = await loadApplicationContent(parsed.options), identity = createIdentityOwner(`corpse-${movement}-${character}-${health}`);
    const options = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts, mode: "singleplayer", skill: 1, seed: 17, maxClients: 1 } satisfies Parameters<typeof createSimulation>[0];
    const simulation = createSimulation(options);
    try {
      const client = identity.client(0, 0), actor = simulation.admitPlayer(client).actor;
      for (let frame = 0; frame < 5; frame++) simulation.step({ elapsedMilliseconds: 100, commands: [] });
      const source = simulation.q2Source(), player = simulation.movementPlayer(actor), body = simulation.bodies.read(actor);
      if (source === null || player === null || body === null) throw new Error("Missing source player");
      simulation.combat.setHealth(player.actor, 100); simulation.combat.setArmor(player.actor, { kind: "none" });
      const alive = simulation.playerView(actor);
      expect(alive.angles.z).not.toBe(character === "q1" ? 80 : 40);
      source.game.damage(actor, actor, actor, 100 - health, 0, { x: 0, y: 0, z: 0 }, body.origin, { x: 0, y: 0, z: 0 }, 0);
      expect(simulation.playerUi(actor).health).toBe(health);
      for (let frame = 0; frame < 20; frame++) simulation.step({ elapsedMilliseconds: 100, commands: [{ actor, source: { kind: "remote-client", client }, sequence: frame,
        command: { ...idleCommand(player.profile.kind, Math.round(simulation.timeSeconds * 1000) + 100), buttons: character === "q2" && frame === 0 ? 1 : 0 } }] });
      const view = simulation.playerView(actor), gibbed = character === "q3" ? health <= -40 : health < -40;
      expect(view.viewHeight).toBeLessThan(alive.viewHeight);
      expect(view.angles.z).toBe(character === "q1" ? 80 : 40);
      if (character === "q1") {
        const corpse = simulation.presentations().find(model => model.actor.equals(actor) && !model.viewWeapon);
        expect(corpse?.path).toBe(gibbed ? "progs/h_player.mdl" : "progs/player.mdl");
        expect(view.viewHeight).toBe(gibbed ? 8 : -8);
        if (!gibbed) expect(corpse?.frame).toBeGreaterThanOrEqual(41);
        expect(simulation.presentations().filter(model => /^progs\/gib[123]\.mdl$/.test(model.path))).toHaveLength(gibbed ? 3 : 0);
      } else if (character === "q2") {
        const state = source.players.states.get(actor), entity = source.game.entity(actor);
        expect(state?.dead).toBe(true); expect(state?.gibbed).toBe(gibbed);
        expect(view.viewHeight).toBe(gibbed ? 8 : -2);
        const movementState = player.readState();
        if (movementState.kind === "q2-classic") expect(movementState.type).toBe(gibbed ? 3 : 2);
        const corpse = simulation.presentations().find(model => model.actor.equals(actor) && !model.viewWeapon);
        expect(corpse?.frame).toBe(entity?.frame);
        if (!gibbed) expect(corpse?.frame).toBeGreaterThanOrEqual(177);
        else expect(corpse?.path).toMatch(/models\/objects\/gibs\/(head2|skull)\/tris.md2/);
      } else {
        const pose = simulation.characterViews().find(model => model.actor.equals(actor));
        expect(pose).toBeDefined();
        expect((pose?.sourceFlags ?? 0) & 1).toBe(1);
        expect(((pose?.sourceFlags ?? 0) & 128) !== 0).toBe(gibbed);
        expect(player.animation.state.kind).toBe("q3");
        if (player.animation.state.kind === "q3" && !gibbed) expect(player.animation.state.legs & 127).toBeLessThan(6);
      }
      if (movement === "q1" && character === "q1") {
        const restored = createSimulation({ ...options, restore: decodeSaveImage(encodeSaveImage(simulation.checkpoint())), restoredClients: [client] });
        try {
          const restoredActor = restored.players()[0]; if (restoredActor === undefined) throw new Error("Missing restored corpse");
          expect(restored.playerView(restoredActor)).toEqual(view);
          restored.step({ elapsedMilliseconds: 100, commands: [] });
          expect(restored.playerUi(restoredActor).health).toBe(health);
        } finally { restored.close(); }
      }
    } finally { simulation.close(); await content.close(); }
  }, 30000);
}

for (const [game, map] of [["q1-classic-id1", "e1m1"], ["q3-baseq3", "q3dm1"]]) for (const character of ["q1", "q2", "q3"]) {
  test(`${game} map runs ${character} death lifecycle with Q1 movement`, async () => {
    if (game === undefined || map === undefined) throw new Error("Missing source map");
    const parsed = parseApplicationCommand(["--game", game, "--map", map, "--movement", "q1", "--character", character, "--dedicated"]);
    if (parsed.kind !== "run") throw new Error("Missing launch");
    const content = await loadApplicationContent(parsed.options), identity = createIdentityOwner(`death-world-${game}-${character}`);
    const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts, mode: "singleplayer", skill: 1, seed: 17, maxClients: 1 });
    try {
      const client = identity.client(0, 0), actor = simulation.admitPlayer(client).actor, player = simulation.movementPlayer(actor);
      if (player === null) throw new Error("Missing player");
      simulation.combat.setHealth(player.actor, 100); simulation.combat.setArmor(player.actor, { kind: "none" }); simulation.combat.setTraits(player.actor, { invulnerable: false });
      const origin = simulation.playerView(actor).origin;
      simulation.combat.apply({ target: actor, amount: 117, knockback: 0, direction: { x: 0, y: 0, z: 0 }, point: origin, normal: { x: 0, y: 0, z: 0 }, delivery: "direct",
        attack: { sequence: 0, time: { kind: "seconds", value: simulation.timeSeconds }, attacker: null, inflictor: null, weapon: null,
          weaponProvider: content.recipe.weapons[0]?.provider ?? content.recipe.combat.provider, combatProvider: content.recipe.combat.provider,
          inventoryProvider: content.recipe.inventory.provider, movementProvider: content.recipe.movement.provider, cause: { kind: "q2", meansOfDeath: 0, damageFlags: 0 } } });
      expect(simulation.playerUi(actor).health).toBe(-17);
      for (let frame = 0; frame < 20; frame++) simulation.step({ elapsedMilliseconds: 100, commands: [{ actor, source: { kind: "remote-client", client }, sequence: frame,
        command: { ...idleCommand(player.profile.kind, Math.round(simulation.timeSeconds * 1000) + 100), buttons: character === "q2" && frame === 0 ? 1 : 0 } }] });
      const view = simulation.playerView(actor);
      expect(view.viewHeight).toBe(character === "q1" ? -8 : character === "q2" ? -2 : -16);
      expect(view.angles.z).toBe(character === "q1" ? 80 : 40);
      const nativeCamera: SceneCamera = { origin: { x: 100, y: 200, z: 300 }, axis: anglesToAxis({ x: -15, y: 30, z: 40 }),
        viewport: { x: 0, y: 0, width: 320, height: 240 }, projection: perspectiveProjection(90, 74, 16384), clip: { kind: "none" } };
      const camera = cameraWithCharacterDeath(nativeCamera, view);
      if (game === "q3-baseq3" && character !== "q3") {
        expect(view.foreignCharacterDeath).toBe(true);
        expect(camera.origin).toEqual({ ...view.origin, z: view.origin.z + view.viewHeight });
        expect(camera.axis).toEqual(anglesToAxis(view.angles));
      } else expect(camera).toBe(nativeCamera);
      expect(simulation.playerUi(actor).health).toBe(-17);
      if (character === "q1") expect(simulation.presentations().find(model => model.actor.equals(actor) && !model.viewWeapon)?.frame).toBeGreaterThanOrEqual(41);
      if (character === "q3") expect((simulation.characterViews().find(model => model.actor.equals(actor))?.sourceFlags ?? 0) & 1).toBe(1);
    } finally { simulation.close(); await content.close(); }
  }, 30000);
}

for (const character of ["q1", "q2", "q3"]) test(`Q2 coop ${character} character still respawns with standing camera`, async () => {
  const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q1", "--character", character, "--dedicated"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const content = await loadApplicationContent(parsed.options), identity = createIdentityOwner(`corpse-coop-${character}`);
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts, mode: "coop", skill: 1, seed: 17, maxClients: 1 });
  try {
    const client = identity.client(0, 0), actor = simulation.admitPlayer(client).actor, player = simulation.movementPlayer(actor), source = simulation.q2Source();
    if (player === null || source === null) throw new Error("Missing player");
    simulation.combat.setHealth(player.actor, 100); simulation.combat.setArmor(player.actor, { kind: "none" });
    source.game.damage(actor, actor, actor, 117, 0, { x: 0, y: 0, z: 0 }, simulation.playerView(actor).origin, { x: 0, y: 0, z: 0 }, 0);
    expect(simulation.playerUi(actor).health).toBe(-17);
    for (let frame = 0; frame < 25; frame++) simulation.step({ elapsedMilliseconds: 100, commands: [{ actor, source: { kind: "remote-client", client }, sequence: frame,
      command: { ...idleCommand(player.profile.kind, Math.round(simulation.timeSeconds * 1000) + 100), buttons: frame >= 22 ? 1 : 0 } }] });
    expect(simulation.playerUi(actor).health).toBeGreaterThan(0);
    expect(simulation.playerView(actor).viewHeight).toBe(character === "q3" ? 26 : 22);
    expect(simulation.playerView(actor).angles.z).not.toBe(character === "q1" ? 80 : 40);
  } finally { simulation.close(); await content.close(); }
}, 30000);

for (const game of ["q1-classic-id1", "q1-quakeworld"]) for (const health of [-17, -41]) test(`${game} actual QuakeC death projects source eye at ${health}`, async () => {
  const parsed = parseApplicationCommand(["--game", game, "--map", "e1m1", "--movement", "q1", "--character", "q1", "--mode", "deathmatch", "--dedicated",
    ...(game === "q1-classic-id1" ? ["--progs", "progs.dat"] : [])]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const content = await loadApplicationContent(parsed.options), identity = createIdentityOwner(`qc-death-${game}-${health}`);
  if (content.preparedQuakeC === null) throw new Error("Missing source QC program");
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts, preparedQuakeC: content.preparedQuakeC,
    dedicated: true, mode: "deathmatch", skill: 1, seed: 17, maxClients: 8 });
  try {
    const source = simulation.quakecSource(); if (source === null) throw new Error("Missing source QC runtime");
    const client = identity.client(0, 0); if (source.kind === "quakeworld") source.prepareClientSpawn(client);
    const actor = simulation.admitPlayer(client).actor, slot = source.sourceSlot(actor);
    if (slot === null) throw new Error("Missing source slot");
    const words = source.entities.at(slot), field = (name: string): number => {
      const definition = source.prepared.program.fieldsByName.get(name); if (definition === undefined) throw new Error(`Missing source field ${name}`); return definition.offset;
    };
    words.setFloat(field("health"), 100); words.setFloat(field("armorvalue"), 0); words.setFloat(field("armortype"), 0);
    expect(simulation.playerView(actor).viewHeight).toBe(22);
    const machine = source.machine;
    machine.globals.setInt(4, source.entities.reference(slot)); machine.globals.setInt(7, source.entities.reference(0)); machine.globals.setInt(10, source.entities.reference(0));
    machine.globals.setFloat(13, 100 - health); machine.execute(source.prepared.program.functionNamed("T_Damage").index, 4);
    expect(simulation.playerUi(actor).health).toBe(health);
    expect(words.float(field("deadflag"))).toBeGreaterThan(0);
    const view = simulation.playerView(actor);
    expect(view.viewHeight).toBe(health < -40 ? 8 : game === "q1-quakeworld" ? -16 : -8);
    expect(view.angles.z).toBe(80);
    expect(machine.strings.get(words.int(field("model")))).toBe(health < -40 ? "progs/h_player.mdl" : "progs/player.mdl");
  } finally { simulation.close(); await content.close(); }
}, 30000);

test("Q2 source respawn resets Q3 movement pitch-clamp delta with its absolute view reset", async () => {
  const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q3", "--character", "q2", "--dedicated"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const content = await loadApplicationContent(parsed.options), identity = createIdentityOwner("q2-q3-respawn-angle");
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts, mode: "coop", skill: 1, seed: 17, maxClients: 1 });
  try {
    const client = identity.client(0, 0), actor = simulation.admitPlayer(client).actor, player = simulation.movementPlayer(actor), source = simulation.q2Source();
    if (player === null || source === null) throw new Error("Missing actual Q2 source player");
    let sequence = 0;
    const step = (pitch: number, yaw: number, attack: boolean): void => {
      simulation.step({ elapsedMilliseconds: 100, commands: [{ actor, source: { kind: "local-seat", client, seat: identity.seat(0) }, sequence: sequence++,
        command: { kind: "q3", serverTimeMilliseconds: Math.round(simulation.timeSeconds * 1000) + 100,
          angleWords: [pitch, yaw, 0], forwardMove: 0, rightMove: 0, upMove: 0, buttons: attack ? 1 : 0, weapon: 0 } }] });
    };
    step(30000, 12345, false);
    const clamped = player.readState(); if (clamped.kind !== "q3") throw new Error("Missing selected Q3 state");
    expect(clamped.deltaAngleWords[0]).not.toBe(0);
    simulation.combat.setHealth(player.actor, 100); simulation.combat.setArmor(player.actor, { kind: "none" });
    source.game.damage(actor, actor, actor, 117, 0, { x: 0, y: 0, z: 0 }, simulation.playerView(actor).origin, { x: 0, y: 0, z: 0 }, 0);
    expect(simulation.playerUi(actor).health).toBeLessThan(0);
    for (let frame = 0; frame < 30 && simulation.playerUi(actor).health <= 0; frame++) step(30000, 12345, frame >= 22);
    expect(simulation.playerUi(actor).health).toBeGreaterThan(0);
    const respawned = player.readState(); if (respawned.kind !== "q3") throw new Error("Missing respawned Q3 state");
    expect(respawned.deltaAngleWords).toEqual([0, 0, 0]);
    const desired = simulation.playerView(actor).angles;
    step(Math.trunc(desired.x * 65536 / 360) & 65535, Math.trunc(desired.y * 65536 / 360) & 65535, false);
    const viewed = simulation.playerView(actor).angles;
    expect(Math.abs(((viewed.x - desired.x + 540) % 360) - 180)).toBeLessThan(0.02);
    expect(Math.abs(((viewed.y - desired.y + 540) % 360) - 180)).toBeLessThan(0.02);
  } finally { simulation.close(); await content.close(); }
}, 30000);
