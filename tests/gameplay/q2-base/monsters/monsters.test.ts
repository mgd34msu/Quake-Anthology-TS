import { describe, expect, test } from "bun:test";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { ActorId, OwnedActor } from "../../../../src/contracts/identity.ts";
import type { Vec3 } from "../../../../src/contracts/math.ts";
import type { TraceResult } from "../../../../src/contracts/scene.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ2CombatPolicy, nativeVictimArmor } from "../../../../src/world/gameplay/index.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { readQ2Bsp } from "../../../../src/formats/q2-map/index.ts";
import { parseQ2Entities, inhibitQ2Spawn } from "../../../../src/content/q2/foundation/fields.ts";
import type { Q2FoundationHost, Q2PresentationEvent, Q2SpawnFields, Q2TraceRequest } from "../../../../src/content/q2/foundation/host.ts";
import { Q2Foundation } from "../../../../src/content/q2/foundation/runtime.ts";
import { Q2Ballistics } from "../../../../src/content/q2/foundation/weapons/ballistics.ts";
import { Q2Monsters } from "../../../../src/content/q2/foundation/monsters/index.ts";
import { q2ClassicBaseMonsterDefinitions, registerQ2ClassicBaseMonsters } from "../../../../src/content/q2/base/monsters/index.ts";
import { medicFrame } from "../../../../src/content/q2/base/monsters/tables/medic.ts";
import { gunnerFrame } from "../../../../src/content/q2/base/monsters/tables/gunner.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };

