import { SharedPickupAdmission } from "../../../../src/world/gameplay/pickups.ts";
import { expansionSourceSupply } from "../../../../src/content/composition/expansion-source-supply.ts";
import { Q1_Q2_SUPPLY_PROFILE } from "../../../../src/content/composition/q1-q2-supply.ts";
import { q2BaseWeaponInventory } from "../../../../src/content/q2/foundation/items.ts";
import { expect, test } from "bun:test";
import type { ActorId, OwnedActor } from "../../../../src/contracts/identity.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { BodyCheckpoint, CombatCheckpoint, InventoryCheckpoint } from "../../../../src/contracts/session.ts";
import { SessionActorRegistry, SharedBodyTable, ActorCallbackTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ1CombatPolicy, nativeVictimArmor } from "../../../../src/world/gameplay/index.ts";
import { Q1Foundation } from "../../../../src/content/q1/foundation/runtime.ts";
import type { Q1Actor } from "../../../../src/content/q1/foundation/entity.ts";
import type { Q1FoundationCheckpoint } from "../../../../src/content/q1/foundation/checkpoint.ts";
import type { Q1Event, Q1FoundationHost } from "../../../../src/content/q1/foundation/types.ts";
import { ZERO, PLAYER_BOUNDS } from "../../../../src/content/q1/foundation/types.ts";
import { registerQ1Base } from "../../../../src/content/q1/base/index.ts";
import { registerQ1CampaignAddons, BLOODY_NIGHTMARE_ACTIVE, BLOODY_NIGHTMARE_NEWGAME, captureQ1AddonTravel, admitQ1AddonTravel } from "../../../../src/content/q1/addons/index.ts";
import { spawnSpammer } from "../../../../src/content/q1/addons/monsters/bosses/oldnew-children.ts";
import { giveNextMg3Upgrade, mg3UpgradeFlag, mg3UpgradedMaximum, mg3HammerBodyFrame } from "../../../../src/content/q1/addons/items/index.ts";
import type { Mg3Upgrade } from "../../../../src/content/q1/addons/items/index.ts";
import { handleMg3ItemImpulse } from "../../../../src/content/q1/addons/items/commands.ts";
import { q1PowerupTimers } from "../../../../src/app/bootstrap/simulation/powerup-timers.ts";
import { captureSharedBodies, restoreSharedBodyLinks } from "../../../../src/persistence/world-state.ts";
import { encodeQ1FoundationCheckpoint, decodeQ1FoundationCheckpoint } from "../../../../src/persistence/q1-foundation.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { readQ1Bsp, q1EntityValue } from "../../../../src/formats/q1-map/index.ts";
import type { Q1Entity } from "../../../../src/formats/q1-map/index.ts";

