import { expect, test } from "bun:test";
import { corpusFile, corpusHasFile } from "../../../support/corpus.ts";

import type { ActorId } from "../../../../src/contracts/identity.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { SessionActorRegistry, ActorCallbackTable } from "../../../../src/world/actors/index.ts";
import { SharedInventoryTable, createQ1CombatPolicy, nativeVictimArmor } from "../../../../src/world/gameplay/index.ts";
import { createSceneQueries } from "../../../../src/world/collision/index.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { readQ1Bsp, q1EntityValue } from "../../../../src/formats/q1-map/index.ts";
import { Q1Foundation } from "../../../../src/content/q1/foundation/runtime.ts";
import { PLAYER_BOUNDS, ZERO, vadd } from "../../../../src/content/q1/foundation/types.ts";
import { registerQ1Base } from "../../../../src/content/q1/base/index.ts";
import { monsterFrames } from "../../../../src/content/q1/base/frames.ts";
import { registerMissionPackArsenal } from "../../../../src/content/q1/missionpacks/arsenal.ts";
import { registerMissionPackMonsters } from "../../../../src/content/q1/missionpacks/monsters/index.ts";
import { gremlinSteal } from "../../../../src/content/q1/missionpacks/monsters/gremlin-weapons.ts";
import type { Q1MissionPack } from "../../../../src/content/q1/missionpacks/types.ts";
import { impulseAuthority } from "../../../support/authority.ts";
import { q1SceneBodies, q1TestHost } from "../../../support/q1-host.ts";

const packPath = (pack: Q1MissionPack, edition: "classic" | "rerelease"): string => `q1/${edition === "rerelease" ? "rerelease/" : ""}${pack}/pak0.pak`;
async function session(pack: Q1MissionPack, name: string, edition: "classic" | "rerelease" = "rerelease") {
  const archive = await openArchive(corpusFile(packPath(pack, edition)));
  const entry = archive.findEntries(`maps/${name}.bsp`)[0]; if (entry === undefined) throw new Error("Retail start.bsp missing");
  const map = readQ1Bsp(await archive.readEntry(entry), { source: `maps/${name}.bsp` }); archive.close();
  const actors = new SessionActorRegistry(createIdentityOwner(`missionpack-${pack}`)), callbacks = new ActorCallbackTable(actors), scene = createSceneQueries(map);
  const players: ActorId[] = [], gravity = new Map<ActorId, number>();
  let active: Q1Foundation | null = null, randomValue = 0.4;
  const bodies = q1SceneBodies(actors, scene, actor => active?.entity(actor));
  const combat = impulseAuthority(actors, callbacks, bodies);
  const inventory = new SharedInventoryTable(actors);
  const { host, pending, events } = q1TestHost({ actors, callbacks, bodies, combat, inventory, scene, world: () => active?.world?.actor.id ?? null, entity: actor => active?.entity(actor), players: () => players }, {
    random: () => randomValue, setGravity: (actor, scale) => { gravity.set(actor, scale); return undefined; } });
  const game = new Q1Foundation(host, { edition, skill: 1, deathmatch: 0, teamplay: 0, coop: false, maxClients: 2, gravity: 800, campaign: `q1:${pack}`, combatProvider: "q1:combat", inventoryProvider: "q1:inventory", movementProvider: "q3:movement" }); active = game;
  combat.register(createQ1CombatPolicy({ id: "q1:combat", context: request => game.combatContext(request), sourceEffects: game.damageSourceEffects, armor: nativeVictimArmor(() => ({ arithmetic: "binary32", screenFacingDot: 0 })) }));
  const base = registerQ1Base(game); const arsenal = registerMissionPackArsenal(game, pack), monsters = registerMissionPackMonsters(game, base, pack);
  for (const source of map.entityList) { const classname = q1EntityValue(source, "classname") ?? ""; if (classname === "worldspawn" || classname.startsWith("monster_") || classname === "path_corner" || classname === "info_player_start") game.spawnEntity(game.create(classname, source)); }
  const start = [...game.entities.values()].find(entity => entity.classname === "info_player_start"), origin = start === undefined ? ZERO : game.body(start).origin;
  function player(slot: number) {
    const owner = actors.allocateAtSource("q3:character", slot, "q3:sarge");
    bodies.create(owner, { origin: vadd(origin, { x: 64 * (slot - 1), y: 0, z: 0 }), angles: ZERO, velocity: ZERO, bounds: PLAYER_BOUNDS, ground: null });
    combat.create(owner, { health: 100, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 100, canTakeDamage: true, invulnerable: false, team: null });
    const state = game.attachPlayer(owner); players.push(owner.id); return state;
  }
  return { game, arsenal, monsters, actors, callbacks, combat, bodies, inventory, events, pending, gravity, random: (value: number) => { randomValue = value; }, player: player(1), target: player(2) };
}

