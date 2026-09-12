import { monsterPowerArmor } from "../../../../src/content/q2/missionpacks/monsters/power-armor.ts";
import { decodeQ2MonstersCheckpoint, encodeQ2MonstersCheckpoint } from "../../../../src/persistence/q2-monsters.ts";
import { findRereleaseSpawnPoint, checkRereleaseGroundSpawnPoint } from "../../../../src/content/q2/rerelease/monsters/spawn-placement.ts";
import { Q2MissionPackMonsterState } from "../../../../src/content/q2/missionpacks/monsters/state.ts";
import { medicFrame } from "../../../../src/content/q2/rerelease/monsters/tables/medic.ts";
import { decodeQ2MissionPackMonstersCheckpoint, encodeQ2MissionPackMonstersCheckpoint } from "../../../../src/persistence/q2-missionpacks.ts";
import { describe, expect, test } from "bun:test";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { ActorId, OwnedActor } from "../../../../src/contracts/identity.ts";
import type { Vec3 } from "../../../../src/contracts/math.ts";
import type { TraceResult } from "../../../../src/contracts/scene.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ2CombatPolicy, nativeVictimArmor } from "../../../../src/world/gameplay/index.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { readQ2Bsp } from "../../../../src/formats/q2-map/index.ts";
import { parseQ2Entities } from "../../../../src/content/q2/foundation/fields.ts";
import type { Q2FoundationHost, Q2PresentationEvent, Q2SpawnFields, Q2TraceRequest } from "../../../../src/content/q2/foundation/host.ts";
import { Q2Foundation } from "../../../../src/content/q2/foundation/runtime.ts";
import { Q2Ballistics } from "../../../../src/content/q2/foundation/weapons/ballistics.ts";
import { Q2Monsters } from "../../../../src/content/q2/foundation/monsters/index.ts";
import { registerQ2ClassicBaseMonsters } from "../../../../src/content/q2/base/monsters/index.ts";
import { registerQ2RereleaseMonsters } from "../../../../src/content/q2/rerelease/monsters/index.ts";
import { Q2MissionPackProjectiles } from "../../../../src/content/q2/missionpacks/projectiles/index.ts";
import { berserkFrame } from "../../../../src/content/q2/rerelease/monsters/tables/berserk.ts";
import { guardianFrame } from "../../../../src/content/q2/rerelease/monsters/tables/guardian.ts";
import { shamblerFrame } from "../../../../src/content/q2/rerelease/monsters/tables/shambler.ts";
import { guncmdrFrame } from "../../../../src/content/q2/rerelease/monsters/tables/guncmdr.ts";
import { Q2RereleaseRandom } from "../../../../src/core/random/q2-rerelease.ts";
import { insaneFrame } from "../../../../src/content/q2/rerelease/monsters/tables/insane.ts";
import { parasiteFrame } from "../../../../src/content/q2/rerelease/monsters/tables/parasite.ts";
import { brainFrame } from "../../../../src/content/q2/rerelease/monsters/tables/brain.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };

