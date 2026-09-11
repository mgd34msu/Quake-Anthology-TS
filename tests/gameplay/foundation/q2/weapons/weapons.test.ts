import { describe, expect, test } from "bun:test";
import { createIdentityOwner } from "../../../../../src/contracts/identity.ts";
import type { ActorId } from "../../../../../src/contracts/identity.ts";
import type { DamageOutcome, InventoryEntry } from "../../../../../src/contracts/gameplay.ts";
import type { Vec3 } from "../../../../../src/contracts/math.ts";
import type { TraceResult } from "../../../../../src/contracts/scene.ts";
import { SessionActorRegistry, ActorCallbackTable, SharedBodyTable, translatedBodyBounds } from "../../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ2CombatPolicy, nativeVictimArmor } from "../../../../../src/world/gameplay/index.ts";
import { Q2Foundation } from "../../../../../src/content/q2/foundation/runtime.ts";
import type { Q2Edition, Q2FoundationHost, Q2PresentationEvent, Q2TraceRequest } from "../../../../../src/content/q2/foundation/host.ts";
import { Q2Weapons, Q2WeaponState, Q2_BASE_WEAPONS } from "../../../../../src/content/q2/foundation/weapons/index.ts";
import type { Q2WeaponEvent, Q2WeaponInput, Q2WeaponName } from "../../../../../src/content/q2/foundation/weapons/index.ts";

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

