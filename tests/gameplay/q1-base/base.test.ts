import { Q3SelectedArsenal } from "../../../src/app/bootstrap/simulation/arsenal/q3.ts";
import { SharedPickupAdmission } from "../../../src/world/gameplay/pickups.ts";
import { Q1_Q3_SUPPLY_PROFILE } from "../../../src/content/composition/q1-q3-supply.ts";
import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ActorId, OwnedActor } from "../../../src/contracts/identity.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { SessionActorRegistry, SharedBodyTable, ActorCallbackTable, translatedBodyBounds } from "../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ1CombatPolicy, nativeVictimArmor } from "../../../src/world/gameplay/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { Q1_DONOR_PROFILE, createNumericOperations } from "../../../src/core/numeric.ts";
import { Q1MonsterMovement } from "../../../src/movement/q1/monsters.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { readQ1Bsp, parseQ1Entities } from "../../../src/formats/q1-map/index.ts";
import type { Q1Map } from "../../../src/formats/q1-map/index.ts";
import { Q1Foundation } from "../../../src/content/q1/foundation/runtime.ts";
import type { Q1Event, Q1FoundationHost } from "../../../src/content/q1/foundation/types.ts";
import { PLAYER_BOUNDS, ZERO, vadd } from "../../../src/content/q1/foundation/types.ts";
import { registerQ1Base, Q1CharacterActor, Q1CampaignState, captureQ1Travel, admitQ1Travel, newQ1Travel, q1Obituary, dropBackpack } from "../../../src/content/q1/base/index.ts";
import type { Q1ObituaryActor } from "../../../src/content/q1/base/index.ts";
import { setMonsterRoute } from "../../../src/content/q1/foundation/monsters.ts";
import { monsterFrames } from "../../../src/content/q1/base/frames.ts";
import type { Q1FoundationCheckpoint } from "../../../src/content/q1/foundation/index.ts";
import { encodeQ1FoundationCheckpoint, decodeQ1FoundationCheckpoint } from "../../../src/persistence/q1-foundation.ts";
import { captureSharedBodies, restoreSharedBodyLinks } from "../../../src/persistence/world-state.ts";

