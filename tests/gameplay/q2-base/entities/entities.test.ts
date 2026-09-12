import { describe, expect, test } from "bun:test";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { ActorId, OwnedActor } from "../../../../src/contracts/identity.ts";
import type { DamageOutcome } from "../../../../src/contracts/gameplay.ts";
import type { Vec3 } from "../../../../src/contracts/math.ts";
import type { BodyCheckpoint, CombatCheckpoint, InventoryCheckpoint, SavedActorId } from "../../../../src/contracts/session.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ2CombatPolicy, nativeVictimArmor } from "../../../../src/world/gameplay/index.ts";
import { Q2Foundation } from "../../../../src/content/q2/foundation/runtime.ts";
import type { Q2FoundationHost, Q2PresentationEvent } from "../../../../src/content/q2/foundation/host.ts";
import { createQ2TargetModule } from "../../../../src/content/q2/foundation/targets.ts";
import { Q2MoverModule } from "../../../../src/content/q2/foundation/movers.ts";
import { Q2Ballistics } from "../../../../src/content/q2/foundation/weapons/ballistics.ts";
import { Q2Monsters } from "../../../../src/content/q2/foundation/monsters/index.ts";
import { createQ2BaseEntityModule, q2ClockText, snapQ2TurretEighth } from "../../../../src/content/q2/base/entities/index.ts";
import type { Q2BaseEntitiesCheckpoint } from "../../../../src/content/q2/base/entities/index.ts";
import type { Q2FoundationCheckpoint } from "../../../../src/content/q2/foundation/checkpoint.ts";
import type { Q2MoversCheckpoint } from "../../../../src/content/q2/foundation/movers.ts";
import type { Q2MonstersCheckpoint } from "../../../../src/content/q2/foundation/monsters/checkpoint.ts";
import { registerQ2ClassicBaseMonsters } from "../../../../src/content/q2/base/monsters/index.ts";
import { captureSharedBodies, restoreSharedBodyLinks } from "../../../../src/persistence/world-state.ts";
import { encodeQ2FoundationCheckpoint, decodeQ2FoundationCheckpoint } from "../../../../src/persistence/q2-foundation.ts";
import { encodeQ2BaseEntitiesCheckpoint, decodeQ2BaseEntitiesCheckpoint } from "../../../../src/persistence/q2-base-entities.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { readQ2Bsp } from "../../../../src/formats/q2-map/index.ts";
import { parseQ2Entities } from "../../../../src/content/q2/foundation/fields.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };

interface SavedEntities {
  readonly now: number;
  readonly slots: ReturnType<SessionActorRegistry["checkpoint"]>;
  readonly sources: ReturnType<SessionActorRegistry["sourceCheckpoint"]>;
  readonly bodies: readonly BodyCheckpoint[]; readonly combat: readonly CombatCheckpoint[]; readonly inventory: readonly InventoryCheckpoint[];
  readonly players: readonly SavedActorId[];
  readonly foundation: Q2FoundationCheckpoint; readonly entities: Q2BaseEntitiesCheckpoint;
  readonly movers: Q2MoversCheckpoint; readonly monsters: Q2MonstersCheckpoint;
}