function fixture(edition: Q2Edition, name: Q2WeaponName = "blaster", frameSeconds = 0.1) {
  let now = 0;
  const actors = new SessionActorRegistry(createIdentityOwner(`q2-weapons-${edition}-${name}`));
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
  const ammo: readonly InventoryEntry[] = ["shells", "bullets", "grenades", "rockets", "cells", "slugs"].map(kind => ({ item: `q2:ammo_${kind}`, count: 200, capacity: 200 }));
  inventory.create(player, [...ammo, ...Q2_BASE_WEAPONS.filter(weapon => weapon.name !== "grenades").map(weapon => ({ item: weapon.item, count: 1, capacity: 1 }))]);
  const monsters = new Set<ActorId>();
  const tracing = { trace: clearTrace };
  const host: Q2FoundationHost = {
    actors, callbacks, bodies, combat, inventory,
    now: () => now, frameSeconds: () => frameSeconds, random: () => 0.5, schedule: () => undefined, touchTriggers: () => undefined,
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
  const self = game.attachPlayer(player);
  const weapons = new Q2Weapons({ emit: event => { events.push(event); return undefined; }, noise: () => undefined, dodge: () => undefined,
    lagCompensation: { kind: "current-world" }, ammoChanged: () => undefined, canTarget: () => true });
  const state = weapons.bind(self, game, new Q2WeaponState(name));
  const definition = Q2_BASE_WEAPONS.find(weapon => weapon.name === name);
  if (definition === undefined) throw new Error("Missing base weapon");
  state.phase = "ready"; state.frame = definition.fireLast + 1;
  return { actors, bodies, combat, inventory, player, self, game, weapons, state, events, outcomes, presentation, tracing, monsters,
    step(seconds: number, current: Q2WeaponInput = input) { now = seconds; weapons.tick(self, game, current); },
    target(x: number) {
      const target = game.create("monster_soldier");
      game.move(target, { origin: { x, y: 0, z: 0 }, bounds: { min: zero, max: zero } });
      combat.create(target.actor, { health: 500, armor: { kind: "none" }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
      monsters.add(target.actor.id);
      return target;
    },
  };
}

describe("Q2 base weapons on shared state", () => {
  test("classic and rerelease fire real blaster actors at their own cadence for a Q3 character", () => {
    for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) {
      const scene = fixture(edition, "blaster", 0.025);
      scene.step(0);
      const bolt = [...scene.game.entities.values()].find(entity => entity.classname === "bolt");
      if (bolt === undefined) throw new Error("Blaster did not create its projectile");
      const velocity = scene.game.body(bolt).velocity;
      expect(Math.round(Math.hypot(velocity.x, velocity.y, velocity.z))).toBe(edition === "classic" ? 1000 : 1500);
      expect(bolt.damage).toBe(edition === "classic" ? 10 : 15);
      expect(scene.state.frame).toBe(edition === "classic" ? 6 : 5);
      if (edition === "rerelease") {
        scene.step(0.025); expect(scene.state.frame).toBe(5);
        scene.step(0.1); expect(scene.state.frame).toBe(6);
        scene.step(0.2); expect(scene.state.frame).toBe(7);
        scene.step(0.3); expect(scene.state.frame).toBe(8);
      }
      expect(scene.events.some(event => event.kind === "muzzleflash")).toBe(true);
      expect(scene.events.some(event => event.kind === "player-animation")).toBe(false);
      expect(scene.player.owner).toBe("q3:character");
      scene.actors.close();
    }
  });

  test("all ammo weapons reach actual firing from ready and consume the shared inventory", () => {
    for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) for (const definition of Q2_BASE_WEAPONS) {
      if (definition.ammo === null) continue;
      const scene = fixture(edition, definition.name);
      for (let frame = 0; frame < 24; frame++) scene.step(frame / 10, { ...input, attack: definition.name !== "grenades" || frame < 13 });
      expect(scene.inventory.count(scene.player.id, definition.ammo)).toBeLessThan(200);
      if (definition.name !== "grenades") expect(scene.events.some(event => event.kind === "muzzleflash")).toBe(true);
      scene.actors.close();
    }
  });

  test("BFG windup rechecks cells spent by power armor before launching", () => {
    const scene = fixture("rerelease", "bfg");
    scene.step(0);
    expect(scene.events.filter(event => event.kind === "muzzleflash")).toHaveLength(1);
    scene.inventory.consume(scene.player, "q2:ammo_cells", 160);
    for (let frame = 1; frame < 12; frame++) scene.step(frame / 10);
    expect([...scene.game.entities.values()].filter(entity => entity.classname === "bfg blast")).toHaveLength(0);
    expect(scene.inventory.count(scene.player.id, "q2:ammo_cells")).toBe(40);
    scene.actors.close();
  });

  test("rocket impact commits direct and splash once with weapon provenance", () => {
    const scene = fixture("rerelease"), direct = scene.target(100), splash = scene.target(130);
    const rocket = scene.weapons.fireRocket(scene.self, scene.game, { x: 100, y: 0, z: 0 }, forward, 100, 650, 120, 120);
    rocket.touch?.(rocket, scene.game, { self: rocket.actor, other: direct.actor.id, plane, surface: null });
    expect(scene.combat.read(direct.actor.id)?.health).toBe(400);
    expect(scene.combat.read(splash.actor.id)?.health).toBe(395);
    expect(scene.actors.isLive(rocket.actor.id)).toBe(false);
    const committed = scene.outcomes.filter(outcome => outcome.kind === "committed");
    expect(committed.every(outcome => outcome.decision.request.attack.weapon === "q2:weapon_rocketlauncher")).toBe(true);
    expect(committed.filter(outcome => outcome.decision.request.target.equals(direct.actor.id))).toHaveLength(1);
    scene.actors.close();
  });

  test("rerelease rail piercing damages two actors without changing their solidity", () => {
    const scene = fixture("rerelease"), first = scene.target(100), second = scene.target(200);
    scene.game.solid(first, "box"); scene.game.solid(second, "box");
    scene.tracing.trace = request => {
      const target = [first, second].find(entity => !request.exclude?.includes(entity.actor.id) && request.ignore !== entity.actor.id);
      if (target === undefined) return clearTrace(request);
      return { ...clearTrace(request), fraction: scene.game.body(target).origin.x / request.end.x, end: scene.game.body(target).origin, hit: { kind: "actor", actor: target.actor.id }, contact: { kind: "plane", plane } };
    };
    scene.weapons.fireRail(scene.self, scene.game, zero, forward, 100, 200);
    expect(scene.combat.read(first.actor.id)?.health).toBe(400);
    expect(scene.combat.read(second.actor.id)?.health).toBe(400);
    expect(first.solid).toBe("box"); expect(second.solid).toBe("box");
    expect(scene.outcomes.filter(outcome => outcome.kind === "committed")).toHaveLength(2);
    scene.actors.close();
  });
});
