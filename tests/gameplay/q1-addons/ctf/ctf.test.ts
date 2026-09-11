import { expect, test } from "bun:test";
import type { ActorId, OwnedActor } from "../../../../src/contracts/identity.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { Q1Entity, Q1Map } from "../../../../src/formats/q1-map/index.ts";
import { readQ1Bsp } from "../../../../src/formats/q1-map/index.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { createSceneQueries } from "../../../../src/world/collision/index.ts";
import { Q1_DONOR_PROFILE } from "../../../../src/core/numeric.ts";
import { SessionActorRegistry, SharedBodyTable, ActorCallbackTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ1CombatPolicy, nativeVictimArmor } from "../../../../src/world/gameplay/index.ts";
import { Q1Foundation } from "../../../../src/content/q1/foundation/runtime.ts";
import type { Q1Event, Q1FoundationHost } from "../../../../src/content/q1/foundation/types.ts";
import { ZERO, PLAYER_BOUNDS, vadd } from "../../../../src/content/q1/foundation/types.ts";
import { registerQ1Base, Q1CharacterActor } from "../../../../src/content/q1/base/index.ts";
import { Q1AddonContext } from "../../../../src/content/q1/addons/context.ts";
import { registerCTF } from "../../../../src/content/q1/addons/ctf/index.ts";
import type { CtfInput, CtfStatus, CtfTeam, Q1CtfServices } from "../../../../src/content/q1/addons/ctf/index.ts";
import { setTeam } from "../../../../src/content/q1/addons/ctf/teams.ts";
import { touchFlag, dropFlag } from "../../../../src/content/q1/addons/ctf/flags.ts";
import { fireHook, hookTouch } from "../../../../src/content/q1/addons/ctf/grapple.ts";
import type { ItemId } from "../../../../src/contracts/gameplay.ts";