const retailPacks: readonly Parameters<typeof packPath>[0][] = ["hipnotic", "rogue"], retailEditions: readonly Parameters<typeof packPath>[1][] = ["classic", "rerelease"];
test.skipIf(!retailEditions.every(edition => retailPacks.every(pack => corpusHasFile(packPath(pack, edition)))))("retail Hipnotic and Rogue monsters admit exact frames and saved continuations", async () => {
  for (const edition of ["classic", "rerelease"]) {
    if (edition !== "classic" && edition !== "rerelease") throw new Error("Unknown edition");
    for (const entry of [{ pack: "hipnotic", map: "hip2m1", species: "gremlin", count: 6 }, { pack: "rogue", map: "r2m1", species: "eel", count: 13 }]) {
      if (entry.pack !== "hipnotic" && entry.pack !== "rogue") throw new Error("Unknown pack");
      const current = await session(entry.pack, entry.map, edition);
      const monsters = [...current.monsters.monsters.values()];
      expect(monsters.filter(monster => monster.spec.species === entry.species)).toHaveLength(entry.count);
      expect(monsters.every(monster => [...monster.definition.frames.values()].every(frame =>
        (monster.definition.frames.has(frame.next) || frame.next in monster.definition.actions || monsterFrames.has(frame.next)) && frame.operations.every(operation => operation.kind !== "action" || operation.name in monster.definition.actions)))).toBe(true);
      expect(() => current.game.capture()).not.toThrow(); current.actors.close();
    }
  }
});

test.skipIf(!corpusHasFile(packPath("hipnotic", "rerelease")))("Gremlin steals the shared weapon, spends signed burst ammo and clones pending source state", async () => {
  const current = await session("hipnotic", "hip2m1"), { game, monsters, inventory, player, target } = current;
  const monster = [...monsters.monsters.values()].find(monster => monster.spec.species === "gremlin"); if (monster === undefined) throw new Error("Missing retail Gremlin");
  const body = game.body(monster.entity); game.host.bodies.write(player.actor, { ...game.host.bodies.read(player.actor.id) ?? body, origin: vadd(body.origin, { x: 40, y: 0, z: 0 }) });
  inventory.configure(player.actor, { item: game.weaponItem("nailgun"), count: 1, capacity: 1 }); inventory.configure(player.actor, { item: "q1:ammo/nails", count: 1, capacity: 200 }); game.selectWeapon(player.actor, "nailgun");
  monster.enemy = player.actor.id; current.random(0.7); expect(gremlinSteal(monster)).toBe(true); expect(inventory.count(player.actor.id, game.weaponItem("nailgun"))).toBe(0); expect(inventory.count(monster.entity.actor.id, "q1:ammo/nails")).toBe(1);
  monster.enemy = target.actor.id; monster.play("gremlin_nail3");
  for (let i = 0; i < 3; i++) monster.play(monster.nextFrame);
  expect(inventory.count(monster.entity.actor.id, "q1:ammo/nails")).toBe(-3); expect(monster.entity.number("currentammo")).toBe(-3);
  const clone = game.cloneEntity(monster.entity); expect(monsters.require(clone).capture()).toEqual(monster.capture()); expect(inventory.count(clone.actor.id, "q1:ammo/nails")).toBe(-3);
  expect(() => game.capture()).not.toThrow(); current.actors.close();
});

test.skipIf(!corpusHasFile(packPath("hipnotic", "rerelease")))("Horn charm keeps retail soldier and dog callbacks on the shared controller", async () => {
  const { game, monsters, player, actors } = await session("hipnotic", "hip1m1");
  for (const species of ["army", "dog"]) {
    const monster = [...monsters.monsters.values()].find(monster => monster.spec.species === species); if (monster === undefined) throw new Error(`Missing retail ${species}`);
    const before = monster.capture(); monsters.charm(monster.entity, player.actor.id); expect(monster.capture()).toEqual(before); expect(monster.entity.references.get("charmer")).toBe(player.actor.id);
    monster.found(player.actor.id); expect(monster.enemy).toBe(null);
    const body = game.host.bodies.read(player.actor.id); if (body === null) throw new Error("Missing charmer body");
    game.host.bodies.write(player.actor, { ...body, origin: vadd(monster.origin, { x: 300, y: 0, z: 0 }) });
    monster.ai("walk", 2); expect(monster.entity.number("huntingcharmer")).toBe(2); expect(monster.nextFrame).toBe(monster.spec.walk);
    expect(monster.entity.references.get("goalentity")).toBe(monster.entity.references.get("trigger_field"));
  }
  expect(() => game.capture()).not.toThrow(); actors.close();
});

