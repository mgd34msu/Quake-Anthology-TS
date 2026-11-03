import { expect, test } from "bun:test";
import { corpusFile } from "../../../support/corpus.ts";

import { existsSync } from "node:fs";
import type { ActorId } from "../../../../src/contracts/identity.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { SessionActorRegistry, ActorCallbackTable } from "../../../../src/world/actors/index.ts";
import { SharedInventoryTable, createQ1CombatPolicy, nativeVictimArmor } from "../../../../src/world/gameplay/index.ts";
import { createSceneQueries } from "../../../../src/world/collision/index.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { readQ1Bsp } from "../../../../src/formats/q1-map/index.ts";
import { spawnMapActor } from "../../../../src/content/q1/foundation/spawns.ts";
import { Q1Foundation } from "../../../../src/content/q1/foundation/runtime.ts";
import { PLAYER_BOUNDS, ZERO, vadd } from "../../../../src/content/q1/foundation/types.ts";
import { registerQ1Base } from "../../../../src/content/q1/base/index.ts";
import { registerQ1CampaignAddons } from "../../../../src/content/q1/addons/index.ts";
import { registerQ1MissionPack } from "../../../../src/content/q1/missionpacks/runtime.ts";
import type { Q1MissionPack } from "../../../../src/content/q1/missionpacks/types.ts";
import { impulseAuthority } from "../../../support/authority.ts";
import { q1SceneBodies, q1TestHost } from "../../../support/q1-host.ts";

