import { SharedPhysics } from "../../../src/app/bootstrap/simulation/physics.ts";
import { createNativeQ1PusherServices } from "../../../src/app/bootstrap/simulation/native-q1-pusher.ts";
import { actorCollision, actorMotion, actorFlags } from "../../../src/app/bootstrap/simulation/actor-execution.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { Q1_DONOR_PROFILE } from "../../../src/core/numeric.ts";
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import type { ActorId, OwnedActor } from "../../../src/contracts/identity.ts";
import type { TransitionIntent } from "../../../src/contracts/gameplay.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { SessionActorRegistry, ActorCallbackTable } from "../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ1CombatPolicy, nativeVictimArmor } from "../../../src/world/gameplay/index.ts";
import { Q1Foundation } from "../../../src/content/q1/foundation/runtime.ts";
import type { Q1Event, Q1FoundationHost } from "../../../src/content/q1/foundation/types.ts";
import { ZERO, PLAYER_BOUNDS } from "../../../src/content/q1/foundation/types.ts";
import { registerQ1Base } from "../../../src/content/q1/base/index.ts";
import { registerQ1CampaignAddons, registerQ1Horde, mg1LastSigil, mg3RuneCount, handleQ1AddonImpulse, frameQ1AddonPlayer } from "../../../src/content/q1/addons/index.ts";
import type { Q1AddonEvent } from "../../../src/content/q1/addons/index.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { readQ1Bsp } from "../../../src/formats/q1-map/index.ts";
import type { Q1Entity } from "../../../src/formats/q1-map/index.ts";

