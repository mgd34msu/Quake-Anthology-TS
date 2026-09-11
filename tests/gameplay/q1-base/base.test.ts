import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ActorId, OwnedActor } from "../../../src/contracts/identity.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { SessionActorRegistry, SharedBodyTable, ActorCallbackTable, translatedBodyBounds } from "../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ1CombatPolicy, nativeVictimArmor } from "../../../src/world/gameplay/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { Q1_DONOR_PROFILE } from "../../../src/core/numeric.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { readQ1Bsp } from "../../../src/formats/q1-map/index.ts";
import type { Q1Map } from "../../../src/formats/q1-map/index.ts";
import { Q1Foundation } from "../../../src/content/q1/foundation/runtime.ts";
import type { Q1Event, Q1FoundationHost } from "../../../src/content/q1/foundation/types.ts";
import { PLAYER_BOUNDS, ZERO, vadd } from "../../../src/content/q1/foundation/types.ts";
import { registerQ1Base, Q1CharacterActor, Q1CampaignState, captureQ1Travel, admitQ1Travel, newQ1Travel, baseSpecies, BaseMonster } from "../../../src/content/q1/base/index.ts";
import { monsterFrames } from "../../../src/content/q1/base/frames.ts";

const archivePath = resolve(import.meta.dir, "../../../../qfiles/q1/rerelease/id1/pak0.pak");
async function readMap(name: string): Promise<Q1Map> {
  const archive = await openArchive(archivePath);
  try { const entry = archive.findEntries(`maps/${name}.bsp`)[0]; if (entry === undefined) throw new Error(`Missing ${name}`); return readQ1Bsp(await archive.readEntry(entry), { source: `maps/${name}.bsp` }); }
  finally { archive.close(); }
}
function createGame(map: Q1Map) {
  const actors = new SessionActorRegistry(createIdentityOwner("q1-base-smoke")), callbacks = new ActorCallbackTable(actors), scene = createSceneQueries(map);
  const pending = new Map<OwnedActor, number>(), events: Q1Event[] = [], players: ActorId[] = [];
  let runtime: Q1Foundation | null = null;
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onUnlink: actor => { scene.unlink(actor); return undefined; }, onLink: body => {
    const entity = runtime?.entity(body.actor);
    if (entity === null || entity === undefined || entity.solid === "none" || entity.classname === "worldspawn") { scene.unlink(body.actor); return undefined; }
    const model = entity.model.startsWith("*") ? Number(entity.model.slice(1)) : null;
    scene.link(body, { family: "q1", shape: model === null ? { kind: "box" } : { kind: "model", model }, contents: -2, owner: entity.owner, role: entity.solid === "trigger" ? "trigger" : "solid", monster: entity.monster !== null, deadMonster: false }); return undefined;
  } });
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
    walkMove: () => false, moveToGoal: () => undefined, checkBottom: () => false,
    pushMove: (actor, displacement) => { const body = bodies.read(actor.id); if (body === null) throw new Error("Missing body"); bodies.write(actor, { ...body, origin: vadd(body.origin, displacement) }); bodies.link(actor); return null; },
    scheduleThink: (actor, seconds) => { pending.set(actor, seconds); return undefined; }, cancelThink: actor => { pending.delete(actor); return undefined; },
    emit: event => { events.push(event); return undefined; }, transition: () => undefined, players: () => players, checkClient: () => null,
    classname: actor => runtime?.entity(actor)?.classname ?? "player", powerup: () => undefined,
  };
  const game = new Q1Foundation(host, { edition: "rerelease", skill: 1, deathmatch: 0, coop: false, gravity: 800, maxClients: 4, campaign: "q1:id1", combatProvider: "q1:combat", inventoryProvider: "q1:inventory", movementProvider: "q2:movement" }); runtime = game;
  combat.register(createQ1CombatPolicy({ id: "q1:combat", context: request => game.combatContext(request), armor: nativeVictimArmor(() => ({ arithmetic: "binary32", screenFacingDot: 0 })) }));
  const campaign = new Q1CampaignState(), base = registerQ1Base(game, { campaign }); const report = game.spawnMap(map);
  const player = actors.allocateAtSource("q3:character", 1, "q3:sarge"); const spawn = [...game.entities.values()].find(entity => entity.classname === "info_player_start");
  bodies.create(player, { origin: spawn === undefined ? ZERO : game.body(spawn).origin, angles: ZERO, velocity: ZERO, bounds: PLAYER_BOUNDS, ground: null });
  combat.create(player, { health: 100, armor: { kind: "none" }, mass: 100, canTakeDamage: true, invulnerable: false, team: null }); inventory.create(player, []); game.attachPlayer(player); players.push(player.id);
  return { game, base, report, actors, combat, inventory, player, pending, events, campaign };
}

test.skipIf(!existsSync(archivePath))("real base maps register bosses, monsters, trains, traps and gates", async () => {
  const classes = new Set<string>();
  for (const name of ["start", "e1m7", "e2m2", "e3m3", "e4m4", "end"]) {
    const { actors, report } = createGame(await readMap(name));
    for (const entity of report.spawned) classes.add(entity.classname);
    actors.close();
  }
  expect(classes.has("monster_boss")).toBe(true); expect(classes.has("monster_oldone")).toBe(true); expect(classes.has("monster_shambler")).toBe(true);
  expect(classes.has("misc_teleporttrain")).toBe(true); expect(classes.has("func_bossgate")).toBe(true);
  expect([...monsterFrames.values()].every(frame => monsterFrames.has(frame.next))).toBe(true);
});

test.skipIf(!existsSync(archivePath))("zombie recovery and gib death use shared combat state", async () => {
  const { game, base, actors, combat, player } = createGame(await readMap("e1m7"));
  const spec = baseSpecies.find(candidate => candidate.species === "zombie"); if (spec === undefined) throw new Error("Missing zombie provider");
  const entity = game.create("monster_zombie"), monster = new BaseMonster(game, entity, spec, base); base.monsters.set(entity.actor, monster); monster.spawn(); entity.damageable = true;
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
  character.respawn(100); expect(character.presentation.model).toBe("progs/player.mdl"); expect(combat.read(player.id)?.health).toBe(100); actors.close();
});
