import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../../../src/contracts/identity.ts";
import type { ActorId } from "../../../../../src/contracts/identity.ts";
import type { DamageOutcome } from "../../../../../src/contracts/gameplay.ts";
import type { Vec3 } from "../../../../../src/contracts/math.ts";
import type { TraceResult } from "../../../../../src/contracts/scene.ts";
import { SessionActorRegistry, ActorCallbackTable, SharedBodyTable, translatedBodyBounds } from "../../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ2CombatPolicy, nativeVictimArmor } from "../../../../../src/world/gameplay/index.ts";
import { Q2EntityServices } from "../../../../../src/content/q2/foundation/entity-services.ts";
import type { Q2Edition, Q2FoundationHost, Q2PresentationEvent, Q2TraceRequest } from "../../../../../src/content/q2/foundation/host.ts";
import { Q2Weapons, Q2WeaponState } from "../../../../../src/content/q2/foundation/weapons/index.ts";
import type { Q2WeaponEvent, Q2WeaponInput } from "../../../../../src/content/q2/foundation/weapons/index.ts";

import { Q2HandGrenadeEquipment, HAND_GRENADE_AMMO } from "../../../../../src/content/q2/equipment/hand-grenades.ts";
import type { HandGrenadeEquipmentInput } from "../../../../../src/content/q2/equipment/hand-grenades.ts";
import { encodeHandGrenadesCheckpoint, decodeHandGrenadesCheckpoint } from "../../../../../src/persistence/q2-hand-grenades.ts";
import { encodeCheckpointValue } from "../../../../../src/persistence/value.ts";
import { PlayerState } from "../../../../../src/content/q3/base/shared/player-state.ts";
import { Weapon } from "../../../../../src/content/q3/base/shared/definitions.ts";
import { add, scale, subtract, normalize } from "../../../../../src/content/q2/foundation/fields.ts";
import { angleVectors } from "../../../../../src/content/q2/foundation/weapons/vectors.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };
const plane = { normal: { x: -1, y: 0, z: 0 }, distance: 0, type: 0, signbits: 1 };
function clearTrace(request: Q2TraceRequest): TraceResult {
  return { kind: "q2", fraction: 1, startSolid: false, allSolid: false, end: request.end, contact: { kind: "none" }, hit: { kind: "none" }, contents: 0, surface: null, sourcePlane: plane, secondary: null };
}

const loadout = { enabled: true, initialAmmo: 1, capacity: 50, infiniteAmmo: false };
const input: Q2WeaponInput = {
  attack: true, latchedAttack: false, holster: false, angles: zero, ducked: false, spectator: false,
  notarget: false, hand: "right", animatePlayer: false, quadUntil: 0, doubleUntil: 0, quadFireUntil: 0,
  haste: false, noStackDouble: false, instantSwitch: false, quickSwitch: true, infiniteAmmo: false, playersCollide: true, gravity: 800, weaponThunk: false,
};

