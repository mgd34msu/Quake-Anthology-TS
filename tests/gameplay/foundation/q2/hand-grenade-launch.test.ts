import { describe, expect, test } from "bun:test";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { ActorId } from "../../../../src/contracts/identity.ts";
import type { DamageOutcome } from "../../../../src/contracts/gameplay.ts";
import type { Vec3 } from "../../../../src/contracts/math.ts";
import type { TraceResult } from "../../../../src/contracts/scene.ts";
import { SessionActorRegistry, ActorCallbackTable, SharedBodyTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ2CombatPolicy, nativeVictimArmor } from "../../../../src/world/gameplay/index.ts";
import { Q2Foundation } from "../../../../src/content/q2/foundation/runtime.ts";
import type { Q2Edition, Q2FoundationHost, Q2PresentationEvent, Q2TraceRequest } from "../../../../src/content/q2/foundation/host.ts";
import { Q2Weapons } from "../../../../src/content/q2/foundation/weapons/index.ts";
import type { Q2WeaponEvent, Q2WeaponInput } from "../../../../src/content/q2/foundation/weapons/index.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };
const forward: Vec3 = { x: 1, y: 0, z: 0 };
const plane = { normal: { x: -1, y: 0, z: 0 }, distance: 0, type: 0, signbits: 1 };
function clearTrace(request: Q2TraceRequest): TraceResult {
  return { kind: "q2", fraction: 1, startSolid: false, allSolid: false, end: request.end, contact: { kind: "none" }, hit: { kind: "none" }, contents: 0, surface: null, sourcePlane: plane, secondary: null };
}

const input: Q2WeaponInput = {
  attack: true, latchedAttack: false, holster: false, angles: zero, ducked: false, spectator: false,
  notarget: false, hand: "right", animatePlayer: false, quadUntil: 0, doubleUntil: 0, quadFireUntil: 0,
  haste: false, noStackDouble: false, instantSwitch: false, quickSwitch: true, infiniteAmmo: false, playersCollide: true, gravity: 800, weaponThunk: false,
};

