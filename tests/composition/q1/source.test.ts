import { expect, test } from "bun:test";
import type { ActorId, OwnedActor } from "../../../src/contracts/identity.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { Q1Map } from "../../../src/formats/q1-map/index.ts";
import { readQ1Bsp } from "../../../src/formats/q1-map/index.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { SessionActorRegistry, ActorCallbackTable, SharedBodyTable, translatedBodyBounds } from "../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ1CombatPolicy, nativeVictimArmor } from "../../../src/world/gameplay/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { Q1_DONOR_PROFILE } from "../../../src/core/numeric.ts";
import { Q1Foundation } from "../../../src/content/q1/foundation/runtime.ts";
import { PLAYER_BOUNDS, Q1_WEAPON_IDS, ZERO, vadd } from "../../../src/content/q1/foundation/types.ts";
import type { Q1Event, Q1FoundationHost } from "../../../src/content/q1/foundation/types.ts";
import { Q1CampaignState } from "../../../src/content/q1/base/index.ts";
import { Q1SourceComposition } from "../../../src/content/composition/q1/index.ts";
import type { Q1CompositionEvent, Q1CompositionServices, Q1SourceProgram } from "../../../src/content/composition/q1/index.ts";
import { touchFlag } from "../../../src/content/q1/addons/ctf/flags.ts";
import { encodeQ1FoundationCheckpoint, decodeQ1FoundationCheckpoint } from "../../../src/persistence/q1-foundation.ts";
import { captureSharedBodies, restoreSharedBodyLinks } from "../../../src/persistence/world-state.ts";

