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
import { registerQ2ClassicBaseMonsters } from "../../../../src/content/q2/base/monsters/index.ts";
import { Q2MoverModule } from "../../../../src/content/q2/foundation/movers.ts";
import { Q2MissionPackProjectiles } from "../../../../src/content/q2/missionpacks/projectiles/index.ts";
import { registerQ2MissionPackMonsters, q2XatrixMonsterDefinitions, q2RogueMonsterDefinitions } from "../../../../src/content/q2/missionpacks/monsters/index.ts";
import type { Q2MonsterMissionPack, Q2MissionPackMonsterServices } from "../../../../src/content/q2/missionpacks/monsters/types.ts";
import { medicFrame } from "../../../../src/content/q2/missionpacks/monsters/tables/rogue-medic.ts";
import { finishCorpse } from "../../../../src/content/q2/base/monsters/common.ts";
import { walkMove } from "../../../../src/content/q2/foundation/monsters/ai.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };

export function missionPackMonsterFixture(pack: Q2MonsterMissionPack) {
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
  const monsters = new Q2Monsters(weapons), baseModule = registerQ2ClassicBaseMonsters(monsters);
  const movers = new Q2MoverModule({ pathCorner: (corner, game, actor) => monsters.touchPathCorner(corner, game, actor), combatPoint: (point, game, actor) => monsters.touchCombatPoint(point, game, actor) });
  const bolts = new Q2MissionPackProjectiles({ base: weapons, monster: actor => monsters.context(actor), playerEffect: () => undefined });
  const services: Q2MissionPackMonsterServices = { movers, gravity: () => 800, badArea: actor => bolts.badArea(actor, game), badAreaEntity: (actor, origin) => bolts.badAreaEntity(actor, game, origin), markTeslaArea: (self, tesla) => bolts.markTeslaArea(self, game, tesla), powerups: () => ({ quadUntil: 0, doubleUntil: 0, invulnerabilityUntil: 0 }) };
  const module = registerQ2MissionPackMonsters(monsters, pack, bolts, services);
  const game = new Q2Foundation(host, { edition: "classic", mapName: "base1", skill: 1, mode: "singleplayer", deathmatchFlags: 0, maxClients: 1, provider: "q2:game", campaign: "q2:base", combatProvider: "q2:combat", inventoryProvider: "q2:inventory", movementProvider: "q1:movement" }, [module, baseModule]);
  const playerEntity = game.attachPlayer(player);
  return { module, bolts, services, actors, callbacks, bodies, combat, inventory, player, playerEntity, game, monsters, events, random, diagnostics,
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


const fixture = missionPackMonsterFixture;

describe("original missionpack monster source behavior", () => {
  test("implemented definitions admit their actual retail map entity rows", async () => {
    for (const pack of ["xatrix", "rogue"] satisfies readonly Q2MonsterMissionPack[]) {
      const scene = fixture(pack), definitions = pack === "xatrix" ? q2XatrixMonsterDefinitions(scene.monsters, scene.bolts) : q2RogueMonsterDefinitions(scene.monsters, scene.bolts, scene.services, scene.module.source);
      const names = new Set(definitions.map(definition => definition.classname));
      const archive = await openArchive(`/home/buzzkill/Projects/qfiles/q2/${pack}/pak0.pak`);
      try {
        const representatives = new Map<string, Q2SpawnFields>();
        for (const entry of archive.entries.filter(entry => entry.path.startsWith("maps/") && entry.path.endsWith(".bsp"))) {
          for (const row of parseQ2Entities(readQ2Bsp(await archive.readEntry(entry)).entities, "classic")) if (names.has(row.classname) && !inhibitQ2Spawn(row, scene.game.options)) representatives.set(row.classname, row);
        }
        expect(representatives.size).toBeGreaterThan(3);
        for (const definition of definitions) {
          const row = representatives.get(definition.classname) ?? { classname: definition.classname, ordinal: -1, values: new Map([["origin", "0 0 64"]]) };
          const entity = scene.game.spawn(row), context = scene.monsters.context(entity.actor.id);
          expect(context).not.toBeNull(); expect(entity.model).toBe(definition.model);
          expect(scene.combat.read(entity.actor.id)?.health).toBeGreaterThan(0);
        }
      } finally { archive.close(); scene.actors.close(); }
    }
  });

  test("carrier summons share source counts and return slots through the normal death callback", () => {
    const scene = fixture("rogue"), carrier = scene.spawn("monster_carrier", new Map([["origin", "0 0 180"]]));
    carrier.entity.enemy = scene.player.id;
    const before = scene.game.counters.totalMonsters, slots = carrier.state.monsterSlots;
    carrier.dispatch("carrier_spawn_check");
    const child = [...scene.game.entities.values()].find(entity => entity.classname === "monster_flyer");
    if (child === undefined) throw new Error("Carrier source spawn callback failed to create its flyer");
    const childContext = scene.monsters.context(child.actor.id);
    if (childContext === null) throw new Error("Summoned flyer did not join the shared controller");
    expect(childContext.state.commander).toBe(carrier.entity.actor.id);
    expect(childContext.state.spawnedBy).toBe("carrier"); expect(childContext.state.doNotCount).toBe(true);
    expect(scene.game.counters.totalMonsters).toBe(before); expect(carrier.state.monsterSlots).toBe(slots - 1);
    scene.combat.setHealth(child.actor, -5);
    child.die?.(child, scene.game, { attack: null, self: child.actor, attacker: scene.player.id, inflictor: scene.player.id, damage: 55, kick: 0, point: zero });
    expect(carrier.state.monsterSlots).toBe(slots); expect(scene.game.counters.killedMonsters).toBe(0);
    expect(scene.actors.isLive(child.actor.id)).toBe(false);
    scene.actors.close();
  });

  test("medic commander resurrects the same actor and summons through shared source counts", () => {
    const scene = fixture("rogue"), commander = scene.spawn("monster_medic_commander"), patient = scene.spawn("monster_infantry", new Map([["origin", "140 0 24"]]));
    scene.combat.setHealth(patient.entity.actor, -10); patient.state.dead = true; finishCorpse(patient);
    commander.entity.enemy = scene.player.id; commander.run();
    expect(commander.state.medic).toBe(true); expect(commander.entity.enemy).toBe(patient.entity.actor.id);
    const actor = patient.entity.actor.id, total = scene.game.counters.totalMonsters;
    commander.entity.frame = medicFrame.attack43; commander.dispatch("medic_cable_attack");
    expect(scene.combat.read(actor)?.canTakeDamage).toBe(false);
    expect(patient.state.resurrecting).toBe(true);
    commander.entity.frame = medicFrame.attack50; commander.dispatch("medic_cable_attack");
    const revived = scene.monsters.context(actor);
    expect(revived?.entity.actor.id).toBe(actor); expect(scene.combat.read(actor)?.health).toBe(100);
    expect(revived?.state.doNotCount).toBe(true); expect(revived?.state.resurrecting).toBe(false);
    expect(scene.module.source.get(patient.entity).healer).toBeNull(); expect(scene.game.counters.totalMonsters).toBe(total);
    commander.dispatch("medic_hook_retract");
    expect(commander.entity.enemy).toBe(scene.player.id); expect(commander.state.medic).toBe(false);
    const slots = commander.state.monsterSlots;
    commander.dispatch("medic_determine_spawn"); commander.dispatch("medic_finish_spawn");
    const child = [...scene.game.entities.values()].find(entity => entity.classname === "monster_soldier");
    if (child === undefined) throw new Error("Commander source reinforcement was not spawned");
    expect(scene.monsters.context(child.actor.id)?.state.commander).toBe(commander.entity.actor.id);
    expect(scene.monsters.context(child.actor.id)?.state.spawnedBy).toBe("medic");
    expect(commander.state.monsterSlots).toBe(slots - 1); expect(scene.game.counters.totalMonsters).toBe(total);
    scene.actors.close();
  });

  test("Rogue movement rejects real Tesla areas and reverses steps toward the hazard", () => {
    const scene = fixture("rogue"), actor = scene.spawn("monster_gunner"), tesla = scene.bolts.fireTesla(scene.playerEntity, scene.game, { x: 60, y: 0, z: 24 }, { x: 1, y: 0, z: 0 }, 1, 0);
    const area = scene.bolts.spawnBadArea(scene.game, { x: 40, y: -40, z: -10 }, { x: 80, y: 40, z: 100 }, 0, tesla.actor.id);
    scene.game.move(actor.entity, { ground: scene.game.host.worldActor() });
    expect(walkMove(actor, 0, 32)).toBe(false);
    expect(scene.game.body(actor.entity).origin.x).toBe(0); expect(actor.entity.enemy).toBe(tesla.actor.id);
    expect(scene.module.source.get(actor.entity).blocked).toBe(false);
    scene.game.move(actor.entity, { origin: { x: 50, y: 0, z: 24 }, angles: zero });
    expect(walkMove(actor, 0, 8)).toBe(true); expect(scene.game.body(actor.entity).origin.x).toBe(42);
    actor.state.oldEnemy = scene.player.id; scene.game.remove(area);
    expect(walkMove(actor, 0, 8)).toBe(true); expect(actor.entity.enemy).toBe(scene.player.id);
    expect(scene.game.body(actor.entity).origin.x).toBe(42); expect(scene.module.source.get(actor.entity).badArea).toBeNull();
    scene.actors.close();
  });
});