test.skipIf(!corpusHasFile(packPath("hipnotic", "rerelease")))("Hipnotic path corners keep authored waits on the monster controller", async () => {
  const { game, monsters, actors } = await session("hipnotic", "hip1m1");
  const monster = [...monsters.monsters.values()].find(monster => monster.spec.species === "army"); if (monster === undefined) throw new Error("Missing retail soldier");
  const first = game.create("path_corner"), second = game.create("path_corner"); first.targetname = "test_first"; first.target = "test_second"; first.delay = 7; second.targetname = "test_second";
  game.spawnEntity(first); game.spawnEntity(second); monster.state.path = first.targetname; monster.enemy = null;
  first.touch?.(monster.entity.actor.id, null);
  expect(monster.state.path).toBe(second.targetname); expect(monster.state.pauseUntil).toBe(game.time + 7); expect(monster.entity.references.get("goalentity")).toBe(second.actor.id);
  expect(() => game.capture()).not.toThrow(); actors.close();
});

function spawnSpecies(current: Awaited<ReturnType<typeof session>>, classname: string, spawnflags: number, extra: (entity: ReturnType<typeof current.game.create>) => void = () => undefined) {
  const entity = current.game.create(classname); entity.spawnflags = spawnflags; extra(entity);
  const start = [...current.game.entities.values()].find(candidate => candidate.classname === "info_player_start");
  current.game.setOrigin(entity, vadd(start === undefined ? ZERO : current.game.body(start).origin, { x: 0, y: 128, z: 0 })); current.game.spawnEntity(entity);
  const monster = current.monsters.monsters.get(entity.actor); if (monster === undefined) throw new Error(`Missing controller for ${classname}`);
  return monster;
}

test.skipIf(!corpusHasFile(packPath("rogue", "rerelease")))("Rogue statues stay frozen and invulnerable until used, and the three untargeted statues stay inert", async () => {
  const current = await session("rogue", "r2m1"), { game, monsters, player, actors } = current;
  const statues = [...monsters.monsters.values()].filter(monster => (monster.spec.species === "knight" || monster.spec.species === "hellknight") && (monster.entity.spawnflags & 2) !== 0);
  expect(statues).toHaveLength(35);
  const triggered = statues.filter(monster => monster.entity.targetname !== "");
  expect(triggered).toHaveLength(32); expect(statues.every(monster => monster.entity.skin === 1)).toBe(true);
  const total = game.totalMonsters; expect(statues.length - triggered.length).toBe(3);
  const statue = triggered[0]; if (statue === undefined) throw new Error("Missing statue");
  statue.start(); expect(statue.entity.damageable).toBe(false); expect(statue.nextFrame).toBe("rogue_statue_pause");
  statue.use(player.actor.id); expect(statue.entity.damageable).toBe(true); expect(statue.enemy).toBe(player.actor.id); expect(statue.entity.number("rogue_statue")).toBe(0);
  expect(game.totalMonsters).toBe(total); expect(() => game.capture()).not.toThrow(); actors.close();
});

test.skipIf(!corpusHasFile(packPath("rogue", "rerelease")))("Rogue zombies read the lying, ambush and sneaky flags, and sneaky ones escape after their delay", async () => {
  const current = await session("rogue", "r2m1"), { game, player, actors } = current;
  const lying = spawnSpecies(current, "monster_zombie", 2 | 4);
  expect(lying.entity.spawnflags).toBe(2); expect(lying.entity.solid).toBe("none"); expect(game.body(lying.entity).bounds.max.z).toBe(-16);
  lying.start(); expect(lying.currentFrame).toBe("zombie_sleep");
  lying.pain(player.actor.id, 1); expect(lying.entity.number("rogue_zstate")).toBe(0); expect(lying.currentFrame).toBe("zombie_paine12");
  expect(game.body(lying.entity).bounds.max.z).toBe(40);
  const ambush = spawnSpecies(current, "monster_zombie", 4); expect(ambush.entity.spawnflags).toBe(2); expect(ambush.entity.solid).toBe("slidebox");
  const total = game.totalMonsters;
  const sneaky = spawnSpecies(current, "monster_zombie", 8); expect(game.totalMonsters).toBe(total + 1); expect(sneaky.entity.solid).toBe("none"); expect(sneaky.entity.damageable).toBe(false);
  expect(sneaky.currentFrame).toBe("rogue_cruc1"); expect(sneaky.entity.delay).toBe(3);
  sneaky.play("zombie_run1"); expect(sneaky.nextFrame).toBe("rogue_cruc1"); expect(sneaky.state.painFinished).toBe(game.time + 3);
  game.time += 3.5; sneaky.play("rogue_cruc2"); expect(sneaky.nextFrame).toBe("zombie_escape1");
  for (let i = 1; i <= 16; i++) sneaky.play(`zombie_escape${i}`);
  expect(sneaky.entity.solid).toBe("slidebox"); expect(sneaky.entity.damageable).toBe(true); expect(sneaky.entity.number("rogue_zstate")).toBe(0); expect(sneaky.nextFrame).toBe("zombie_run1");
  actors.close();
});