async function map(program: Q1SourceProgram, name: string): Promise<Q1Map> {
  const archive = await openArchive(`/home/buzzkill/Projects/qfiles/q1/rerelease/${program}/pak0.pak`);
  try { const path = `maps/${name}.bsp`, entry = archive.findEntries(path)[0]; if (entry === undefined) throw new Error(`Missing ${path}`); return readQ1Bsp(await archive.readEntry(entry), { source: path }); }
  finally { archive.close(); }
}
interface Saved {
  readonly source: Uint8Array;
  readonly slots: ReturnType<SessionActorRegistry["checkpoint"]>;
  readonly sources: ReturnType<SessionActorRegistry["sourceCheckpoint"]>;
  readonly bodies: ReturnType<typeof captureSharedBodies>;
  readonly combat: readonly { readonly actor: { readonly slot: number; readonly generation: number }; readonly state: NonNullable<ReturnType<GameplayAuthority["read"]>> }[];
  readonly inventory: readonly { readonly actor: { readonly slot: number; readonly generation: number }; readonly entries: ReturnType<SharedInventoryTable["entries"]> }[];
}
function sourceWorld(map: Q1Map, program: Q1SourceProgram, saved?: Saved) {
  const owner = createIdentityOwner("q1-composition-check"), actors = saved === undefined ? new SessionActorRegistry(owner) : SessionActorRegistry.restore(owner, saved.slots, saved.sources);
  const callbacks = new ActorCallbackTable(actors), scene = createSceneQueries(map), players: ActorId[] = [], events: Q1CompositionEvent[] = [], sourceEvents: Q1Event[] = [];
  const pending = new Map<OwnedActor, number>(), cvars = new Map<string, number>([["teamplay", program === "ctf" ? 130 : 0]]);
  let runtime: Q1Foundation | null = null, composed: Q1SourceComposition | null = null;
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onUnlink: actor => { scene.unlink(actor); return undefined; }, onLink: body => {
    const entity = runtime?.entity(body.actor); if (entity == null || entity.solid === "none" || entity.classname === "worldspawn") { scene.unlink(body.actor); return undefined; }
    const model = entity.model.startsWith("*") ? Number(entity.model.slice(1)) : null;
    scene.link(body, { family: "q1", shape: model === null ? { kind: "box" } : { kind: "model", model }, contents: -2, owner: entity.owner, role: entity.solid === "trigger" ? "trigger" : "solid", monster: entity.monster !== null, deadMonster: false }); return undefined;
  } });
  const combat = new GameplayAuthority(actors, callbacks, { impulse: (actor, impulse) => { const body = bodies.read(actor.id); if (body !== null) bodies.write(actor, { ...body, velocity: vadd(body.velocity, impulse) }); return undefined; },
    beforeReaction: (actor, decision) => composed?.beforeReaction(actor, decision), confirmed: () => undefined });
  const inventory = new SharedInventoryTable(actors);
  const host: Q1FoundationHost = { actors, bodies, callbacks, combat, inventory, random: () => 0.4,
    trace: request => { const trace = scene.trace({ start: request.start, end: request.end, shape: { kind: "box", bounds: request.bounds }, target: { kind: "world" }, policy: { kind: "q1", move: request.missile ? "missile" : request.monsters ? "normal" : "no-monsters", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: request.ignore });
      if (trace.kind !== "q1") throw new Error("Expected actual Q1 map trace");
      return { fraction: trace.fraction, end: trace.end, normal: trace.sourcePlane.normal, actor: trace.hit.kind === "actor" ? trace.hit.actor : trace.hit.kind === "world" ? runtime?.world?.actor.id ?? null : null, startSolid: trace.startSolid, allSolid: trace.allSolid, sky: false, inOpen: trace.inOpen, inWater: trace.inWater }; },
    contents: point => { const contents = scene.pointContents({ point, target: { kind: "world" }, policy: { kind: "q1", move: "normal", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: null }); if (contents.kind !== "q1") throw new Error("Expected Q1 contents"); return contents.contents === -2 ? "solid" : contents.contents === -3 ? "water" : contents.contents === -4 ? "slime" : contents.contents === -5 ? "lava" : contents.contents === -6 ? "sky" : "empty"; },
    // These source lifecycle checks do not step monster chase or rider physics.
    walkMove: () => false, moveToGoal: () => undefined, changeYaw: () => undefined, checkBottom: () => false, pushMove: (actor, displacement) => { const body = bodies.read(actor.id); if (body === null) throw new Error("Missing brush"); bodies.write(actor, { ...body, origin: vadd(body.origin, displacement) }); return null; },
    scheduleThink: (actor, due) => { pending.set(actor, due); return undefined; }, cancelThink: actor => { pending.delete(actor); return undefined; },
    emit: event => { sourceEvents.push(event); return undefined; }, transition: () => undefined, players: () => players, checkClient: () => null, classname: actor => runtime?.entity(actor)?.classname ?? "player",
    powerup: (actor, kind, until) => { if (kind === "invulnerability") combat.setTraits(actor, { invulnerable: until > 0 }); return undefined; },
    setGravity: () => undefined,
  };
  const game = new Q1Foundation(host, { edition: "rerelease", skill: 1, coop: false, deathmatch: program === "ctf" ? 1 : 0, maxClients: 4, gravity: 800, campaign: `q1:${program}`, combatProvider: "q1:combat", inventoryProvider: "q1:inventory", movementProvider: "q2:movement" }); runtime = game;
  const services: Q1CompositionServices = {
    cvar: name => cvars.get(name) ?? 0, setCvar: (name, value) => { cvars.set(name, Number(value)); return undefined; }, emit: event => { events.push(event); return undefined; },
    selectedPlayer: actor => ({ deadFlag: game.health(actor) > 0 ? 0 : 2, isBot: false, viewAngles: bodies.read(actor)?.angles ?? ZERO, viewOffset: { x: 0, y: 0, z: 26 }, frame: 0, waterType: "empty", waterLevel: 0, teleportUntil: game.player(actor)?.teleportUntil ?? 0 }),
    setObserver: (actor, enabled) => { const owner = actors.resolveOwned(actor); if (owner === null) throw new Error("Missing observer"); combat.setTraits(owner, { canTakeDamage: !enabled }); return undefined; },
    placePlayer: (actor, spot, travel) => { const body = bodies.read(actor.id); if (body === null || composed === null) throw new Error("Missing respawn body"); bodies.write(actor, { ...body, origin: game.body(spot).origin, bounds: PLAYER_BOUNDS, velocity: ZERO }); combat.setTraits(actor, { canTakeDamage: true }); return composed.admitTravel(actor, travel); },
    disconnect: actor => { const owner = actors.resolveOwned(actor); if (owner !== null) actors.release(owner); const index = players.indexOf(actor); if (index >= 0) players.splice(index, 1); return undefined; },
    teleport: (actor, origin, angles, velocity, until) => { const owner = actors.resolveOwned(actor), body = bodies.read(actor); if (owner === null || body === null) throw new Error("Missing teleport body"); bodies.write(owner, { ...body, origin, angles, velocity }); const player = game.player(actor); if (player !== null) player.teleportUntil = until; return undefined; },
    selectedWeapon: actor => { const player = game.player(actor); return player === null ? null : game.weaponItem(player.weapon); }, selectedAmmo: actor => { const player = game.player(actor); return player === null ? null : game.weaponAmmo(player.weapon); },
    selectWeapon: (actor, item) => { const player = game.player(actor), weapon = Q1_WEAPON_IDS.find(value => game.weaponItem(value) === item); return player !== null && weapon !== undefined && game.selectWeapon(player.actor, weapon); },
    weaponChanged: () => undefined, promptSupported: () => true, restartSession: () => undefined, finishCampaign: () => undefined,
  };
  const source = new Q1SourceComposition(game, { program, campaign: new Q1CampaignState(), officialCampaign: true, registered: true }, services); composed = source;
  combat.register(createQ1CombatPolicy({ id: "q1:combat", context: request => ({ ...game.combatContext(request), teamplay: services.cvar("teamplay") }), armor: nativeVictimArmor(() => ({ arithmetic: "binary32", screenFacingDot: 0 })), sourceEffects: game.damageSourceEffects }));
  if (saved === undefined) source.spawnMap(map);
  else {
    const owner = (id: { readonly slot: number; readonly generation: number }): OwnedActor => { const actor = actors.resolveSaved(id); if (actor === null) throw new Error("Missing saved actor"); return actor; };
    for (const record of saved.bodies) bodies.create(owner(record.actor), { ...record.body, ground: record.body.ground === null ? null : actors.referenceSaved(record.body.ground) });
    for (const record of saved.combat) combat.create(owner(record.actor), record.state);
    for (const record of saved.inventory) inventory.create(owner(record.actor), record.entries);
    game.restore(decodeQ1FoundationCheckpoint(saved.source), { scheduleThinks: false }); restoreSharedBodyLinks(saved, { actors, bodies }); game.resumeThinks();
    for (const client of source.clients.records.values()) players.push(client.actor.id);
  }
  function admit(name: string, color: number) {
    const slot = players.length, actor = actors.allocateAtSource("q1:official", slot + 1, "q3:sarge");
    bodies.create(actor, { origin: ZERO, angles: ZERO, velocity: ZERO, bounds: PLAYER_BOUNDS, ground: null }); combat.create(actor, { health: 100, armor: { kind: "none" }, mass: 100, canTakeDamage: true, invulnerable: false, team: null }); inventory.create(actor, []); players.push(actor.id);
    source.attach(actor, { slot, userinfo: new Map([["name", name], ["topcolor", String(color)], ["bottomcolor", String(color)]]) }); game.attachPlayer(actor); source.admitTravel(actor, source.newTravel()); source.spawned(actor.id, true);
    const point = source.selectSpawn(actor.id); if (point !== null) { const body = bodies.read(actor.id); if (body !== null) bodies.write(actor, { ...body, origin: game.body(point).origin }); } return actor;
  }
  function advance(until: number) { for (;;) { const next = [...pending].filter(([, due]) => due <= until).sort((a, b) => a[1] - b[1])[0]; if (next === undefined) break; pending.delete(next[0]); callbacks.think(next[0], { frame: 0, time: { kind: "seconds", value: next[1] }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" }); } game.time = until; }
  function capture(): Saved {
    const combatRecords: Saved["combat"][number][] = [], inventoryRecords: Saved["inventory"][number][] = [];
    for (const actor of actors.observations()) { const state = combat.read(actor.id); if (state !== null) combatRecords.push({ actor: { slot: actor.id.slot, generation: actor.id.generation }, state }); if (inventory.has(actor.id)) inventoryRecords.push({ actor: { slot: actor.id.slot, generation: actor.id.generation }, entries: inventory.entries(actor.id) }); }
    return { source: encodeQ1FoundationCheckpoint(game.capture()), slots: actors.checkpoint(), sources: actors.sourceCheckpoint(), bodies: captureSharedBodies(actors, bodies), combat: combatRecords, inventory: inventoryRecords };
  }
  return { source, game, actors, callbacks, combat, inventory, events, sourceEvents, cvars, admit, advance, capture };
}

test("actual CTF composition joins client teams, capture score, death ordering and fresh saved admission", async () => {
  const level = await map("ctf", "ctf1"), world = sourceWorld(level, "ctf"), red = world.admit("Ranger", 4), blue = world.admit("Sarge", 13); world.advance(10);
  const ctf = world.source.ctf; if (ctf === null) throw new Error("Missing selected CTF source");
  const redFlag = ctf.flag("red"), blueFlag = ctf.flag("blue"); if (redFlag === null || blueFlag === null) throw new Error("Missing authored flags");
  expect(world.combat.read(red.id)?.team).toBe("red"); expect(world.inventory.count(red.id, "q1:ammo/shells")).toBe(40);
  touchFlag(ctf, blueFlag, red.id); touchFlag(ctf, redFlag, red.id); expect(world.source.clients.redCaptures).toBe(1); expect(world.source.clients.require(red.id).frags).toBe(15);
  let scoreAtCharacterDeath = -1;
  world.callbacks.bind(blue, { think: null, touch: null, use: null, pain: null, die: () => { scoreAtCharacterDeath = world.source.clients.require(red.id).frags; return undefined; } });
  world.game.damage(blue.id, red.id, red.id, 1000, "shotgun"); expect(scoreAtCharacterDeath).toBeGreaterThan(15); expect(world.source.clients.require(blue.id).deathRecorded).toBe(true);
  world.source.input(red.id, { attack: false, jump: false, use: false, impulse: 22 }); expect(world.source.impulse(red.id)).toBe(true); expect(world.game.player(red.id)?.weapon).toBe("ctf:grapple");
  const checkpoint = world.capture(), restored = sourceWorld(level, "ctf", checkpoint), savedRed = restored.actors.resolveSaved({ slot: red.id.slot, generation: red.id.generation }); if (savedRed === null) throw new Error("Missing saved client");
  expect(restored.source.clients.require(savedRed.id).name).toBe("Ranger"); expect(restored.source.clients.require(savedRed.id).frags).toBe(scoreAtCharacterDeath); expect(restored.source.clients.redCaptures).toBe(1);
  expect(restored.game.player(savedRed.id)?.weapon).toBe("ctf:grapple"); expect(restored.game.capture()).toEqual(decodeQ1FoundationCheckpoint(checkpoint.source));
  world.actors.close(); restored.actors.close();
});

test("actual MG1 horde and campaign maps register their authored source behavior through composition", async () => {
  for (const name of ["hub", "horde1"]) {
    const world = sourceWorld(await map("mg1", name), "mg1"), actor = world.admit("Sarge", 4); world.advance(0.5);
    expect(world.source.addon?.program).toBe("mg1"); expect(world.source.horde).not.toBeNull();
    world.game.beginFrame(0.5, 0.05); world.source.preFrame(0.05); world.source.playerPreThink(actor.id); world.game.playerFrame(actor, 0.5, 0); world.game.playerAfterPhysics(actor, 0.5); world.source.playerPostThink(actor.id);
    expect(world.source.addon?.frameTime).toBe(0.05); expect(world.source.clients.require(actor.id).name).toBe("Sarge"); expect(() => world.capture()).not.toThrow();
    if (name === "horde1") expect(world.source.horde?.manager?.classname).toBe("horde_manager"); world.actors.close();
  }
});

test("official campaign selection joins base, mission packs and rerelease addons on their actual start maps", async () => {
  const cases: readonly (readonly [Q1SourceProgram, string])[] = [["id1", "e1m1"], ["hipnotic", "hip1m1"], ["rogue", "r1m1"], ["dopa", "e5m1"], ["mg3", "hub"]];
  for (const [program, name] of cases) {
    const level = await map(program, name), world = sourceWorld(level, program), actor = world.admit("Ranger", 4);
    expect(world.game.mapName).toBe(name); expect(world.game.player(actor.id)).not.toBeNull();
    expect(world.source.packs?.pack ?? world.source.addon?.program ?? "id1").toBe(program);
    if (program === "id1") {
      const player = world.game.player(actor.id); if (player === null) throw new Error("Missing admitted source arsenal");
      world.inventory.configure(actor, { item: "q1:weapon/supershotgun", count: 1, capacity: 1 }); world.inventory.configure(actor, { item: "q1:ammo/shells", count: 1, capacity: 100 });
      world.source.input(actor.id, { attack: false, jump: false, use: false, impulse: 3 }); expect(world.source.impulse(actor.id)).toBe(true); expect(player.weapon).toBe("shotgun");
      expect(world.sourceEvents.some(event => event.kind === "message" && event.text === "$qc_not_enough_ammo")).toBe(true);
      player.attackFinished = 1; world.source.input(actor.id, { attack: false, jump: false, use: false, impulse: 1 }); expect(world.source.impulse(actor.id)).toBe(false);
      world.source.input(actor.id, { attack: false, jump: false, use: false, impulse: 0 }); expect(world.source.clients.require(actor.id).impulse).toBe(1);
      world.game.time = 1; expect(world.source.impulse(actor.id)).toBe(true); expect(player.weapon).toBe("axe");
      world.source.input(actor.id, { attack: false, jump: false, use: false, impulse: 9 }); expect(world.source.impulse(actor.id)).toBe(true);
      expect(world.inventory.count(actor.id, "q1:ammo/cells")).toBe(200); expect(world.combat.read(actor.id)?.armor.kind).toBe("q1"); expect(player.weapon).toBe("rocketlauncher");
    }
    if (program === "mg3") {
      const addon = world.source.addon, player = world.game.player(actor.id); if (addon === null || player === null) throw new Error("Missing MG3 source state");
      const impulse = (value: number) => { world.source.input(actor.id, { attack: false, jump: false, use: false, impulse: value }); expect(world.source.impulse(actor.id)).toBe(true); };
      impulse(111); expect(addon.playerNumber(actor.id, "parm10")).toBe(1); expect(player.maxHealth).toBe(60);
      impulse(100); expect(player.maxHealth).toBe(100); expect(addon.playerNumber(actor.id, "parm10")).toBe(1);
      impulse(99); expect(world.inventory.count(actor.id, "q1:key/silver")).toBe(0); expect(world.inventory.count(actor.id, "q1:weapon/mg3:laser")).toBe(1); expect(world.combat.read(actor.id)?.armor.kind).toBe("none");
      impulse(118); impulse(1); expect(player.weapon).toBe("mg3:mjolnir"); impulse(12); expect(player.weapon).toBe("mg3:laser");
      impulse(227); expect(addon.playerNumber(actor.id, "parm15")).toBe(1); impulse(122); expect(addon.playerNumber(actor.id, "infiniteammo")).toBe(1);
      impulse(2); expect(world.game.weaponInput(actor, true, ZERO, 0, 0)).toBe(true); expect(world.inventory.count(actor.id, "q1:ammo/shells")).toBe(100);
      world.game.time = 2; impulse(4); expect(world.game.weaponInput(actor, true, ZERO, 2, 0)).toBe(true); expect(world.inventory.count(actor.id, "q1:ammo/nails")).toBe(200);
      const checkpoint = world.capture(), restored = sourceWorld(level, program, checkpoint);
      expect(restored.game.capture()).toEqual(decodeQ1FoundationCheckpoint(checkpoint.source)); restored.actors.close();
    }
    expect(() => world.capture()).not.toThrow(); world.actors.close();
  }
});
