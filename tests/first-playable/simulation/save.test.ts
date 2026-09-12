import { test, expect } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation, savedSimulationSettings } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner, sameActor } from "../../../src/contracts/identity.ts";
import { encodeSaveImage, decodeSaveImage } from "../../../src/persistence/index.ts";

for (const [map, path, count] of [["e1m2", "progs/flame.mdl", 24], ["e2m1", "*4", 1]] satisfies readonly (readonly [string, string, number])[]) test(`authored Q1 static ${map} models retain order and raw pose through fresh save restore without live actors`, async () => {
  const command = parseApplicationCommand(["--game", "q1-classic-id1", "--map", map, "--movement", "q1", "--character", "q1", "--dedicated"]);
  if (command.kind !== "run") throw new Error("Expected native static fixture");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner("q1-static-save");
  const options = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: command.options.skill, mode: command.options.mode, seed: 1, maxClients: 1 };
  const original = createSimulation(options);
  try {
    const source = original.q1Source(); if (source === null) throw new Error("Missing Q1 source");
    const records = original.events.capture().persistent;
    const statics = records.filter(record => record.kind === "q1" && record.event.kind === "static-model");
    expect(statics).toHaveLength(count);
    expect(statics[0]?.event).toEqual({ kind: "static-model", path, frame: 0, colorMap: 0, skin: 0, origin: map === "e1m2" ? { x: 932, y: 640, z: 340 } : { x: 0, y: 0, z: 0 }, angles: { x: 0, y: 0, z: 0 } });
    expect([...source.game.entities.values()].some(entity => entity.classname.startsWith("light_torch") || entity.classname.startsWith("light_flame"))).toBe(false);
    expect(original.presentations().some(model => model.path === "progs/flame.mdl" || model.path === "progs/flame2.mdl")).toBe(false);
    expect([...source.game.entities.values()].some(entity => entity.classname === "func_illusionary")).toBe(false);
    const first = statics[0]; if (first === undefined) throw new Error("Missing authored static");
    if (map === "e1m2") expect(records.find(record => record.sequence === first.sequence - 1)?.event.kind).toBe("ambient");
    const origin = { x: 1.0625, y: 2.03125, z: 3.015625 }, angles = { x: 0, y: 31.875, z: 0 };
    source.game.host.emit({ kind: "static-model", path, frame: 1, colorMap: 7, skin: 0, origin, angles });
    origin.x = 999; angles.y = 999;
    const image = decodeSaveImage(encodeSaveImage(original.checkpoint()));
    const restored = createSimulation({ ...options, restore: image });
    try {
      expect(restored.events.capture().persistent).toEqual(original.events.capture().persistent);
      const last = restored.events.capture().persistent.at(-1);
      if (last?.kind !== "q1" || last.event.kind !== "static-model") throw new Error("Missing restored static");
      expect(last.event.origin.x).toBe(1.0625); expect(last.event.angles.y).toBe(31.875);
      expect(restored.drainPresentationEvents().filter(record => record.kind === "q1" && record.event.kind === "static-model")).toHaveLength(count + 1);
      expect(restored.drainPresentationEvents()).toEqual([]);
    } finally { restored.close(); }
  } finally { original.close(); await content.close(); }
}, 30000);