interface Saved {
  readonly source: Q1FoundationCheckpoint;
  readonly slots: ReturnType<SessionActorRegistry["checkpoint"]>;
  readonly sources: ReturnType<SessionActorRegistry["sourceCheckpoint"]>;
  readonly bodies: readonly BodyCheckpoint[]; readonly combat: readonly CombatCheckpoint[]; readonly inventories: readonly InventoryCheckpoint[];
}
function session(saved?: Saved, options: { readonly skill?: 0 | 1 | 2 | 3; readonly deathmatch?: number; readonly coop?: boolean; readonly itemFloor?: boolean } = {}) {
  const identity = createIdentityOwner("mg3-items-smoke");
  const actors = saved === undefined ? new SessionActorRegistry(identity) : SessionActorRegistry.restore(identity, saved.slots, saved.sources);
  const callbacks = new ActorCallbackTable(actors), bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  const inventory = new SharedInventoryTable(actors), events: Q1Event[] = [], players: ActorId[] = [], pending = new Map<OwnedActor, number>();
  let runtime: Q1Foundation | null = null, hit: ActorId | null = null;
  let contents: ReturnType<Q1FoundationHost["contents"]> = "empty";
  const host: Q1FoundationHost = { actors, callbacks, bodies, combat, inventory, random: () => 0.4,
    trace: request => ({ fraction: options.itemFloor === true && request.start.z - request.end.z === 256 ? 0.5 : hit === null || !request.monsters ? 1 : 0.5, end: request.end, normal: { x: -1, y: 0, z: 0 }, actor: request.monsters ? hit : null,
      startSolid: false, allSolid: false, sky: false, inOpen: true, inWater: false }), contents: () => contents, walkMove: () => false,
    changeYaw: () => { throw new Error("This item fixture does not drive monster turning"); }, moveToGoal: () => undefined, checkBottom: () => false, pusherServices: () => { throw new Error("This fixture does not step native pushers"); },
    scheduleThink: (actor, seconds) => { pending.set(actor, seconds); return undefined; }, cancelThink: actor => { pending.delete(actor); return undefined; },
    emit: event => { events.push(event); return undefined; }, transition: () => undefined, players: () => players, checkClient: () => null,
    classname: actor => runtime?.entity(actor)?.classname ?? "player", powerup: () => undefined };
  const game = new Q1Foundation(host, { edition: "rerelease", skill: options.skill ?? 1, deathmatch: options.deathmatch ?? 0, coop: options.coop ?? false, gravity: 800, maxClients: 2,
    campaign: "q1:mg3", combatProvider: "q1:combat", inventoryProvider: "q1:inventory", movementProvider: "q2:movement" }); runtime = game;
  combat.register(createQ1CombatPolicy({ id: "q1:combat", context: request => game.combatContext(request), sourceEffects: game.damageSourceEffects,
    armor: nativeVictimArmor(() => ({ arithmetic: "binary32", screenFacingDot: 0 })) }));
  const cvars = new Map<string, number>([["skill", options.skill ?? 1]]);
  const base = registerQ1Base(game), context = registerQ1CampaignAddons(base, "mg3", { emit: () => undefined, isMonster: actor => game.entity(actor)?.monster != null,
    cvar: name => cvars.get(name) ?? 0, setCvar: (name, value) => { cvars.set(name, Number(value)); return undefined; } });
  let actor: OwnedActor;
  if (saved === undefined) {
    actor = actors.allocateAtSource("q3:character", 1, "q3:sarge");
    bodies.create(actor, { origin: ZERO, angles: ZERO, velocity: ZERO, bounds: PLAYER_BOUNDS, ground: null });
    combat.create(actor, { health: 100, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 100, canTakeDamage: true, invulnerable: false, team: null }); game.attachPlayer(actor);
  } else {
    const player = actors.atSource("q3:character", 1); if (player === null) throw new Error("Missing restored player"); actor = player;
    const owner = (id: BodyCheckpoint["actor"]): OwnedActor => { const value = actors.resolveSaved(id); if (value === null) throw new Error("Missing saved actor"); return value; };
    for (const entry of saved.bodies) bodies.create(owner(entry.actor), { ...entry.body, ground: entry.body.ground === null ? null : actors.referenceSaved(entry.body.ground) });
    for (const entry of saved.combat) combat.create(owner(entry.actor), entry.state);
    for (const entry of saved.inventories) inventory.create(owner(entry.actor), entry.entries);
    game.restore(saved.source); restoreSharedBodyLinks(saved, { actors, bodies });
  }
  players.push(actor.id);
  const player = game.player(actor.id); if (player === null) throw new Error("Missing MG3 player");
  function spawn(classname: string, source?: Q1Entity): Q1Actor { const entity = game.create(classname, source); game.spawnEntity(entity); return entity; }
  function think(entity: Q1Actor, seconds: number): void { callbacks.think(entity.actor, { frame: 0, time: { kind: "seconds", value: seconds }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" }); }
  function touch(entity: Q1Actor): void { callbacks.touch({ self: entity.actor, other: actor.id, plane: null, surface: null }); }
  function save(): Saved { return { source: decodeQ1FoundationCheckpoint(encodeQ1FoundationCheckpoint(game.capture())), slots: actors.checkpoint(), sources: actors.sourceCheckpoint(),
    bodies: captureSharedBodies(actors, bodies), combat: actors.observations().flatMap(observation => { const state = combat.read(observation.id); return state === null ? [] : [{ actor: { slot: observation.id.slot, generation: observation.id.generation }, state }]; }),
    inventories: actors.observations().flatMap(observation => inventory.has(observation.id) ? [{ actor: { slot: observation.id.slot, generation: observation.id.generation }, entries: inventory.entries(observation.id) }] : []) }; }
  return { actors, game, base, context, player, inventory, combat, events, pending, spawn, think, touch, save, contents: (value: ReturnType<Q1FoundationHost["contents"]>) => { contents = value; }, hit: (entity: Q1Actor | null) => { hit = entity?.actor.id ?? null; } };
}

test("MG3 lava suit blocks all liquid hazards, restores its timer and expires distinctly from the biosuit", () => {
  const state = session(undefined, { itemFloor: true });
  try {
    const suit = state.spawn("item_artifact_lavasuit"); state.think(suit, 0.2);
    expect(suit.model).toBe("progs/lavasuit.mdl");
    state.game.time = 1; state.touch(suit);
    expect(state.player.powerups.get("mg3:lavasuit")).toBe(31);
    expect(state.player.powerups.has("suit")).toBe(false);
    expect(q1PowerupTimers(state.player.powerups, 1)).toContainEqual({ item: "q1:item_artifact_lavasuit", label: "Lava Suit", remainingSeconds: 30 });
    for (const [index, liquid] of (["lava", "slime", "water"] satisfies readonly ReturnType<Q1FoundationHost["contents"]>[]).entries()) {
      state.contents(liquid); state.player.airFinished = 0;
      state.game.playerFrame(state.player.actor, index + 2, 3);
      expect(state.game.health(state.player.actor.id)).toBe(50);
    }
    const restored = session(state.save());
    try {
      expect(restored.player.powerups.get("mg3:lavasuit")).toBe(31);
      restored.contents("lava");
      restored.game.playerFrame(restored.player.actor, 29, 3);
      expect(restored.events.filter(event => event.kind === "message" && event.text === "$mg3_qc_lavasuit_wearing_out")).toHaveLength(1);
      restored.game.playerFrame(restored.player.actor, 29.5, 3);
      expect(restored.events.filter(event => event.kind === "message" && event.text === "$mg3_qc_lavasuit_wearing_out")).toHaveLength(1);
      restored.game.playerFrame(restored.player.actor, 31, 3);
      expect(restored.player.powerups.has("mg3:lavasuit")).toBe(false);
      expect(restored.game.health(restored.player.actor.id)).toBe(20);
      expect(q1PowerupTimers(restored.player.powerups, 31)).toEqual([]);
      restored.game.givePowerup(restored.player, "suit");
      restored.game.playerFrame(restored.player.actor, 32.1, 3);
      expect(restored.game.health(restored.player.actor.id)).toBe(-10);
    } finally { restored.actors.close(); }
  } finally { state.actors.close(); }
});

test("MG3 coop lava suit respawns after 2.5 seconds and clears its fired target", () => {
  const state = session(undefined, { coop: true, itemFloor: true });
  try {
    const suit = state.spawn("item_artifact_lavasuit"); state.think(suit, 0.2);
    suit.target = "already-fired"; state.game.time = 1; state.touch(suit);
    expect(suit.target).toBe("");
    expect(state.pending.get(suit.actor)).toBe(3.5);
    expect(suit.model).toBe("");
    state.think(suit, 3.5);
    expect(suit.model).toBe("progs/lavasuit.mdl");
    expect(suit.solid).toBe("trigger");
  } finally { state.actors.close(); }
});

test("retail MG3 upgrade identity, capacity refill, repeated pickup and saved continuation", async () => {
  const archive = await openArchive("/home/buzzkill/Projects/qfiles/q1/rerelease/mg3/pak0.pak");
  const state = session();
  try {
    const entry = archive.findEntries("maps/map1.bsp")[0]; if (entry === undefined) throw new Error("Missing retail MG3 map1");
    const map = readQ1Bsp(await archive.readEntry(entry), { source: entry.path }); state.game.mapName = "map1";
    const source = map.entityList.find(entity => q1EntityValue(entity, "classname")?.startsWith("item_upgrade_"));
    if (source === undefined) throw new Error("Retail map1 has no upgrade");
    const classname = q1EntityValue(source, "classname"); if (classname === null) throw new Error("Upgrade classname missing");
    expect(state.player.maxHealth).toBe(50); expect(state.inventory.entries(state.player.actor.id).filter(item => item.item.startsWith("q1:ammo/")).map(item => item.capacity)).toEqual([50, 100, 20, 100]);
    const upgrade = state.spawn(classname, source); state.think(upgrade, 0.5); state.touch(upgrade);
    expect(state.game.live(upgrade)).toBe(false); expect(state.context.playerNumber(state.player.actor.id, "parm10") + state.context.playerNumber(state.player.actor.id, "parm11") + state.context.playerNumber(state.player.actor.id, "parm12") + state.context.playerNumber(state.player.actor.id, "parm13") + state.context.playerNumber(state.player.actor.id, "parm14")).toBe(1);
    const saved = state.save(), restored = session(saved);
    try {
      expect(restored.game.capture()).toEqual(saved.source);
      const before = restored.inventory.entries(restored.player.actor.id), health = restored.player.maxHealth;
      const duplicate = restored.spawn(classname, source); restored.think(duplicate, 1); restored.touch(duplicate);
      expect(restored.inventory.entries(restored.player.actor.id)).toEqual(before); expect(restored.player.maxHealth).toBe(health);
      expect(restored.events.some(event => event.kind === "message" && event.text.startsWith("$mg3_qc_upgrade_fail"))).toBe(true);
    } finally { restored.actors.close(); }
    expect(mg3UpgradeFlag("map2b")).toBe(8192); expect(mg3UpgradeFlag("secret6")).toBe(16384); expect(mg3UpgradedMaximum(50, 32767)).toBe(200);
  } finally { archive.close(); state.actors.close(); }
});

test("MG3 laser damage and Bloody shotgun cadence/pellets share inventory and combat", () => {
  const state = session(), { game, player, inventory } = state;
  try {
    state.touch(state.spawn("weapon_laser_gun")); expect(player.weapon).toBe("mg3:laser"); expect(inventory.count(player.actor.id, "q1:ammo/cells")).toBe(30);
    expect(game.weaponInput(player.actor, true, ZERO, 1)).toBe(true);
    const lasers = [...game.entities.values()].filter(entity => entity.classname === "hiplaser"); expect(lasers).toHaveLength(2); expect(lasers.map(laser => laser.damage)).toEqual([15, 15]); expect(lasers.every(laser => laser.projectileWeapon === "mg3:laser")).toBe(true);
    const target = game.create("target"); target.damageable = true; state.combat.setHealth(target.actor, 1000); state.hit(target);
    const hidden = state.spawn("weapon_bloody_sg"); state.think(hidden, 1.5); expect(game.live(hidden)).toBe(false);
    state.base.campaign.writeFlags(BLOODY_NIGHTMARE_NEWGAME);
    state.touch(state.spawn("weapon_bloody_sg")); expect(game.weaponModel(player.weapon, player)).toBe("progs/v_bloodshot.mdl");
    expect(game.attack(player.actor, ZERO, 2)).toBe(true); expect(player.attackFinished).toBeCloseTo(2.28, 5);
    state.touch(state.spawn("weapon_bloody_ssg")); expect(game.weaponModel(player.weapon, player)).toBe("progs/v_bloodshot2.mdl");
    const health = game.health(target.actor.id); expect(game.attack(player.actor, ZERO, 3)).toBe(true); expect(health - game.health(target.actor.id)).toBe(112);
    const save = state.save(), restored = session(save); try { expect(restored.game.capture()).toEqual(save.source); } finally { restored.actors.close(); }
  } finally { state.actors.close(); }
});

test("MG3 hammer second hit discharges after source delay and survives saved references", () => {
  const state = session(), { game, player, inventory } = state;
  try {
    state.touch(state.spawn("weapon_mjolnir")); const target = game.create("target"); target.damageable = true; state.combat.setHealth(target.actor, 1000); state.hit(target);
    expect(game.attack(player.actor, ZERO, 1)).toBe(true);
    expect(mg3HammerBodyFrame(state.context, player)).toBe(38);
    const strike = [...game.entities.values()].find(entity => entity.classname === "mg3_hammer_strike"); if (strike === undefined) throw new Error("Missing hammer strike");
    state.think(strike, 1.2); expect(game.health(target.actor.id)).toBe(960); expect(player.attackFinished).toBeCloseTo(1.4, 5);
    expect(game.weaponModel(player.weapon, player)).toBe("progs/v_hammer_glow.mdl");
    const saved = state.save(), restored = session(saved);
    try {
      const savedTarget = [...restored.game.entities.values()].find(entity => entity.classname === "target"); if (savedTarget === undefined) throw new Error("Missing restored hammer victim"); restored.hit(savedTarget);
      expect(restored.game.attack(restored.player.actor, ZERO, 1.41)).toBe(true);
      const second = [...restored.game.entities.values()].find(entity => entity.classname === "mg3_hammer_strike"); if (second === undefined) throw new Error("Missing second strike");
      restored.think(second, 1.61); expect(restored.inventory.count(restored.player.actor.id, "q1:ammo/cells")).toBe(15);
      expect([...restored.game.entities.values()].filter(entity => entity.classname === "hipnotic_mjolnir_lightning")).toHaveLength(4);
      expect(inventory.count(player.actor.id, "q1:ammo/cells")).toBe(30);
      expect(restored.game.weaponModel(restored.player.weapon, restored.player)).toBe("progs/v_hammer.mdl");
      expect(mg3HammerBodyFrame(restored.context, restored.player)).toBe(38);
      expect(restored.game.attack(restored.player.actor, ZERO, 2.2)).toBe(true);
      expect(mg3HammerBodyFrame(restored.context, restored.player)).toBe(32);
    } finally { restored.actors.close(); }
  } finally { state.actors.close(); }
});

test("MG3 grants all fifteen upgrades with the actual final health and ammunition limits", () => {
  const state = session();
  try {
    for (const type of ["health", "shells", "nails", "rockets", "cells"] satisfies readonly Mg3Upgrade[]) {
      for (let upgrade = 0; upgrade < 15; upgrade++) expect(giveNextMg3Upgrade(state.context, type, state.player)).toBe(true);
      expect(giveNextMg3Upgrade(state.context, type, state.player)).toBe(false);
    }
    expect(state.player.maxHealth).toBe(200); expect(state.game.health(state.player.actor.id)).toBe(200);
    expect(state.inventory.entries(state.player.actor.id).filter(item => item.item.startsWith("q1:ammo/")).map(item => [item.count, item.capacity]))
      .toEqual([[200, 200], [250, 250], [170, 170], [250, 250]]);
  } finally { state.actors.close(); }
});

test("MG3 source level parameters survive ordinary, hub and death equipment resets", () => {
  const source = session(), next = session(), hub = session(), dead = session();
  try {
    for (const type of ["health", "shells", "nails", "rockets", "cells"] satisfies readonly Mg3Upgrade[])
      giveNextMg3Upgrade(source.context, type, source.player);
    source.context.setPlayerNumber(source.player.actor.id, "parm15", 3);
    const carry = captureQ1AddonTravel(source.context, source.player.actor);
    expect(carry.maxHealth).toBe(60); expect(carry.health).toBe(60);
    admitQ1AddonTravel(next.context, next.player.actor, carry);
    expect(next.player.maxHealth).toBe(60); expect(next.game.health(next.player.actor.id)).toBe(60);
    expect(next.inventory.entries(next.player.actor.id).filter(item => item.item.startsWith("q1:ammo/")).map(item => item.capacity)).toEqual([60, 110, 30, 110]);
    expect(next.context.playerNumber(next.player.actor.id, "parm15")).toBe(3);
    hub.game.worldType = 3; admitQ1AddonTravel(hub.context, hub.player.actor, carry);
    expect(hub.game.health(hub.player.actor.id)).toBe(50); expect(hub.player.maxHealth).toBe(60);
    expect(hub.inventory.count(hub.player.actor.id, "q1:ammo/shells")).toBe(25);
    expect(hub.context.playerNumber(hub.player.actor.id, "parm10")).toBe(1);
    source.combat.setHealth(source.player.actor, 0);
    admitQ1AddonTravel(dead.context, dead.player.actor, captureQ1AddonTravel(source.context, source.player.actor));
    expect(dead.game.health(dead.player.actor.id)).toBe(50); expect(dead.player.maxHealth).toBe(60);
    expect(dead.context.playerNumber(dead.player.actor.id, "parm15")).toBe(3);
  } finally { source.actors.close(); next.actors.close(); hub.actors.close(); dead.actors.close(); }
});

test("MG3 current capacity words preserve reset independently of travel upgrade flags", () => {
  const source = session(), next = session();
  try {
    giveNextMg3Upgrade(source.context, "shells", source.player);
    expect(source.game.inventoryCapacity(source.player.actor.id, "q1:ammo/shells")).toBe(60);
    expect(handleMg3ItemImpulse(source.context, source.player.actor.id, 100, () => undefined)).toBe(true);
    expect(source.game.inventoryCapacity(source.player.actor.id, "q1:ammo/shells")).toBe(100);
    giveNextMg3Upgrade(source.context, "shells", source.player);
    const restored = session(source.save());
    try {
      expect(restored.game.inventoryCapacity(restored.player.actor.id, "q1:ammo/shells")).toBe(110);
      expect(restored.inventory.count(restored.player.actor.id, "q1:ammo/shells")).toBe(110);
      admitQ1AddonTravel(next.context, next.player.actor, captureQ1AddonTravel(restored.context, restored.player.actor));
      expect(next.game.inventoryCapacity(next.player.actor.id, "q1:ammo/shells")).toBe(70);
    } finally { restored.actors.close(); }
  } finally { source.actors.close(); next.actors.close(); }
});

test("MG3 Bloody Nightmare travel preserves hammer, Bloody SSG and armor with source weapon selection", () => {
  const source = session(undefined, { skill: 3 }), next = session(undefined, { skill: 3 });
  try {
    source.touch(source.spawn("weapon_mjolnir")); source.touch(source.spawn("weapon_laser_gun"));
    source.context.setPlayerNumber(source.player.actor.id, "parm15", 3);
    source.combat.setArmor(source.player.actor, { regular: { kind: "q1", points: 150, absorption: 0.8, item: "q1:armor/red" }, powered: { kind: "none" } });
    source.base.campaign.writeFlags(BLOODY_NIGHTMARE_ACTIVE); next.base.campaign.writeFlags(source.base.campaign.readFlags());
    const carry = captureQ1AddonTravel(source.context, source.player.actor); expect(carry.weapon).toBe("mg3:laser");
    admitQ1AddonTravel(next.context, next.player.actor, carry);
    expect(next.player.weapon).toBe("shotgun"); expect(next.game.weaponModel(next.player.weapon, next.player)).toBe("progs/v_bloodshot.mdl");
    expect(next.inventory.entries(next.player.actor.id).filter(entry => entry.item.startsWith("q1:weapon/") && entry.count !== 0).map(entry => entry.item).sort())
      .toEqual(["q1:weapon/axe", "q1:weapon/mg3:mjolnir", "q1:weapon/shotgun", "q1:weapon/supershotgun"]);
    expect(next.combat.read(next.player.actor.id)?.armor).toEqual({ regular: { kind: "q1", points: 150, absorption: 0.8, item: "q1:armor/red" }, powered: { kind: "none" } });
  } finally { source.actors.close(); next.actors.close(); }
});


test("retail MG3 bosses register source controllers and restore their live callbacks", async () => {
  const archive = await openArchive("/home/buzzkill/Projects/qfiles/q1/rerelease/mg3/pak0.pak"), state = session();
  try {
    state.spawn("worldspawn");
    for (const [mapName, classname, health] of [["boss2", "monster_oldone_new", 12000], ["map1", "monster_ghost", 10], ["boss", "monster_orb", 300]] satisfies [string, string, number][]) {
      const entry = archive.findEntries(`maps/${mapName}.bsp`)[0]; if (entry === undefined) throw new Error(`Missing retail ${mapName}`);
      const map = readQ1Bsp(await archive.readEntry(entry), { source: entry.path }), source = map.entityList.find(entity => q1EntityValue(entity, "classname") === classname);
      if (source === undefined) throw new Error(`Missing retail ${classname}`);
      const boss = state.spawn(classname, source); expect(state.game.health(boss.actor.id)).toBe(health); expect(boss.think).not.toBeNull(); expect(boss.die).not.toBeNull();
    }
    const finalBoss = state.spawn("monster_boss_final"); expect(finalBoss.classname).toBe("monster_boss"); expect(finalBoss.number("boss_immune")).toBe(1);
    finalBoss.use?.(null, state.player.actor.id); expect(state.game.health(finalBoss.actor.id)).toBe(12000); expect(finalBoss.frame).toBe(0);
    state.think(finalBoss, 0.1); expect(finalBoss.frame).toBe(1);
    const zombie = state.spawn("monster_szombie"), sacrifice = state.spawn("misc_sacrifice");
    expect(state.game.health(zombie.actor.id)).toBe(60); expect(sacrifice.use).not.toBeNull();
    const oldnew = [...state.game.entities.values()].find(entity => entity.classname === "monster_oldone_new"); if (oldnew === undefined) throw new Error("Missing retail Oldnew");
    const spammer = spawnSpammer(state.context, oldnew); state.think(spammer, 0.1); expect(spammer.count).toBe(1);
    const saved = state.save(), restored = session(saved);
    try {
      expect(restored.game.capture()).toEqual(saved.source);
      const restoredFinal = restored.game.entity(restored.actors.referenceSaved(finalBoss.actor.id)); if (restoredFinal === null) throw new Error("Missing restored final boss");
      expect(restoredFinal.frame).toBe(1); restored.think(restoredFinal, 0.2); expect(restoredFinal.frame).toBe(2);
      const restoredSpammer = restored.game.entity(restored.actors.referenceSaved(spammer.actor.id)); if (restoredSpammer === null) throw new Error("Missing restored Oldnew spammer");
      restored.think(restoredSpammer, 0.2); expect(restoredSpammer.count).toBe(2);
      expect([...restored.game.entities.values()].filter(entity => entity.classname === "spam")).toHaveLength(2);
      const ghost = [...restored.game.entities.values()].find(entity => entity.classname === "monster_ghost"); if (ghost === undefined) throw new Error("Missing restored ghost");
      restored.touch(ghost); expect(ghost.touch).toBeNull(); expect(ghost.think).not.toBeNull();
      const restoredSacrifice = [...restored.game.entities.values()].find(entity => entity.classname === "misc_sacrifice"); if (restoredSacrifice === undefined) throw new Error("Missing restored sacrifice");
      const frame = restoredSacrifice.frame; restored.think(restoredSacrifice, 0.1); expect(restoredSacrifice.frame).toBe(frame + 1);
      expect(() => restored.save()).not.toThrow();
    } finally { restored.actors.close(); }
  } finally { archive.close(); state.actors.close(); }
});

test("MG3 laser and hammer source pickups grant the selected foreign arsenal", () => {
  const scene = session(undefined, { itemFloor: true });
  try {
    for (const entry of q2BaseWeaponInventory()) scene.inventory.configure(scene.player.actor, { ...entry, count: 0 });
    scene.game.pickupAdmission = new SharedPickupAdmission({ inventory: scene.inventory, profile: expansionSourceSupply(Q1_Q2_SUPPLY_PROFILE), ammoGranted: () => undefined, weaponGranted: () => undefined });
    for (const classname of ["weapon_laser_gun", "weapon_mjolnir"]) {
      const item = scene.spawn(classname); scene.think(item, 0.2); scene.touch(item);
      expect(scene.inventory.count(scene.player.actor.id, classname === "weapon_laser_gun" ? "q2:weapon_hyperblaster" : "q2:weapon_blaster")).toBe(1);
      expect(item.solid).toBe("none");
    }
    expect(scene.inventory.count(scene.player.actor.id, "q2:ammo_cells")).toBe(60);
    expect(scene.inventory.count(scene.player.actor.id, "q1:weapon/mg3:laser")).toBe(0);
    expect(scene.inventory.count(scene.player.actor.id, "q1:weapon/mg3:mjolnir")).toBe(0);
  } finally { scene.actors.close(); }
});
