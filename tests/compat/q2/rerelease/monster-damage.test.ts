// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import type { ActorId } from "../../../../src/contracts/identity.ts";
import type { DamageRequest } from "../../../../src/contracts/gameplay.ts";
import { available, nativeFixture } from "./native.test.ts";
import { RereleaseSourceEdict } from "../../../../src/compat/q2/rerelease/source-state.ts";
import { guestPointer, guestInt, resultPointer } from "../../../../src/compat/q2/rerelease/module.ts";
import { rereleaseDamageSignature, rereleaseModLayout, rereleaseFreeSignature, rereleaseSpawnSignature } from "../../../../src/compat/q2/rerelease/native-entries.ts";

test.skipIf(!available)("retail monster accumulation retains qualifying provenance through native callbacks and saves", async () => {
  let nativeSequence = 100;
  const { source, host, guest, world, memory } = await nativeFixture(undefined, true, () => [], {
    provenance: () => ({ sequence: ++nativeSequence, time: { kind: "milliseconds", value: 10 }, weapon: null,
      weaponProvider: "q2:guest", combatProvider: "test:q2-combat", inventoryProvider: "q2:guest", movementProvider: "q2:movement" }),
  });
  host.preInit(); source.init();
  host.spawnEntities("base1", `{ "classname" "worldspawn" } { "classname" "info_player_start" "origin" "${world.origin}" } { "classname" "monster_soldier" "origin" "0 0 512" }`);
  expect(host.clientConnect(1, "\\name\\Probe\\skin\\male/grunt\\ip\\127.0.0.1", "monster", false).accepted).toBe(true); host.clientBegin(1);
  const bridge = host.foreignActors; if (bridge === null) throw new Error("No bridge");
  const view = guest.entities().atSlot(18), edict = new RereleaseSourceEdict(view, guest);
  let monster = host.actor(view); if (monster === null) throw new Error("No native monster");
  const foreign = world.engine.actors.allocate("q3:foreign", "q3:monster-attacker");
  world.engine.bodies.create(foreign, { origin: { x: 100, y: 0, z: 512 }, angles: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
    bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } }, ground: null });
  world.engine.combat.create(foreign, { health: 100, mass: 200, canTakeDamage: true, invulnerable: false, armor: { kind: "none" }, team: null });
  const request = (target: ActorId, sequence: number, amount: number): DamageRequest => ({ target, amount, knockback: 0, direction: { x: 1, y: 0, z: 0 },
    point: { x: 1, y: 2, z: 3 }, normal: { x: 0, y: 0, z: 1 }, delivery: "direct",
    attack: { sequence, time: { kind: "milliseconds", value: sequence }, attacker: foreign.id, inflictor: foreign.id, weapon: "q2:weapon_blaster",
      weaponProvider: "q2:guest", combatProvider: "test:q2-combat", inventoryProvider: "q2:guest", movementProvider: "q3:movement",
      cause: { kind: "q2", meansOfDeath: 1, damageFlags: 0 } } });
  const pain = memory.readPointer(edict.at("pain.value")), die = memory.readPointer(edict.at("die.value"));
  if (pain === null || die === null) throw new Error("Missing native callbacks");
  const callbacks = guest.options.runner.options.callbacks, cpu = guest.options.runner.options.cpu;
  const reactions: { kind: string; damage: number; sequence: number | undefined }[] = [];
  const observe = (kind: string): void => {
    if (cpu.state.registers.read("rcx", 64) !== view.address.byteOffset) return;
    reactions.push({ kind, damage: Number(BigInt.asIntN(32, cpu.state.registers.read("r9", 64))), sequence: world.decisions.at(-1)?.request.attack.sequence });
  };
  // Register after the production binding so this observes its beforeReaction notification.
  bridge.deferred.track(view);
  const boundaries: number[] = [];
  const removeBoundary = callbacks.observeEntry(bridge.entries.processPain, () => {
    if (cpu.state.registers.read("rcx", 64) !== view.address.byteOffset || memory.readInt32(memory.offset(view.address, 3136n)) === 0) return;
    const decision = world.decisions.at(-1);
    if (decision === undefined) throw new Error("Native processing has no shared reaction");
    expect(decision.reaction).toBe(edict.health <= 0 ? "death" : "pain");
    expect(decision.mutations).toEqual([]); boundaries.push(decision.request.attack.sequence);
  });
  const removePain = callbacks.observeEntry(pain, () => observe("pain")), removeDie = callbacks.observeEntry(die, () => observe("die"));
  bridge.damageNative(request(monster.id, 1, 3)); bridge.damageNative(request(monster.id, 2, 4));
  expect(edict.health).toBe(23); expect(reactions).toEqual([]); expect(world.outcomes).toHaveLength(2);
  memory.writeUint8(edict.at("takedamage"), 0);
  bridge.damageNative(request(monster.id, 3, 9)); memory.writeUint8(edict.at("takedamage"), 1);
  for (let i = 0; i < 8 && reactions.length === 0; i++) host.runFrame(true);
  expect(reactions).toEqual([{ kind: "pain", damage: 7, sequence: 2 }]); expect(world.outcomes).toHaveLength(3);
  expect(world.decisions.at(-1)?.mutations).toEqual([]);
  bridge.damageNative(request(monster.id, 4, 2));
  const vectors = memory.allocate({ byteLength: 36, alignment: 4n, label: "native monster witness" });
  guest.invoke(bridge.entries.damage, rereleaseDamageSignature, [guestPointer(view.address), guestPointer(guest.entities().atSlot(0).address), guestPointer(guest.entities().atSlot(0).address),
    guestPointer(vectors), guestPointer(memory.offset(vectors, 12n)), guestPointer(memory.offset(vectors, 24n)), guestInt(1), guestInt(0), guestInt(0),
    { kind: "aggregate", layout: rereleaseModLayout, bytes: new Uint8Array([1, 0, 0]) }], view);
  const lastNative = nativeSequence;
  for (let i = 0; i < 8 && reactions.length === 1; i++) host.runFrame(true);
  expect(reactions.at(-1)).toEqual({ kind: "pain", damage: 3, sequence: lastNative });
  expect(world.decisions.at(-1)?.request.attack.attacker).toBe(world.engine.worldActor());
  bridge.damageNative(request(monster.id, 5, 2));
  const saved = host.writeSave("level", false);
  expect(saved.deferredDamage).toHaveLength(1); expect(saved.projections).toHaveLength(1);
  const pendingCount = reactions.length;
  for (let i = 0; i < 8 && reactions.length === pendingCount; i++) host.runFrame(true);
  bridge.damageNative(request(monster.id, 50, 100));
  expect(world.decisions.at(-1)?.reaction).toBe("none");
  const deathCount = reactions.length;
  for (let i = 0; i < 8 && reactions.length === deathCount; i++) host.runFrame(true);
  expect(reactions.at(-1)).toEqual({ kind: "die", damage: 100, sequence: 50 });
  const oldForeignBody = world.engine.bodies.read(foreign.id);
  host.readSave("level", saved);
  expect(host.clientConnect(1, "\\name\\Probe\\skin\\male/grunt\\ip\\127.0.0.1", "monster", false).accepted).toBe(true); host.clientBegin(1);
  expect(world.engine.actors.isLive(foreign.id)).toBe(true); expect(world.engine.bodies.read(foreign.id)).toEqual(oldForeignBody);
  monster = host.actor(guest.entities().atSlot(18)); if (monster === null) throw new Error("Monster not restored");
  const before = world.decisions.length;
  for (let i = 0; i < 8 && world.decisions.length === before; i++) host.runFrame(true);
  expect(world.decisions.at(-1)?.reaction).toBe("pain"); expect(world.decisions.at(-1)?.request.attack.sequence).toBe(5);
  expect(world.decisions.at(-1)?.request.attack.attacker).toBe(foreign.id);
  bridge.damageNative(request(monster.id, 6, 100));
  expect(world.decisions.at(-1)?.reaction).toBe("none");
  const lethal = host.writeSave("level", false); host.readSave("level", lethal);
  expect(host.clientConnect(1, "\\name\\Probe\\skin\\male/grunt\\ip\\127.0.0.1", "monster", false).accepted).toBe(true); host.clientBegin(1);
  const lethalBefore = world.decisions.length;
  for (let i = 0; i < 8 && world.decisions.length === lethalBefore; i++) host.runFrame(true);
  expect(world.decisions.at(-1)?.reaction).toBe("death"); expect(world.decisions.at(-1)?.request.attack.sequence).toBe(6);
  expect(world.decisions.at(-1)?.appliedDamage).toBe(100);
  expect(boundaries).toEqual([2, lastNative, 5, 50, 5, 6]);
  removeBoundary(); removePain(); removeDie(); memory.unmap(vectors, 36); source.close(); world.engine.actors.release(foreign);
});