function fixture(edition: Q2Edition, frameSeconds = 0.1) {
  let now = 0;
  const randomCalls: number[] = [];
  const reaction = { death: (): undefined => undefined };
  const actors = new SessionActorRegistry(createIdentityOwner(`q2-weapons-${edition}`));
  const callbacks = new ActorCallbackTable(actors);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const world = actors.allocateAtSource("q2:game", 0, "q2:worldspawn");
  bodies.create(world, { origin: zero, angles: zero, velocity: zero, bounds: { min: zero, max: zero }, ground: null });
  const outcomes: DamageOutcome[] = [], events: Q2WeaponEvent[] = [], presentation: Q2PresentationEvent[] = [];
  const combat = new GameplayAuthority(actors, callbacks, {
    impulse: (actor, impulse) => {
      const body = bodies.read(actor.id);
      if (body !== null) bodies.write(actor, { ...body, velocity: { x: body.velocity.x + impulse.x, y: body.velocity.y + impulse.y, z: body.velocity.z + impulse.z } });
      return undefined;
    }, beforeReaction: (actor, decision) => { if (actor.id === player.id && decision.reaction === "death") reaction.death(); return undefined; }, confirmed: outcome => { outcomes.push(outcome); return undefined; },
  });
  combat.register(createQ2CombatPolicy({ id: "q2:combat", context: request => ({ arithmetic: "binary64", player: request.target.equals(player.id), monster: !request.target.equals(player.id), attackerPlayer: request.attack.attacker?.equals(player.id) ?? false,
    hasEnemy: true, easySkill: false, deathmatch: false, defenderSphere: false, teamDamageEnabled: false, friendlyFire: true, nuke: false, noKnockback: false, movable: true, rejectTeamDamage: false, suppressPain: false }),
    armor: nativeVictimArmor(() => ({ screenFacingDot: 1, arithmetic: "binary64" })) }));
  const inventory = new SharedInventoryTable(actors);
  const player = actors.allocate("q3:character", "q3:sarge");
  bodies.create(player, { origin: zero, angles: zero, velocity: zero, bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } }, ground: null });
  combat.create(player, { health: 100, armor: { kind: "none" }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
  inventory.create(player, [{ item: "q3:weapon/railgun", count: 1, capacity: 1 }]);
  const primary = new PlayerState("baseq3"); primary.weapon = Weapon.WP_RAILGUN;
  const monsters = new Set<ActorId>();
  const tracing = { trace: clearTrace };
  const host: Q2FoundationHost = {
    actors, callbacks, bodies, combat, inventory,
    now: () => now, frameSeconds: () => frameSeconds, random: () => { randomCalls.push(0.5); return 0.5; }, schedule: () => undefined, touchTriggers: () => undefined,
    trace: request => tracing.trace(request), pointContents: () => 0, inPvs: () => true, inPhs: () => true, areasConnected: () => true,
    nearby: (origin, radius) => [...actors.ownedBy("q3:character"), ...actors.ownedBy("q2:game")].map(actor => actor.id).filter(actor => {
      const body = bodies.read(actor);
      return body !== null && Math.hypot(body.origin.x - origin.x, body.origin.y - origin.y, body.origin.z - origin.z) <= radius;
    }), players: () => [player.id], worldActor: () => world.id, isPlayer: actor => actor.equals(player.id), isMonster: actor => monsters.has(actor),
    inlineModelBounds: () => ({ min: zero, max: zero }), setSolid: () => undefined, setMotion: () => undefined, setAreaPortal: () => undefined,
    playerViewState: actor => actor.equals(player.id) ? { viewAngles: input.angles, oldVelocity: bodies.read(actor)?.velocity ?? zero } : null,
    keyConsumed: () => undefined, prepareLevelChange: () => undefined,
    emit: event => { presentation.push(event); return undefined; }, transition: () => undefined, diagnostic: message => { throw new Error(message); },
  };
  const game = new Q2EntityServices(host, { edition, mapName: "weapon-check", skill: 1, mode: "singleplayer", deathmatchFlags: 0, maxClients: 1,
    provider: "q2:game", campaign: "q2:campaign", combatProvider: "q2:combat", inventoryProvider: "q2:inventory", movementProvider: "q1:movement" }, []);
  const weapons = new Q2Weapons({ emit: event => { events.push(event); return undefined; }, noise: () => undefined, dodge: () => undefined,
    lagCompensation: { kind: "current-world" }, ammoChanged: () => undefined, canTarget: () => true });
  const equipment = new Q2HandGrenadeEquipment(game, weapons);
  equipment.configure(player.id, loadout);
  const project: HandGrenadeEquipmentInput["project"] = (angles, offset) => {
    const body = bodies.read(player.id);
    if (body === null) throw new Error("Missing test actor body");
    const axes = angleVectors(angles), eye = add(body.origin, { x: 0, y: 0, z: 22 });
    const start = add(add(eye, scale(axes.forward, offset.x)), scale(axes.right, offset.y));
    if (edition === "classic") return { start: add(start, { x: 0, y: 0, z: offset.z }), direction: axes.forward };
    const muzzle = add(start, scale(axes.up, offset.z));
    const trace = host.trace({ start: eye, end: add(eye, scale(axes.forward, 8192)), bounds: null, ignore: player.id, mask: 0x6000003 });
    return { start: muzzle, direction: normalize(subtract(trace.end, muzzle)) };
  };
  const handInput: HandGrenadeEquipmentInput = { angles: zero, gravity: 800, quadUntil: 0, doubleUntil: 0, quadFireUntil: 0,
    haste: false, noStackDouble: false, playersCollide: true, pressed: false, held: true, released: false, lifecycle: "alive", project };
  return { actors, bodies, combat, inventory, player, game, weapons, events, outcomes, presentation, tracing, monsters, callbacks, world, randomCalls, equipment, primary, handInput, reaction,
    step(seconds: number, update: Partial<HandGrenadeEquipmentInput> = {}) { now = seconds; equipment.step(player.id, { ...handInput, ...update }); },
    nativeStep(seconds: number, current = input) { now = seconds; const self = game.entity(player.id); if (self === null) throw new Error("Missing native test player"); weapons.tick(self, game, current); },
    advance(seconds: number) { now = seconds; for (const entity of [...game.entities.values()]) if (entity.nextThink !== null && entity.nextThink <= now) callbacks.think(entity.actor, { frame: Math.round(now * 10), time: { kind: "seconds", value: now }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" }); },
    target(x: number) {
      const target = game.create("monster_soldier");
      game.move(target, { origin: { x, y: 0, z: 0 }, bounds: { min: zero, max: zero } });
      combat.create(target.actor, { health: 500, armor: { kind: "none" }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
      monsters.add(target.actor.id);
      return target;
    },
  };
}

test("offhand action emits a real shared projectile with Q3 primary selected and no Q2 player record", () => {
  const f = fixture("classic"), victim = f.target(20);
  f.step(0, { pressed: true });
  expect(f.inventory.count(f.player.id, HAND_GRENADE_AMMO)).toBe(0);
  for (let frame = 1; frame <= 12; frame++) f.step(frame / 10, { held: false, released: frame === 1 });
  const grenade = [...f.game.entities.values()].find(entity => entity.classname === "hgrenade");
  if (grenade === undefined) throw new Error("No hand projectile");
  expect(grenade.owner).toBe(f.player.id);
  expect(f.game.entity(f.player.id)).toBeNull();
  expect(f.weapons.states.size).toBe(0);
  expect(f.primary.weapon).toBe(Weapon.WP_RAILGUN);
  f.callbacks.touch({ self: grenade.actor, other: victim.actor.id, plane, surface: null });
  expect(f.combat.read(victim.actor.id)?.health).toBeLessThan(500);
  expect(f.outcomes.some(outcome => outcome.kind === "committed" && outcome.decision.request.attack.attacker === f.player.id
    && outcome.decision.request.attack.weapon === HAND_GRENADE_AMMO)).toBe(true);
  expect(f.actors.isLive(grenade.actor.id)).toBe(false);
  expect(f.primary.weapon).toBe(Weapon.WP_RAILGUN);
  expect(f.inventory.count(f.player.id, HAND_GRENADE_AMMO)).toBe(0);
});

test("native grenade launcher and offhand compete for the same last unit before either admission", () => {
  for (const offhandFirst of [true, false]) {
    const f = fixture("classic"), self = f.game.attachPlayer(f.player);
    const state = f.weapons.bind(self, f.game, new Q2WeaponState("grenadelauncher"));
    state.phase = "ready"; state.frame = 17;
    if (offhandFirst) f.step(0, { pressed: true });
    f.nativeStep(0);
    if (!offhandFirst) f.step(0, { pressed: true });
    const launcherGrenades = [...f.game.entities.values()].filter(entity => entity.classname === "grenade");
    expect(launcherGrenades).toHaveLength(offhandFirst ? 0 : 1);
    expect(f.equipment.state(f.player.id)?.action.kind).toBe(offhandFirst ? "preparing" : "idle");
    expect(f.inventory.count(f.player.id, HAND_GRENADE_AMMO)).toBe(0);
  }
});

test("cooking checkpoint restores the debited shared inventory without replaying effects or allowance", () => {
  const original = fixture("rerelease");
  original.step(0, { pressed: true });
  for (let frame = 1; frame <= 10; frame++) original.step(frame / 10);
  const saved = decodeHandGrenadesCheckpoint(encodeHandGrenadesCheckpoint(original.equipment.capture()));
  expect(saved.actors[0]?.state.action.kind).toBe("cooking");
  const restored = fixture("rerelease");
  for (const entry of original.inventory.entries(original.player.id)) restored.inventory.configure(restored.player, entry);
  const effectsBefore = restored.presentation.length;
  restored.equipment.restore(saved);
  expect(restored.presentation).toHaveLength(effectsBefore);
  expect(restored.game.entities.size).toBe(0);
  expect(restored.inventory.count(restored.player.id, HAND_GRENADE_AMMO)).toBe(0);
  restored.equipment.configure(restored.player.id, loadout);
  expect(restored.equipment.state(restored.player.id)?.action.kind).toBe("cooking");
  restored.step(2, { held: false, released: true });
  const grenade = [...restored.game.entities.values()].find(entity => entity.classname === "hand_grenade");
  expect(grenade?.nextThink).toBe(4.2);
  expect(restored.inventory.count(restored.player.id, HAND_GRENADE_AMMO)).toBe(0);
  restored.step(2.1, { held: false });
  expect(restored.game.entities.size).toBe(1);
  const corrupt = { ...saved, actors: saved.actors.map(entry => ({ ...entry, state: { ...entry.state,
    action: { kind: "preparing", frame: 12, nextAt: 1, releaseQueued: false } } })) };
  expect(() => decodeHandGrenadesCheckpoint(encodeCheckpointValue(corrupt))).toThrow("hold frame");
});

test("overcook death reentry and actor release cannot emit twice or resurrect the equipment record", () => {
  for (const release of [false, true]) {
    const f = fixture("classic");
    let deaths = 0;
    f.reaction.death = () => {
      deaths++;
      f.equipment.step(f.player.id, { ...f.handInput, lifecycle: "dead" });
      if (release) f.actors.release(f.player);
      return undefined;
    };
    f.step(0, { pressed: true });
    for (let frame = 1; frame <= 11; frame++) f.step(frame / 10);
    const cooking = f.equipment.state(f.player.id)?.action;
    if (cooking?.kind !== "cooking") throw new Error("Expected a live fuse");
    f.step(cooking.expiresAt, { quadUntil: 10 });
    expect(deaths).toBe(1);
    expect(f.outcomes.filter(outcome => outcome.kind === "committed" && outcome.decision.request.target === f.player.id)).toHaveLength(1);
    expect(f.game.entities.size).toBe(0);
    if (release) expect(f.equipment.state(f.player.id)).toBeNull();
    else {
      expect(f.equipment.state(f.player.id)?.action.kind).toBe("disarmed");
      expect(f.inventory.count(f.player.id, HAND_GRENADE_AMMO)).toBe(0);
    }
  }
});

test("disable refunds only unprimed ammunition, pre-removal resolves primed ammunition, release cleanup is actor independent", () => {
  const unprimed = fixture("classic");
  unprimed.step(0, { pressed: true });
  unprimed.equipment.configure(unprimed.player.id, { ...loadout, enabled: false });
  unprimed.step(0.1);
  expect(unprimed.inventory.count(unprimed.player.id, HAND_GRENADE_AMMO)).toBe(1);
  const primed = fixture("rerelease");
  primed.step(0, { pressed: true });
  for (let frame = 1; frame <= 10; frame++) primed.step(frame / 10);
  expect(() => primed.equipment.configure(primed.player.id, { ...loadout, infiniteAmmo: true })).toThrow("reserved");
  primed.step(2, { lifecycle: "removing" });
  expect(primed.inventory.count(primed.player.id, HAND_GRENADE_AMMO)).toBe(0);
  expect([...primed.game.entities.values()][0]?.spawnflags).toBe(1);
  expect(() => primed.actors.release(primed.player)).not.toThrow();
  expect(primed.equipment.state(primed.player.id)).toBeNull();
  const removed = fixture("classic");
  removed.step(0, { pressed: true });
  expect(() => removed.actors.release(removed.player)).not.toThrow();
  expect(removed.equipment.state(removed.player.id)).toBeNull();
});

test("native hand grenade and offhand reserve the same last unit before cooking in either order", () => {
  for (const nativeFirst of [true, false]) {
    const f = fixture("classic"), self = f.game.attachPlayer(f.player);
    const native = f.weapons.bind(self, f.game, new Q2WeaponState("grenades"));
    native.phase = "ready"; native.frame = 16;
    if (nativeFirst) {
      f.nativeStep(0);
      for (let frame = 1; frame <= 11; frame++) f.nativeStep(frame / 10);
      f.step(1.1, { pressed: true });
      expect(f.equipment.state(f.player.id)?.action.kind).toBe("idle");
      expect(f.inventory.count(f.player.id, HAND_GRENADE_AMMO)).toBe(0);
      f.nativeStep(1.2, { ...input, attack: false });
      expect(() => f.nativeStep(1.3, { ...input, attack: false })).not.toThrow();
    } else {
      f.step(0, { pressed: true });
      f.nativeStep(0);
      expect(native.phase).toBe("ready");
      expect(f.equipment.state(f.player.id)?.action.kind).toBe("preparing");
      for (let frame = 1; frame <= 12; frame++) f.step(frame / 10, { held: false, released: frame === 1 });
    }
    expect([...f.game.entities.values()].filter(entity => entity.classname === "hgrenade")).toHaveLength(1);
    expect(f.inventory.count(f.player.id, HAND_GRENADE_AMMO)).toBe(0);
  }
});