function world(program: "mg1" | "mg3", withHorde = false, walkable = false) {
  const actors = new SessionActorRegistry(createIdentityOwner("q1-addon-smoke")), callbacks = new ActorCallbackTable(actors);
  let runtime: Q1Foundation | null = null;
  const bounds = { min: { x: -1024, y: -1024, z: -1024 }, max: { x: 1024, y: 1024, z: 1024 } };
  const scene = createSceneQueries({ kind: "q1-bsp", format: "bsp29", entities: "", planes: [], vertices: [], edges: [], surfaceEdges: [], nodes: [],
    leaves: [-2, -1].map(contents => ({ contents, bounds, faces: { first: 0, count: 0 }, visibilityOffset: null, ambientSound: [0, 0, 0, 0] })),
    leafFaces: [], textures: [], textureInfo: [], faces: [], models: [{ bounds, origin: ZERO, headnodes: [-2, -1, -1, -1], visibleLeaves: 1, faces: { first: 0, count: 0 } }],
    clipnodes: [], visibility: new Uint8Array(), lighting: { kind: "luminance8", samples: new Uint8Array() }, decoupledLightmaps: null, brushList: null, extensions: [] });
  const execution = (actor: OwnedActor) => { const entity = runtime?.entity(actor.id); return entity == null || runtime === null ? null :
    { kind: "q1", entity, services: runtime, content: "q1:rerelease:mg3:test" } satisfies import("../../../src/app/bootstrap/simulation/actor-execution.ts").ActorExecution; };
  const physics: SharedPhysics = new SharedPhysics({ actors, callbacks, scene, numeric: Q1_DONOR_PROFILE, sourceOrder: (a, b) => a.slot - b.slot,
    worldActor: () => runtime?.world?.actor.id ?? null, onBlocked: (actor, other) => runtime?.entity(actor.id)?.blocked?.(other),
    getCollision: actor => { const entry = execution(actor); return entry === null ? null : actorCollision(entry); },
    getMotion: actor => { const entry = execution(actor), body = physics.bodies.read(actor.id); return entry === null || body === null ? null : actorMotion(entry, body); },
    getFlags: actor => { const entry = execution(actor); return entry === null ? { player: true } : actorFlags(entry); } });
  const bodies = physics.bodies;

  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  const inventory = new SharedInventoryTable(actors), events: Q1Event[] = [], addonEvents: Q1AddonEvent[] = [], pending = new Map<OwnedActor, number>(), players: ActorId[] = [];
  const cvars = new Map<string, number>(), transitions: TransitionIntent[] = [];
  const host: Q1FoundationHost = { actors, callbacks, bodies, combat, inventory, random: () => 0.4,
    trace: request => ({ fraction: 1, end: request.end, normal: ZERO, actor: null, startSolid: false, allSolid: false, sky: false, inOpen: true, inWater: false }),
    contents: () => "empty", walkMove: () => walkable, moveToGoal: () => undefined, changeYaw: () => { throw new Error("This check does not drive monster turning"); }, checkBottom: () => false,
    pusherServices: game => createNativeQ1PusherServices(game, physics),
    scheduleThink: (actor, due) => { pending.set(actor, due); return undefined; }, cancelThink: actor => { pending.delete(actor); return undefined; },
    emit: event => { events.push(event); return undefined; }, transition: intent => { transitions.push(intent); return undefined; }, players: () => players, checkClient: () => null,
    classname: actor => runtime?.entity(actor)?.classname ?? "player", powerup: () => undefined,
  };
  const game = new Q1Foundation(host, { edition: "rerelease", skill: 1, deathmatch: 0, coop: false, gravity: 800, maxClients: 4,
    campaign: program === "mg1" ? "q1:mg1" : "q1:mg3", combatProvider: "q1:combat", inventoryProvider: "q1:inventory", movementProvider: "q2:movement" }); runtime = game;
  combat.register(createQ1CombatPolicy({ id: "q1:combat", context: request => game.combatContext(request), armor: nativeVictimArmor(() => ({ arithmetic: "binary32", screenFacingDot: 0 })) }));
  const base = registerQ1Base(game), context = registerQ1CampaignAddons(base, program, {
    emit: event => { addonEvents.push(event); return undefined; }, isMonster: actor => game.entity(actor)?.monster !== null && game.entity(actor) !== null,
    cvar: name => cvars.get(name) ?? 0, setCvar: (name, value) => { cvars.set(name, Number(value)); return undefined; },
  });
  const horde = withHorde ? registerQ1Horde(context, { deadFlag: player => game.health(player) > 0 ? 0 : 2, noTarget: () => false, isBot: () => false,
    respawnTeammate: () => undefined, addScore: () => undefined, restartSession: () => undefined }) : null;
  const player = actors.allocateAtSource("q3:character", 1, "q3:sarge");
  bodies.create(player, { origin: ZERO, angles: ZERO, velocity: ZERO, bounds: PLAYER_BOUNDS, ground: null });
  combat.create(player, { health: 100, armor: { kind: "none" }, mass: 100, canTakeDamage: true, invulnerable: false, team: null }); inventory.create(player, []); players.push(player.id); game.attachPlayer(player);
  const spawn = (classname: string, fields: Readonly<Record<string, string>> = {}) => {
    const source: Q1Entity = { properties: [{ key: "classname", value: classname }, ...Object.entries(fields).map(([key, value]) => ({ key, value }))] };
    const entity = game.create(classname, source); game.spawnEntity(entity); return entity;
  };
  const think = (entity: import("../../../src/content/q1/foundation/entity.ts").Q1Actor, time: number): undefined => {
    pending.delete(entity.actor); callbacks.think(entity.actor, { frame: 0, time: { kind: "seconds", value: time }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" }); return undefined;
  };
  const touch = (entity: import("../../../src/content/q1/foundation/entity.ts").Q1Actor): undefined => { callbacks.touch({ self: entity.actor, other: player.id, plane: null, surface: null }); return undefined; };
  return { actors, game, base, context, horde, combat, player, events, addonEvents, pending, cvars, transitions, spawn, think, touch };
}

test("MG1 fifth rune and MG3 fourth rune keep distinct flags with a foreign character", () => {
  for (const program of ["mg1", "mg3"] satisfies readonly ("mg1" | "mg3")[]) {
    const state = world(program), { game, base, spawn, touch } = state;
    const rune = spawn("item_sigil", { spawnflags: program === "mg1" ? "16" : "136" });
    expect(rune.model).toBe(program === "mg1" ? "progs/mg1_rune5.mdl" : "progs/end4.mdl"); touch(rune);
    expect(base.campaign.readFlags()).toBe(program === "mg1" ? 1040 : 8);
    expect(mg1LastSigil(base.campaign.readFlags())).toBe(program === "mg1" ? 16 : 0);
    expect(mg3RuneCount(base.campaign.readFlags())).toBe(program === "mg1" ? 0 : 1);
    expect(rune.solid).toBe("none"); expect(() => game.capture()).not.toThrow(); state.actors.close();
  }
});

test("timed counters reset their count, and multitouch fires occupied then empty", () => {
  const state = world("mg1"), { game, spawn, player, think, touch } = state;
  let activations = 0;
  game.named.register("test:target", { use: () => { activations++; return undefined; } });
  const target = spawn("trigger_relay", { targetname: "counted" }); target.use = game.named.use(target, "test:target");
  const counter = spawn("trigger_counter_timed", { target: "counted", count: "2", delay: "2" });
  counter.use?.(null, player.id); expect(counter.count).toBe(1); think(counter, 2); expect(counter.count).toBe(2);
  counter.use?.(null, player.id); counter.use?.(null, player.id); expect(activations).toBe(1); expect(game.live(counter)).toBe(false);
  const trigger = spawn("trigger_multitouch", { target: "counted" }); touch(trigger); touch(trigger); expect(activations).toBe(2);
  think(trigger, 2.2); expect(activations).toBe(3); touch(trigger); expect(activations).toBe(4); state.actors.close();
});

test("MG3 breakable pain and light ramp use shared bodies and named saved callbacks", () => {
  const state = world("mg3"), { game, context, spawn, think, player } = state;
  const brush = spawn("func_breakable"); game.time = 10; brush.fields.set("ltime", "2"); game.damage(brush.actor.id, player.id, player.id, 10);
  expect(game.health(brush.actor.id)).toBe(10000); expect(game.body(brush).velocity.z).toBe(-20);
  expect(brush.nextThink).toBe(3);
  game.physicsEntity(brush.actor, 10.05, 0.05); expect(game.body(brush).origin.z).toBe(-1);
  expect(brush.number("ltime")).toBe(Math.fround(2.05));
  spawn("light", { targetname: "ramp_light", style: "32", spawnflags: "1" });
  const ramp = spawn("target_lightramp", { targetname: "ramp", target: "ramp_light", delay: "2" }); think(ramp, 0.1);
  ramp.use?.(null, player.id); context.frame(1); expect(ramp.number("cnt")).toBe(0.5);
  expect(state.events.some(event => event.kind === "lightstyle" && event.style === 32 && event.pattern === "g")).toBe(true);
  expect(() => game.capture()).not.toThrow(); state.actors.close();
});

test("actual MG1 hub and Horde map entities spawn through addon registration", async () => {
  const archive = await openArchive(resolve(import.meta.dir, "../../../../qfiles/q1/rerelease/mg1/pak0.pak"));
  try {
    for (const name of ["hub", "horde1"]) {
      const state = world("mg1", true);
      try {
        const entry = archive.findEntries(`maps/${name}.bsp`)[0]; if (entry === undefined) throw new Error(`Missing MG1 ${name}`);
        const map = readQ1Bsp(await archive.readEntry(entry), { source: entry.path }); state.game.spawnMap(map);
        const entities = [...state.game.entities.values()];
        expect(entities.some(entity => entity.classname === (name === "hub" ? "misc_rune_indicator" : "horde_manager"))).toBe(true);
        expect(entities.some(entity => entity.classname === (name === "hub" ? "func_door" : "info_monster_start"))).toBe(true);
        const candles = map.entityList.filter(entity => entity.properties.some(property => property.key === "classname" && property.value === "light_candle"));
        const statics = state.events.filter(event => event.kind === "static-model" && event.path === "progs/candle.mdl");
        expect(statics.length).toBe(candles.length);
        if (name === "hub") expect(statics.length).toBeGreaterThan(0);
        expect(entities.some(entity => entity.classname === "light_candle")).toBe(false);
        expect(() => state.game.capture()).not.toThrow();
      } finally { state.actors.close(); }
    }
  } finally { archive.close(); }
});

test("horde spawns source squads and excludes zombies from shared kill counts", () => {
  const state = world("mg1", true), { game, horde, spawn, player, actors } = state;
  if (horde === null) throw new Error("Horde was not registered");
  const manager = spawn("horde_manager"); spawn("info_monster_start", { origin: "512 0 0", spawnflags: "2" });
  game.time = 11; expect(horde.prepare(manager)).toBe(true); expect(manager.number("fodder")).toBe(3); expect(manager.number("army")).toBe(1);
  horde.spawnWave(manager); expect(horde.livingMonsters()).toHaveLength(3); expect(game.totalMonsters).toBe(3); expect(manager.number("fodder")).toBe(2);
  const zombie = horde.spawnMonster("zombie", { x: 1000, y: 0, z: 0 }, ZERO, manager); expect(game.totalMonsters).toBe(3);
  game.damage(zombie.actor.id, player.id, player.id, 1000); expect(game.killedMonsters).toBe(0);
  const grunt = horde.livingMonsters().find(entity => entity.classname === "monster_army"); if (grunt === undefined) throw new Error("Missing source grunt");
  game.damage(grunt.actor.id, player.id, player.id, 1000); expect(game.killedMonsters).toBe(1);
  horde.changeKeys("silver", 1); horde.changeKeys("silver", 1);
  state.touch(spawn("func_door", { spawnflags: "16" })); expect(manager.number("keys_silver")).toBe(1); expect(game.host.inventory.count(player.id, "q1:key/silver")).toBe(1);
  state.touch(spawn("func_door", { spawnflags: "16" })); expect(manager.number("keys_silver")).toBe(0); expect(game.host.inventory.count(player.id, "q1:key/silver")).toBe(0);
  expect(() => game.capture()).not.toThrow(); actors.close();
});

test("MG3 trigger activation preserves rune inhibition and requires ground when authored", () => {
  const state = world("mg3"), { game, spawn, player, touch } = state; let activations = 0;
  game.named.register("test:trigger", { use: () => { activations++; return undefined; } });
  const target = spawn("trigger_relay", { targetname: "goal" }); target.use = game.named.use(target, "test:trigger");
  const trigger = spawn("trigger_multiple", { target: "goal", spawnflags: "66" });
  expect(trigger.solid).toBe("none"); trigger.use?.(null, player.id); expect(trigger.solid).toBe("trigger"); touch(trigger); expect(activations).toBe(0);
  const ground = spawn("worldspawn"), body = game.host.bodies.read(player.id); if (body === null) throw new Error("Missing player body");
  game.host.bodies.write(player, { ...body, ground: ground.actor.id }); touch(trigger); expect(activations).toBe(1);
  const hidden = spawn("trigger_secret", { spawnflags: "262144" }); expect(game.live(hidden)).toBe(false); expect(game.totalSecrets).toBe(0);
  state.actors.close();
});

test("authored immediate end text advances the shared intermission before its normal input delay", () => {
  const state = world("mg1"), { game, spawn, touch, think, base } = state;
  game.mapName = "mge1m1"; spawn("worldspawn"); spawn("info_intermission");
  const exit = spawn("trigger_changelevel", { map: "hub", endtext: "$authored_end_text", spawnflags: "1" }); touch(exit);
  expect(state.transitions).toHaveLength(0); think(exit, 0.1);
  expect(state.events.some(event => event.kind === "finale" && event.text === "$authored_end_text")).toBe(true);
  expect(base.levelRules.requestExit(0.5, true).kind).toBe("waiting"); expect(base.levelRules.requestExit(1.1, true).kind).toBe("travel");
  expect(state.transitions).toHaveLength(1); expect(state.transitions[0]?.kind).toBe("campaign-level"); state.actors.close();
});

test("MG3 demodog leap hits a foreign player then dies into three timed grenades", () => {
  const state = world("mg3"), { game, spawn, think, player } = state;
  const initialHealth = game.health(player.id);
  const dog = spawn("monster_demodog", { origin: "100 0 0" }); expect(dog.classname).toBe("monster_dog"); expect(dog.model).toBe("");
  think(dog, 0.2); expect(dog.model).toBe("progs/dog_explosive.mdl"); expect(game.totalMonsters).toBe(1);
  game.setBody(dog, { velocity: { x: 400, y: 0, z: 200 } }); dog.touch = game.named.touch(dog, "mg3:demodog:jump_touch"); state.touch(dog);
  expect(game.health(player.id)).toBe(initialHealth - 14); expect(game.health(dog.actor.id)).toBe(-50); expect(game.killedMonsters).toBe(1); expect(dog.model).toBe("progs/h_dog.mdl");
  const grenades = [...game.entities.values()].filter(entity => entity.classname === "grenade"); expect(grenades).toHaveLength(3);
  for (const grenade of grenades) { expect(grenade.damage).toBe(60); expect(grenade.nextThink).toBeCloseTo(2.65); }
  expect(() => game.cloneEntity(dog)).not.toThrow(); expect(() => game.capture()).not.toThrow(); state.actors.close();
});

test("MG3 infected actors transform in place and count only the final death", () => {
  for (const classname of ["monster_knight_infected", "monster_army_infected", "monster_enforcer_infected", "monster_hell_knight_infected"]) {
    const state = world("mg3", false, true), { game, spawn, think, player } = state;
    let targetUses = 0;
    game.named.register("test:infected-target", { use: () => { targetUses++; return undefined; } });
    const relay = spawn("trigger_relay", { targetname: "death_target" }); relay.use = game.named.use(relay, "test:infected-target");
    const entity = spawn(classname, { target: "death_target", origin: "100 0 0" }), actor = entity.actor;
    expect(entity.model).toBe(""); expect(entity.nextThink).toBeCloseTo(0.2); think(entity, 0.2); const bounds = game.body(entity).bounds;
    const zombie = classname === "monster_knight_infected" || classname === "monster_army_infected";
    game.damage(actor.id, player.id, player.id, 1000);
    expect(entity.actor).toBe(actor); expect(game.live(entity)).toBe(true); expect(game.health(actor.id)).toBe(zombie ? 60 : 300);
    expect(entity.classname).toBe(zombie ? "monster_zombie" : "monster_demon1"); expect(entity.damageable).toBe(true);
    expect(game.killedMonsters).toBe(0); expect(game.totalMonsters).toBe(1); expect(targetUses).toBe(1); expect(game.body(entity).bounds).toEqual(bounds);
    expect(() => game.cloneEntity(entity)).not.toThrow(); expect(() => game.capture()).not.toThrow();
    const extension = game.stateExtensions.get("mg3:infected"); if (extension === undefined) throw new Error("Missing infected save extension"); extension.restore(extension.capture());
    game.damage(actor.id, player.id, player.id, 1000); expect(game.killedMonsters).toBe(1); expect(targetUses).toBe(2);
    expect(entity.model).toBe(zombie ? "progs/h_zombie.mdl" : "progs/h_demon.mdl"); state.actors.close();
  }
});

test("infected blocked transformation gibs once and sleeping hell knights retain source rise delays", () => {
  const state = world("mg3"), { game, spawn, think, player } = state;
  const knight = spawn("monster_knight_infected"); think(knight, 0.2); game.damage(knight.actor.id, player.id, player.id, 1000);
  expect(game.killedMonsters).toBe(1); expect(game.health(knight.actor.id)).toBe(-100); expect(knight.model).toBe("progs/h_zombie.mdl");
  for (const flags of [65536, 8388608]) {
    const corpse = spawn("monster_hell_knight_infected", { spawnflags: String(flags) }); think(corpse, 1);
    expect(corpse.solid).toBe("none"); expect(corpse.pain).toBeNull(); expect(corpse.frame).toBe(flags === 65536 ? 53 : 62);
    think(corpse, 1.1); expect(corpse.nextThink).toBeCloseTo(10000.1);
    corpse.use?.(null, player.id); think(corpse, 2); think(corpse, 2.1);
    expect(corpse.solid).toBe("none"); expect(corpse.nextThink).toBeCloseTo(7.1);
  }
  expect(() => game.capture()).not.toThrow(); state.actors.close();
});

test("both infected hell-knight corpse sequences restore ordinary callbacks when raised", () => {
  for (const flags of [65536, 8388608]) {
    const state = world("mg3", false, true), { game, spawn, think, player } = state;
    const corpse = spawn("monster_hell_knight_infected", { spawnflags: String(flags) }); think(corpse, 0.2); think(corpse, 0.3);
    corpse.use?.(null, player.id); think(corpse, 0.4); think(corpse, 0.5); expect(corpse.solid).toBe("slidebox");
    for (let frame = 0; frame < 15 && corpse.number("infected.risen") === 0; frame++) think(corpse, corpse.nextThink);
    expect(corpse.number("infected.risen")).toBe(1); expect(corpse.pain).not.toBeNull(); expect(corpse.frame).toBe(1);
    game.damage(corpse.actor.id, player.id, player.id, 1000); expect(corpse.classname).toBe("monster_demon1"); expect(game.killedMonsters).toBe(0);
    state.actors.close();
  }
});

test("addon commands preserve no-key grants, delayed monster targets, and MG3 discovery markers", () => {
  const classicAddons = world("mg1"), mg3 = world("mg3");
  expect(handleQ1AddonImpulse(classicAddons.context, classicAddons.player.id, 99)).toBe(true);
  expect(classicAddons.game.host.inventory.count(classicAddons.player.id, "q1:key/silver")).toBe(0);
  expect(classicAddons.game.host.inventory.count(classicAddons.player.id, "q1:ammo/cells")).toBe(200);
  expect(classicAddons.game.player(classicAddons.player.id)?.weapon).toBe("rocketlauncher");
  const { game, context, player, spawn } = mg3; let uses = 0;
  game.named.register("test:omnicide", { use: () => { uses++; return undefined; } });
  const relay = spawn("trigger_relay", { targetname: "death" }); relay.use = game.named.use(relay, "test:omnicide");
  const deferred = spawn("monster_knight_infected", { spawnflags: "4", target: "death" });
  handleQ1AddonImpulse(context, player.id, 219); expect(uses).toBe(1); expect(game.live(deferred)).toBe(false); expect(game.killedMonsters).toBe(game.totalMonsters);
  spawn("trigger_secret", { origin: "100 0 0" }); handleQ1AddonImpulse(context, player.id, 116); frameQ1AddonPlayer(context, player.id, { x: 0, y: 0, z: 22 });
  expect([...game.entities.values()].filter(entity => entity.classname === "secret_marker")).toHaveLength(1);
  handleQ1AddonImpulse(context, player.id, 116); expect([...game.entities.values()].some(entity => entity.classname === "secret_marker")).toBe(false);
  handleQ1AddonImpulse(context, player.id, 105); handleQ1AddonImpulse(context, player.id, 223);
  expect(mg3.base.campaign.readFlags()).toBe(15 | 64 | 128); expect(mg3.cvars.get("skill")).toBe(3);
  mg3.base.campaign.writeFlags(64 | 128 | 8); handleQ1AddonImpulse(context, player.id, 11); expect(mg3.base.campaign.readFlags()).toBe(64 | 128 | 8 | 1);
  expect(() => game.capture()).not.toThrow(); classicAddons.actors.close(); mg3.actors.close();
});

test("rerelease additive wind and shelter portals act on a foreign character body", () => {
  const state = world("mg3"), { game, context, spawn, touch, player, think } = state;
  context.frame(0.1); game.time = 1;
  const push = spawn("trigger_push", { speed: "100", spawnflags: "2" }); touch(push); expect(game.host.bodies.read(player.id)?.velocity.x).toBe(100);
  const shelter = spawn("trigger_shelter_portal"); touch(shelter); touch(push); expect(game.host.bodies.read(player.id)?.velocity.x).toBe(100);
  const body = game.host.bodies.read(player.id); if (body === null) throw new Error("Missing player body");
  game.host.bodies.write(player, { ...body, origin: { x: 0, y: 0, z: -1 } }); touch(shelter); touch(push); expect(game.host.bodies.read(player.id)?.velocity.x).toBe(200);
  const hurt = spawn("trigger_hurt", { dmg: "7", wait: "0.2", spawnflags: "1" }), health = game.health(player.id);
  touch(hurt); expect(game.health(player.id)).toBe(health); hurt.use?.(null, player.id); touch(hurt); expect(game.health(player.id)).toBe(health - 7); expect(hurt.solid).toBe("none");
  think(hurt, 1.2); expect(hurt.solid).toBe("trigger"); state.actors.close();
});


test("MG3 path visitation, pause cancellation and switching use saved actor bindings", () => {
  const state = world("mg3"), { game, spawn } = state;
  const next = spawn("path_corner", { targetname: "next" });
  const alternate = spawn("path_corner", { targetname: "alternate", origin: "0 100 0" });
  const corner = spawn("path_corner", { targetname: "corner", target: "next", wait: "2" });
  const mover = spawn("monster_ogre", { targetname: "walker" });
  mover.references.set("movetarget", corner.actor.id); mover.movementFlags |= 32;
  corner.touch?.(mover.actor.id, null);
  expect(mover.references.get("movetarget")).toEqual(next.actor.id);
  expect(corner.owner).toEqual(mover.actor.id);
  expect(mover.references.get("dmg_inflictor")).toEqual(corner.actor.id);
  expect(mover.monster?.pauseUntil).toBe(game.time + 2);
  const switcher = spawn("target_switchpath", { targetname: "switch", target: "corner", netname: "alternate" });
  switcher.use?.(null, null);
  expect(corner.target).toBe("alternate");
  expect(mover.references.get("movetarget")).toEqual(alternate.actor.id);
  expect(mover.monster?.path).toBe("alternate");
  const cancel = spawn("target_cancelpause", { targetname: "cancel", target: "walker" });
  cancel.use?.(null, null);
  expect(mover.monster?.pauseUntil).toBe(0);
  const boss = spawn("monster_boss_final", { targetname: "walker" });
  expect(boss.pathEnd).toBeNull();
  cancel.use?.(null, null);
  expect(boss.use).not.toBeNull();
  expect(() => game.capture()).not.toThrow();
  expect(() => spawn("target_cancelpause", { targetname: "invalid" })).toThrow();
  expect(spawn("path_corner", { targetname: "forever", wait: "-1" }).wait).toBe(999999);
  state.actors.close();
});

test("addon static overrides preserve raw pose, ambient ordering and dynamic gas lifetime", () => {
  for (const program of ["mg1", "mg3"] satisfies readonly ("mg1" | "mg3")[]) {
    const { game, spawn, events, actors } = world(program);
    try {
      for (const classname of ["light_torch_small_walltorch", "light_flame_large_yellow", "light_flame_small_yellow", "light_flame_small_white", "light_candle"]) {
        const first = events.length, entity = game.create(classname);
        game.setBody(entity, { origin: { x: 12.125, y: 24.25, z: 36.5 }, angles: { x: 0, y: 31.875, z: 0 } });
        entity.spawnflags = 4; entity.skin = 2; entity.frame = 3; game.spawnEntity(entity);
        expect(game.live(entity)).toBe(false);
        const event = events.at(-1);
        if (event?.kind !== "static-model") throw new Error("Missing static light event");
        expect(event.origin).toEqual({ x: 12.125, y: 24.25, z: 36.5 });
        expect(event.skin).toBe(2);
        expect(event.frame).toBe(classname === "light_flame_large_yellow" ? 1 : 3);
        expect(game.precaches.models).toContain(event.path);
        if (classname === "light_candle") {
          expect(events.length - first).toBe(1);
          expect(event.angles).toEqual({ x: 0, y: 31.875, z: 0 });
        } else {
          expect(events[first]).toEqual({ kind: "ambient", origin: event.origin, path: "ambience/fire1.wav", volume: 0.5, attenuation: 3 });
          expect(event.angles).toEqual({ x: 180, y: 0, z: 0 });
        }
      }
      for (const classname of ["ambient_suck_wind", "ambient_drone", "ambient_flouro_buzz", "ambient_drip", "ambient_comp_hum", "ambient_thunder", "ambient_light_buzz", "ambient_swamp1", "ambient_swamp2", "ambient_generic"]) {
        const first = events.length, entity = spawn(classname, { origin: "7.125 8.25 9.5", noise: "ambience/wind2.wav", volume: "0.75", delay: "2" });
        expect(game.live(entity)).toBe(false);
        const sound = events[first], model = events[first + 1];
        if (sound?.kind !== "ambient" || model?.kind !== "static-model") throw new Error("Ambient must precede its static record");
        expect(model.path).toBe(""); expect(model.origin).toEqual(sound.origin);
        expect(game.precaches.sounds).toContain(sound.path);
        if (classname === "ambient_generic") { expect(sound.volume).toBe(0.75); expect(sound.attenuation).toBe(2); }
      }
      const beforeMissing = events.length;
      expect(game.live(spawn("ambient_generic"))).toBe(false); expect(events.length).toBe(beforeMissing);
      const first = events.length, gas = spawn("light_flame_gas");
      expect(game.live(gas)).toBe(true);
      expect([...game.entities.values()].filter(entity => entity.model === "progs/flame3.mdl").map(entity => entity.number("alpha"))).toEqual([Math.fround(0.6), Math.fround(0.4)]);
      expect(events.slice(first).some(event => event.kind === "static-model")).toBe(false);
    } finally { actors.close(); }
  }
});