for (const reuse of [false, true]) test.skipIf(!available)(`retail deferred save retains freed projectile provenance with native slot reuse ${reuse}`, async () => {
  const { source, host, guest, world, memory } = await nativeFixture(undefined, true, () => [], {
    provenance: () => ({ sequence: 81, time: { kind: "milliseconds", value: 10 }, weapon: null,
      weaponProvider: "q2:guest", combatProvider: "test:q2-combat", inventoryProvider: "q2:guest", movementProvider: "q2:movement" }),
  });
  try {
    host.preInit(); source.init();
    host.spawnEntities("base1", `{ "classname" "worldspawn" } { "classname" "info_player_start" "origin" "${world.origin}" } { "classname" "monster_soldier" "origin" "0 0 512" }`);
    expect(host.clientConnect(1, "\\name\\Probe\\skin\\male/grunt\\ip\\127.0.0.1", "stale", false).accepted).toBe(true); host.clientBegin(1);
    const bridge = host.foreignActors; if (bridge === null) throw new Error("No bridge");
    const view = guest.entities().atSlot(18);
    const inflictor = resultPointer(guest.invoke(bridge.entries.spawn, rereleaseSpawnSignature, []));
    if (inflictor === null) throw new Error("Missing projectile slot");
    const projectileView = guest.entities().fromPointer(inflictor), projectile = host.actor(projectileView);
    if (projectile === null) throw new Error("Missing projectile actor");
    const vectors = memory.allocate({ byteLength: 36 });
    try {
      guest.invoke(bridge.entries.damage, rereleaseDamageSignature, [guestPointer(view.address), guestPointer(inflictor), guestPointer(guest.entities().atSlot(0).address),
        guestPointer(vectors), guestPointer(memory.offset(vectors, 12n)), guestPointer(memory.offset(vectors, 24n)), guestInt(1), guestInt(0), guestInt(0),
        { kind: "aggregate", layout: rereleaseModLayout, bytes: new Uint8Array([1, 0, 0]) }], view);
      guest.invoke(bridge.entries.free, rereleaseFreeSignature, [guestPointer(inflictor)]);
      if (reuse) {
        const replacement = resultPointer(guest.invoke(bridge.entries.spawn, rereleaseSpawnSignature, []));
        expect(replacement).toEqual(inflictor); host.reconcile();
        const occupant = host.actor(projectileView); if (occupant === null) throw new Error("Missing reused actor");
        expect(occupant.id.equals(projectile.id)).toBe(false);
      }
      const saved = host.writeSave("level", false);
      expect(world.engine.actors.isLive(projectile.id)).toBe(false);
      expect(saved.native.length).toBeGreaterThan(0);
      expect(saved.deferredDamage[0]?.inflictorSlot).toBe(projectileView.slot);
      host.readSave("level", saved);
      expect(memory.readPointer(memory.offset(view.address, 3128n))).toEqual(inflictor);
      expect(host.clientConnect(1, "\\name\\Probe\\skin\\male/grunt\\ip\\127.0.0.1", "stale", false).accepted).toBe(true); host.clientBegin(1);
      const before = world.decisions.length;
      for (let frame = 0; frame < 8 && world.decisions.length === before; frame++) host.runFrame(true);
      const decision = world.decisions.at(-1); if (decision === undefined) throw new Error("Missing restored reaction");
      expect(decision.reaction).toBe("pain"); expect(decision.request.attack.sequence).toBe(81);
      expect(decision.request.attack.inflictor?.equals(projectile.id)).toBe(true);
      expect(world.engine.actors.isLive(projectile.id)).toBe(false);
      expect(decision.appliedDamage).toBe(1);
    } finally { memory.unmap(vectors, 36); }
  } finally { source.close(); }
}, 120000);