function fixture(saved?: SavedEntities) {
  let now = saved?.now ?? 0, restoring = saved !== undefined;
  const identity = createIdentityOwner("q2-base-entities"), actors = saved === undefined ? new SessionActorRegistry(identity) : SessionActorRegistry.restore(identity, saved.slots, saved.sources);
  const callbacks = new ActorCallbackTable(actors);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const events: Q2PresentationEvent[] = [], outcomes: DamageOutcome[] = [], players: ActorId[] = [];
  const scheduled = new Map<OwnedActor, number>();
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined,
    confirmed: outcome => { outcomes.push(outcome); return undefined; } });
  combat.register(createQ2CombatPolicy({ id: "q2:combat", armor: nativeVictimArmor(() => ({ arithmetic: "binary64", screenFacingDot: 1 })),
    context: request => ({ arithmetic: "binary64", player: players.includes(request.target), monster: false, attackerPlayer: false,
      hasEnemy: false, easySkill: false, deathmatch: false, defenderSphere: false, teamDamageEnabled: false, friendlyFire: false,
      nuke: false, noKnockback: true, movable: false, rejectTeamDamage: false, suppressPain: false }) }));
  const host: Q2FoundationHost = { actors, bodies, callbacks, combat, inventory: new SharedInventoryTable(actors),
    now: () => now, gravity: () => 800, frameSeconds: () => 0.1, random: () => { if (restoring) throw new Error("Restore consumed source randomness"); return 0.5; }, touchTriggers: () => undefined, keyConsumed: () => undefined,
    schedule: (actor, due) => { if (due === null) scheduled.delete(actor); else scheduled.set(actor, due); return undefined; },
    trace: request => ({ kind: "q2", fraction: 1, startSolid: false, allSolid: false, end: request.end,
      contact: { kind: "none" }, hit: { kind: "none" }, contents: 0, surface: null, secondary: null,
      sourcePlane: { normal: zero, distance: 0, type: 0, signbits: 0 } }),
    pointContents: () => 0, inPvs: () => true, inPhs: () => true, areasConnected: () => true, nearby: () => [],
    players: () => players, isPlayer: actor => players.includes(actor), isMonster: () => false,
    worldActor: () => { const world = [...game.entities.values()].find(entity => entity.classname === "worldspawn"); if (world === undefined) throw new Error("Missing source world"); return world.actor.id; },
    inlineModelBounds: () => ({ min: zero, max: { x: 128, y: 128, z: 64 } }), setSolid: () => undefined, setMotion: () => undefined,
    setAreaPortal: () => undefined, emit: event => { events.push(event); return undefined; },
    playerViewState: () => ({ viewAngles: zero, oldVelocity: zero }), prepareLevelChange: () => undefined, transition: () => undefined,
    diagnostic: message => { throw new Error(message); } };
  const weapons = new Q2Ballistics({ emit: () => undefined, noise: () => undefined, dodge: () => undefined,
    lagCompensation: { kind: "current-world" }, ammoChanged: () => undefined, canTarget: () => true });
  const monsters = new Q2Monsters(weapons);
  const movers = new Q2MoverModule({ pathCorner: (corner, game, actor) => monsters.touchPathCorner(corner, game, actor),
    combatPoint: (point, game, actor) => monsters.touchCombatPoint(point, game, actor) });
  const entities = createQ2BaseEntityModule({ movers, weapons,
    teleportPlayer: () => { throw new Error("Unexpected teleport"); }, playerPush: () => undefined, setActorGravity: () => undefined,
    localTime: () => ({ hour: 1, minute: 2, second: 3 }),
    turretDriver: (entity, game) => monsters.spawnInfantryDriver(entity, game), monsterContext: actor => monsters.context(actor), resumeMonster: (entity, game) => monsters.resumeMonster(entity, game) });
  const game = new Q2Foundation(host, { edition: "classic", mapName: "base-entities", skill: 1, mode: "singleplayer", deathmatchFlags: 0,
    maxClients: 1, provider: "q2:official", campaign: "q2:base", combatProvider: "q2:combat", inventoryProvider: "q2:inventory", movementProvider: "q3:movement" },
  [entities, movers, registerQ2ClassicBaseMonsters(monsters), createQ2TargetModule()]);
  game.sourceCallbacks.register(weapons.callbacks);
  if (saved === undefined) game.create("worldspawn");
  if (saved !== undefined) {
    const owner = (actor: SavedActorId): OwnedActor => { const value = actors.resolveSaved(actor); if (value === null) throw new Error("Missing shared saved actor"); return value; };
    for (const entry of saved.bodies) bodies.create(owner(entry.actor), { ...entry.body, ground: entry.body.ground === null ? null : actors.referenceSaved(entry.body.ground) });
    for (const entry of saved.combat) combat.create(owner(entry.actor), entry.state);
    for (const entry of saved.inventory) host.inventory.create(owner(entry.actor), entry.entries);
    players.push(...saved.players.map(actor => actors.referenceSaved(actor)));
    game.restore(saved.foundation); movers.restore(game, saved.movers); monsters.restore(game, saved.monsters); entities.restore(game, saved.entities);
    restoreSharedBodyLinks(saved, { actors, bodies });
    for (const entity of game.entities.values()) if (entity.nextThink !== null) host.schedule(entity.actor, entity.nextThink);
    restoring = false;
  }
  function spawn(classname: string, values: ReadonlyMap<string, string> = new Map<string, string>()) { return game.spawn({ classname, ordinal: -1, values }); }
  function save(): SavedEntities {
    const reference = (actor: ActorId): SavedActorId => ({ slot: actor.slot, generation: actor.generation });
    return { now, slots: actors.checkpoint(), sources: actors.sourceCheckpoint(), bodies: captureSharedBodies(actors, bodies), players: players.map(reference),
      combat: actors.observations().flatMap(actor => { const state = combat.read(actor.id); return state === null ? [] : [{ actor: reference(actor.id), state }]; }),
      inventory: actors.observations().flatMap(actor => host.inventory.has(actor.id) ? [{ actor: reference(actor.id), entries: host.inventory.entries(actor.id) }] : []),
      foundation: decodeQ2FoundationCheckpoint(encodeQ2FoundationCheckpoint(game.capture())), entities: decodeQ2BaseEntitiesCheckpoint(encodeQ2BaseEntitiesCheckpoint(entities.capture(game))),
      movers: movers.capture(game), monsters: monsters.capture() };
  }
  return { actors, host, game, entities, monsters, events, outcomes, spawn, save,
    player() {
      const actor = actors.allocate("q3:character", "q3:sarge");
      bodies.create(actor, { origin: zero, angles: zero, velocity: zero, ground: null, bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } } });
      combat.create(actor, { health: 1000, armor: { kind: "none" }, mass: 200, canTakeDamage: true, invulnerable: false, team: null }); players.push(actor.id); return actor;
    },
    advance(seconds: number) {
      const elapsed = seconds - now;
      for (const entity of game.entities.values()) {
        const body = game.body(entity), velocity = body.velocity, angular = entity.angularVelocity;
        game.move(entity, { origin: { x: body.origin.x + velocity.x * elapsed, y: body.origin.y + velocity.y * elapsed, z: body.origin.z + velocity.z * elapsed },
          angles: { x: body.angles.x + angular.x * elapsed, y: body.angles.y + angular.y * elapsed, z: body.angles.z + angular.z * elapsed } }, false);
      }
      now = seconds;
      for (const entity of [...game.entities.values()]) entity.prethink?.(entity, game);
      for (const [actor] of [...scheduled].filter(([, due]) => due <= now).sort(([a], [b]) => a.id.slot - b.id.slot)) {
        scheduled.delete(actor);
        if (actors.isLive(actor.id)) callbacks.think(actor, { frame: Math.round(now * 10), time: { kind: "seconds", value: now }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" });
      }
    },
  };
}