function fixture(isN64 = false, gravity = 800) {
  const actors = new SessionActorRegistry(createIdentityOwner("q2-base-monsters")), callbacks = new ActorCallbackTable(actors);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  const inventory = new SharedInventoryTable(actors), scheduled = new Map<OwnedActor, number>(), events: Q2PresentationEvent[] = [];
  const world = actors.allocateAtSource("q2:game", 0, "q2:worldspawn"), player = actors.allocate("q3:character", "q3:sarge");
  bodies.create(world, { origin: zero, angles: zero, velocity: zero, bounds: { min: zero, max: zero }, ground: null });
  bodies.create(player, { origin: { x: 500, y: 0, z: 24 }, angles: zero, velocity: zero, bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } }, ground: world.id });
  combat.create(player, { health: 1000, armor: { kind: "none" }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
  let now = 0, rayActor: ActorId = player.id;
  const random: number[] = [], diagnostics: string[] = [], rereleaseRandom = new Q2RereleaseRandom(1);
  const plane = { normal: { x: 0, y: 0, z: 1 }, distance: 0, type: 2, signbits: 0 };
  const traces: Q2TraceRequest[] = [];
  const trace = (request: Q2TraceRequest): TraceResult => {
    traces.push(request);
    const clear: TraceResult = { kind: "q2", fraction: 1, startSolid: false, allSolid: false, end: request.end, hit: { kind: "none" }, contact: { kind: "none" }, contents: 0, surface: null, sourcePlane: plane, secondary: null };
    if (request.bounds !== null && request.end.z < request.start.z && request.end.z + request.bounds.min.z <= 0) {
      const z = -request.bounds.min.z;
      return { ...clear, fraction: Math.max(0, (request.start.z - z) / (request.start.z - request.end.z)), end: { ...request.end, z }, hit: { kind: "world", model: 0 }, contact: { kind: "plane", plane }, contents: 1 };
    }
    if (request.bounds === null && (request.mask & 0x2000000) !== 0 && Math.hypot(request.end.x - request.start.x, request.end.y - request.start.y, request.end.z - request.start.z) > 150) return { ...clear, fraction: 0.8, hit: { kind: "actor", actor: rayActor } };
    return clear;
  };
  const host: Q2FoundationHost = {
    actors, callbacks, bodies, combat, inventory, now: () => now, gravity: () => gravity, frameSeconds: () => 0.1, random: () => random.shift() ?? rereleaseRandom.float(), rereleaseRandom,
    schedule: (actor, due) => { if (due === null) scheduled.delete(actor); else scheduled.set(actor, due); return undefined; },
    trace, pointContents: point => point.z < 0 ? 1 : 0, inPvs: () => true, inPhs: () => true, areasConnected: () => true,
    players: () => [player.id], worldActor: () => world.id, isPlayer: actor => actor === player.id, isMonster: actor => ((game.entity(actor)?.serverFlags ?? 0) & 4) !== 0,
    touchTriggers: () => undefined, nearby: () => [...game.entities.values()].map(entity => entity.actor.id), inlineModelBounds: () => ({ min: zero, max: zero }),
    setSolid: () => undefined, setMotion: () => undefined, setAreaPortal: () => undefined, emit: event => { events.push(event); return undefined; },
    playerViewState: () => ({ viewAngles: zero, oldVelocity: zero }), keyConsumed: () => undefined, prepareLevelChange: () => undefined, transition: () => undefined,
    diagnostic: message => { diagnostics.push(message); return undefined; },
  };
  combat.register(createQ2CombatPolicy({ id: "q2:combat", armor: nativeVictimArmor(request => ({ arithmetic: "binary64", screenFacingDot: 1, q2: { product: "rerelease", ctf: false, alive: (combat.read(request.target)?.health ?? 0) > 0 } })),
    context: request => ({ arithmetic: "binary64", player: request.target === player.id, monster: host.isMonster(request.target), attackerPlayer: request.attack.attacker === player.id,
      hasEnemy: game.entity(request.target)?.enemy !== null, easySkill: false, deathmatch: false, defenderSphere: false, teamDamageEnabled: false, friendlyFire: false,
      nuke: false, noKnockback: true, movable: false, rejectTeamDamage: false, suppressPain: false }) }));
  const weapons = new Q2Ballistics({ emit: () => undefined, noise: () => undefined, dodge: () => undefined, lagCompensation: { kind: "current-world" }, ammoChanged: () => undefined, canTarget: () => true });
  const monsters = new Q2Monsters(weapons); registerQ2ClassicBaseMonsters(monsters);
  const projectiles = new Q2MissionPackProjectiles({ base: weapons, monster: actor => monsters.context(actor), playerEffect: () => undefined });
  const source = new Q2MissionPackMonsterState();
  const module = registerQ2RereleaseMonsters(monsters, { source, isN64, expansion: "base", weapons: projectiles });
  const game = new Q2Foundation(host, { edition: "rerelease", mapName: "base1", skill: 1, mode: "singleplayer", deathmatchFlags: 0, maxClients: 1, provider: "q2:game", campaign: "q2:base", combatProvider: "q2:combat", inventoryProvider: "q2:inventory", movementProvider: "q1:movement" }, [module]);
  const playerEntity = game.attachPlayer(player);
  return { actors, callbacks, bodies, combat, inventory, player, playerEntity, game, monsters, source, events, random, diagnostics, traces,
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

describe("rerelease species on the shared Q2 controller", () => {
  test("retail empty keys and values remain tokens while missing values and braces fail", () => {
    const rows = parseQ2Entities('{ "classname" "path_corner" "" "1" "target" "p_viper8" }\n{ "classname" "func_button" "" "" "message" "" } // tail', "rerelease");
    expect(rows[0]?.values.get("")).toBe("1"); expect(rows[1]?.values.get("")).toBe(""); expect(rows[1]?.values.get("message")).toBe("");
    expect(() => parseQ2Entities('{ "classname" }', "rerelease")).toThrow("missing value");
    expect(() => parseQ2Entities('{ "classname" "func_button" // no closing brace', "rerelease")).toThrow("EOF without closing brace");
  });
  test("admits real retail rerelease monster records and source registrations", async () => {
    const scene = fixture(), archive = await openArchive("/home/buzzkill/Projects/qfiles/q2/rerelease/baseq2/pak0.pak");
    try {
      const wanted = new Set(["monster_berserk", "monster_arachnid", "monster_guardian", "monster_guncmdr", "monster_gunner", "monster_shambler", "monster_tank", "monster_tank_commander", "monster_gladiator", "monster_gladb", "monster_supertank", "monster_boss5", "monster_flipper", "monster_floater", "monster_hover", "monster_flyer", "monster_chick", "monster_mutant", "monster_boss2", "monster_jorg", "monster_makron", "misc_insane"]), representatives = new Map<string, Q2SpawnFields>();
      for (const classname of ["monster_brain", "monster_chick_heat", "monster_parasite"]) wanted.add(classname);
      for (const entry of archive.entries.filter(entry => ["maps/base1.bsp", "maps/boss1.bsp", "maps/boss2.bsp"].includes(entry.path) || entry.path.startsWith("maps/mgu") && entry.path.endsWith(".bsp"))) for (const row of parseQ2Entities(readQ2Bsp(await archive.readEntry(entry)).entities, "rerelease")) if (wanted.has(row.classname)) representatives.set(row.classname, row);
      expect(representatives.has("monster_berserk")).toBe(true);
      for (const row of representatives.values()) { const entity = scene.game.spawn(row); expect(scene.monsters.context(entity.actor.id)).not.toBeNull(); }
      for (const classname of wanted) expect(scene.spawn(classname).state.move.frames.length).toBeGreaterThan(0);
      expect(scene.diagnostics).toEqual([]);
    } finally { archive.close(); scene.actors.close(); }
  });

  test("Floater disguise ignores pain and wakes into the original pop animation", () => {
    const scene = fixture(), monster = scene.spawn("monster_floater", new Map([["spawnflags", "8"], ["origin", "0 0 24"]]));
    try {
      expect(monster.state.move.name).toBe("floater_move_disguise");
      monster.entity.enemy = scene.player.id;
      scene.game.damage(monster.entity.actor.id, scene.playerEntity, scene.player.id, 1, 0, zero, zero, zero, 0);
      scene.monsters.endFrame(scene.game);
      expect(monster.state.move.name).toBe("floater_move_disguise"); expect(monster.state.painTime).toBe(0);
      monster.run(); expect(monster.state.move.name).toBe("floater_move_pop");
      scene.random.push(0, 0); monster.attack();
      expect(monster.state.move.name).toBe("floater_move_attack1a"); expect(monster.state.attackState).toBe("sliding");
      expect(scene.game.body(monster.entity).bounds.max.z).toBe(48);
    } finally { scene.actors.close(); }
  });

  test("Chick fires a 650-unit rocket and clears blind steering at reload", () => {
    const scene = fixture(), monster = scene.spawn("monster_chick");
    try {
      monster.entity.enemy = scene.player.id; monster.dispatch("ChickRocket");
      const rocket = [...scene.game.entities.values()].find(entity => entity.classname === "rocket");
      if (rocket === undefined) throw new Error("Chick did not fire its rerelease rocket");
      const velocity = scene.game.body(rocket).velocity;
      expect(Math.hypot(velocity.x, velocity.y, velocity.z)).toBeCloseTo(650, 4);
      monster.state.manualSteering = true; monster.dispatch("chick_rerocket");
      expect(monster.state.manualSteering).toBe(false); expect(monster.state.move.name).toBe("chick_move_end_attack1");
    } finally { scene.actors.close(); }
  });

  test("Mutant leap damages once even below classic impact speed and restores its named touch", () => {
    const scene = fixture(), monster = scene.spawn("monster_mutant");
    try {
      monster.dispatch("mutant_jump_takeoff");
      expect(scene.game.body(monster.entity).velocity).toEqual({ x: 425, y: 0, z: 160 });
      const source = scene.game.capture(), controller = scene.monsters.capture();
      expect(source.entities.find(entity => entity.actor.slot === monster.entity.actor.id.slot)?.callbacks.touch).toBe("mutant_jump_touch");
      scene.game.restore(source); scene.monsters.restore(scene.game, controller);
      const restored = scene.monsters.context(monster.entity.actor.id);
      if (restored === null || restored.entity.touch === null) throw new Error("Mutant jump touch was not restored");
      scene.game.move(restored.entity, { velocity: { x: 100, y: 0, z: 0 } });
      const touch = restored.entity.touch;
      scene.random.push(0); touch(restored.entity, scene.game, { self: restored.entity.actor, other: scene.player.id, plane: null, surface: null });
      touch(restored.entity, scene.game, { self: restored.entity.actor, other: scene.player.id, plane: null, surface: null });
      expect(scene.combat.read(scene.player.id)?.health).toBe(960); expect(restored.entity.style).toBe(0);
    } finally { scene.actors.close(); }
  });

  test("Parasite launches a saved physical proboscis, drains health, and retracts on pain", () => {
    const scene = fixture(), monster = scene.spawn("monster_parasite");
    try {
      monster.entity.enemy = scene.player.id; monster.setMove("parasite_move_fire_proboscis"); monster.entity.frame = parasiteFrame.drain03;
      scene.combat.setHealth(monster.entity.actor, 100); monster.dispatch("parasite_fire_proboscis");
      const tip = scene.game.entity(monster.entity.proboscus);
      if (tip === null || tip.touch === null || tip.think === null) throw new Error("Parasite did not create a physical proboscis");
      expect(tip.speed).toBe(1250); expect(tip.motion).toBe("fly-missile");
      scene.game.move(tip, { origin: scene.game.body(scene.playerEntity).origin });
      tip.touch(tip, scene.game, { self: tip.actor, other: scene.player.id, plane: null, surface: null });
      expect(tip.style).toBe(1); expect(monster.state.nextFrame).toBe(parasiteFrame.drain06);
      tip.think(tip, scene.game); expect(scene.combat.read(scene.player.id)?.health).toBe(993); expect(scene.combat.read(monster.entity.actor.id)?.health).toBe(102);
      const source = scene.game.capture(), saved = source.entities.find(entity => entity.actor.slot === tip.actor.id.slot);
      expect(saved?.callbacks.touch).toBe("rerelease.parasite.proboscis_touch");
      expect(saved?.callbacks.think).toBe("rerelease.parasite.proboscis_think"); expect(saved?.links.proboscus).not.toBeNull();
      expect(source.entities.find(entity => entity.actor.slot === monster.entity.actor.id.slot)?.links.proboscus?.generation).toBe(tip.actor.id.generation);
      scene.game.damage(monster.entity.actor.id, scene.playerEntity, scene.player.id, 1, 0, zero, zero, zero, 0); scene.monsters.endFrame(scene.game);
      expect(tip.style).toBe(2); expect(tip.speed).toBe(2500); expect(monster.state.move.name).toBe("parasite_move_pain1");
      tip.think(tip, scene.game); expect(tip.style).toBe(3);
      tip.think(tip, scene.game); expect(monster.entity.proboscus).toBeNull(); expect(scene.game.entity(tip.actor.id)).toBeNull();
    } finally { scene.actors.close(); }
  });

  test("Brain fires both named saved eye beams and heat Chick selects guided rockets", () => {
    const scene = fixture(), brain = scene.spawn("monster_brain"), chick = scene.spawn("monster_chick_heat");
    try {
      brain.entity.enemy = scene.player.id; brain.entity.frame = brainFrame.walk101; brain.dispatch("brain_laserbeam");
      expect(scene.combat.read(scene.player.id)?.health).toBe(998);
      const saved = scene.game.capture();
      expect(saved.entities.find(entity => entity.actor.slot === brain.entity.beam?.slot)?.callbacks.postthink).toBe("rerelease.brain.right_eye_update");
      expect(saved.entities.find(entity => entity.actor.slot === brain.entity.beam2?.slot)?.callbacks.postthink).toBe("rerelease.brain.left_eye_update");
      chick.entity.enemy = scene.player.id; chick.dispatch("ChickRocket");
      const rocket = [...scene.game.entities.values()].find(entity => entity.classname === "rocket" && entity.owner?.equals(chick.entity.actor.id) === true);
      if (rocket === undefined) throw new Error("Heat Chick did not fire a guided rocket");
      expect(rocket.speed).toBe(500); expect(rocket.accel).toBe(0.15); expect(rocket.think).not.toBeNull(); expect(chick.entity.skin).toBe(2);
    } finally { scene.actors.close(); }
  });

  test("Hover corpse resumes its named delayed explosion after restoring", () => {
    const scene = fixture(), monster = scene.spawn("monster_hover");
    try {
      monster.dispatch("hover_dead");
      const source = scene.game.capture(), controller = scene.monsters.capture();
      expect(source.entities.find(entity => entity.actor.slot === monster.entity.actor.id.slot)?.callbacks.think).toBe("hover_deadthink");
      scene.game.restore(source); scene.monsters.restore(scene.game, controller);
      const restored = scene.monsters.context(monster.entity.actor.id);
      if (restored === null || restored.entity.think === null) throw new Error("Hover corpse think was not restored");
      scene.game.move(restored.entity, { ground: scene.game.host.worldActor() });
      restored.entity.think(restored.entity, scene.game);
      expect(restored.state.gibbed).toBe(true);
      expect(scene.events.some(event => event.kind === "effect" && event.effect === "q2:explosion1")).toBe(true);
    } finally { scene.actors.close(); }
  });

  test("Insane quiet and crucified flags preserve rerelease voice and hull behavior", () => {
    const scene = fixture(), monster = scene.spawn("misc_insane", new Map([["spawnflags", "72"], ["origin", "0 0 24"]]));
    try {
      expect(monster.state.locomotion).toBe("stationary");
      expect(scene.game.body(monster.entity).bounds).toEqual({ min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } });
      scene.advance(1); scene.events.length = 0;
      monster.dispatch("insane_moan"); monster.dispatch("insane_shake"); monster.dispatch("insane_scream");
      expect(scene.events.some(event => event.kind === "sound")).toBe(false);
      monster.entity.frame = insaneFrame.stand1;
      scene.game.damage(monster.entity.actor.id, scene.playerEntity, scene.player.id, 1, 0, zero, zero, zero, 0);
      scene.monsters.endFrame(scene.game);
      expect(monster.state.move.name).toBe("insane_move_struggle_cross");
    } finally { scene.actors.close(); }
  });

  test("Actor uses a named path callback and keeps firing independently of its pause timer", () => {
    const scene = fixture();
    try {
      const target = scene.game.spawn({ classname: "target_actor", ordinal: -1, values: new Map([["targetname", "actor_path"], ["origin", "100 0 24"]]) });
      const monster = scene.spawn("misc_actor", new Map([["targetname", "friend"], ["target", "actor_path"], ["origin", "0 0 24"]]));
      if (monster.entity.use === null) throw new Error("Actor has no use callback");
      const saved = scene.game.capture();
      expect(saved.entities.find(entity => entity.actor.slot === monster.entity.actor.id.slot)?.callbacks.use).toBe("rerelease.actor.actor_use");
      expect(saved.entities.find(entity => entity.actor.slot === target.actor.id.slot)?.callbacks.touch).toBe("rerelease.actor.target_actor_touch");
      monster.entity.use(monster.entity, scene.game, null, scene.player.id);
      expect(monster.state.moveTarget).toBe(target.actor.id); expect(monster.state.move.name).toBe("actor_move_walk");
      monster.entity.enemy = scene.player.id; monster.state.pauseTime = 0; scene.random.push(0); monster.attack(); monster.dispatch("actor_fire");
      expect(monster.state.fireWait).toBe(1); expect(monster.state.holdFrame).toBe(true);
    } finally { scene.actors.close(); }
  });

  test("Boss2 N64 uses its hyperblaster and moving single-rocket launcher", () => {
    const scene = fixture(), monster = scene.spawn("monster_boss2", new Map([["spawnflags", "8"], ["origin", "0 0 24"]]));
    try {
      monster.entity.enemy = scene.player.id; scene.random.push(0); monster.attack();
      expect(monster.state.move.name).toBe("boss2_move_attack_hb");
      monster.dispatch("Boss2Rocket64");
      const rocket = [...scene.game.entities.values()].find(entity => entity.classname === "rocket");
      if (rocket === undefined) throw new Error("N64 Boss2 did not fire its rocket");
      expect(monster.entity.count).toBe(1); expect(rocket.damage).toBe(35);
      const velocity = scene.game.body(rocket).velocity;
      expect(Math.hypot(velocity.x, velocity.y, velocity.z)).toBeCloseTo(750, 4);
    } finally { scene.actors.close(); }
  });

  test("Jorg ejects Makron immediately and Makron keeps its own saved rail aim", () => {
    const scene = fixture(), monster = scene.spawn("monster_jorg");
    try {
      expect(scene.combat.read(monster.entity.actor.id)?.health).toBe(8000);
      expect(monster.entity.model).toBe("models/monsters/boss3/jorg/tris.md2");
      monster.entity.enemy = scene.player.id; monster.dispatch("jorg_dead");
      const entity = [...scene.game.entities.values()].find(entity => entity.classname === "monster_makron");
      if (entity === undefined) throw new Error("Jorg did not eject Makron immediately");
      const makron = scene.monsters.context(entity.actor.id);
      if (makron === null) throw new Error("Ejected Makron has no shared source context");
      expect(scene.game.body(entity).velocity.z).toBe(200); expect(makron.state.move.name).toBe("makron_move_sight");
      makron.dispatch("MakronSaveloc"); expect(entity.pos1.x).toBe(500);
      makron.state.blindFireTarget = { x: -1000, y: 0, z: 0 };
      makron.dispatch("MakronRailgun");
      const rail = scene.events.find(event => event.kind === "monster-muzzleflash" && event.actor.equals(entity.actor.id) && event.flash === 119);
      if (rail === undefined || rail.kind !== "monster-muzzleflash") throw new Error("Makron rail did not produce its source muzzle event");
      expect(rail.direction.x).toBeGreaterThan(0);
    } finally { scene.actors.close(); }
  });

  test("Berserk uses reduced spike damage and new long-range leap", () => {
    const scene = fixture(), monster = scene.spawn("monster_berserk");
    try {
      monster.entity.enemy = scene.player.id;
      scene.bodies.write(scene.player, { ...scene.game.body(scene.playerEntity), origin: { x: 40, y: 0, z: 24 } });
      scene.advance(1); scene.random.push(0); monster.dispatch("berserk_attack_spike");
      expect(scene.combat.read(scene.player.id)?.health).toBe(995);
      scene.bodies.write(scene.player, { ...scene.game.body(scene.playerEntity), origin: { x: 400, y: 0, z: 24 } });
      scene.random.push(0); monster.attack(); expect(monster.state.move.name).toBe("berserk_move_attack_strike");
      monster.entity.frame = berserkFrame.jump1; monster.dispatch("berserk_jump_takeoff");
      expect(scene.game.body(monster.entity).velocity.z).toBe(450);
    } finally { scene.actors.close(); }
  });

  test("Guardian suppresses pain while firing and alternates saved laser entities", () => {
    const scene = fixture(), monster = scene.spawn("monster_guardian");
    try {
      monster.entity.enemy = scene.player.id; scene.advance(1); monster.setMove("guardian_move_atk2_fire"); monster.entity.frame = guardianFrame.atk2_fire1;
      scene.game.damage(monster.entity.actor.id, scene.playerEntity, scene.player.id, 100, 0, zero, zero, zero, 0);
      scene.monsters.endFrame(scene.game);
      expect(monster.state.move.name).toBe("guardian_move_atk2_fire");
      monster.dispatch("guardian_laser_fire"); monster.entity.frame++; monster.dispatch("guardian_laser_fire");
      expect(monster.entity.beam).not.toBeNull(); expect(monster.entity.beam2).not.toBeNull();
      expect(scene.game.entity(monster.entity.beam)?.postthink).not.toBeNull();
      expect(scene.combat.read(scene.player.id)?.health).toBe(950);
    } finally { scene.actors.close(); }
  });

  test("Shambler saves windup endpoints and frees the beam at lightning release", () => {
    const scene = fixture(), monster = scene.spawn("monster_shambler");
    try {
      monster.entity.enemy = scene.player.id; monster.entity.frame = shamblerFrame.magic01; monster.dispatch("shambler_windup");
      const beam = monster.entity.beam; expect(beam).not.toBeNull(); expect(scene.game.entity(beam)?.pos2).not.toEqual(zero);
      monster.entity.frame = shamblerFrame.magic06; monster.dispatch("ShamblerSaveLoc");
      expect(monster.entity.beam).toBeNull(); expect(scene.game.entity(beam)).toBeNull(); expect(monster.state.nextFrame).toBe(shamblerFrame.magic09);
      scene.random.push(0); monster.dispatch("ShamblerCastLightning"); expect(scene.combat.read(scene.player.id)?.health).toBe(992);
    } finally { scene.actors.close(); }
  });

  test("Gun commander uses flechettes and its scaled power shield", () => {
    const scene = fixture(), monster = scene.spawn("monster_guncmdr");
    try {
      expect(scene.game.body(monster.entity).bounds.max.z).toBe(45);
      expect(scene.inventory.count(monster.entity.actor.id, "q2:monster-power")).toBe(200);
      monster.entity.enemy = scene.player.id; monster.entity.frame = guncmdrFrame.c_attack107;
      monster.dispatch("GunnerCmdrFire");
      const bolt = [...scene.game.entities.values()].find(entity => entity.classname === "flechette");
      if (bolt === undefined || bolt.touch === null) throw new Error("Gun commander did not create a source flechette");
      expect(bolt.model).toBe("models/proj/flechette/tris.md2");
      bolt.touch(bolt, scene.game, { self: bolt.actor, other: scene.player.id, plane: null, surface: null });
      expect(scene.combat.read(scene.player.id)?.health).toBe(996);
      expect(scene.events.some(event => event.kind === "monster-muzzleflash" && event.actor.equals(monster.entity.actor.id))).toBe(true);
    } finally { scene.actors.close(); }
  });

  test("Quake II 64 commanders scale and supertanks retain the long death loop", () => {
    const scene = fixture(true);
    try {
      const commander = scene.spawn("monster_tank_commander", new Map([["spawnflags", "8"]]));
      expect(scene.combat.read(commander.entity.actor.id)?.health).toBe(1500); expect(scene.game.body(commander.entity).bounds.max.z).toBe(108);
      const tank = scene.spawn("monster_supertank"); expect(tank.entity.count).toBe(10);
      tank.dispatch("BossLoop"); expect(tank.entity.count).toBe(9); expect(tank.state.nextFrame).toBeGreaterThan(0);
      const stand = scene.game.spawn({ classname: "monster_tank_stand", ordinal: -1, values: new Map<string, string>() });
      expect(stand.scale).toBe(1.5); expect(scene.game.body(stand).bounds.max.z).toBe(96);
      if (stand.use === null) throw new Error("Quake II 64 tank stand did not bind its source use callback");
      stand.use(stand, scene.game, null, null); expect(scene.game.entity(stand.actor.id)).toBeNull();
    } finally { scene.actors.close(); }
  });
});

test("Rerelease medic revives the same actor and preserves health and commander accounting", () => {
  const scene = fixture();
  let medic = scene.spawn("monster_medic"), patient = scene.spawn("monster_medic", new Map([["origin", "200 0 24"]]));
  try {
    const actor = patient.entity.actor.id;
    patient.entity.healthTarget = "old_health"; patient.entity.itemTarget = "old_item";
    patient.entity.maxHealth = 740; patient.state.gibHealth = -130;
    patient.state.monsterSlots = 9; patient.state.monsterUsed = 3;
    monsterPowerArmor(patient, "shield", 480);
    patient.state.initialPowerArmorType = "shield"; patient.state.maxPowerArmorPower = 480;
    patient.state.baseHealth = 370; patient.state.healthScaling = 2;
    scene.inventory.configure(patient.entity.actor, { item: "q2:monster-power", count: 5, capacity: 480 });
    const checkpoint = decodeQ2MonstersCheckpoint(encodeQ2MonstersCheckpoint(scene.monsters.capture()));
    const saved = checkpoint.actors.find(entry => entry.actor.slot === actor.slot);
    expect(saved?.state.initialPowerArmorType).toBe("shield"); expect(saved?.state.maxPowerArmorPower).toBe(480);
    expect(saved?.state.baseHealth).toBe(370); expect(saved?.state.healthScaling).toBe(2);
    scene.monsters.restore(scene.game, checkpoint);
    const restoredMedic = scene.monsters.context(medic.entity.actor.id), restoredPatient = scene.monsters.context(actor);
    if (restoredMedic === null || restoredPatient === null) throw new Error("Medic controller metadata did not restore");
    medic = restoredMedic; patient = restoredPatient;
    scene.combat.setHealth(patient.entity.actor, -10); patient.state.dead = true;
    patient.dispatch("medic_dead");
    medic.entity.enemy = actor; medic.state.oldEnemy = scene.player.id; medic.state.medic = true;
    scene.source.get(patient.entity).healer = medic.entity.actor.id;
    medic.entity.frame = medicFrame.attack43; medic.dispatch("medic_cable_attack");
    expect(patient.state.resurrecting).toBe(true);
    expect(scene.combat.read(actor)?.canTakeDamage).toBe(false);
    medic.entity.frame = medicFrame.attack50; medic.dispatch("medic_cable_attack");
    const revived = scene.monsters.context(actor);
    expect(revived?.entity).toBe(patient.entity);
    expect(patient.entity.healthTarget).toBe(""); expect(patient.entity.itemTarget).toBe("");
    expect(scene.combat.read(actor)?.health).toBe(740);
    expect(revived?.state.gibHealth).toBe(-65);
    expect(revived?.state.monsterSlots).toBe(9);
    expect(revived?.state.monsterUsed).toBe(3);
    expect(revived?.state.initialPowerArmorType).toBe("shield"); expect(revived?.state.maxPowerArmorPower).toBe(480);
    expect(revived?.state.baseHealth).toBe(370); expect(revived?.state.healthScaling).toBe(2);
    expect(scene.inventory.count(actor, "q2:monster-power")).toBe(480);
    const armor = scene.combat.read(actor)?.armor;
    expect(armor?.kind === "q2" ? armor.powerArmor : null).toEqual({ kind: "shield", cells: 480 });
    expect(revived?.entity.enemy).toBe(scene.player.id);
    expect(scene.source.get(patient.entity).healer).toBeNull();
    expect(medic.entity.enemy).toBe(scene.player.id);
  } finally { scene.actors.close(); }
});

test("Rerelease medic source state saves reinforcement choices and rejects healed players", () => {
  const scene = fixture(), medic = scene.spawn("monster_medic_commander");
  try {
    expect(medic.state.monsterSlots).toBe(4);
    const state = scene.source.get(medic.entity);
    state.chosenReinforcements = [1, 0]; state.reactToDamageTime = 4.25; state.medicTries = 2;
    const checkpoint = decodeQ2MissionPackMonstersCheckpoint(encodeQ2MissionPackMonstersCheckpoint(scene.source.capture(scene.game)));
    state.chosenReinforcements.push(6);
    scene.source.restore(scene.game, checkpoint);
    expect(scene.source.get(medic.entity).chosenReinforcements).toEqual([1, 0]);
    expect(scene.source.get(medic.entity).reactToDamageTime).toBe(4.25);
    expect(scene.source.get(medic.entity).medicTries).toBe(2);
    medic.entity.enemy = scene.player.id; medic.state.medic = true; medic.entity.frame = medicFrame.attack43;
    medic.dispatch("medic_cable_attack");
    expect(medic.state.medic).toBe(true);
    expect(scene.combat.read(scene.player.id)?.health).toBe(1000);
    scene.random.push(0); medic.dispatch("medic_quick_attack");
    expect(medic.state.nextMove?.name).toBe("medic_move_attackHyperBlaster");
    expect(medic.state.nextFrame).toBe(medicFrame.attack16);
  } finally { scene.actors.close(); }
});

test("Rerelease medic timeout marks a corpse and summoned deaths release their weighted slots", () => {
  const scene = fixture(), medic = scene.spawn("monster_medic_commander"), patient = scene.spawn("monster_medic", new Map([["origin", "200 0 24"]]));
  try {
    scene.combat.setHealth(patient.entity.actor, -10); patient.state.dead = true; patient.dispatch("medic_dead");
    medic.state.medic = true; medic.state.oldEnemy = scene.player.id; medic.entity.enemy = patient.entity.actor.id;
    medic.entity.timestamp = -1;
    medic.checkAttack(200);
    expect(scene.source.get(patient.entity).badMedic1).toBe(medic.entity.actor.id);
    expect(medic.state.medic).toBe(false);
    expect(medic.entity.enemy).toBe(scene.player.id);
    const child = scene.spawn("monster_medic");
    child.state.spawnedBy = "medic"; child.state.commander = medic.entity.actor.id; child.state.monsterSlots = 3;
    medic.state.monsterSlots = 9; medic.state.monsterUsed = 5;
    scene.game.damage(child.entity.actor.id, scene.playerEntity, scene.player.id, 350, 0, zero, zero, zero, 0);
    scene.monsters.endFrame(scene.game);
    expect(medic.state.monsterSlots).toBe(9);
    expect(medic.state.monsterUsed).toBe(2);
  } finally { scene.actors.close(); }
});

test("Rerelease commander growth uses saved callbacks and expires with its beam", () => {
  const scene = fixture(), medic = scene.spawn("monster_medic_commander");
  try {
    scene.source.get(medic.entity).chosenReinforcements = [0];
    medic.dispatch("medic_spawngrows");
    const growth = [...scene.game.entities.values()].find(entity => entity.classname === "spawngro");
    if (growth === undefined) throw new Error("Medic reinforcement growth did not spawn");
    const beam = growth.beam;
    expect(growth.model).toBe("models/items/spawngro3/tris.md2");
    expect(growth.timestamp).toBe(1);
    const saved = scene.game.capture().entities.find(entity => entity.actor.slot === growth.actor.id.slot);
    expect(saved?.callbacks.think).toBe("rerelease.medic.spawngrow_think");
    scene.advance(0.5);
    expect(growth.alpha).toBe(0.25);
    expect(scene.game.entity(beam)).not.toBeNull();
    scene.advance(1);
    expect(scene.game.entity(growth.actor.id)).toBeNull();
    expect(scene.game.entity(beam)).toBeNull();
  } finally { scene.actors.close(); }
});


test("Rerelease reinforcement placement drops farther than maxMoveUp and rejects unsupported ground", () => {
  const scene = fixture(), medic = scene.spawn("monster_medic");
  try {
    const bounds = scene.game.body(medic.entity).bounds, high = { x: 200, y: 0, z: 104 };
    expect(findRereleaseSpawnPoint(scene.game, high, bounds, 32)).toEqual({ x: 200, y: 0, z: 24 });
    expect(checkRereleaseGroundSpawnPoint(scene.game, high, bounds, 256, -1)).toBe(false);
  } finally { scene.actors.close(); }
});


test("rerelease gunner prediction and grenade launch use host gravity without a source world entity", () => {
  function launch(gravity: number) {
    const scene = fixture(false, gravity), gunner = scene.spawn("monster_gunner");
    gunner.entity.enemy = scene.player.id;
    scene.rayHit(scene.game.host.worldActor());
    expect(scene.game.entity(scene.game.host.worldActor())).toBeNull();
    scene.random.push(0.5, 0.5);
    gunner.dispatch("GunnerGrenade");
    const grenade = [...scene.game.entities.values()].find(entity => entity.classname === "grenade");
    if (grenade === undefined) throw new Error("Gunner did not launch its source grenade");
    const trajectory = scene.traces.find(trace => trace.bounds === null && trace.ignore === null);
    if (trajectory === undefined) throw new Error("Gunner did not simulate a firing trajectory");
    return { velocity: scene.game.body(grenade).velocity, trajectory };
  }
  const normal = launch(800), low = launch(400);
  expect(low.trajectory.start).toEqual(normal.trajectory.start);
  expect(low.trajectory.end.x).toBeCloseTo(normal.trajectory.end.x, 8);
  expect(low.trajectory.end.z).toBeGreaterThan(normal.trajectory.end.z);
  expect(low.velocity.z).toBeLessThan(normal.velocity.z);
  expect(low.velocity).not.toEqual(normal.velocity);
});