async function map(name: string): Promise<Q1Map> {
  const archive = await openArchive("/home/buzzkill/Projects/qfiles/q1/rerelease/ctf/pak0.pak");
  try { const path = `maps/${name}.bsp`, entry = archive.findEntries(path)[0]; if (entry === undefined) throw new Error(`Missing ${path}`); return readQ1Bsp(await archive.readEntry(entry), { source: path }); }
  finally { archive.close(); }
}
function world(map: Q1Map, coop = false) {
  const actors = new SessionActorRegistry(createIdentityOwner("ctf-content-check")), callbacks = new ActorCallbackTable(actors), scene = createSceneQueries(map);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const pending = new Map<OwnedActor, number>(), events: Q1Event[] = [], players: ActorId[] = [];
  const scores = new Map<ActorId, number>(), captures = new Map<CtfTeam, number>(), observers = new Set<ActorId>(), inputs = new Map<ActorId, CtfInput>(), statuses = new Map<ActorId, CtfStatus>(), weapons = new Map<ActorId, ItemId>(), cvars = new Map<string, number>([["teamplay", 130]]);
  const combat = new GameplayAuthority(actors, callbacks, { impulse: (actor, impulse) => { const body = bodies.read(actor.id); if (body !== null) bodies.write(actor, { ...body, velocity: vadd(body.velocity, impulse) }); return undefined; }, beforeReaction: () => undefined, confirmed: () => undefined });
  const inventory = new SharedInventoryTable(actors); let runtime: Q1Foundation | null = null;
  const host: Q1FoundationHost = { actors, callbacks, bodies, combat, inventory, random: () => 0.4,
    trace: request => {
      const result = scene.trace({ start: request.start, end: request.end, shape: { kind: "box", bounds: request.bounds }, target: { kind: "world" }, policy: { kind: "q1", move: request.missile === true ? "missile" : request.monsters ? "normal" : "no-monsters", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: request.ignore });
      if (result.kind !== "q1") throw new Error("CTF expected Q1 trace");
      return { fraction: result.fraction, end: result.end, normal: result.sourcePlane.normal, actor: result.hit.kind === "actor" ? result.hit.actor : result.hit.kind === "world" ? runtime?.world?.actor.id ?? null : null, startSolid: result.startSolid, allSolid: result.allSolid, sky: false, inOpen: result.inOpen, inWater: result.inWater };
    },
    contents: () => "empty", walkMove: () => false, moveToGoal: () => undefined,
    changeYaw: () => { throw new Error("CTF fixture removes monsters before their yaw phase"); }, checkBottom: () => false,
    pushMove: (actor, displacement) => { const body = bodies.read(actor.id); if (body === null) throw new Error("Missing CTF brush"); bodies.write(actor, { ...body, origin: vadd(body.origin, displacement) }); return null; },
    scheduleThink: (actor, time) => { pending.set(actor, time); return undefined; }, cancelThink: actor => { pending.delete(actor); return undefined; },
    emit: event => { events.push(event); return undefined; }, transition: () => undefined, players: () => players, checkClient: () => null, classname: actor => runtime?.entity(actor)?.classname ?? "player", powerup: () => undefined,
  };
  const game = new Q1Foundation(host, { edition: "rerelease", skill: 1, deathmatch: coop ? 0 : 1, coop, gravity: 800, maxClients: 4, campaign: "q1:ctf", combatProvider: "q1:combat", inventoryProvider: "q1:inventory", movementProvider: "q2:movement" }); runtime = game;
  combat.register(createQ1CombatPolicy({ id: "q1:combat", context: request => ({ ...game.combatContext(request), teamplay: cvars.get("teamplay") ?? 0 }), sourceEffects: game.damageSourceEffects, armor: nativeVictimArmor(() => ({ arithmetic: "binary32", screenFacingDot: 0 })) }));
  const context = new Q1AddonContext(registerQ1Base(game), "ctf", { emit: () => undefined, isMonster: () => false, cvar: name => cvars.get(name) ?? 0, setCvar: (name, value) => { cvars.set(name, Number(value)); return undefined; } });
  const input = (actor: ActorId): CtfInput => inputs.get(actor) ?? { attack: false, jump: false, impulse: 0, grappleSelected: false, viewAngles: ZERO, teleportUntil: 0, frame: 0 };
  const services: Q1CtfServices = {
    name: actor => `Player${actor.slot}`, isBot: () => false, score: actor => scores.get(actor) ?? 0, addScore: (actor, delta) => { scores.set(actor, (scores.get(actor) ?? 0) + delta); return undefined; },
    captures: team => captures.get(team) ?? 0, addCapture: team => { captures.set(team, (captures.get(team) ?? 0) + 1); return undefined; }, input,
    consumeImpulse: actor => { inputs.set(actor, { ...input(actor), impulse: 0 }); return undefined; }, observer: actor => observers.has(actor),
    setObserver: (actor, enabled) => { if (enabled) observers.add(actor); else observers.delete(actor); return undefined; },
    respawn: (actor, spot) => { const owner = actors.resolveOwned(actor), body = bodies.read(actor); if (owner === null || body === null) throw new Error("Missing CTF respawn actor"); combat.setHealth(owner, 100); if (spot !== null) bodies.write(owner, { ...body, origin: game.body(spot).origin }); return undefined; },
    disconnect: actor => { observers.add(actor); return undefined; }, colors: () => undefined, promptSupported: () => true, prompt: () => undefined, clearPrompt: () => undefined,
    teleport: (actor, origin, angles, velocity, until) => { const owner = actors.resolveOwned(actor), body = bodies.read(actor); if (owner === null || body === null) throw new Error("Missing CTF teleport actor"); bodies.write(owner, { ...body, origin, angles, velocity }); inputs.set(actor, { ...input(actor), teleportUntil: until }); return undefined; },
    selectGrapple: actor => { inputs.set(actor, { ...input(actor), grappleSelected: true }); return undefined; }, selectedWeapon: actor => weapons.get(actor) ?? "q1:weapon/shotgun", selectedAmmo: () => "q1:ammo/shells", weaponChanged: () => undefined,
    haste: () => undefined, status: (actor, status) => { statuses.set(actor, status); return undefined; }, log: () => undefined,
  };
  const ctf = registerCTF(context, services), report = game.spawnMap(map);
  const admit = (team: CtfTeam) => {
    const actor = actors.allocateAtSource("q3:character", players.length + 1, "q3:sarge");
    bodies.create(actor, { origin: ZERO, angles: ZERO, velocity: ZERO, bounds: PLAYER_BOUNDS, ground: null });
    combat.create(actor, { health: 100, armor: { kind: "none" }, mass: 100, canTakeDamage: true, invulnerable: false, team });
    inventory.create(actor, []); players.push(actor.id); game.attachPlayer(actor); ctf.spawnPlayer(actor.id, true); setTeam(ctf, actor.id, team);
    const spot = ctf.selectSpawn(actor.id); if (spot !== null) ctf.writeBody(actor.id, { origin: game.body(spot).origin }); return actor;
  };
  const advance = (until: number) => {
    for (;;) {
      const next = [...pending].filter(([, time]) => time <= until).sort((a, b) => a[1] - b[1])[0]; if (next === undefined) break;
      pending.delete(next[0]); callbacks.think(next[0], { frame: 0, time: { kind: "seconds", value: next[1] }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" });
    }
    game.time = until;
  };
  const spawn = (classname: string, fields: Readonly<Record<string, string>> = {}) => {
    const source: Q1Entity = { properties: [{ key: "classname", value: classname }, ...Object.entries(fields).map(([key, value]) => ({ key, value }))] };
    const entity = game.create(classname, source); game.spawnEntity(entity); return entity;
  };
  return { actors, bodies, callbacks, combat, inventory, game, context, ctf, report, services, inputs, statuses, scores, captures, cvars, admit, advance, spawn };
}

test("actual rerelease CTF maps spawn flags, team starts, runes and named saved state", async () => {
  for (const name of ["ctf1", "ctf2", "ctf3", "ctf4", "ctf5", "ctf6", "ctf7", "ctf8", "ctf9"]) {
    const state = world(await map(name)); state.advance(0.5);
    expect(state.ctf.flag("red")?.solid).toBe("trigger"); expect(state.ctf.flag("blue")?.solid).toBe("trigger");
    expect([...state.game.entities.values()].filter(entity => entity.classname.startsWith("item_rune_")).length).toBe(4);
    expect(state.game.totalMonsters).toBe(0); expect(() => state.game.capture()).not.toThrow(); state.actors.close();
  }
});

test("foreign character captures, returns dropped flags and pulls an actual grapple anchor", async () => {
  const state = world(await map("ctf1")), red = state.admit("red"), blue = state.admit("blue"); state.advance(10);
  const redFlag = state.ctf.flag("red"), blueFlag = state.ctf.flag("blue"); if (redFlag === null || blueFlag === null) throw new Error("Missing CTF flags");
  touchFlag(state.ctf, blueFlag, red.id); expect(state.ctf.carried(red.id)).toBe(blueFlag);
  touchFlag(state.ctf, redFlag, red.id); expect(state.captures.get("red")).toBe(1); expect(state.scores.get(red.id)).toBe(15);
  touchFlag(state.ctf, redFlag, blue.id); dropFlag(state.ctf, blue.id); state.advance(39); expect(redFlag.count).toBe(2); state.advance(40.2); expect(redFlag.count).toBe(0);
  state.inputs.set(red.id, { ...state.services.input(red.id), attack: true, grappleSelected: true }); expect(fireHook(state.ctf, red.id)).toBe(true);
  const hook = state.ctf.hook(red.id), worldEntity = state.game.world; if (hook === null || worldEntity === null) throw new Error("Missing CTF hook/world");
  expect(hook.movement).toBe("fly"); state.game.setOrigin(hook, vadd(state.ctf.body(red.id).origin, { x: 250, y: 0, z: 16 })); hookTouch(state.ctf, hook, worldEntity.actor.id);
  state.advance(40.4); expect(state.ctf.body(red.id).velocity.x).toBeGreaterThan(900); expect(state.ctf.grapple.pulling(red.id)).toBe(true);
  state.inputs.set(red.id, { ...state.services.input(red.id), attack: false }); state.advance(40.6); expect(state.ctf.hook(red.id)).toBeNull(); state.actors.close();
});

test("team armor and health gates reflect through the source damage commit boundary", async () => {
  const state = world(await map("ctf1")), attacker = state.admit("red"), target = state.admit("red"); state.advance(10); state.cvars.set("teamplay", 7);
  state.combat.setArmor(attacker, { kind: "none" });
  state.combat.setArmor(target, { kind: "q1", points: 100, absorption: 0.3, item: "q1:item_armor1" });
  state.game.damage(target.id, attacker.id, attacker.id, 20, "shotgun");
  expect(state.game.health(target.id)).toBe(100); expect(state.combat.read(target.id)?.armor).toEqual({ kind: "q1", points: 100, absorption: 0.3, item: "q1:item_armor1" }); expect(state.game.health(attacker.id)).toBe(80);
  state.cvars.set("teamplay", 4); state.game.damage(target.id, attacker.id, attacker.id, 20, "shotgun");
  expect(state.game.health(target.id)).toBe(86); expect(state.game.health(attacker.id)).toBe(60);
  state.actors.close();
});

test("CTF source arsenal applies haste launch speed and delayed grapple frames", async () => {
  const state = world(await map("ctf1")), actor = state.admit("red"); state.advance(10);
  expect(state.inventory.count(actor.id, "q1:ammo/shells")).toBe(40); expect(state.combat.read(actor.id)?.armor).toEqual({ kind: "q1", points: 50, absorption: 0.3, item: "q1:item_armor1" });
  state.ctf.grant(actor.id, "q1:ctf/rune/haste", 1); expect(state.game.attack(actor, ZERO, 10)).toBe(true);
  expect(state.game.player(actor.id)?.attackFinished).toBeCloseTo(10.3, 5);
  state.ctf.grant(actor.id, "q1:weapon/nailgun", 1); state.ctf.grant(actor.id, "q1:ammo/nails", 10, 200); state.game.selectWeapon(actor, "nailgun");
  expect(state.game.attack(actor, ZERO, 11)).toBe(true);
  const nail = [...state.game.entities.values()].find(entity => entity.projectile === "spike"); if (nail === undefined) throw new Error("Missing CTF haste spike");
  expect(state.game.body(nail).velocity.x).toBeCloseTo(2000, 4);
  state.game.selectWeapon(actor, "ctf:grapple"); state.inputs.set(actor.id, { ...state.services.input(actor.id), grappleSelected: true, attack: true });
  const character = new Q1CharacterActor(state.game, actor, { sourcePose: () => state.ctf.characterPose(actor.id), fallDamageAllowed: () => state.ctf.fallDamageAllowed(actor.id) });
  expect(state.game.attack(actor, ZERO, 12)).toBe(true); expect(state.game.player(actor.id)?.weaponFrame).toBe(2); expect(state.ctf.hook(actor.id)).toBeNull();
  expect(character.presentation.frame).toBe(137);
  state.advance(12.11); expect(state.ctf.hook(actor.id)?.model).toBe("progs/star.mdl"); expect(state.game.player(actor.id)?.weaponFrame).toBe(3);
  expect(character.presentation.frame).toBe(138); state.game.playerFrame(actor, 12.21); expect(character.presentation.frame).toBe(139);
  const travel = state.ctf.captureTravel(actor.id); setTeam(state.ctf, actor.id, "blue"); state.ctf.restoreTravel(actor.id, travel); expect(state.ctf.lastTeam(actor.id)).toBe("red");
  expect(() => state.game.capture()).not.toThrow(); state.actors.close();
  const cooperative = world(await map("ctf1"), true), player = cooperative.admit("red"); cooperative.advance(0.5);
  const pickup = [...cooperative.game.entities.values()].find(entity => entity.classname === "weapon_nailgun"); if (pickup === undefined) throw new Error("CTF1 has no authored nailgun");
  pickup.touch?.(player.id, null); expect(cooperative.inventory.count(player.id, "q1:weapon/nailgun")).toBe(1); expect(cooperative.inventory.count(player.id, "q1:ammo/nails")).toBe(0); cooperative.actors.close();
});

test("CTF team commands, source vote exit and capture limit use shared match transitions", async () => {
  const state = world(await map("ctf1")), actor = state.admit("red"); state.advance(10);
  state.inputs.set(actor.id, { ...state.services.input(actor.id), impulse: 104 }); expect(state.ctf.impulse(actor.id)).toBe(true); expect(state.services.observer(actor.id)).toBe(true);
  state.inputs.set(actor.id, { ...state.services.input(actor.id), impulse: 102 }); expect(state.ctf.impulse(actor.id)).toBe(true); expect(state.ctf.team(actor.id)).toBe("blue"); expect(state.services.observer(actor.id)).toBe(false);
  state.spawn("info_vote_destination", { targetname: "vote_dest", origin: "128 64 32", angle: "90" });
  const vote = state.spawn("trigger_voteexit", { target: "vote_dest", map: "ctf8", message: "The Strongbox" });
  state.game.mapName = "start"; vote.touch?.(actor.id, null); expect(vote.count).toBe(1); expect(state.ctf.body(actor.id).origin).toEqual({ x: 128, y: 64, z: 59 });
  vote.touch?.(actor.id, null); expect(vote.count).toBe(1); state.game.time = 71; state.context.frame(0.1); state.advance(71.2);
  expect(state.game.intermission?.map).toBe("ctf8"); state.actors.close();
  const limited = world(await map("ctf9")); limited.cvars.set("fraglimit", 1); limited.services.addCapture("blue"); limited.context.frame(0.1); limited.advance(0.2);
  expect(limited.game.intermission?.map).toBe("ctf1"); limited.actors.close();
});
