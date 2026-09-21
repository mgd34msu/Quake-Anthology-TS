import { describe, expect, test } from "bun:test";
import { createIdentityOwner } from "../../../../../src/contracts/identity.ts";
import type { OwnedActor } from "../../../../../src/contracts/identity.ts";
import type { Vec3 } from "../../../../../src/contracts/math.ts";
import type { TraceResult } from "../../../../../src/contracts/scene.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../../../src/world/gameplay/index.ts";
import type { Q2Edition, Q2Entity, Q2FoundationHost, Q2GameServices, Q2PresentationEvent, Q2TraceRequest } from "../../../../../src/content/q2/foundation/host.ts";
import { Q2Foundation } from "../../../../../src/content/q2/foundation/runtime.ts";
import { Q2Weapons } from "../../../../../src/content/q2/foundation/weapons/index.ts";
import { Q2Monsters, throwGib } from "../../../../../src/content/q2/foundation/monsters/index.ts";
import { classic_infantryFrames, rerelease_infantryFrames, rerelease_soldierFrames } from "../../../../../src/content/q2/foundation/monsters/frames.ts";
import { openArchive } from "../../../../../src/content/archive/index.ts";
import { readQ2Bsp } from "../../../../../src/formats/q2-map/index.ts";
import { parseQ2Entities, inhibitQ2Spawn } from "../../../../../src/content/q2/foundation/fields.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };
interface Shot { readonly type: "bullet" | "shotgun"; readonly damage: number; readonly count: number; readonly hspread: number; readonly vspread: number; }
class RecordedWeapons extends Q2Weapons {
  readonly shots: Shot[] = [];
  override fireBullet(_self: Q2Entity, _game: Q2GameServices, _start: Vec3, _direction: Vec3, damage: number, _kick: number, hspread: number, vspread: number, _mod: number): undefined {
    this.shots.push({ type: "bullet", damage, count: 1, hspread, vspread }); return undefined;
  }
  override fireShotgun(_self: Q2Entity, _game: Q2GameServices, _start: Vec3, _direction: Vec3, damage: number, _kick: number, hspread: number, vspread: number, count: number, _mod: number): undefined {
    this.shots.push({ type: "shotgun", damage, count, hspread, vspread }); return undefined;
  }
}