function fixture(edition: Q2Edition, frameSeconds = 0.1) {
  let now = 0;
  const randomCalls: number[] = [];
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
    }, beforeReaction: () => undefined, confirmed: outcome => { outcomes.push(outcome); return undefined; },
  });
  combat.register(createQ2CombatPolicy({ id: "q2:combat", context: request => ({ arithmetic: "binary64", player: request.target.equals(player.id), monster: !request.target.equals(player.id), attackerPlayer: request.attack.attacker?.equals(player.id) ?? false,
    hasEnemy: true, easySkill: false, deathmatch: false, defenderSphere: false, teamDamageEnabled: false, friendlyFire: true, nuke: false, noKnockback: false, movable: true, rejectTeamDamage: false, suppressPain: false }),
    armor: nativeVictimArmor(() => ({ screenFacingDot: 1, arithmetic: "binary64" })) }));
  const inventory = new SharedInventoryTable(actors);
  const player = actors.allocate("q3:character", "q3:sarge");
  bodies.create(player, { origin: zero, angles: zero, velocity: zero, bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } }, ground: null });
  combat.create(player, { health: 100, armor: { kind: "none" }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
  const monsters = new Set<ActorId>();
  const tracing = { trace: clearTrace };
  const host: Q2FoundationHost = {
    actors, callbacks, bodies, combat, inventory,
    now: () => now, gravity: () => 800, frameSeconds: () => frameSeconds, random: () => { randomCalls.push(0.5); return 0.5; }, schedule: () => undefined, touchTriggers: () => undefined,
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
  const game = new Q2Foundation(host, { edition, mapName: "weapon-check", skill: 1, mode: "singleplayer", deathmatchFlags: 0, maxClients: 1,
    provider: "q2:game", campaign: "q2:campaign", combatProvider: "q2:combat", inventoryProvider: "q2:inventory", movementProvider: "q1:movement" }, []);
  const weapons = new Q2Weapons({ emit: event => { events.push(event); return undefined; }, noise: () => undefined, dodge: () => undefined,
    lagCompensation: { kind: "current-world" }, ammoChanged: () => undefined, canTarget: () => true });
  return { actors, bodies, combat, inventory, player, game, weapons, events, outcomes, presentation, tracing, monsters, callbacks, world, randomCalls,
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

const launch = { start: { x: 50, y: 0, z: 0 }, direction: forward, damage: 125, speed: 400, timer: 1, radius: 165, held: false, gravity: 400, playersCollide: false };

describe("hand grenades launched by shared actor identity", () => {
  test("foreign thrower has no Q2 entity or weapon state and fuse uses shared combat and cleanup", () => {
    for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) {
      const scene = fixture(edition), target = scene.target(60);
      const grenade = scene.weapons.fireHandGrenade(scene.player.id, scene.game, launch);
      expect(scene.game.entity(scene.player.id)).toBeNull();
      expect(scene.weapons.states.size).toBe(0);
      expect(grenade.owner).toBe(scene.player.id);
      expect(scene.game.body(grenade).velocity).toEqual({ x: 400, y: 0, z: edition === "classic" ? 200 : 100 });
      expect(grenade.clipMask).toBe(edition === "classic" ? 100663299 : 100679683);
      expect(grenade.nextThink).toBe(1);
      expect(scene.randomCalls).toHaveLength(edition === "classic" ? 2 : 5);
      scene.advance(0.9);
      expect(scene.actors.isLive(grenade.actor.id)).toBe(true);
      scene.advance(1);
      expect(scene.combat.read(target.actor.id)?.health).toBeLessThan(500);
      expect(scene.outcomes.some(outcome => outcome.kind === "committed" && outcome.decision.request.attack.attacker === scene.player.id)).toBe(true);
      expect(scene.weapons.noises.get(scene.player.id)?.secondary?.actor).toBe(scene.player.id);
      expect(scene.actors.isLive(grenade.actor.id)).toBe(false);
      expect(scene.bodies.read(grenade.actor.id)).toBeNull();
      expect(scene.game.entity(grenade.actor.id)).toBeNull();
      scene.actors.close();
    }
  });

  test("touch bounces, direct impact damages once and excludes direct victim from splash", () => {
    const scene = fixture("rerelease"), direct = scene.target(50), splash = scene.target(70);
    const grenade = scene.weapons.fireHandGrenade(scene.player.id, scene.game, launch);
    scene.callbacks.touch({ self: grenade.actor, other: scene.player.id, plane, surface: null });
    expect(scene.actors.isLive(grenade.actor.id)).toBe(true);
    scene.callbacks.touch({ self: grenade.actor, other: scene.world.id, plane, surface: null });
    expect(scene.presentation.some(event => event.kind === "sound" && event.path === "weapons/hgrenb2a.wav")).toBe(true);
    scene.callbacks.touch({ self: grenade.actor, other: direct.actor.id, plane, surface: null });
    expect(scene.combat.read(direct.actor.id)?.health).toBe(375);
    expect(scene.combat.read(splash.actor.id)?.health).toBeLessThan(500);
    expect(scene.outcomes.filter(outcome => outcome.kind === "committed" && outcome.decision.request.target === direct.actor.id)).toHaveLength(1);
    expect(scene.bodies.read(grenade.actor.id)).toBeNull();
    scene.advance(1);
    expect(scene.outcomes.filter(outcome => outcome.kind === "committed" && outcome.decision.request.target === direct.actor.id)).toHaveLength(1);
    scene.actors.close();
  });

  test("native launcher delegates identical launch and immediate held expiry", () => {
    for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) {
      const scene = fixture(edition), self = scene.game.attachPlayer(scene.player);
      scene.weapons.inputs.set(scene.player.id, { ...input, gravity: launch.gravity, playersCollide: launch.playersCollide });
      const native = scene.weapons.fireGrenade(self, scene.game, launch.start, launch.direction, launch.damage, launch.speed, launch.timer, launch.radius, true);
      const shared = scene.weapons.fireHandGrenade(scene.player.id, scene.game, launch);
      expect(scene.game.body(native)).toEqual(scene.game.body(shared));
      expect(native.angularVelocity).toEqual(shared.angularVelocity);
      expect(native.clipMask).toBe(shared.clipMask);
      expect(native.touch).toBe(shared.touch);
      expect(native.think).toBe(shared.think);
      const held = scene.weapons.fireHandGrenade(scene.player.id, scene.game, { ...launch, timer: 0, held: true });
      expect(scene.actors.isLive(held.actor.id)).toBe(false);
      scene.actors.close();
    }
  });
});
