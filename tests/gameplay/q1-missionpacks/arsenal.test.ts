import type { WeaponBehaviorProjectilePort } from "../../../src/contracts/weapon-behavior.ts";
import { launchHipnoticLaser } from "../../../src/content/q1/missionpacks/hipnotic-weapons.ts";
import { SharedPickupAdmission } from "../../../src/world/gameplay/pickups.ts";
import { expansionSourceSupply } from "../../../src/content/composition/expansion-source-supply.ts";
import { Q1_Q2_SUPPLY_PROFILE } from "../../../src/content/composition/q1-q2-supply.ts";
import { q2BaseWeaponInventory } from "../../../src/content/q2/foundation/items.ts";
import { registerSelectedQ1MissionWeapons } from "../../../src/content/composition/q1-expansion-arsenal.ts";
import { Q1SelectedArsenal } from "../../../src/app/bootstrap/simulation/arsenal/q1.ts";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { ActorId, OwnedActor } from "../../../src/contracts/identity.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { SessionActorRegistry, SharedBodyTable, ActorCallbackTable, translatedBodyBounds } from "../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ1CombatPolicy, nativeVictimArmor } from "../../../src/world/gameplay/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { Q1_DONOR_PROFILE } from "../../../src/core/numeric.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { readQ1Bsp } from "../../../src/formats/q1-map/index.ts";
import { Q1Foundation } from "../../../src/content/q1/foundation/index.ts";
import { Q1EntityServices } from "../../../src/content/q1/foundation/entity-services.ts";
import { registerHipnoticWeapons } from "../../../src/content/q1/missionpacks/arsenal.ts";
import { missionWeapons } from "../../../src/content/q1/missionpacks/types.ts";
import type { Q1Event, Q1FoundationHost } from "../../../src/content/q1/foundation/index.ts";
import { PLAYER_BOUNDS, ZERO, vadd, weaponItem } from "../../../src/content/q1/foundation/types.ts";
import { registerQ1Base } from "../../../src/content/q1/base/index.ts";
import { Q1CharacterActor } from "../../../src/content/q1/base/player.ts";
import type { Q1CharacterInput } from "../../../src/content/q1/base/player.ts";
import { registerMissionPackArsenal, launchRogueLavaSpike, captureMissionPackTravel, decodeMissionPackTravel, admitMissionPackTravel, newMissionPackTravel, dropMissionPackBackpack } from "../../../src/content/q1/missionpacks/index.ts";
import type { Q1MissionPack } from "../../../src/content/q1/missionpacks/index.ts";
import { missionPackCharacterPose } from "../../../src/content/q1/missionpacks/index.ts";
import { missionPackObituary } from "../../../src/content/q1/missionpacks/obituaries.ts";
import type { Q1ObituaryActor } from "../../../src/content/q1/base/rules.ts";