const root = corpusFile("q1/rerelease");
async function session(pack: Q1MissionPack, edition: "classic" | "rerelease" = "rerelease", deathmatch = 0, teamplay = 0, mapName = pack === "hipnotic" ? "hip1m1" : "r2m8", atWorldSpawn?: (game: Q1Foundation) => undefined) {
  const archive = await openArchive(`${root}/${pack}/pak0.pak`);
  const entry = archive.findEntries(`maps/${mapName}.bsp`)[0]; if (entry === undefined) throw new Error("Retail start.bsp missing");
  const map = readQ1Bsp(await archive.readEntry(entry), { source: `maps/${mapName}.bsp` }); archive.close();
  const actors = new SessionActorRegistry(createIdentityOwner(`missionpack-${pack}`)), callbacks = new ActorCallbackTable(actors), scene = createSceneQueries(map);
  const players: ActorId[] = [], gravity = new Map<ActorId, number>();
  let active: Q1Foundation | null = null;
  const bodies = q1SceneBodies(actors, scene, actor => active?.entity(actor));
  const combat = impulseAuthority(actors, callbacks, bodies);
  const inventory = new SharedInventoryTable(actors);
  const { host, pending, events } = q1TestHost({ actors, callbacks, bodies, combat, inventory, scene, world: () => active?.world?.actor.id ?? null, entity: actor => active?.entity(actor), players: () => players }, {
    random: () => 0.4, setGravity: (actor, scale) => { gravity.set(actor, scale); return undefined; } });
  const game = new Q1Foundation(host, { edition, skill: 1, deathmatch, teamplay, coop: false, maxClients: 2, gravity: 800, campaign: `q1:${pack}`, combatProvider: "q1:combat", inventoryProvider: "q1:inventory", movementProvider: "q3:movement" }); active = game;
  combat.register(createQ1CombatPolicy({ id: "q1:combat", context: request => game.combatContext(request), sourceEffects: game.damageSourceEffects, armor: nativeVictimArmor(() => ({ arithmetic: "binary32", screenFacingDot: 0 })) }));
  const base = registerQ1Base(game);
  const colors = new Map<ActorId, number>(), scores = new Map<ActorId, number>();
  const runtime = registerQ1MissionPack(game, base, pack, { gamecfg: () => 8, teamColor: actor => colors.get(actor) ?? 5, setTeamColor: (actor, team) => { colors.set(actor, team); return undefined; }, addFrags: (actor, delta) => { scores.set(actor, (scores.get(actor) ?? 0) + delta); return undefined; }, frags: actor => scores.get(actor) ?? 0, playerName: actor => `player${actor.slot}`, playerFrame: () => 0, disconnect: () => undefined, presentFinale: () => undefined });
  if (atWorldSpawn !== undefined) game.registerSpawn("worldspawn", (source, entity) => { spawnMapActor(source, entity); return atWorldSpawn(game); });
  game.spawnMap(map);
  const start = [...game.entities.values()].find(entity => entity.classname === "info_player_start"), origin = start === undefined ? ZERO : game.body(start).origin;
  function player(slot: number) {
    const owner = actors.allocateAtSource("q3:character", slot, "q3:sarge");
    bodies.create(owner, { origin: vadd(origin, { x: 64 * (slot - 1), y: 0, z: 0 }), angles: ZERO, velocity: ZERO, bounds: PLAYER_BOUNDS, ground: null });
    combat.create(owner, { health: 100, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 100, canTakeDamage: true, invulnerable: false, team: null });
    const state = game.attachPlayer(owner); players.push(owner.id); return state;
  }
  function think(entity: import("../../../../src/content/q1/foundation/entity.ts").Q1Actor, time = entity.nextThink) { pending.delete(entity.actor); callbacks.think(entity.actor, { frame: Math.floor(time * 10), time: { kind: "seconds", value: time }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" }); }
  return { game, runtime, base, actors, callbacks, combat, bodies, inventory, events, pending, gravity, colors, scores, think, player: player(1), target: player(2) };
}

test.skipIf(!existsSync(`${root}/hipnotic/pak0.pak`))("Hipnotic retail world registration, source counter and rotating mover save", async () => {
  const { game, runtime, actors, player, callbacks, think } = await session("hipnotic");
  expect([...game.entities.values()].some(entity => entity.classname === "worldspawn")).toBe(true);
  const counter = game.create("func_counter"); counter.count = 2; counter.targetname = "smoke_counter"; game.spawnEntity(counter);
  callbacks.use(counter.actor, player.actor.id, player.actor.id);
  expect(counter.number("counter_state")).toBe(1);
  const rotating = game.create("func_rotate_entity"); rotating.fields.set("rotate", "0 90 0"); game.spawnEntity(rotating);
  think(rotating); callbacks.use(rotating.actor, player.actor.id, player.actor.id); think(rotating);
  expect(game.body(rotating).angles.y).toBeCloseTo(1.8, 5);
  const checkpoint = game.capture(); expect(checkpoint.entities.find(saved => saved.actor.slot === counter.actor.id.slot)?.callbacks.think).toBe("hip:counter_tick");
  expect(checkpoint.entities.find(saved => saved.actor.slot === rotating.actor.id.slot)?.callbacks.think).toBe("hip:rotate_entity");
  think(counter); expect(game.entity(counter.actor.id)).toBeNull();
  expect(runtime.world.pack).toBe("hipnotic"); actors.close();
});

test.skipIf(!existsSync(`${root}/rogue/pak0.pak`))("Rogue retail ending world, token source scoring and machine crash callbacks", async () => {
  const { game, runtime, actors, player, target, callbacks, think } = await session("rogue", "rerelease", 0, 3);
  const machine = [...game.entities.values()].find(entity => entity.classname === "item_time_machine"); if (machine === undefined) throw new Error("Retail r2m8 time machine missing");
  expect(game.health(machine.actor.id)).toBe(1600);
  let token = [...game.entities.values()].find(entity => entity.classname === "dmatch_tag_token"); if (token === undefined) { token = game.create("dmatch_tag_token"); game.spawnEntity(token); }
  callbacks.touch({ self: token.actor, other: player.actor.id, plane: null, surface: null });
  expect(runtime.world.tagScore(target.actor.id, player.actor.id)).toBe(3);
  expect(runtime.world.tagScore(player.actor.id, target.actor.id)).toBe(5);
  expect(token.owner?.equals(target.actor.id)).toBe(true);
  runtime.world.crashTimeMachine(); expect(machine.movement).toBe("fly"); expect(machine.solid).toBe("none");
  think(machine); expect(game.body(machine).velocity.z).toBe(-55);
  expect(game.capture().entities).toHaveLength(game.entities.size); actors.close();
});

test.skipIf(!existsSync(`${root}/hipnotic/pak0.pak`))("Hipnotic static wallsprite preserves source angle correction and wall offset", async () => {
  const state = await session("hipnotic", "rerelease", 0, 0, "hip1m1", game => {
    const sprite = game.create("wallsprite"); sprite.skin = 2; sprite.frame = 3;
    game.setBody(sprite, { origin: { x: 10, y: 20, z: 30 }, angles: { x: 0, y: -1, z: 0 } });
    game.spawnEntity(sprite); expect(game.live(sprite)).toBe(false);
    return undefined;
  });
  try {
    const event = state.events.find(event => event.kind === "static-model" && event.path === "progs/s_blood1.spr");
    if (event?.kind !== "static-model") throw new Error("Missing wallsprite static record");
    expect(event.angles).toEqual({ x: -90, y: 0, z: 0 });
    expect(event.origin.x).toBeCloseTo(10); expect(event.origin.y).toBe(20); expect(event.origin.z).toBeCloseTo(29.8);
    expect(event.frame).toBe(3); expect(event.skin).toBe(2);
    expect(state.game.precaches.models).toContain(event.path);
  } finally { state.actors.close(); }
});

test.skipIf(!existsSync(`${root}/rogue/pak0.pak`))("Rogue authored candle and source lantern become persistent model records", async () => {
  const state = await session("rogue", "rerelease", 0, 0, "ctf1", game => {
    for (const flags of [0, 1]) {
      const torch = game.create("light_torch_small_walltorch"); torch.spawnflags = flags;
      game.setOrigin(torch, { x: 100 + flags, y: 200, z: 300 }); game.spawnEntity(torch);
      expect(game.live(torch)).toBe(false);
    }
    const lantern = game.create("light_lantern");
    game.setBody(lantern, { origin: { x: 1.125, y: 2.25, z: 3.5 } }); game.spawnEntity(lantern);
    expect(game.live(lantern)).toBe(false); return undefined;
  });
  try {
    for (const flags of [0, 1]) {
      const index = state.events.findIndex(event => event.kind === "static-model" && event.path === "progs/flame.mdl" && event.origin.x === 100 + flags);
      expect(index).toBeGreaterThanOrEqual(0);
      const sounds = state.events.filter(event => event.kind === "ambient" && event.origin.x === 100 + flags);
      expect(sounds.length).toBe(flags === 0 ? 1 : 0);
      if (flags === 0) expect(state.events[index - 1]).toEqual(sounds[0]);
    }
    expect(state.events).toContainEqual({ kind: "static-model", path: "progs/candle.mdl", frame: 0, skin: 0, colorMap: 0,
      origin: { x: -1308, y: 2140, z: 474 }, angles: ZERO });
    expect(state.events).toContainEqual({ kind: "static-model", path: "progs/lantern.mdl", frame: 0, skin: 0, colorMap: 0,
      origin: { x: 1.125, y: 2.25, z: 3.5 }, angles: ZERO });
    expect([...state.game.entities.values()].some(entity => entity.classname === "light_lantern" || entity.classname === "light_candle")).toBe(false);
  } finally { state.actors.close(); }
});

test.skipIf(!existsSync(`${root}/rogue/pak0.pak`))("Rogue accepts the MG1 horde adjunct without re-registering its owned spawn handlers", async () => {
  const { game, base, actors } = await session("rogue");
  const services = { emit: () => undefined, isMonster: () => false, cvar: () => 0, setCvar: () => undefined };
  expect(() => game.adjoin(() => registerQ1CampaignAddons(base, "mg1", services))).not.toThrow();
  actors.close();
});