for (const preset of ["q2-q1-q3", "q1-q2"]) test(`fresh shared ${preset} restore continues the retail source world`, async () => {
  const command = parseApplicationCommand(["--preset", preset]);
  if (command.kind !== "run") throw new Error("Expected application launch");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner(`save-${preset}`), client = identity.client(0, 0);
  const options = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
    skill: command.options.skill, mode: command.options.mode, seed: command.options.seed, maxClients: 1 };
  const original = createSimulation(options);
  try {
    const admission = original.admitPlayer(client);
    for (let frame = 0; frame < 10; frame++) original.step({ elapsedMilliseconds: 100, commands: [] });
    const image = decodeSaveImage(encodeSaveImage(original.checkpoint()));
    expect(savedSimulationSettings(image).clientSlots).toEqual([0]);
    const restored = createSimulation({ ...options, restore: image, restoredClients: [client] });
    try {
      const actor = restored.players()[0]; if (actor === undefined) throw new Error("Saved player was not restored");
      expect(sameActor(actor, admission.actor)).toBe(false);
      expect(restored.playerView(actor)).toEqual(original.playerView(admission.actor));
      expect(restored.playerUi(actor)).toEqual(original.playerUi(admission.actor));
      expect(restored.random.checkpoint()).toEqual(original.random.checkpoint());
      const envelope = { min: { x: -Infinity, y: -Infinity, z: -Infinity }, max: { x: Infinity, y: Infinity, z: Infinity } };
      expect(restored.scene.spatial.query(envelope).map(value => value.body.actor.slot))
        .toEqual(original.scene.spatial.query(envelope).map(value => value.body.actor.slot));
      expect(restored.checkpoint().bodies.map(value => value.linkCount)).toEqual(image.bodies.map(value => value.linkCount));
      for (let frame = 0; frame < 10; frame++) {
        original.step({ elapsedMilliseconds: 100, commands: [] }); restored.step({ elapsedMilliseconds: 100, commands: [] });
      }
      const continuous = original.checkpoint(), resumed = restored.checkpoint();
      expect(resumed.frame).toEqual(continuous.frame);
      expect(resumed.bodies.map(value => ({ ...value.body, ground: value.body.ground?.slot ?? null })))
        .toEqual(continuous.bodies.map(value => ({ ...value.body, ground: value.body.ground?.slot ?? null })));
      expect(restored.random.checkpoint()).toEqual(original.random.checkpoint());
      expect(restored.playerUi(actor)).toEqual(original.playerUi(admission.actor));
      if (preset === "q1-q2") {
        const origin = { x: 500, y: -350, z: 140 }, angles = { x: 0, y: 90, z: 0 };
        restored.controlPlayer(actor, { kind: "cutscene", origin, angles, viewOffset: { x: 0, y: 0, z: 0 } });
        restored.step({ elapsedMilliseconds: 100, commands: [{ actor, sequence: 100, source: { kind: "bot", provider: content.recipe.map.entities.provider },
          command: { kind: "q2-classic", milliseconds: 100, angleShorts: [0, 0, 0], forwardMove: 300, sideMove: 0, upMove: 200, buttons: 1, impulse: 0, lightLevel: 0 } }] });
        expect(restored.playerView(actor)).toEqual({ origin, angles, viewHeight: 0 });
        expect(restored.scene.spatial.get(actor)).toBeNull();
        expect(restored.presentations().some(value => sameActor(value.actor, actor))).toBe(false);
      }
    } finally { restored.close(); }
  } finally { original.close(); await content.close(); }
});

test("rerelease save preserves host elapsed time independently of source scheduling", async () => {
  const command = parseApplicationCommand(["--game", "q2-rerelease-baseq2", "--map", "base1"]);
  if (command.kind !== "run") throw new Error("Expected application launch");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner("save-rerelease-clock"), client = identity.client(0, 0);
  const options = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
    skill: command.options.skill, mode: command.options.mode, seed: command.options.seed, maxClients: 1 };
  const runtimeOptions = { ...options, playerIdentity: () => ({ seat: client.slot, socialId: "" }) };
  const original = createSimulation(runtimeOptions);
  try {
    original.admitPlayer(client);
    for (let frame = 0; frame < 10; frame++) original.step({ elapsedMilliseconds: 50, commands: [] });
    const image = decodeSaveImage(encodeSaveImage(original.checkpoint()));
    expect(image.frame.time).toEqual({ kind: "milliseconds", value: 250 });
    expect(savedSimulationSettings(image).hostMilliseconds).toBe(500);
    const restored = createSimulation({ ...runtimeOptions, restore: image, restoredClients: [client] });
    try {
      expect(savedSimulationSettings(restored.checkpoint()).hostMilliseconds).toBe(500);
      let hostMilliseconds = 500;
      for (const elapsedMilliseconds of [1, 1, 23, 50]) {
        hostMilliseconds += elapsedMilliseconds;
        original.step({ elapsedMilliseconds, commands: [] });
        restored.step({ elapsedMilliseconds, commands: [] });
        const continuous = original.checkpoint(), resumed = restored.checkpoint();
        expect(resumed.frame).toEqual(continuous.frame);
        expect(savedSimulationSettings(resumed).hostMilliseconds).toBe(hostMilliseconds);
        expect(resumed.bodies.map(value => ({ ...value.body, ground: value.body.ground?.slot ?? null })))
          .toEqual(continuous.bodies.map(value => ({ ...value.body, ground: value.body.ground?.slot ?? null })));
      }
      expect(restored.checkpoint().frame.time).toEqual({ kind: "milliseconds", value: 325 });
    } finally { restored.close(); }
  } finally { original.close(); await content.close(); }
});