test.skipIf(!corpusHasFile(packPath("rogue", "rerelease")))("Rogue boss ogres fire multi-grenades and drop multi-rockets; Spawn pick tiers and split", async () => {
  const current = await session("rogue", "r2m1"), { game, player, actors } = current;
  current.random(0.1);
  const ogre = spawnSpecies(current, "monster_ogre", 0); expect(ogre.entity.spawnflags & 2).toBe(2); expect(ogre.entity.skin).toBe(1);
  ogre.enemy = player.actor.id; ogre.play("ogre_nail4");
  expect([...game.entities.values()].some(entity => entity.classname === "MultiGrenade" && entity.owner === ogre.entity.actor.id)).toBe(true);
  const before = [...game.entities.values()].filter(entity => entity.classname === "item_backpack").length;
  ogre.play("ogre_die3"); expect([...game.entities.values()].filter(entity => entity.classname === "item_backpack").length).toBe(before + 1);
  const plain = spawnSpecies(current, "monster_ogre", 1); current.random(0.9); expect(plain.entity.skin).toBe(1);
  current.random(0.9); const normal = spawnSpecies(current, "monster_ogre", 0); expect(normal.entity.spawnflags & 2).toBe(0); expect(normal.entity.skin).toBe(0);
  const blue = spawnSpecies(current, "monster_tarbaby", 8); expect(blue.entity.skin).toBe(2); expect(blue.state.painFinished).toBe(0); expect(game.health(blue.entity.actor.id)).toBe(100);
  const green = spawnSpecies(current, "monster_tarbaby", 4); expect(game.health(green.entity.actor.id)).toBe(60);
  const plainBaby = spawnSpecies(current, "monster_tarbaby", 2); expect(plainBaby.entity.skin).toBe(0);
  current.random(0.1); const count = [...game.entities.values()].filter(entity => entity.classname === "monster_tarbaby").length;
  blue.pain(player.actor.id, 1); const babies = [...game.entities.values()].filter(entity => entity.classname === "monster_tarbaby");
  expect(babies).toHaveLength(count + 1); expect(babies.at(-1)?.owner).toBe(blue.entity.actor.id); expect(game.health(babies.at(-1)?.actor.id ?? blue.entity.actor.id)).toBe(100);
  blue.pain(player.actor.id, 1); expect([...game.entities.values()].filter(entity => entity.classname === "monster_tarbaby")).toHaveLength(count + 1);
  actors.close();
});

test.skipIf(!corpusHasFile(packPath("hipnotic", "rerelease")))("Hipnotic lying zombies wait in zombie_lay and rotfish gib below -20 health", async () => {
  const current = await session("hipnotic", "hip2m4"), { game, player, actors } = current;
  const lying = [...current.monsters.monsters.values()].filter(monster => monster.spec.species === "zombie" && (monster.entity.spawnflags & 5) === 4);
  expect(lying).toHaveLength(8);
  const zombie = lying[0]; if (zombie === undefined) throw new Error("Missing lying zombie");
  zombie.start(); expect(zombie.currentFrame).toBe("zombie_lay");
  zombie.pain(player.actor.id, 5); expect(zombie.currentFrame).toBe("zombie_lay12");
  const fish = spawnSpecies(current, "monster_fish", 0);
  game.host.combat.setHealth(fish.entity.actor, -30); const gibs = [...game.entities.values()].length; fish.die(player.actor.id);
  expect([...game.entities.values()].length).toBeGreaterThan(gibs); expect(fish.currentFrame).not.toBe("f_death1");
  actors.close();
});