describe("Q2 base entity source behaviors", () => {
  test("cross-level target preserves source scheduling plus delayed use after its own removal", () => {
    const scene = fixture();
    scene.spawn("target_secret", new Map([["targetname", "secret"]]));
    const target = scene.spawn("target_crosslevel_target", new Map([["spawnflags", "5"], ["target", "secret"], ["delay", "0.2"]]));
    const trigger = scene.spawn("target_crosslevel_trigger", new Map([["spawnflags", "5"]]));
    scene.host.callbacks.use(trigger.actor, null, null);
    expect(scene.game.counters.serverFlags).toBe(5);
    scene.advance(0.2); expect(scene.actors.isLive(target.actor.id)).toBe(false); expect(scene.game.counters.foundSecrets).toBe(0);
    scene.advance(0.4); expect(scene.game.counters.foundSecrets).toBe(1);
    scene.actors.close();
  });

  test("clock drives source character frames and fires its pathtarget on countdown completion", () => {
    const scene = fixture();
    const digit = scene.spawn("target_character", new Map([["team", "clock"], ["count", "2"], ["model", "*1"]]));
    scene.spawn("target_string", new Map([["team", "clock"], ["targetname", "display"]]));
    scene.spawn("target_secret", new Map([["targetname", "finished"]]));
    scene.spawn("func_clock", new Map([["target", "display"], ["spawnflags", "2"], ["count", "1"], ["pathtarget", "finished"]]));
    scene.advance(1); expect(digit.frame).toBe(1);
    scene.advance(2); expect(digit.frame).toBe(0); expect(scene.game.counters.foundSecrets).toBe(1);
    expect(q2ClockText(3661, 2)).toBe(" 1:01:01"); expect(q2ClockText(61, 1)).toBe(" 1:01");
    expect(snapQ2TurretEighth(-0.0625)).toBe(-0.125);
    scene.actors.close();
  });

  test("platform starts below its authored brush while conveyor use updates source speed", () => {
    const scene = fixture();
    const platform = scene.spawn("func_plat", new Map([["model", "*1"]]));
    expect(scene.entities.platformState(platform)).toEqual({ top: zero, bottom: { x: 0, y: 0, z: -56 }, phase: "bottom" });
    expect(scene.game.body(platform).origin.z).toBe(-56); expect(platform.speed).toBe(20);
    const conveyor = scene.spawn("func_conveyor", new Map([["model", "*2"], ["speed", "125"], ["spawnflags", "2"]]));
    expect(conveyor.speed).toBe(0);
    scene.host.callbacks.use(conveyor.actor, null, null); expect(conveyor.speed).toBe(125);
    scene.host.callbacks.use(conveyor.actor, null, null); expect(conveyor.speed).toBe(0);
    scene.actors.close();
  });

  test("target blaster retains the original projectile behavior and target-specific death cause", () => {
    const scene = fixture();
    const emitter = scene.spawn("target_blaster", new Map([["spawnflags", "2"], ["dmg", "15"]]));
    scene.host.callbacks.use(emitter.actor, null, null);
    const bolt = [...scene.game.entities.values()].find(entity => entity.classname === "bolt");
    if (bolt === undefined) throw new Error("Target did not fire a blaster projectile");
    expect(bolt.effects).toBe(8);
    const victim = scene.game.create("victim");
    scene.host.combat.create(victim.actor, { health: 100, armor: { kind: "none" }, mass: 100, canTakeDamage: true, invulnerable: false, team: null });
    scene.host.callbacks.touch({ self: bolt.actor, other: victim.actor.id, plane: null, surface: null });
    expect(scene.host.combat.read(victim.actor.id)?.health).toBe(85);
    const outcome = scene.outcomes.at(-1);
    if (outcome?.kind !== "committed") throw new Error("Target blast did not reach shared combat");
    expect(outcome.decision.request.attack.cause).toEqual({ kind: "q2", meansOfDeath: 33, damageFlags: 4 });
    expect(outcome.decision.request.attack.weapon).toBeNull();
    scene.actors.close();
  });

  test("turret driver joins the real pusher team and shared infantry death removes it", () => {
    const scene = fixture();
    const report = scene.game.load(`
      { "classname" "turret_base" "team" "gun" "model" "*1" }
      { "classname" "turret_breach" "team" "gun" "model" "*2" "target" "muzzle" "targetname" "barrel" }
      { "classname" "info_notnull" "targetname" "muzzle" "origin" "32 0 0" }
      { "classname" "turret_driver" "target" "barrel" "origin" "-32 0 0" }
    `);
    const base = report.spawned.find(entity => entity.classname === "turret_base"), driver = report.spawned.find(entity => entity.classname === "turret_driver");
    if (base === undefined || driver === undefined) throw new Error("Turret assembly did not spawn");
    scene.advance(0.1);
    expect(scene.game.pushTeam(base.actor.id)).toHaveLength(3);
    expect(driver.teamMaster?.equals(base.actor.id)).toBe(true); expect(driver.frame).toBe(0);
    scene.game.damage(driver.actor.id, base, null, 100, 0, zero, zero, zero, 1);
    expect(scene.game.counters.killedMonsters).toBe(1); expect(driver.teamMaster).toBeNull();
    expect(scene.game.pushTeam(base.actor.id)).toHaveLength(2);
    scene.actors.close();
  });

  test("retail base2 platform continues its accelerated move after a checked save into fresh actors", async () => {
    const archive = await openArchive("/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak"), scene = fixture();
    try {
      const entry = archive.findEntries("maps/base2.bsp")[0]; if (entry === undefined) throw new Error("Missing retail base2 map");
      const map = readQ2Bsp(await archive.readEntry(entry)), authored = parseQ2Entities(map.entities).find(entity => entity.classname === "func_plat");
      if (authored === undefined) throw new Error("Retail base2 has no platform");
      scene.host.inlineModelBounds = model => { const value = map.models[model]; if (value === undefined) throw new Error("Missing retail inline model"); return value.bounds; };
      const platform = scene.game.spawn(authored), player = scene.player(), trigger = [...scene.game.entities.values()].find(entity => entity.classname === "plat_trigger");
      if (trigger === undefined) throw new Error("Missing platform trigger");
      scene.host.callbacks.touch({ self: trigger.actor, other: player.id, plane: null, surface: null });
      scene.advance(0.1); scene.advance(0.2);
      const saved = scene.save(), restored = fixture(saved);
      try {
        expect(restored.events).toHaveLength(0); expect(restored.save().foundation).toEqual(saved.foundation); expect(restored.entities.capture(restored.game)).toEqual(saved.entities);
        expect(restored.actors.isLive(player.id)).toBe(false);
        const current = restored.game.entity(restored.actors.referenceSaved(platform.actor.id)); if (current === null) throw new Error("Missing restored platform");
        for (let tick = 3; tick <= 70; tick++) { scene.advance(tick / 10); restored.advance(tick / 10); }
        expect(restored.game.body(current)).toEqual(scene.game.body(platform));
        expect(restored.entities.capture(restored.game)).toEqual(scene.entities.capture(scene.game));
        expect(restored.game.capture()).toEqual(scene.game.capture());
      } finally { restored.actors.close(); }
    } finally { archive.close(); scene.actors.close(); }
  });

  test("saved turret links and infantry death restore without admission or initialization effects", () => {
    const scene = fixture();
    try {
      scene.game.load(`
        { "classname" "turret_base" "team" "gun" "model" "*1" }
        { "classname" "turret_breach" "team" "gun" "model" "*2" "target" "muzzle" "targetname" "barrel" }
        { "classname" "info_notnull" "targetname" "muzzle" "origin" "32 0 0" }
        { "classname" "turret_driver" "target" "barrel" "origin" "-32 0 0" }
      `);
      const pending = scene.save(), beforeLink = fixture(pending);
      try { expect(beforeLink.events).toHaveLength(0); beforeLink.advance(0.1); scene.advance(0.1); expect(beforeLink.game.capture()).toEqual(scene.game.capture()); }
      finally { beforeLink.actors.close(); }
      const base = [...scene.game.entities.values()].find(entity => entity.classname === "turret_base"), driver = [...scene.game.entities.values()].find(entity => entity.classname === "turret_driver");
      if (base === undefined || driver === undefined) throw new Error("Missing linked turret");
      const player = scene.player(); driver.enemy = player.id; scene.advance(0.2);
      const saved = scene.save(), restored = fixture(saved);
      try {
        expect(restored.events).toHaveLength(0); expect(restored.entities.capture(restored.game)).toEqual(saved.entities);
        const liveBase = restored.game.entity(restored.actors.referenceSaved(base.actor.id)), liveDriver = restored.game.entity(restored.actors.referenceSaved(driver.actor.id));
        if (liveBase === null || liveDriver === null) throw new Error("Missing restored turret");
        expect(liveDriver.enemy).not.toBe(player.id); expect(liveDriver.enemy?.equals(restored.actors.referenceSaved(player.id))).toBe(true);
        expect(restored.game.pushTeam(liveBase.actor.id)).toHaveLength(3);
        for (let tick = 3; tick <= 24; tick++) { scene.advance(tick / 10); restored.advance(tick / 10); }
        expect(restored.game.capture()).toEqual(scene.game.capture()); expect(restored.entities.capture(restored.game)).toEqual(scene.entities.capture(scene.game));
        scene.game.damage(driver.actor.id, base, null, 100, 0, zero, zero, zero, 1);
        restored.game.damage(liveDriver.actor.id, liveBase, null, 100, 0, zero, zero, zero, 1);
        expect(liveDriver.teamMaster).toBeNull(); expect(restored.game.pushTeam(liveBase.actor.id)).toHaveLength(2);
        expect(restored.game.capture()).toEqual(scene.game.capture());
        const removedBreach = fixture(saved);
        try {
          const breach = [...removedBreach.game.entities.values()].find(entity => entity.classname === "turret_breach"); if (breach === undefined) throw new Error("Missing breach to remove");
          removedBreach.game.remove(breach);
          const stale = removedBreach.save(), fresh = fixture(stale);
          try { expect(fresh.entities.capture(fresh.game)).toEqual(stale.entities); fresh.advance(0.3); expect(fresh.game.entity(fresh.actors.referenceSaved(breach.actor.id))).toBeNull(); }
          finally { fresh.actors.close(); }
        } finally { removedBreach.actors.close(); }
      } finally { restored.actors.close(); }
    } finally { scene.actors.close(); }
  });

  test("clock, light ramp, scenery, actor targets and pending base callbacks continue from named source state", () => {
    const scene = fixture();
    try {
      scene.game.load(`
        { "classname" "target_character" "team" "clock" "count" "2" "model" "*1" }
        { "classname" "target_string" "team" "clock" "targetname" "display" }
        { "classname" "func_clock" "target" "display" "spawnflags" "2" "count" "3" }
        { "classname" "light" "targetname" "lamp" "style" "32" }
        { "classname" "target_lightramp" "target" "lamp" "message" "az" "speed" "2" "spawnflags" "1" }
        { "classname" "misc_eastertank" }
        { "classname" "monster_commander_body" }
        { "classname" "func_object" "model" "*2" }
        { "classname" "func_door_secret" "model" "*3" "wait" "1" }
        { "classname" "target_laser" "spawnflags" "1" }
        { "classname" "trigger_hurt" "spawnflags" "16" }
        { "classname" "trigger_push" }
        { "classname" "misc_actor" "targetname" "actor" "target" "actor-path" }
        { "classname" "target_actor" "targetname" "actor-path" }
        { "classname" "monster_boss3_stand" }
      `);
      const source = (name: string) => { const entity = [...scene.game.entities.values()].find(value => value.classname === name); if (entity === undefined) throw new Error(`Missing ${name}`); return entity; };
      scene.host.callbacks.use(source("target_lightramp").actor, null, null); scene.host.callbacks.use(source("func_door_secret").actor, null, null);
      scene.advance(0.1); const player = scene.player();
      for (const name of ["trigger_hurt", "trigger_push"]) scene.host.callbacks.touch({ self: source(name).actor, other: player.id, plane: null, surface: null });
      for (let tick = 2; tick <= 12; tick++) scene.advance(tick / 10);
      const saved = scene.save(), restored = fixture(saved);
      try {
        expect(restored.events).toHaveLength(0); expect(restored.game.capture()).toEqual(saved.foundation); expect(restored.entities.capture(restored.game)).toEqual(saved.entities);
        for (let tick = 13; tick <= 60; tick++) { scene.advance(tick / 10); restored.advance(tick / 10); }
        expect(restored.game.capture()).toEqual(scene.game.capture()); expect(restored.entities.capture(restored.game)).toEqual(scene.entities.capture(scene.game));
        const actor = source("misc_actor"), current = restored.game.entity(restored.actors.referenceSaved(actor.actor.id)); if (current === null) throw new Error("Missing restored actor");
        scene.host.callbacks.use(actor.actor, null, null); restored.host.callbacks.use(current.actor, null, null);
        expect(restored.monsters.capture()).toEqual(scene.monsters.capture());
      } finally { restored.actors.close(); }
    } finally { scene.actors.close(); }
  });
});