const archivePath = "/home/buzzkill/Projects/qfiles/q1/rerelease/id1/pak0.pak";
async function session(pack: Q1MissionPack, edition: "classic" | "rerelease" = "rerelease", deathmatch = 0, teamplay = 0, weaponBehavior?: WeaponBehaviorProjectilePort) {
  const archive = await openArchive(archivePath);
  const entry = archive.findEntries("maps/start.bsp")[0]; if (entry === undefined) throw new Error("Retail start.bsp missing");
  const map = readQ1Bsp(await archive.readEntry(entry), { source: "maps/start.bsp" }); archive.close();
  const actors = new SessionActorRegistry(createIdentityOwner(`missionpack-${pack}`)), callbacks = new ActorCallbackTable(actors), scene = createSceneQueries(map);
  const events: Q1Event[] = [], players: ActorId[] = [], pending = new Map<OwnedActor, number>(), gravity = new Map<ActorId, number>();
  let active: Q1Foundation | null = null;
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onUnlink: actor => { scene.unlink(actor); return undefined; }, onLink: body => {
    const entity = active?.entity(body.actor);
    if (entity === null || entity === undefined || entity.solid === "none" || entity.classname === "worldspawn") { scene.unlink(body.actor); return undefined; }
    const model = entity.model.startsWith("*") ? Number(entity.model.slice(1)) : null;
    scene.link(body, { family: "q1", shape: model === null ? { kind: "box" } : { kind: "model", model }, contents: -2, owner: entity.owner, role: entity.solid === "trigger" ? "trigger" : "solid", monster: entity.monster !== null, deadMonster: false }); return undefined;
  } });
  const combat = new GameplayAuthority(actors, callbacks, { impulse: (actor, impulse) => { const body = bodies.read(actor.id); if (body !== null) bodies.write(actor, { ...body, velocity: vadd(body.velocity, impulse) }); return undefined; }, beforeReaction: () => undefined, confirmed: () => undefined });
  const inventory = new SharedInventoryTable(actors);
  const host: Q1FoundationHost = { actors, callbacks, bodies, combat, inventory, ...(weaponBehavior === undefined ? {} : { weaponBehavior }), random: () => 0.4, trace: request => {
    const trace = scene.trace({ start: request.start, end: request.end, shape: { kind: "box", bounds: request.bounds }, target: { kind: "world" }, policy: { kind: "q1", move: request.monsters ? "normal" : "no-monsters", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: request.ignore });
    if (trace.kind !== "q1") throw new Error("Q1 trace expected");
    return { fraction: trace.fraction, end: trace.end, normal: trace.sourcePlane.normal, actor: trace.hit.kind === "actor" ? trace.hit.actor : trace.hit.kind === "world" ? active?.world?.actor.id ?? null : null, startSolid: trace.startSolid, allSolid: trace.allSolid, sky: false, inOpen: trace.inOpen, inWater: trace.inWater };
  }, contents: point => {
    const result = scene.pointContents({ point, target: { kind: "world" }, policy: { kind: "q1", move: "normal", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: null });
    if (result.kind !== "q1") throw new Error("Q1 contents expected"); return result.contents === -2 ? "solid" : result.contents === -3 ? "water" : result.contents === -4 ? "slime" : result.contents === -5 ? "lava" : result.contents === -6 ? "sky" : "empty";
  }, walkMove: () => false, moveToGoal: () => undefined, changeYaw: actor => {
    const body = bodies.read(actor.id), entity = active?.entity(actor.id); if (body === null || entity === null || entity === undefined) return undefined;
    const delta = ((entity.idealYaw - body.angles.y + 540) % 360) - 180; bodies.write(actor, { ...body, angles: { ...body.angles, y: Math.fround((body.angles.y + Math.max(-entity.yawSpeed, Math.min(entity.yawSpeed, delta)) + 360) % 360) } }); return undefined;
  }, checkBottom: () => false, pusherServices: () => { throw new Error("This fixture does not step native pushers"); },
    scheduleThink: (actor, due) => { pending.set(actor, due); return undefined; }, cancelThink: actor => { pending.delete(actor); return undefined; }, emit: event => { events.push(event); return undefined; }, transition: () => undefined,
    players: () => players, checkClient: () => null, classname: actor => active?.entity(actor)?.classname ?? "player", powerup: () => undefined, setGravity: (actor, scale) => { gravity.set(actor, scale); return undefined; } };
  const game = new Q1Foundation(host, { edition, skill: 1, deathmatch, teamplay, coop: false, maxClients: 2, gravity: 800, campaign: `q1:${pack}`, combatProvider: "q1:combat", inventoryProvider: "q1:inventory", movementProvider: "q3:movement" }); active = game;
  combat.register(createQ1CombatPolicy({ id: "q1:combat", context: request => game.combatContext(request), sourceEffects: game.damageSourceEffects, armor: nativeVictimArmor(() => ({ arithmetic: "binary32", screenFacingDot: 0 })) }));
  registerQ1Base(game); const arsenal = registerMissionPackArsenal(game, pack); game.spawnMap(map);
  const start = [...game.entities.values()].find(entity => entity.classname === "info_player_start"), origin = start === undefined ? ZERO : game.body(start).origin;
  function player(slot: number) {
    const owner = actors.allocateAtSource("q3:character", slot, "q3:sarge");
    bodies.create(owner, { origin: vadd(origin, { x: 64 * (slot - 1), y: 0, z: 0 }), angles: ZERO, velocity: ZERO, bounds: PLAYER_BOUNDS, ground: null });
    combat.create(owner, { health: 100, armor: { kind: "none" }, mass: 100, canTakeDamage: true, invulnerable: false, team: null });
    const state = game.attachPlayer(owner); players.push(owner.id); return state;
  }
  return { game, arsenal, actors, callbacks, combat, bodies, inventory, events, pending, gravity, player: player(1), target: player(2) };
}

test.skipIf(!existsSync(archivePath))("Hipnotic paired lasers, native pickups and nested empathy use shared actors", async () => {
  const { game, actors, callbacks, inventory, combat, player, target } = await session("hipnotic");
  const pickup = game.create("weapon_laser_gun"); game.spawnEntity(pickup); pickup.solid = "trigger";
  callbacks.touch({ self: pickup.actor, other: player.actor.id, plane: null, surface: null });
  expect(inventory.count(player.actor.id, "q1:ammo/cells")).toBe(30); expect(player.weapon).toBe("hipnotic:laser");
  expect(game.weaponInput(player.actor, true, ZERO, 1)).toBe(true);
  expect([...game.entities.values()].filter(entity => entity.classname === "hiplaser")).toHaveLength(2);
  expect(game.weaponInput(player.actor, true, ZERO, 1.11)).toBe(true);
  expect([...game.entities.values()].filter(entity => entity.classname === "hiplaser")).toHaveLength(3); expect(inventory.count(player.actor.id, "q1:ammo/cells")).toBe(28);
  game.givePowerup(player, "quad"); game.givePowerup(target, "hipnotic:empathy");
  game.damage(target.actor.id, player.actor.id, player.actor.id, 10, "shotgun");
  expect(combat.read(player.actor.id)?.health).toBe(80); expect(combat.read(target.actor.id)?.health).toBe(80);
  game.givePowerup(target, "hipnotic:wetsuit"); game.damage(target.actor.id, player.actor.id, player.actor.id, 100, "lightning", "radius", "discharge");
  expect(combat.read(target.actor.id)?.health).toBe(80); actors.close();
});

for (const edition of ["classic", "rerelease"] satisfies readonly ("classic" | "rerelease")[]) test.skipIf(!existsSync(archivePath))(`Hipnotic ${edition} weapon registration fires on existing actors without campaign player extensions`, async () => {
  const native = await session("hipnotic", edition);
  try {
    const game = new Q1EntityServices(native.game.host, { ...native.game.options, provider: `q1:weapons/${edition}/hipnotic` });
    const actorsBefore = native.actors.observations().length;
    registerHipnoticWeapons(game);
    expect([...game.registeredWeapons.keys()]).toEqual([...native.game.registeredWeapons.keys()]);
    expect(game.weaponOrder).toEqual(native.game.weaponOrder);
    expect(game.playerExtensions.size).toBe(0);
    expect(game.pickupRules).toBeNull();
    expect(game.stateExtensions.size).toBe(0);
    const player = game.attachPlayer(native.player.actor, { initializeInventory: false });
    expect(native.actors.observations().length).toBe(actorsBefore);
    expect(game.entities.size).toBe(0);
    expect(game.world).toBeNull();
    native.inventory.configure(player.actor, { item: "q1:ammo/cells", count: 100, capacity: 100 });
    native.inventory.configure(player.actor, { item: "q1:ammo/rockets", count: 100, capacity: 100 });
    let seconds = 1;
    for (const weapon of missionWeapons) if (weapon.id.startsWith("hipnotic:")) {
      const item = game.weaponItem(weapon.id);
      native.inventory.configure(player.actor, { item, count: 1, capacity: 1 });
      expect(game.selectWeapon(player.actor, weapon.id)).toBe(true);
      expect(game.weaponInput(player.actor, true, ZERO, seconds)).toBe(true);
      expect(player.weapon).toBe(weapon.id);
      expect(game.weaponModel(player.weapon)).toBe(weapon.model);
      seconds += 2;
    }
    expect([...game.entities.values()].filter(entity => entity.classname === "hiplaser")).toHaveLength(2);
    expect([...game.entities.values()].some(entity => entity.classname === "proximity_grenade")).toBe(true);
    expect(native.inventory.count(player.actor.id, "q1:ammo/cells")).toBe(99);
    expect(native.inventory.count(player.actor.id, "q1:ammo/rockets")).toBe(99);
    const health = game.health(player.actor.id);
    player.waterLevel = 3; player.airFinished = -100;
    game.weaponFrame(player.actor, seconds);
    expect(game.health(player.actor.id)).toBe(health);
    expect(game.playerExtensions.size).toBe(0);
  } finally { native.actors.close(); }
});

test.skipIf(!existsSync(archivePath))("Rogue powered ammunition, lava armor and five-way grenades preserve source behavior", async () => {
  const { game, arsenal, actors, callbacks, combat, inventory, player, target, gravity } = await session("rogue");
  inventory.give(player.actor, weaponItem("nailgun"), 1); inventory.give(player.actor, weaponItem("supernailgun"), 1);
  inventory.give(player.actor, "rogue:ammo/lava-nails", 3); arsenal.players.enableCombos(player);
  expect(game.selectWeapon(player.actor, "rogue:lava-supernailgun")).toBe(true); expect(game.attack(player.actor, ZERO, 1)).toBe(true);
  expect(inventory.count(player.actor.id, "rogue:ammo/lava-nails")).toBe(1); expect(game.attack(player.actor, ZERO, 1.21)).toBe(true);
  expect(inventory.count(player.actor.id, "rogue:ammo/lava-nails")).toBe(0);
  combat.setArmor(target.actor, { kind: "q1", points: 100, absorption: 0.8, item: "q1:armor/red" });
  const lava = launchRogueLavaSpike(game, player.actor.id, game.host.bodies.read(target.actor.id)?.origin ?? ZERO, { x: 1, y: 0, z: 0 });
  callbacks.touch({ self: lava.actor, other: target.actor.id, plane: null, surface: null });
  expect(combat.read(target.actor.id)?.health).toBe(91); expect(combat.read(target.actor.id)?.armor).toEqual({ kind: "q1", points: 100, absorption: 0.8, item: "q1:armor/red" });
  game.givePowerup(target, "rogue:shield");
  const superLava = launchRogueLavaSpike(game, player.actor.id, game.host.bodies.read(target.actor.id)?.origin ?? ZERO, { x: 1, y: 0, z: 0 }, true);
  callbacks.touch({ self: superLava.actor, other: target.actor.id, plane: null, surface: null });
  expect(combat.read(target.actor.id)?.health).toBe(84); expect(combat.read(target.actor.id)?.armor).toEqual({ kind: "q1", points: 94, absorption: 0.8, item: "q1:armor/red" });
  inventory.give(player.actor, weaponItem("rogue:multi-grenade"), 1); inventory.give(player.actor, "rogue:ammo/multi-rockets", 1); game.selectWeapon(player.actor, "rogue:multi-grenade"); game.attack(player.actor, ZERO, 2);
  const grenade = [...game.entities.values()].find(entity => entity.classname === "MultiGrenade"); if (grenade === undefined) throw new Error("Missing source multi-grenade");
  callbacks.think(grenade.actor, { frame: 30, time: { kind: "seconds", value: 3 }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" });
  expect([...game.entities.values()].filter(entity => entity.classname === "MiniGrenade")).toHaveLength(5);
  arsenal.players.powerup(player, "rogue:antigrav", 45); expect(gravity.get(player.actor.id)).toBe(0.25); game.playerFrame(player.actor, 49); expect(gravity.get(player.actor.id)).toBe(1); actors.close();
});

test.skipIf(!existsSync(archivePath))("Rogue grapple anchors, pulls and releases using actual shared input state", async () => {
  const { game, actors, callbacks, inventory, bodies, player } = await session("rogue");
  inventory.give(player.actor, weaponItem("rogue:grapple"), 1); game.selectWeapon(player.actor, "rogue:grapple");
  game.playerInput(player.actor, { attack: true, jump: false }); game.weaponInput(player.actor, true, ZERO, 1);
  const hook = [...game.entities.values()].find(entity => entity.classname === "hook"), body = bodies.read(player.actor.id), world = game.world;
  if (hook === undefined || body === null || world === null) throw new Error("Missing source grapple actor");
  game.setOrigin(hook, vadd(body.origin, { x: 200, y: 0, z: 16 }));
  callbacks.touch({ self: hook.actor, other: world.actor.id, plane: null, surface: null }); game.playerFrame(player.actor, 1.01);
  expect(hook.count).toBe(1); expect(bodies.read(player.actor.id)?.velocity.x).toBe(1000);
  game.playerInput(player.actor, { attack: false, jump: false }); game.playerFrame(player.actor, 1.02);
  expect(game.live(hook)).toBe(false); expect(player.attackFinished).toBe(Math.fround(1.27)); actors.close();
});

test.skipIf(!existsSync(archivePath))("Mission pack travel preserves edition resets and source multiplayer starting equipment", async () => {
  const editions: readonly ("classic" | "rerelease")[] = ["classic", "rerelease"];
  for (const edition of editions) {
    const { game, inventory, actors, player } = await session("hipnotic", edition, 1);
    inventory.give(player.actor, weaponItem("hipnotic:laser"), 1); inventory.give(player.actor, "q1:ammo/cells", 30); game.selectWeapon(player.actor, "hipnotic:laser");
    const state = captureMissionPackTravel(game, player.actor, "hipnotic");
    expect(state.weapon).toBe(edition === "classic" ? "hipnotic:laser" : "shotgun");
    game.mapName = "hip2m1"; const reset = decodeMissionPackTravel(game, state, 0, "hipnotic"); admitMissionPackTravel(game, player.actor, reset, "hipnotic");
    expect(inventory.count(player.actor.id, weaponItem("hipnotic:laser"))).toBe(0); expect(player.weapon).toBe("shotgun"); actors.close();
  }
  const { game, inventory, actors, player, combat } = await session("rogue", "rerelease", 1, 4);
  admitMissionPackTravel(game, player.actor, newMissionPackTravel(game, "rogue"), "rogue");
  expect(inventory.count(player.actor.id, weaponItem("rogue:grapple"))).toBe(1);
  expect(combat.read(player.actor.id)?.armor).toEqual({ kind: "q1", points: 50, absorption: 0.3, item: "q1:armor/green" }); actors.close();
});

test.skipIf(!existsSync(archivePath))("Rogue backpacks carry powered ammunition and grant the original base weapon", async () => {
  const { game, arsenal, callbacks, inventory, actors, player, target } = await session("rogue");
  inventory.give(player.actor, weaponItem("nailgun"), 1); inventory.give(player.actor, "rogue:ammo/lava-nails", 25); arsenal.players.enableCombos(player); game.selectWeapon(player.actor, "rogue:lava-nailgun");
  const backpack = dropMissionPackBackpack(game, player.actor, "rogue"); if (backpack === null) throw new Error("Missing source backpack");
  callbacks.touch({ self: backpack.actor, other: target.actor.id, plane: null, surface: null });
  expect(inventory.count(target.actor.id, "rogue:ammo/lava-nails")).toBe(25); expect(inventory.count(target.actor.id, weaponItem("rogue:lava-nailgun"))).toBe(1); expect(target.weapon).toBe("nailgun");
  expect(game.live(backpack)).toBe(false); actors.close();
});

test.skipIf(!existsSync(archivePath))("Rogue team impulses toss source ammo and weapons with owner pickup delay", async () => {
  const { game, arsenal, callbacks, inventory, actors, player, target } = await session("rogue", "rerelease", 1, 1);
  inventory.give(player.actor, weaponItem("nailgun"), 1); inventory.give(player.actor, "rogue:ammo/lava-nails", 50); arsenal.players.enableCombos(player); game.selectWeapon(player.actor, "rogue:lava-nailgun");
  expect(arsenal.impulse(player.actor.id, 20)).toBe(true);
  const backpack = [...game.entities.values()].find(entity => entity.classname === "item_backpack"); if (backpack === undefined) throw new Error("Missing tossed backpack");
  expect(backpack.movement).toBe("bounce"); expect(inventory.count(player.actor.id, "rogue:ammo/lava-nails")).toBe(30);
  callbacks.touch({ self: backpack.actor, other: player.actor.id, plane: null, surface: null }); expect(game.live(backpack)).toBe(true);
  callbacks.touch({ self: backpack.actor, other: target.actor.id, plane: null, surface: null }); expect(inventory.count(target.actor.id, "rogue:ammo/lava-nails")).toBe(20);
  arsenal.impulse(player.actor.id, 21); expect(inventory.count(player.actor.id, weaponItem("rogue:lava-nailgun"))).toBe(0); expect(player.weapon).toBe("shotgun");
  const weapon = [...game.entities.values()].find(entity => entity.classname === "weapon_nailgun" && entity.owner === player.actor.id); if (weapon === undefined) throw new Error("Missing tossed weapon");
  callbacks.touch({ self: weapon.actor, other: target.actor.id, plane: null, surface: null }); expect(inventory.count(target.actor.id, weaponItem("rogue:lava-nailgun"))).toBe(1); actors.close();
});

test.skipIf(!existsSync(archivePath))("Hipnotic hammer character uses source model and shared pain/death lifecycle", async () => {
  const { game, inventory, actors, player, bodies, combat } = await session("hipnotic");
  inventory.give(player.actor, weaponItem("hipnotic:mjolnir"), 1); game.selectWeapon(player.actor, "hipnotic:mjolnir");
  const character = new Q1CharacterActor(game, player.actor, { sourcePose: () => missionPackCharacterPose(game, player.actor.id, "hipnotic"), dropInventory: () => { game.selectWeapon(player.actor, "shotgun"); return undefined; } });
  const input: Q1CharacterInput = { axePose: false, attack: false, jump: false, use: false, waterLevel: 0, waterType: "empty", invisible: false, invulnerable: false };
  expect(character.frame(1, input).model).toBe("progs/playham.mdl"); expect(character.presentation.frame).toBe(6);
  const body = bodies.read(player.actor.id); if (body === null) throw new Error("Missing player body"); bodies.write(player.actor, { ...body, velocity: { x: 100, y: 0, z: 0 } });
  expect(character.frame(1.1, input).frame).toBe(0); character.pain(null); expect(character.presentation.frame).toBe(18);
  expect(character.frame(1.11, { ...input, invisible: true }).model).toBe("progs/eyes.mdl"); expect(character.presentation.frame).toBe(0);
  character.frame(1.12, input); combat.setHealth(player.actor, -1); character.die(); expect(character.presentation.model).toBe("progs/playham.mdl"); expect(character.presentation.frame).toBe(24);
  game.selectWeapon(player.actor, "shotgun"); expect(character.frame(1.22, input).model).toBe("progs/playham.mdl");
  character.respawn(); expect(character.frame(2, input).model).toBe("progs/player.mdl"); actors.close();
});

test.skipIf(!existsSync(archivePath))("Pack obituary decisions preserve source random draws and sole score awards", async () => {
  const { actors, player, target } = await session("rogue"); let draws = 0, tags = 0;
  const victim: Q1ObituaryActor = { actor: target.actor.id, name: "target", classname: "player", isPlayer: true, isMonster: false, team: 1, health: -1, waterType: "empty", waterLevel: 0, weapon: "shotgun", quadExpires: 0, invulnerableExpires: 0, brush: false, killString: "" };
  const attacker: Q1ObituaryActor = { ...victim, actor: player.actor.id, name: "player", team: 2, weapon: "rogue:plasma" };
  const input = { edition: "rerelease", victim, attacker, telefragOwner: null, teamplay: 0, deathType: "hipnotic:empathy", random: () => { draws++; return 0.4; } } satisfies Parameters<typeof missionPackObituary>[0];
  const context = { pack: "hipnotic", inflictorClassname: "player", attackerDeathType: "", victimSavedTeam: 1, gamecfg: 0 } satisfies Parameters<typeof missionPackObituary>[1];
  const empathy = missionPackObituary(input, context); expect(draws).toBe(2); expect(empathy.message?.text).toBe("$qc_death_empathy1"); expect(empathy.score).toEqual({ actor: player.actor.id, delta: 1 });
  const vengeance = missionPackObituary({ ...input, attacker: { ...attacker, isPlayer: false, classname: "Vengeance" } }, { ...context, pack: "rogue" }); expect(vengeance.score).toBe(null);
  const tag = missionPackObituary({ ...input, teamplay: 3 }, { ...context, pack: "rogue", tagScore: () => { tags++; return 5; } }); expect(tag.score).toEqual({ actor: player.actor.id, delta: 5 }); expect(tags).toBe(1);
  const suicide = missionPackObituary({ ...input, edition: "classic", attacker: victim }, context); expect(suicide.message?.text).toBe("target checks if his weapon is loaded\n"); actors.close();
});


test("foreign selected Q1 pickup switch respects its own saved player policy", async () => {
  const { game, player, inventory, actors } = await session("hipnotic");
  try {
    const selected = new Q1SelectedArsenal({ game, observe: () => ({ viewAngles: ZERO, waterLevel: 0 }) });
    inventory.give(player.actor, weaponItem("hipnotic:laser"), 1);
    inventory.give(player.actor, "q1:ammo/cells", 30);
    player.autoSwitch = "never";
    selected.pickupWeapons(player.actor, [weaponItem("hipnotic:laser")], "always");
    expect(player.weapon).toBe("shotgun");
    selected.pickupAmmo(player.actor, [{ item: "q1:ammo/cells", before: 0, given: 30 }], true);
    expect(player.weapon).toBe("shotgun");
    player.autoSwitch = "always";
    selected.pickupWeapons(player.actor, [weaponItem("hipnotic:laser")], "always");
    expect(player.weapon).toBe("hipnotic:laser");
  } finally { actors.close(); }
});

for (const program of ["rogue", "mg3"] satisfies readonly ("rogue" | "mg3")[]) test(`selected ${program} source arsenal fires registered extensions on shared foreign players`, async () => {
  const native = await session("hipnotic");
  try {
    const game = new Q1EntityServices(native.game.host, { ...native.game.options, provider: `q1:weapons/rerelease/${program}` });
    const source = registerSelectedQ1MissionWeapons(game, program, { emit: () => undefined, isMonster: () => false, cvar: () => 0, setCvar: () => undefined });
    const arsenal = new Q1SelectedArsenal({ game, impulse: source.impulse, preparePickup: source.preparePickup, observe: () => ({ viewAngles: ZERO, waterLevel: 0 }) });
    arsenal.admit(native.player.actor, 100);
    if (program === "rogue") {
      native.inventory.give(native.player.actor, weaponItem("nailgun"), 1);
      native.inventory.give(native.player.actor, "rogue:ammo/lava-nails", 10);
      arsenal.pickupAmmo(native.player.actor, [{ item: "rogue:ammo/lava-nails", before: 0, given: 10 }], true);
      expect(native.inventory.count(native.player.actor.id, weaponItem("rogue:lava-nailgun"))).toBe(1);
      expect(arsenal.read(native.player.actor.id).activeWeapon).toBe(weaponItem("rogue:lava-nailgun"));
    }
    let time = 1;
    for (const weapon of game.registeredWeapons.values()) {
      if (!weapon.id.startsWith(`${program}:`) || weapon.id === "rogue:grapple") continue;
      native.inventory.configure(native.player.actor, { item: game.weaponItem(weapon.id), count: 1, capacity: 1 });
      if (weapon.ammo !== null) native.inventory.configure(native.player.actor, { item: weapon.ammo, count: 100, capacity: 200 });
      expect(arsenal.select(native.player.actor.id, game.weaponItem(weapon.id))).toBe(true);
      expect(game.weaponInput(native.player.actor, true, ZERO, time)).toBe(true);
      expect(arsenal.read(native.player.actor.id).activeWeapon).toBe(game.weaponItem(weapon.id));
      time += 2;
    }
    expect(game.capture().players.length).toBe(1);
    if (program === "mg3") expect(game.capture().extensions.length).toBeGreaterThan(0);
  } finally { native.actors.close(); }
});

for (const pack of ["hipnotic", "rogue"] satisfies readonly Q1MissionPack[]) test(`native ${pack} pickups route into the selected foreign inventory`, async () => {
  const scene = await session(pack);
  try {
    for (const entry of q2BaseWeaponInventory()) scene.inventory.configure(scene.player.actor, { ...entry, count: 0 });
    scene.game.pickupAdmission = new SharedPickupAdmission({ inventory: scene.inventory, profile: expansionSourceSupply(Q1_Q2_SUPPLY_PROFILE), ammoGranted: () => undefined, weaponGranted: () => undefined });
    const entity = scene.game.create(pack === "hipnotic" ? "weapon_laser_gun" : "item_lava_spikes");
    scene.game.spawnEntity(entity); entity.solid = "trigger";
    scene.callbacks.touch({ self: entity.actor, other: scene.player.actor.id, plane: null, surface: null });
    expect(scene.inventory.count(scene.player.actor.id, pack === "hipnotic" ? "q2:ammo_cells" : "q2:ammo_bullets")).toBe(pack === "hipnotic" ? 30 : 25);
    if (pack === "hipnotic") {
      expect(scene.inventory.count(scene.player.actor.id, "q2:weapon_hyperblaster")).toBe(1);
      expect(scene.inventory.count(scene.player.actor.id, weaponItem("hipnotic:laser"))).toBe(0);
    } else expect(scene.inventory.count(scene.player.actor.id, "rogue:ammo/lava-nails")).toBe(0);
    expect<string>(entity.solid).toBe("none");
  } finally { scene.actors.close(); }
});

test.skipIf(!existsSync(archivePath))("Hipnotic source think retains projected launch and steering between donor callbacks", async () => {
  let steer = true;
  const { game, player, actors } = await session("hipnotic", "rerelease", 0, 0, {
    controlsTrajectory: () => true,
    launch: input => ({ origin: input.body.origin, velocity: { x: 300, y: 0, z: 0 }, angles: ZERO }),
    step: (_projectile, body) => { if (!steer) return null; steer = false; return { origin: body.origin, velocity: { x: 0, y: 250, z: 0 }, angles: { x: 0, y: 90, z: 0 } }; },
  });
  try {
    const laser = launchHipnoticLaser(game, player.actor.id, game.host.bodies.read(player.actor.id)?.origin ?? ZERO, { x: 1, y: 0, z: 0 });
    const think = laser.think; if (think === null) throw new Error("Hipnotic laser think missing");
    think(); expect(game.body(laser).velocity).toEqual({ x: 300, y: 0, z: 0 }); expect(laser.speed).toBe(300);
    game.applyProjectileBehavior(laser.actor, 0.2);
    expect(laser.movedir).toEqual({ x: 0, y: 250, z: 0 }); expect(laser.speed).toBe(250);
    game.time = 0.3; think(); game.applyProjectileBehavior(laser.actor, 0.3);
    expect(game.body(laser).velocity).toEqual({ x: 0, y: 250, z: 0 });
    expect(laser.model).toBe("progs/lasrspik.mdl"); expect(laser.damage).toBe(18);
    const world = game.world, touch = laser.touch; if (world === null || touch === null) throw new Error("Missing source bounce receiver");
    touch(world.actor.id, { x: 0, y: -1, z: 0 });
    expect(laser.movedir).toEqual({ x: 0, y: -250, z: 0 });
    game.time = 0.4; think(); game.applyProjectileBehavior(laser.actor, 0.4);
    expect(game.body(laser).velocity).toEqual({ x: 0, y: -250, z: 0 });
    expect(laser.speed).toBe(250);
  } finally { actors.close(); }
});


test.skipIf(!existsSync(archivePath))("routed base weapon pickups retain Rogue grapple and pregrant autoswitch rules", async () => {
  const scene = await session("rogue");
  try {
    const selections: string[] = [];
    for (const entry of q2BaseWeaponInventory()) scene.inventory.configure(scene.player.actor, { ...entry, count: 0 });
    scene.game.pickupAdmission = new SharedPickupAdmission({ inventory: scene.inventory, profile: expansionSourceSupply(Q1_Q2_SUPPLY_PROFILE),
      ammoGranted: () => undefined, weaponGranted: (_actor, _weapons, selection) => { selections.push(selection); return undefined; } });
    const pickup = () => {
      const entity = scene.game.create("weapon_rocketlauncher"); scene.game.spawnEntity(entity); entity.solid = "trigger";
      scene.callbacks.touch({ self: entity.actor, other: scene.player.actor.id, plane: null, surface: null });
    };
    scene.player.weapon = "rogue:grapple"; scene.player.attackHeld = true; scene.player.autoSwitch = "always";
    pickup();
    expect(selections).toEqual(["never"]);
    expect(scene.inventory.count(scene.player.actor.id, "q2:weapon_rocketlauncher")).toBe(1);
    scene.player.attackHeld = false; scene.player.autoSwitch = "new";
    pickup();
    expect(selections).toEqual(["never", "never"]);
    scene.inventory.configure(scene.player.actor, { item: "q2:weapon_rocketlauncher", count: 0, capacity: 1 });
    pickup();
    expect(selections).toEqual(["never", "never", "always"]);
  } finally { scene.actors.close(); }
});