function fixture(edition: Q2Edition, step = 0.1) {
  const actors = new SessionActorRegistry(createIdentityOwner(`q2-monsters-${edition}`));
  const callbacks = new ActorCallbackTable(actors);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  const inventory = new SharedInventoryTable(actors), scheduled = new Map<OwnedActor, number>(), events: Q2PresentationEvent[] = [];
  const world = actors.allocateAtSource("q2:game", 0, "q2:worldspawn"), player = actors.allocate("q3:character", "q3:sarge");
  bodies.create(world, { origin: zero, angles: zero, velocity: zero, bounds: { min: zero, max: zero }, ground: null });
  bodies.create(player, { origin: { x: 500, y: 0, z: 24 }, angles: zero, velocity: zero, bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } }, ground: world.id });
  combat.create(player, { health: 1000, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
  let now = 0, touches = 0;
  const random: number[] = [];
  const plane = { normal: { x: 0, y: 0, z: 1 }, distance: 0, type: 2, signbits: 0 };
  const trace = (request: Q2TraceRequest): TraceResult => {
    const clear: TraceResult = { kind: "q2", fraction: 1, startSolid: false, allSolid: false, end: request.end, hit: { kind: "none" }, contact: { kind: "none" }, contents: 0, surface: null, sourcePlane: plane, secondary: null };
    if (request.bounds !== null && request.end.z < request.start.z) {
      const z = -request.bounds.min.z;
      return { ...clear, fraction: (request.start.z - z) / (request.start.z - request.end.z), end: { ...request.end, z }, hit: { kind: "world", model: 0 }, contact: { kind: "plane", plane }, contents: 1 };
    }
    if (request.bounds === null && (request.mask & 0x2000000) !== 0) return { ...clear, fraction: 0.8, hit: { kind: "actor", actor: player.id } };
    return clear;
  };
  const host: Q2FoundationHost = {
    actors, callbacks, bodies, combat, inventory, now: () => now, gravity: () => 800, frameSeconds: () => step, random: () => random.shift() ?? 0.5,
    schedule: (actor, due) => { if (due === null) scheduled.delete(actor); else scheduled.set(actor, due); return undefined; },
    trace, pointContents: point => point.z < 0 ? 1 : 0, inPvs: () => true, inPhs: () => true, areasConnected: () => true,
    players: () => [player.id], worldActor: () => world.id, isPlayer: actor => actor === player.id, isMonster: actor => (game.entity(actor)?.serverFlags ?? 0) % 8 >= 4,
    touchTriggers: () => { touches++; return undefined; }, nearby: () => [], inlineModelBounds: () => ({ min: zero, max: zero }),
    setSolid: () => undefined, setMotion: () => undefined, setAreaPortal: () => undefined, emit: event => { events.push(event); return undefined; },
    playerViewState: () => ({ viewAngles: zero, oldVelocity: zero }), keyConsumed: () => undefined, prepareLevelChange: () => undefined, transition: () => undefined, diagnostic: () => undefined,
  };
  const weapons = new RecordedWeapons({ emit: () => undefined, noise: () => undefined, dodge: () => undefined, lagCompensation: { kind: "current-world" }, ammoChanged: () => undefined, canTarget: () => true });
  const monsters = new Q2Monsters(weapons);
  const game = new Q2Foundation(host, { edition, mapName: "base1", skill: 1, mode: "singleplayer", deathmatchFlags: 0, maxClients: 1, provider: "q2:game", campaign: "q2:base", combatProvider: "q2:combat", inventoryProvider: "q2:inventory", movementProvider: "q2:movement" }, [monsters]);
  game.attachPlayer(player);
  return { actors, bodies, combat, player, game, host, monsters, weapons, events, random, setTime(seconds: number) { now = seconds; }, get touches() { return touches; },
    spawn(classname: string) {
      const entity = game.spawn({ classname, ordinal: 0, values: new Map([["origin", "0 0 24"]]) });
      const context = monsters.context(entity.actor.id);
      if (context === null) throw new Error(`Missing source monster ${classname}`);
      return context;
    },
    advance(seconds: number) {
      now = seconds; monsters.beginFrame(game);
      for (const [actor, due] of [...scheduled].sort(([a], [b]) => a.id.slot - b.id.slot)) {
        if (due > now + 1e-9 || !actors.isLive(actor.id)) continue;
        scheduled.delete(actor);
        callbacks.think(actor, { frame: Math.round(now / step), time: { kind: "seconds", value: now }, elapsed: { kind: "seconds", value: step }, phase: "entity-think" });
      }
    },
  };
}

describe("source soldier and infantry behavior", () => {
  test("real base1 monster rows are claimed with source health and inhibition", async () => {
    for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) {
      const scene = fixture(edition);
      const archive = await openArchive(`/home/buzzkill/Projects/qfiles/q2/${edition === "classic" ? "" : "rerelease/"}baseq2/pak0.pak`);
      try {
        const entry = archive.findEntries("maps/base1.bsp")[0];
        if (entry === undefined) throw new Error("Missing supplied base1 BSP");
        const rows = parseQ2Entities(readQ2Bsp(await archive.readEntry(entry)).entities, edition).filter(row => row.classname.startsWith("monster_"));
        if (edition === "classic") expect(rows).toHaveLength(19);
        for (const row of rows) {
          if (inhibitQ2Spawn(row, scene.game.options)) continue;
          const entity = scene.game.spawn(row);
          expect(scene.monsters.context(entity.actor.id)).not.toBeNull();
          expect(scene.combat.read(entity.actor.id)?.health).toBe(entity.classname === "monster_infantry" ? 100 : entity.classname === "monster_soldier_light" ? 20 : entity.classname === "monster_soldier" ? 30 : 40);
        }
      } finally { archive.close(); scene.actors.close(); }
    }
  });

  test("rerelease shotgun fire marks the uncocked gun and skips into its cock sequence", () => {
    const scene = fixture("rerelease"), context = scene.spawn("monster_soldier");
    scene.advance(0.1);
    context.entity.enemy = scene.player.id;
    context.setMove("soldier_move_attack1");
    context.entity.frame = rerelease_soldierFrames.attak102;
    scene.advance(0.2);
    expect(scene.weapons.shots).toEqual([{ type: "shotgun", damage: 2, count: 9, hspread: 1500, vspread: 750 }]);
    expect(context.state.cocked).toBe(false);
    context.dispatch("soldier_attack1_shotgun_check");
    expect(context.state.nextFrame).toBe(rerelease_soldierFrames.attak106);
    expect(context.state.forceRefire).toBe(true);
    context.dispatch("soldier_cock");
    expect(context.state.cocked).toBe(true);
    scene.actors.close();
  });

  test("rerelease movement runs between 10 Hz gun callbacks", () => {
    const scene = fixture("rerelease", 0.025), context = scene.spawn("monster_infantry");
    scene.advance(0.1);
    context.entity.enemy = scene.player.id;
    context.setMove("infantry_move_attack4");
    context.entity.frame = rerelease_infantryFrames.run201 - 1;
    context.state.fireWait = 5;
    scene.advance(0.125);
    const firstOrigin = scene.game.body(context.entity).origin.x;
    scene.advance(0.15); scene.advance(0.175); scene.advance(0.2);
    expect(scene.weapons.shots).toHaveLength(1);
    expect(scene.game.body(context.entity).origin.x).toBeGreaterThan(firstOrigin);
    expect(scene.touches).toBeGreaterThan(3);
    scene.advance(0.225);
    expect(scene.weapons.shots).toHaveLength(2);
    scene.actors.close();
  });

  test("classic infantry death sprays all twelve authored death gun frames", () => {
    const scene = fixture("classic"), context = scene.spawn("monster_infantry");
    scene.advance(0.1);
    scene.combat.setHealth(context.entity.actor, -10);
    scene.random.push(0.4);
    context.entity.die?.(context.entity, scene.game, { attack: null, self: context.entity.actor, attacker: scene.player.id, inflictor: scene.player.id, damage: 10, kick: 0, point: zero });
    expect(context.state.move.name).toBe("infantry_move_death2");
    context.entity.frame = classic_infantryFrames.death211 - 1;
    for (let tick = 2; tick <= 17; tick++) scene.advance(tick / 10);
    expect(scene.weapons.shots).toHaveLength(12);
    expect(context.state.corpse).toBe(true);
    expect(context.entity.serverFlags & 2).toBe(2);
    expect(scene.game.counters.killedMonsters).toBe(1);
    scene.actors.close();
  });

  test("rerelease combines pain before the source frame-end callback", () => {
    const scene = fixture("rerelease"), context = scene.spawn("monster_infantry");
    scene.advance(0.1);
    const prior = context.state.move;
    scene.combat.setHealth(context.entity.actor, 40);
    const hit = { attack: null, self: context.entity.actor, attacker: scene.player.id, damage: 5, kick: 2 };
    context.entity.pain?.(context.entity, scene.game, hit);
    context.entity.pain?.(context.entity, scene.game, hit);
    expect(context.state.move.name.startsWith("infantry_move_pain")).toBe(false);
    expect(context.entity.skin).toBe(1);
    scene.monsters.endFrame(scene.game);
    expect(context.state.move.name.startsWith("infantry_move_pain")).toBe(true);
    expect(scene.events.filter(event => event.kind === "sound" && event.path.startsWith("infantry/infpain"))).toHaveLength(1);
    expect(context.state.move).not.toBe(prior);
    scene.actors.close();
  });

  test("an AI move switch still executes the callback captured from its original frame", () => {
    const scene = fixture("classic"), context = scene.spawn("monster_soldier");
    scene.advance(0.1);
    context.setMove("soldier_move_stand1");
    context.entity.frame = context.state.move.firstFrame - 1;
    scene.random.push(0.2, 0.9, 0.9);
    scene.advance(0.2);
    expect(context.state.move.name).toBe("soldier_move_attack6");
    expect(scene.events.some(event => event.kind === "sound" && event.path === "soldier/solidle1.wav")).toBe(true);
    scene.actors.close();
  });
  test("source saves restore named callbacks, pending pain and animation timing without spawning", () => {
    const scene = fixture("rerelease", 0.025), infantry = scene.spawn("monster_infantry"), soldier = scene.spawn("monster_soldier_light");
    scene.advance(0.1);
    infantry.entity.enemy = scene.player.id;
    infantry.setMove("infantry_move_attack4"); infantry.entity.frame = rerelease_infantryFrames.run201 - 1; infantry.state.fireWait = 5;
    scene.advance(0.125);
    scene.monsters.reportNoise(scene.player.id, { x: 100, y: 0, z: 24 });
    scene.combat.setHealth(soldier.entity.actor, 5);
    const attack = scene.game.attack(scene.player.id, scene.player.id, 1, 0, "q2:blaster");
    soldier.entity.pain?.(soldier.entity, scene.game, { attack, self: soldier.entity.actor, attacker: scene.player.id, damage: 7, kick: 3 });
    throwGib(soldier.entity, scene.game, "models/objects/gibs/sm_meat/tris.md2", 5);
    const source = structuredClone(scene.game.capture()), snapshot = structuredClone(scene.monsters.capture());
    const pending = snapshot.actors.find(actor => actor.actor.slot === soldier.entity.actor.id.slot)?.pendingDamage;
    expect(pending?.attack?.cause).toEqual(attack.cause);
    expect(pending?.reaction).not.toHaveProperty("attack");
    const random = [...scene.random], counters = { ...scene.game.counters };
    const actors = SessionActorRegistry.restore(createIdentityOwner("q2-monsters-restored"), scene.actors.checkpoint(), scene.actors.sourceCheckpoint());
    const callbacks = new ActorCallbackTable(actors), bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
    const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
    for (const entry of scene.actors.observations()) {
      const actor = actors.resolveSaved(entry.id), body = scene.bodies.read(entry.id), health = scene.combat.read(entry.id);
      if (actor === null) throw new Error("Missing restored actor");
      if (body !== null) bodies.create(actor, { ...body, ground: body.ground === null ? null : actors.referenceSaved(body.ground) });
      if (health !== null) combat.create(actor, health);
    }
    const player = actors.referenceSaved(scene.player.id), world = actors.referenceSaved(scene.host.worldActor());
    const host: Q2FoundationHost = { ...scene.host, actors, bodies, callbacks, combat, inventory: new SharedInventoryTable(actors),
      worldActor: () => world, players: () => [player], isPlayer: actor => actor === player, isMonster: actor => (game.entity(actor)?.serverFlags ?? 0) % 8 >= 4,
      trace: request => { const trace = scene.host.trace(request); return trace.hit.kind === "actor" ? { ...trace, hit: { kind: "actor", actor: actors.referenceSaved(trace.hit.actor) } } : trace; } };
    const restored = new Q2Monsters(scene.weapons), game = new Q2Foundation(host, scene.game.options, [restored]);
    game.restore(source); restored.restore(game, snapshot);
    expect(scene.random).toEqual(random);
    expect(game.counters).toEqual(counters);
    expect(game.capture().entities.map(entity => entity.callbacks)).toEqual(source.entities.map(entity => entity.callbacks));
    const resumed = restored.context(actors.referenceSaved(infantry.entity.actor.id));
    if (resumed === null) throw new Error("Missing restored infantry");
    expect(resumed).not.toBe(infantry);
    expect(resumed.entity.enemy).toBe(player);
    expect(resumed.state.move.name).toBe(infantry.state.move.name);
    expect(resumed.state.nextMoveTime).toBe(infantry.state.nextMoveTime);
    scene.setTime(0.15); resumed.entity.think?.(resumed.entity, game);
    expect(scene.weapons.shots).toHaveLength(1);
    scene.setTime(0.225); resumed.entity.think?.(resumed.entity, game);
    expect(scene.weapons.shots).toHaveLength(2);
    const before = scene.events.filter(event => event.kind === "sound" && event.path.startsWith("soldier/solpain")).length;
    restored.endFrame(game);
    const restoredAttack = game.entity(actors.referenceSaved(soldier.entity.actor.id))?.lastAttack;
    expect(restoredAttack?.attacker).toBe(player);
    expect(restoredAttack?.cause).toEqual(attack.cause);
    expect(scene.events.filter(event => event.kind === "sound" && event.path.startsWith("soldier/solpain"))).toHaveLength(before + 1);
    expect(restored.capture().actors.find(actor => actor.actor.slot === soldier.entity.actor.id.slot)?.pendingDamage).toBeNull();
    actors.close(); scene.actors.close();
  });

});