const archivePath = resolve(import.meta.dir, "../../../../qfiles/q1/rerelease/id1/pak0.pak");
async function readMap(name: string): Promise<Q1Map> {
  const archive = await openArchive(archivePath);
  try { const entry = archive.findEntries(`maps/${name}.bsp`)[0]; if (entry === undefined) throw new Error(`Missing ${name}`); return readQ1Bsp(await archive.readEntry(entry), { source: `maps/${name}.bsp` }); }
  finally { archive.close(); }
}
interface SavedBaseWorld {
  readonly source: Q1FoundationCheckpoint;
  readonly slots: ReturnType<SessionActorRegistry["checkpoint"]>;
  readonly sources: ReturnType<SessionActorRegistry["sourceCheckpoint"]>;
  readonly bodies: readonly import("../../../src/contracts/session.ts").BodyCheckpoint[];
  readonly combat: readonly import("../../../src/contracts/session.ts").CombatCheckpoint[];
  readonly inventories: readonly import("../../../src/contracts/session.ts").InventoryCheckpoint[];
}
function createGame(map: Q1Map, saved?: SavedBaseWorld, deathmatch = 0, nativePrecaches = true) {
  const identities = createIdentityOwner("q1-base-smoke");
  const actors = saved === undefined ? new SessionActorRegistry(identities) : SessionActorRegistry.restore(identities, saved.slots, saved.sources), callbacks = new ActorCallbackTable(actors), scene = createSceneQueries(map);
  const pending = new Map<OwnedActor, number>(), events: Q1Event[] = [], players: ActorId[] = [];
  let runtime: Q1Foundation | null = null;
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onUnlink: actor => { scene.unlink(actor); return undefined; }, onLink: body => {
    const entity = runtime?.entity(body.actor);
    if (entity === null || entity === undefined || entity.solid === "none" || entity.classname === "worldspawn") { scene.unlink(body.actor); return undefined; }
    const model = entity.model.startsWith("*") ? Number(entity.model.slice(1)) : null;
    scene.link(body, { family: "q1", shape: model === null ? { kind: "box" } : { kind: "model", model }, contents: -2, owner: entity.owner, role: entity.solid === "trigger" ? "trigger" : "solid", monster: entity.monster !== null, deadMonster: false }); return undefined;
  } });
  const movement = new Q1MonsterMovement({ scene, numeric: createNumericOperations(Q1_DONOR_PROFILE), random: { nextInteger: () => 1 }, readTarget: actor => {
    const owner = actors.resolveOwned(actor), body = bodies.read(actor);
    return owner === null || body === null ? null : { origin: body.origin, absoluteBounds: translatedBodyBounds(owner, body) };
  }, read: actor => {
    const body = bodies.read(actor), entity = runtime?.entity(actor); if (body === null || entity === null || entity === undefined) return null;
    return { ...body, absoluteBounds: translatedBodyBounds(entity.actor, body), flags: entity.movementFlags, ground: body.ground === null ? { kind: "none" } : { kind: "actor", actor: body.ground }, idealYaw: entity.idealYaw, yawSpeed: entity.yawSpeed, enemy: entity.monster?.enemy ?? null };
  }, write: (actor, state) => { const body = bodies.read(actor.id); if (body === null) throw new Error("Missing source body"); bodies.write(actor, { ...body, angles: state.angles }); return undefined; }, link: actor => bodies.link(actor) });
  const combat = new GameplayAuthority(actors, callbacks, { impulse: (actor, impulse) => { const body = bodies.read(actor.id); if (body !== null) bodies.write(actor, { ...body, velocity: vadd(body.velocity, impulse) }); return undefined; }, beforeReaction: () => undefined, confirmed: () => undefined });
  const inventory = new SharedInventoryTable(actors);
  const host: Q1FoundationHost = { actors, callbacks, bodies, combat, inventory, random: () => 0.4,
    trace: request => {
      const trace = scene.trace({ start: request.start, end: request.end, shape: { kind: "box", bounds: request.bounds }, target: { kind: "world" }, policy: { kind: "q1", move: request.monsters ? "normal" : "no-monsters", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: request.ignore });
      if (trace.kind !== "q1") throw new Error("Q1 trace expected");
      return { fraction: trace.fraction, end: trace.end, normal: trace.sourcePlane.normal, actor: trace.hit.kind === "actor" ? trace.hit.actor : trace.hit.kind === "world" ? runtime?.world?.actor.id ?? null : null, startSolid: trace.startSolid, allSolid: trace.allSolid, sky: false, inOpen: trace.inOpen, inWater: trace.inWater };
    },
    contents: point => {
      const result = scene.pointContents({ point, target: { kind: "world" }, policy: { kind: "q1", move: "normal", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: null });
      if (result.kind !== "q1") throw new Error("Q1 contents expected"); return result.contents === -2 ? "solid" : result.contents === -3 ? "water" : result.contents === -4 ? "slime" : result.contents === -5 ? "lava" : result.contents === -6 ? "sky" : "empty";
    },
    // This smoke exercises registration, shared mutations and animation, not step movement.
    walkMove: () => false, moveToGoal: () => undefined, changeYaw: actor => movement.changeYaw(actor), checkBottom: () => false,
    pusherServices: () => { throw new Error("This fixture does not step native pushers"); },
    scheduleThink: (actor, seconds) => { pending.set(actor, seconds); return undefined; }, cancelThink: actor => { pending.delete(actor); return undefined; },
    emit: event => { events.push(event); return undefined; }, transition: () => undefined, players: () => players, checkClient: () => null,
    classname: actor => runtime?.entity(actor)?.classname ?? "player", powerup: () => undefined,
  };
  const game = new Q1Foundation(host, { edition: "rerelease", skill: 1, deathmatch, coop: false, gravity: 800, maxClients: 4, campaign: "q1:id1", ...(nativePrecaches ? { precacheProgram: "id1" } : {}), combatProvider: "q1:combat", inventoryProvider: "q1:inventory", movementProvider: "q2:movement" }); runtime = game;
  combat.register(createQ1CombatPolicy({ id: "q1:combat", context: request => game.combatContext(request), armor: nativeVictimArmor(() => ({ arithmetic: "binary32", screenFacingDot: 0 })) }));
  const campaign = new Q1CampaignState(), base = registerQ1Base(game, { campaign });
  let report: import("../../../src/content/q1/foundation/index.ts").Q1SpawnReport | null = null, player: OwnedActor;
  if (saved === undefined) {
    report = game.spawnMap(map); player = actors.allocateAtSource("q3:character", 1, "q3:sarge"); const spawn = [...game.entities.values()].find(entity => entity.classname === "info_player_start");
    bodies.create(player, { origin: spawn === undefined ? ZERO : game.body(spawn).origin, angles: ZERO, velocity: ZERO, bounds: PLAYER_BOUNDS, ground: null });
    combat.create(player, { health: 100, armor: { kind: "none" }, mass: 100, canTakeDamage: true, invulnerable: false, team: null }); inventory.create(player, []); game.attachPlayer(player);
  } else {
    const restored = actors.atSource("q3:character", 1); if (restored === null) throw new Error("Missing saved foreign character"); player = restored;
    const owner = (id: import("../../../src/contracts/session.ts").SavedActorId): OwnedActor => { const actor = actors.resolveSaved(id); if (actor === null) throw new Error("Missing saved actor"); return actor; };
    for (const entry of saved.bodies) bodies.create(owner(entry.actor), { ...entry.body, ground: entry.body.ground === null ? null : actors.referenceSaved(entry.body.ground) });
    for (const entry of saved.combat) combat.create(owner(entry.actor), entry.state);
    for (const entry of saved.inventories) inventory.create(owner(entry.actor), entry.entries);
    game.restore(saved.source); restoreSharedBodyLinks(saved, { actors, bodies });
  }
  players.push(player.id);
  return { game, base, report, actors, combat, inventory, player, pending, events, campaign };
}

test.skipIf(!existsSync(archivePath))("real base maps register bosses, monsters, trains, traps and gates", async () => {
  const classes = new Set<string>();
  for (const name of ["start", "e1m7", "e2m2", "e3m3", "e4m4", "end"]) {
    const { game, actors, report } = createGame(await readMap(name)); if (report === null) throw new Error("Missing source spawn report");
    for (const entity of report.spawned) classes.add(entity.classname);
    expect(() => game.capture()).not.toThrow();
    actors.close();
  }
  expect(classes.has("monster_boss")).toBe(true); expect(classes.has("monster_oldone")).toBe(true); expect(classes.has("monster_shambler")).toBe(true);
  expect(classes.has("misc_teleporttrain")).toBe(true); expect(classes.has("func_bossgate")).toBe(true);
  expect([...monsterFrames.values()].every(frame => monsterFrames.has(frame.next))).toBe(true);
});

test.skipIf(!existsSync(archivePath))("zombie recovery and gib death use shared combat state", async () => {
  const map = await readMap("e1m7"), source = parseQ1Entities('{ "classname" "monster_zombie" "targetname" "recovery_test" }');
  const { game, base, actors, combat, player } = createGame({ ...map, entityList: [...map.entityList, ...source] });
  const entity = game.find("recovery_test")[0], monster = entity === undefined ? undefined : base.monsters.get(entity.actor);
  if (entity === undefined || monster === undefined) throw new Error("Missing source-spawned zombie"); entity.damageable = true;
  game.damage(entity.actor.id, player.id, player.id, 10); expect(combat.read(entity.actor.id)?.health).toBe(60);
  game.damage(entity.actor.id, player.id, player.id, 25); expect(monster.currentFrame).toBe("zombie_paine1");
  const before = game.killedMonsters; game.damage(entity.actor.id, player.id, player.id, 100);
  expect(entity.model).toBe("progs/h_zombie.mdl"); expect(combat.read(entity.actor.id)?.canTakeDamage).toBe(false); expect(game.killedMonsters).toBe(before + 1); actors.close();
});

test.skipIf(!existsSync(archivePath))("travel and Q1 character lifecycle reuse an admitted foreign actor", async () => {
  const { game, actors, inventory, combat, player } = createGame(await readMap("start"));
  inventory.give(player, "q1:key/gold", 1); inventory.consume(player, "q1:ammo/shells", 25); combat.setHealth(player, 15);
  const travel = captureQ1Travel(game, player); expect(travel.health).toBe(50); expect(travel.inventory.find(entry => entry.item === "q1:key/gold")?.count).toBe(0);
  admitQ1Travel(game, player, travel); expect(inventory.count(player.id, "q1:ammo/shells")).toBe(25);
  expect(newQ1Travel({ edition: "rerelease", skill: 3, deathmatch: 0 }).health).toBe(50); expect(newQ1Travel({ edition: "classic", skill: 3, deathmatch: 0 }).health).toBe(100);
  const count = actors.observations().length, character = new Q1CharacterActor(game, player);
  combat.setHealth(player, 0); character.die();
  const input = { axePose: false, attack: false, jump: false, use: false, waterLevel: 0, waterType: "empty", invisible: false, invulnerable: false } satisfies import("../../../src/content/q1/base/player.ts").Q1CharacterInput;
  for (let i = 1; i <= 20; i++) character.frame(i / 10, input);
  expect(character.presentation.life).toBe("respawnable"); expect(actors.observations().length).toBe(count);
  const characterSave = character.capture(); character.respawn(); character.restore(characterSave); expect(character.presentation.life).toBe("respawnable");
  character.respawn(100); expect(character.presentation.model).toBe("progs/player.mdl"); expect(combat.read(player.id)?.health).toBe(100); actors.close();
});

test.skipIf(!existsSync(archivePath))("actual Shub finale resumes named source state in a fresh actor registry", async () => {
  const map = await readMap("end"), original = createGame(map);
  const { game, actors, combat, inventory, player } = original;
  inventory.configure(player, { item: "rogue:ammo/lava-nails", count: 0, capacity: 200 });
  const pack = dropBackpack(game, ZERO, { weapon: null, shells: 0, nails: 0, rockets: 0, cells: 0, extra: [{ item: "rogue:ammo/lava-nails", count: 17 }], selection: "rank", avoidUnderwaterLightning: true, ownerPickupDelay: 1 });
  if (pack === null) throw new Error("Extra-ammo backpack was discarded"); pack.owner = player.id; pack.touch?.(player.id, null); expect(game.live(pack)).toBe(true);
  const shub = [...original.base.monsters.values()].find(monster => monster.spec.species === "oldone"); if (shub === undefined) throw new Error("Missing authored Shub");
  game.damage(shub.entity.actor.id, player.id, player.id, 50000);
  const source = game.capture();
  expect(source.entities.some(entity => entity.callbacks.think === "base:finale_2")).toBe(true);
  const saved: SavedBaseWorld = {
    source: decodeQ1FoundationCheckpoint(encodeQ1FoundationCheckpoint(source)), slots: actors.checkpoint(), sources: actors.sourceCheckpoint(),
    bodies: captureSharedBodies(actors, game.host.bodies),
    combat: actors.observations().flatMap(actor => { const state = combat.read(actor.id); return state === null ? [] : [{ actor: { slot: actor.id.slot, generation: actor.id.generation }, state }]; }),
    inventories: actors.observations().flatMap(actor => inventory.has(actor.id) ? [{ actor: { slot: actor.id.slot, generation: actor.id.generation }, entries: inventory.entries(actor.id) }] : []),
  };
  const restored = createGame(map, saved); expect(restored.report).toBe(null); expect(restored.events).toHaveLength(0); expect(restored.game.capture()).toEqual(source);
  expect(restored.game.precaches.models).toEqual(game.precaches.models); expect(restored.game.precaches.sounds).toEqual(game.precaches.sounds);
  expect(restored.game.precaches.phase).toBe("frozen");
  expect(() => restored.game.precacheModel("progs/oldone.mdl")).toThrow("spawn functions");
  expect(() => restored.game.precacheSound("boss2/death.wav")).toThrow("spawn functions");
  for (const current of [original, restored]) {
    const timer = [...current.game.entities.values()].find(entity => entity.classname === "finale_timer"); if (timer === undefined) throw new Error("Missing saved finale timer");
    for (const seconds of [1, 3]) current.game.host.callbacks.think(timer.actor, { frame: 0, time: { kind: "seconds", value: seconds }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" });
  }
  expect(restored.game.capture()).toEqual(original.game.capture());
  expect([...restored.base.monsters.values()].find(monster => monster.spec.species === "oldone")?.nextFrame).toBe("old_thrash1");
  const restoredPack = [...restored.game.entities.values()].find(entity => entity.classname === "item_backpack"); if (restoredPack === undefined) throw new Error("Missing saved extra-ammo backpack");
  restoredPack.touch?.(restored.player.id, null); expect(restored.inventory.count(restored.player.id, "rogue:ammo/lava-nails")).toBe(17);
  actors.close(); restored.actors.close();
});

test.skipIf(!existsSync(archivePath))("source episode exit and classic versus rerelease obituary rules remain distinct", async () => {
  const { game, base, campaign, actors, player } = createGame(await readMap("e1m7"));
  const attacker = actors.allocateAtSource("q2:character", 2, "q2:male");
  const victim: Q1ObituaryActor = { actor: player.id, name: "Ranger", classname: "player", isPlayer: true, isMonster: false, team: 1, health: -50, waterType: "empty", waterLevel: 0, weapon: "shotgun", quadExpires: 0, invulnerableExpires: 0, brush: false, killString: "" };
  const killer: Q1ObituaryActor = { ...victim, actor: attacker.id, name: "Grunt", team: 2, health: 100, weapon: "rocketlauncher", quadExpires: 30 };
  const input = { victim, attacker: killer, telefragOwner: null, teamplay: 0, deathType: "", random: () => 0.4 };
  expect(q1Obituary({ ...input, edition: "classic" }).message?.text).toBe("Ranger was gibbed by Grunt's rocket\n");
  expect(q1Obituary({ ...input, edition: "rerelease" }).message?.text).toBe("$qc_death_rl_quad2");
  expect(q1Obituary({ ...input, edition: "rerelease", attacker: { ...killer, team: 1 }, teamplay: 2 }).score?.delta).toBe(-1);
  base.levelRules.begin("start", player.id); expect(base.levelRules.requestExit(1, true).kind).toBe("waiting");
  expect(base.levelRules.requestExit(2, true)).toEqual({ kind: "finale", text: "$qc_finale_e1", track: 2 });
  campaign.writeFlags(15); expect(base.levelRules.requestExit(3, true)).toEqual({ kind: "finale", text: "$qc_finale_all_runes", track: 2 });
  expect(base.levelRules.requestExit(4, true)).toEqual({ kind: "travel", map: "start" }); expect(game.intermission).toBe(null); actors.close();
});


test.skipIf(!existsSync(archivePath))("id1 monster precaches match native spawn declaration order and inhibition", async () => {
  const map = await readMap("e1m1"), world = parseQ1Entities('{ "classname" "worldspawn" }');
  const baseline = createGame({ ...map, entityList: world }), models = [...baseline.game.precaches.models], sounds = [...baseline.game.precaches.sounds]; baseline.actors.close();
  for (const [classname, file] of [["monster_army", "soldier"], ["monster_dog", "dog"], ["monster_knight", "knight"], ["monster_enforcer", "enforcer"], ["monster_demon1", "demon"], ["monster_ogre", "ogre"], ["monster_ogre_marksman", "ogre"], ["monster_hell_knight", "hknight"], ["monster_shambler", "shambler"], ["monster_wizard", "wizard"], ["monster_shalrath", "shalrath"], ["monster_tarbaby", "tarbaby"], ["monster_fish", "fish"], ["monster_zombie", "zombie"], ["monster_boss", "boss"], ["monster_oldone", "oldone"]] satisfies [string, string][]) {
    const source = readFileSync(`/home/buzzkill/Projects/qsrc/quake/progs106/${file}.qc`, "utf8"), spawn = source.search(/void\(\)\s+monster_\w+\s*=\s*\{/);
    expect(spawn).toBeGreaterThanOrEqual(0);
    const declarations = [...source.slice(spawn).matchAll(/precache_(model|sound)2?\s*\(\s*"([^"]+)"\s*\)/g)];
    const expected = (kind: string, initial: readonly string[]): readonly string[] => [...new Set([...initial, ...declarations.flatMap(match => match[1] === kind && match[2] !== undefined ? [match[2]] : [])])];
    for (const flags of classname === "monster_zombie" ? [0, 1] : [0]) {
      const entities = [...world, ...parseQ1Entities(`{ "classname" "${classname}" "spawnflags" "${flags}" }`)];
      const state = createGame({ ...map, entityList: entities });
      try {
        expect(state.game.precaches.models).toEqual(expected("model", models)); expect(state.game.precaches.sounds).toEqual(expected("sound", sounds));
        const total = state.game.totalMonsters, removed = state.game.create(classname); state.game.spawnEntity(removed, { deathmatch: 1 });
        expect(state.game.live(removed)).toBe(false); expect(state.game.totalMonsters).toBe(total);
        expect(() => state.game.precacheModel(expected("model", models)[1] ?? "progs/player.mdl")).toThrow("spawn functions");
      } finally { state.actors.close(); }
      const inhibited = createGame({ ...map, entityList: entities }, undefined, 1);
      try { expect(inhibited.game.precaches.models).toEqual(models); expect(inhibited.game.precaches.sounds).toEqual(sounds); } finally { inhibited.actors.close(); }
    }
  }
  for (const name of ["e1m1", "e1m2"]) {
    const state = createGame(await readMap(name));
    try {
      expect(state.game.precaches.models).toContain("progs/soldier.mdl"); expect(state.game.precaches.models).toContain("progs/h_guard.mdl");
      expect(state.game.precaches.sounds).toContain("soldier/sattck1.wav"); expect(state.game.precaches.phase).toBe("frozen");
    } finally { state.actors.close(); }
  }
});


test.skipIf(!existsSync(archivePath))("base monster mission owns activation, route and one death notification", async () => {
  const map = await readMap("e1m7");
  const { game, base, actors, player } = createGame({ ...map, entityList: parseQ1Entities('{ "classname" "worldspawn" }') }, undefined, 0, false);
  const entity = game.create("monster_knight");
  let spawned = 0, started = 0, used = 0, killed = 0;
  game.monsterMissions.set(entity.actor.id, {
    ambush: false, spawned: () => { spawned++; return undefined; },
    started: () => { expect(entity.damageable).toBe(true); expect(entity.movementFlags & 32).toBe(32); started++; return undefined; },
    killed: () => { killed++; return undefined; }, route: () => { expect(started).toBe(1); return player.id; },
    use: () => { used++; return true; }, combatRoute: () => ({ goal: player.id, standGround: false }), foundTarget: () => undefined,
  });
  const total = game.totalMonsters;
  game.spawnEntity(entity); expect(spawned).toBe(1); expect(game.totalMonsters).toBe(total);
  const monster = base.monsters.get(entity.actor);
  if (monster === undefined) throw new Error("Missing mission monster");
  monster.start(); expect(started).toBe(1); expect(monster.route()).toBe(player.id);
  setMonsterRoute(game, entity, player.id, game.time + 30);
  expect(monster.state.mode).toBe("stand"); expect(monster.state.pauseUntil).toBe(game.time + 30);
  monster.enemy = player.id; monster.use(null); expect(used).toBe(1);
  const before = game.killedMonsters;
  monster.countKill(); monster.countKill(); expect(killed).toBe(1); expect(game.killedMonsters).toBe(before);
  actors.close();
});


test.skipIf(!existsSync(archivePath))("source backpacks map ammo for native and foreign players without inventing weapon selection", async () => {
  const map = await readMap("e1m7"), { game, actors, inventory, player, events } = createGame(map);
  inventory.configure(player, { item: "q3:ammo/lightning", count: 0, capacity: 200 });
  const arsenal = new Q3SelectedArsenal({ provider: "q3:official", product: "baseq3", inventory,
    fire: () => undefined, useHoldable: () => undefined });
  arsenal.admit(player, 100);
  inventory.give(player, "q3:weapon/lightning", 1);
  const active = arsenal.read(player.id).activeWeapon;
  let selections = 0;
  game.pickupAdmission = new SharedPickupAdmission({ inventory, profile: Q1_Q3_SUPPLY_PROFILE,
    ammoGranted: (actor, grants, autoSwitch) => arsenal.pickupAmmo(actor, grants, autoSwitch), weaponGranted: (_actor, _weapons, selection) => { expect(selection).toBe("better"); selections++; return undefined; } });
  for (const foreign of [false, true]) {
    if (foreign) game.players.delete(player);
    expect(game.player(player.id) === null).toBe(foreign);
    const before = inventory.count(player.id, "q3:ammo/lightning"), native = inventory.count(player.id, "q1:ammo/cells");
    const pack = dropBackpack(game, ZERO, { weapon: null, shells: 0, nails: 0, rockets: 0, cells: 5 });
    if (pack === null) throw new Error("Missing cell backpack");
    const sounds = events.filter(event => event.kind === "sound").length;
    pack.touch?.(player.id, null); expect(game.live(pack)).toBe(false);
    expect(inventory.count(player.id, "q3:ammo/lightning")).toBe(before + 5);
    expect(inventory.count(player.id, "q1:ammo/cells")).toBe(native);
    expect(arsenal.read(player.id).activeWeapon).toBe(active); expect(arsenal.pendingWeapon(player.id)).toBe(null);
    expect(events.filter(event => event.kind === "sound").length).toBe(sounds + 1);
  }
  expect(selections).toBe(0);
  inventory.configure(player, { item: "q3:ammo/lightning", count: 0, capacity: 200 });
  game.pickupAdmission.ammo(player, { item: "q1:ammo/cells", amount: 5 });
  expect(arsenal.pendingWeapon(player.id)).toBe("q3:weapon/lightning");
  inventory.configure(player, { item: "q3:ammo/lightning", count: 200, capacity: 200 });
  const full = dropBackpack(game, ZERO, { weapon: null, shells: 0, nails: 0, rockets: 0, cells: 5 });
  if (full === null) throw new Error("Missing full-inventory backpack");
  full.touch?.(player.id, null); expect(game.live(full)).toBe(false); expect(inventory.count(player.id, "q3:ammo/lightning")).toBe(200); expect(selections).toBe(0);
  inventory.configure(player, { item: "q3:weapon/lightning", count: 0, capacity: 1 });
  const armed = dropBackpack(game, ZERO, { weapon: "lightning", shells: 0, nails: 0, rockets: 0, cells: 5 });
  if (armed === null) throw new Error("Missing weapon backpack");
  armed.touch?.(player.id, null); expect(game.live(armed)).toBe(false); expect(inventory.count(player.id, "q3:weapon/lightning")).toBe(1); expect(selections).toBe(1);
  actors.close();
});