function fixture() {
  const actors = new SessionActorRegistry(createIdentityOwner("q2-base-monsters")), callbacks = new ActorCallbackTable(actors);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  const inventory = new SharedInventoryTable(actors), scheduled = new Map<OwnedActor, number>(), events: Q2PresentationEvent[] = [];
  const world = actors.allocateAtSource("q2:game", 0, "q2:worldspawn"), player = actors.allocate("q3:character", "q3:sarge");
  bodies.create(world, { origin: zero, angles: zero, velocity: zero, bounds: { min: zero, max: zero }, ground: null });
  bodies.create(player, { origin: { x: 500, y: 0, z: 24 }, angles: zero, velocity: zero, bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } }, ground: world.id });
  combat.create(player, { health: 1000, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
  let now = 0, rayActor: ActorId = player.id;
  const random: number[] = [], diagnostics: string[] = [];
  const plane = { normal: { x: 0, y: 0, z: 1 }, distance: 0, type: 2, signbits: 0 };
  const trace = (request: Q2TraceRequest): TraceResult => {
    const clear: TraceResult = { kind: "q2", fraction: 1, startSolid: false, allSolid: false, end: request.end, hit: { kind: "none" }, contact: { kind: "none" }, contents: 0, surface: null, sourcePlane: plane, secondary: null };
    if (request.bounds !== null && request.end.z < request.start.z && request.end.z + request.bounds.min.z <= 0) {
      const z = -request.bounds.min.z;
      return { ...clear, fraction: Math.max(0, (request.start.z - z) / (request.start.z - request.end.z)), end: { ...request.end, z }, hit: { kind: "world", model: 0 }, contact: { kind: "plane", plane }, contents: 1 };
    }
    if (request.bounds === null && (request.mask & 0x2000000) !== 0) return { ...clear, fraction: 0.8, hit: { kind: "actor", actor: rayActor } };
    return clear;
  };
  const host: Q2FoundationHost = {
    actors, callbacks, bodies, combat, inventory, now: () => now, gravity: () => 800, frameSeconds: () => 0.1, random: () => random.shift() ?? 0.5,
    schedule: (actor, due) => { if (due === null) scheduled.delete(actor); else scheduled.set(actor, due); return undefined; },
    trace, pointContents: point => point.z < 0 ? 1 : 0, inPvs: () => true, inPhs: () => true, areasConnected: () => true,
    players: () => [player.id], worldActor: () => world.id, isPlayer: actor => actor === player.id, isMonster: actor => ((game.entity(actor)?.serverFlags ?? 0) & 4) !== 0,
    touchTriggers: () => undefined, nearby: () => [...game.entities.values()].map(entity => entity.actor.id), inlineModelBounds: () => ({ min: zero, max: zero }),
    setSolid: () => undefined, setMotion: () => undefined, setAreaPortal: () => undefined, emit: event => { events.push(event); return undefined; },
    playerViewState: () => ({ viewAngles: zero, oldVelocity: zero }), keyConsumed: () => undefined, prepareLevelChange: () => undefined, transition: () => undefined,
    diagnostic: message => { diagnostics.push(message); return undefined; },
  };
  combat.register(createQ2CombatPolicy({ id: "q2:combat", armor: nativeVictimArmor(request => ({ arithmetic: "binary64", screenFacingDot: 1, q2: { product: "classic", ctf: false, alive: (combat.read(request.target)?.health ?? 0) > 0 } })),
    context: request => ({ arithmetic: "binary64", player: request.target === player.id, monster: host.isMonster(request.target), attackerPlayer: request.attack.attacker === player.id,
      hasEnemy: game.entity(request.target)?.enemy !== null, easySkill: false, deathmatch: false, defenderSphere: false, teamDamageEnabled: false, friendlyFire: false,
      nuke: false, noKnockback: true, movable: false, rejectTeamDamage: false, suppressPain: false }) }));
  const weapons = new Q2Ballistics({ emit: () => undefined, noise: () => undefined, dodge: () => undefined, lagCompensation: { kind: "current-world" }, ammoChanged: () => undefined, canTarget: () => true });
  const monsters = new Q2Monsters(weapons), module = registerQ2ClassicBaseMonsters(monsters);
  const game = new Q2Foundation(host, { edition: "classic", mapName: "base1", skill: 1, mode: "singleplayer", deathmatchFlags: 0, maxClients: 1, provider: "q2:game", campaign: "q2:base", combatProvider: "q2:combat", inventoryProvider: "q2:inventory", movementProvider: "q1:movement" }, [module]);
  const playerEntity = game.attachPlayer(player);
  return { actors, callbacks, bodies, combat, inventory, player, playerEntity, game, monsters, events, random, diagnostics,
    rayHit(actor: ActorId) { rayActor = actor; },
    spawn(classname: string, values: ReadonlyMap<string, string> = new Map([["origin", "0 0 24"]])) {
      const entity = game.spawn({ classname, ordinal: -1, values });
      const context = monsters.context(entity.actor.id);
      if (context === null) throw new Error(`Missing source monster ${classname}`);
      return context;
    },
    advance(seconds: number) {
      now = seconds; monsters.beginFrame(game);
      for (const [actor, due] of [...scheduled].sort(([a], [b]) => a.id.slot - b.id.slot)) {
        if (due > now + 1e-9 || !actors.isLive(actor.id)) continue;
        scheduled.delete(actor);
        callbacks.think(actor, { frame: Math.round(now * 10), time: { kind: "seconds", value: now }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" });
      }
    },
  };
}

describe("original Q2 base monster source behavior", () => {
  test("retail campaign monster classnames and every base definition use the shared controller", async () => {
    const scene = fixture(), archive = await openArchive("/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak");
    try {
      const representatives = new Map<string, Q2SpawnFields>();
      const maps = archive.entries.filter(entry => entry.path.startsWith("maps/") && entry.path.endsWith(".bsp"));
      expect(maps).toHaveLength(39);
      for (const entry of maps) {
        for (const row of parseQ2Entities(readQ2Bsp(await archive.readEntry(entry)).entities, "classic")) {
          // The static commander corpse belongs to the base scenery module.
          if (row.classname !== "monster_commander_body" && !inhibitQ2Spawn(row, scene.game.options) && (row.classname.startsWith("monster_") || row.classname === "misc_insane" || row.classname === "misc_actor")) representatives.set(row.classname, row);
        }
      }
      expect(representatives.size).toBeGreaterThan(20);
      for (const row of representatives.values()) {
        const entity = scene.game.spawn(row);
        expect(scene.actors.isLive(entity.actor.id)).toBe(true);
        if (row.classname === "monster_boss3_stand") expect(entity.model).toBe("models/monsters/boss3/rider/tris.md2");
        else expect(scene.monsters.context(entity.actor.id)).not.toBeNull();
      }
      const definitions = q2ClassicBaseMonsterDefinitions(scene.monsters);
      expect(definitions).toHaveLength(20);
      for (const definition of definitions) {
        const context = scene.spawn(definition.classname, new Map([["origin", "0 0 24"], ["targetname", "actor"], ["target", "actor-path"]]));
        expect(scene.combat.read(context.entity.actor.id)?.health).toBe(definition.health);
        expect(context.state.move.frames.length).toBeGreaterThanOrEqual(context.state.move.lastFrame - context.state.move.firstFrame + 1);
      }
      expect(scene.diagnostics).toEqual([]);
    } finally { archive.close(); scene.actors.close(); }
  });

  test("Medic revives the same Brain actor and inventory after its screen has consumed cells", () => {
    const scene = fixture(), brain = scene.spawn("monster_brain", new Map([["origin", "150 0 24"], ["target", "old-path"], ["targetname", "old-name"], ["combattarget", "old-combat"], ["deathtarget", "old-death"]]));
    brain.entity.enemy = scene.player.id;
    const actor = brain.entity.actor;
    const hit = (damage: number) => scene.game.damage(actor.id, scene.playerEntity, scene.player.id, damage, 0, zero, scene.game.body(brain.entity).origin, zero, 0);
    hit(30);
    expect(scene.combat.read(actor.id)?.health).toBe(280);
    expect(scene.inventory.count(actor.id, "q2:monster-power")).toBe(90);
    brain.dispatch("brain_chest_open"); hit(30);
    expect(scene.combat.read(actor.id)?.health).toBe(250);
    expect(scene.inventory.count(actor.id, "q2:monster-power")).toBe(90);
    brain.dispatch("brain_chest_closed"); hit(30);
    expect(scene.inventory.count(actor.id, "q2:monster-power")).toBe(80);
    brain.dispatch("brain_chest_open"); hit(240); brain.dispatch("brain_dead");
    expect(brain.state.dead).toBe(true);
    const medic = scene.spawn("monster_medic");
    medic.entity.enemy = scene.player.id; medic.run();
    expect(medic.entity.enemy).toBe(actor.id);
    expect(medic.state.medic).toBe(true);
    scene.rayHit(actor.id); medic.entity.frame = medicFrame.attack50; medic.dispatch("medic_cable_attack");
    const revived = scene.monsters.context(actor.id);
    expect(revived?.entity.actor).toBe(actor);
    expect(revived?.state.dead).toBe(false);
    expect(revived?.state.resurrecting).toBe(true);
    expect(scene.combat.read(actor.id)?.health).toBe(300);
    expect(scene.inventory.count(actor.id, "q2:monster-power")).toBe(100);
    expect(brain.entity.target).toBe(""); expect(brain.entity.targetname).toBe("");
    expect(brain.entity.combatTarget).toBe(""); expect(brain.entity.deathTarget).toBe("");
    expect(brain.entity.enemy).toBe(scene.player.id);
    expect(scene.game.counters.totalMonsters).toBe(3);
    medic.dispatch("medic_hook_retract"); expect(revived?.state.resurrecting).toBe(false);
    scene.actors.close();
  });

  test("Jorg's death frame launches Makron and keeps the boss explosion scheduler", () => {
    const scene = fixture(), jorg = scene.spawn("monster_jorg");
    expect(jorg.entity.model2).toBe("models/monsters/boss3/jorg/tris.md2");
    scene.advance(0.1);
    scene.game.damage(jorg.entity.actor.id, scene.playerEntity, scene.player.id, 4000, 0, zero, zero, zero, 0);
    expect(jorg.state.move.name).toBe("jorg_move_death");
    const toss = jorg.state.move.frames.findIndex(frame => frame.actions.includes("MakronToss"));
    expect(toss).toBeGreaterThanOrEqual(0);
    jorg.entity.frame = jorg.state.move.firstFrame + toss - 1;
    scene.advance(0.2);
    const makron = [...scene.game.entities.values()].find(entity => entity.classname === "monster_makron");
    if (makron === undefined) throw new Error("Jorg's death did not allocate Makron");
    expect(scene.monsters.context(makron.actor.id)).toBeNull();
    scene.advance(0.3);
    const explosions = () => scene.events.filter(event => event.kind === "effect" && event.effect === "q2:explosion1").length;
    const initial = explosions(); expect(initial).toBeGreaterThan(0);
    scene.advance(0.4); expect(explosions()).toBe(initial + 1);
    for (let frame = 5; frame <= 10; frame++) scene.advance(frame / 10);
    expect(scene.monsters.context(makron.actor.id)?.state.move.name).toBe("makron_move_sight");
    expect(scene.combat.read(makron.actor.id)?.health).toBe(3000);
    expect(scene.game.body(makron).velocity.z).toBe(200);
    scene.actors.close();
  });

  test("Gunner bullets and grenades use the shared ballistics authority against a Q3 player", () => {
    const scene = fixture(), gunner = scene.spawn("monster_gunner");
    gunner.entity.enemy = scene.player.id; gunner.entity.frame = gunnerFrame.attak216;
    gunner.dispatch("GunnerFire");
    expect(scene.combat.read(scene.player.id)?.health).toBe(997);
    gunner.dispatch("GunnerGrenade");
    const grenade = [...scene.game.entities.values()].find(entity => entity.classname === "grenade");
    if (grenade === undefined) throw new Error("Gunner did not fire the shared grenade");
    expect(grenade.owner).toBe(gunner.entity.actor.id);
    expect(grenade.damage).toBe(50);
    expect(scene.game.body(grenade).velocity.x).toBeGreaterThan(500);
    scene.actors.close();
  });

  test("Insane crawl and crucifix flags retain their source meaning", () => {
    const scene = fixture(), crawling = scene.spawn("misc_insane", new Map([["spawnflags", "4"]])), crucified = scene.spawn("misc_insane", new Map([["spawnflags", "8"]]));
    expect(crawling.entity.spawnflags).toBe(4);
    crawling.walk(); expect(crawling.state.move.name).toBe("insane_move_crawl");
    expect(crucified.state.locomotion).toBe("fly");
    expect(crucified.entity.flags & 2048).toBe(2048);
    expect(scene.game.body(crucified.entity).bounds).toEqual({ min: { x: -16, y: 0, z: 0 }, max: { x: 16, y: 8, z: 32 } });
    expect(scene.game.counters.totalMonsters).toBe(0);
    scene.actors.close();
  });
});
