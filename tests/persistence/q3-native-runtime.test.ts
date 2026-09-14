import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner, sameActor } from "../../src/contracts/identity.ts";
import { readSaveImage, writeSaveImage } from "../../src/persistence/index.ts";
import type { Q3SourceRuntime } from "../../src/app/bootstrap/simulation/q3/runtime.ts";
import type { SimulationEvent } from "../../src/contracts/session.ts";
import { GameEntity } from "../../src/content/q3/base/game/state.ts";

function consumeOutput(simulation: ReturnType<typeof createSimulation>, frameEvents: readonly SimulationEvent[] = []) {
  const presentations = simulation.drainPresentationEvents();
  for (const presentation of presentations) {
    if (presentation.kind === "q3-source" && (presentation.event.kind === "console-command" || presentation.event.kind === "drop-client")) {
      throw new Error("The continuation fixture cannot consume a pending native control request");
    }
  }
  return { presentations: presentations.map(value => ({ kind: value.kind, sequence: value.sequence, seconds: value.seconds, sourceEntity: value.sourceEntity })),
    events: [...frameEvents, ...simulation.events.take()].map(value => ({ sequence: value.sequence, time: value.time, kind: value.payload.kind })) };
}

test("retail native Q3 resumes source callbacks and client state through the shared disk image", async () => {
  const command = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm2", "--mode", "deathmatch", "--dedicated"]);
  if (command.kind !== "run") throw new Error("Expected Q3 native launch");
  const directory = await mkdtemp(join(tmpdir(), "q3-native-save-"));
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner("q3-native-disk"), client = identity.client(0, 0);
  const options = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
    skill: command.options.skill, mode: command.options.mode, seed: 173, maxClients: 1 };
  const original = createSimulation(options);
  try {
    const admitted = original.admitPlayer(client), source = original.q3Source();
    if (source === null) throw new Error("Expected native Q3 source");
    for (let frame = 0; frame < 100 && source.level.time < 300; frame++) original.step({ elapsedMilliseconds: 100, commands: [] });
    const player = source.records.nativeByActor(admitted.actor);
    if (player === null || player.client === null) throw new Error("Missing admitted source player");
    player.client.pers.netname = "disk player"; player.bindClientName(player.client);
    player.client.ps.stats.set(7, 723); player.client.ps.ammo.set(0, -31);
    const item = Array.from({ length: source.pool.numEntities }, (_, slot) => source.pool.at(slot)).find(entity => entity.inuse && entity.item !== null && entity.touch !== null);
    if (item === undefined) throw new Error("Retail map lacks a source item after spawn continuation");
    item.think = source.pool.callbacks.think.resolve("q3.item.respawn"); item.nextthink = source.level.time + 300;
    const rocket = source.missiles.fireRocket(player, { ...player.r.currentOrigin, z: player.r.currentOrigin.z + 20 }, { x: 1, y: 0, z: 0 });
    const door = Array.from({ length: source.pool.numEntities }, (_, slot) => source.pool.at(slot)).find(entity => entity.inuse && entity.classname === "func_door");
    if (door === undefined || door.use === null) throw new Error("Retail map lacks a native source door");
    door.use(door, player, player);
    const trace = (runtime: Q3SourceRuntime) => {
      const savedItem = runtime.pool.at(item.slot), savedDoor = runtime.pool.at(door.slot), savedRocket = runtime.pool.at(rocket.slot);
      return { itemThink: savedItem.nextthink, itemEvent: savedItem.s.event, itemLinks: savedItem.r.linkcount,
        doorState: savedDoor.moverState, doorOrigin: { ...savedDoor.r.currentOrigin }, doorThink: savedDoor.nextthink,
        rocketActive: savedRocket.inuse, rocketType: savedRocket.s.eType, rocketOrigin: { ...savedRocket.r.currentOrigin } };
    };
    expect(() => original.checkpoint()).toThrow("Save requires consumed source output");
    expect(consumeOutput(original).presentations.length).toBeGreaterThan(0);
    const oldRocketId = rocket.actor.id, image = original.checkpoint();
    expect(source.missiles.captureSaveState().some(entry => entry.entity === rocket.slot)).toBe(true);
    expect(image.providers.some(record => record.schema === "q3:native")).toBe(true);
    const path = join(directory, "native.sav"); await writeSaveImage(path, image);
    const suffix = () => {
      const frames = Array.from({ length: 8 }, () => { const output = original.step({ elapsedMilliseconds: 100, commands: [] }); return { ...trace(source), output: consumeOutput(original, output.events) }; });
      expect(frames.filter((frame, index) => frame.itemThink === 0 && (index === 0 || frames[index - 1]?.itemThink !== 0))).toHaveLength(1);
      return { frames, native: source.captureNativeState(), frame: original.checkpoint().frame,
        ui: original.playerUi(admitted.actor), view: original.playerView(admitted.actor),
        bodies: original.checkpoint().bodies.map(value => ({ actor: value.actor.slot, body: { ...value.body, ground: value.body.ground?.slot ?? null }, linkCount: value.linkCount })) };
    };
    const continuous = suffix(); original.close();
    const restored = createSimulation({ ...options, restore: await readSaveImage(path), restoredClients: [client] });
    try {
      const restoredSource = restored.q3Source(), restoredPlayer = restored.players()[0];
      if (restoredSource === null || restoredPlayer === undefined) throw new Error("Missing restored source/player");
      const sourcePlayer = restoredSource.records.nativeByActor(restoredPlayer);
      if (sourcePlayer === null || sourcePlayer.client === null) throw new Error("Missing restored player record");
      expect(sameActor(restoredPlayer, admitted.actor)).toBe(false);
      expect(restoredSource.pool.at(rocket.slot).actor.id.equals(oldRocketId)).toBe(false);
      expect(restoredSource.pool.at(item.slot).think).toBe(restoredSource.itemLifecycle.callbacks?.respawn ?? null);
      expect(restoredSource.pool.at(door.slot).use).toBe(restoredSource.pool.callbacks.use.resolve(source.pool.callbacks.use.capture(door.use)));
      expect(sourcePlayer.classname).toBe("disk player"); expect(sourcePlayer.client.ps.stats.get(7)).toBe(723); expect(sourcePlayer.client.ps.ammo.get(0)).toBe(-31);
      consumeOutput(restored);
      const frames = Array.from({ length: 8 }, () => { const output = restored.step({ elapsedMilliseconds: 100, commands: [] }); return { ...trace(restoredSource), output: consumeOutput(restored, output.events) }; });
      expect(frames).toEqual(continuous.frames);
      const resumed = restoredSource.captureNativeState();
      expect(restored.checkpoint().frame).toEqual(continuous.frame); expect(restored.playerUi(restoredPlayer)).toEqual(continuous.ui);
      expect(restored.playerView(restoredPlayer)).toEqual(continuous.view);
      expect(resumed.level).toEqual(continuous.native.level); expect(resumed.random).toBe(continuous.native.random);
      expect(resumed.graph.clients).toEqual(continuous.native.graph.clients);
      expect(resumed.graph.entities.map(entity => ({ values: entity.values, network: entity.network, nextthink: entity.nextthink, think: entity.think })))
        .toEqual(continuous.native.graph.entities.map(entity => ({ values: entity.values, network: entity.network, nextthink: entity.nextthink, think: entity.think })));
      expect(restored.checkpoint().bodies.map(value => ({ actor: value.actor.slot, body: { ...value.body, ground: value.body.ground?.slot ?? null }, linkCount: value.linkCount }))).toEqual(continuous.bodies);
      expect(restoredSource.pool.at(item.slot).think).toBe(restoredSource.itemLifecycle.callbacks?.respawn ?? null);
      expect(restoredSource.pool.at(rocket.slot)).toBeInstanceOf(GameEntity);
      restoredSource.host.engine.appendConsoleCommand("map q3dm2");
      expect(() => restored.checkpoint()).toThrow("Save requires consumed source output");
      const pendingControl = restored.drainPresentationEvents().flatMap(value => value.kind === "q3-source" && value.event.kind === "console-command" ? [value.event] : []);
      expect(pendingControl).toHaveLength(1);
      expect(pendingControl[0]).toEqual({ kind: "console-command", execution: "append", text: "map q3dm2" });
    } finally { restored.close(); }
  } finally { original.close(); await content.close(); await rm(directory, { recursive: true, force: true }); }
}, 30000);
