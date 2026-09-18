import { Q2MissionPackProjectiles } from "../../../../../src/content/q2/missionpacks/projectiles/index.ts";
import type { WeaponBehaviorLaunch, WeaponBehaviorProjectilePort } from "../../../../../src/contracts/weapon-behavior.ts";
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

import { encodeQ2WeaponsCheckpoint, decodeQ2WeaponsCheckpoint, readQ2WeaponState } from "../../../../../src/persistence/q2-weapons.ts";
import { projectQ2Actor } from "../../../../../src/content/q2/foundation/weapons/projection.ts";
import { SaveReader } from "../../../../../src/persistence/value.ts";

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

function fixture(edition: Q2Edition, name: Q2WeaponName = "blaster", frameSeconds = 0.1, infiniteAmmo = false, mode: "singleplayer" | "deathmatch" = "singleplayer", weaponBehavior?: WeaponBehaviorProjectilePort) {
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
    actors, callbacks, bodies, combat, inventory, ...(weaponBehavior === undefined ? {} : { weaponBehavior }),
    now: () => now, gravity: () => 800, frameSeconds: () => frameSeconds, random: () => 0.5, schedule: () => undefined, touchTriggers: () => undefined,
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
  const game = new Q2Foundation(host, { edition, mapName: "weapon-check", skill: 1, mode, deathmatchFlags: infiniteAmmo ? 8192 : 0, maxClients: 1,
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
  test("external handoff uses native drop and saved raise without replacing the selected name", () => {
    for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) {
      const scene = fixture(edition);
      scene.state.pending = "shotgun";
      scene.weapons.requestHolster(scene.self); scene.weapons.requestHolster(scene.self);
      expect(scene.state.pending).toBeNull(); expect(scene.state.weapon).toBe("blaster");
      scene.step(0); expect(scene.state.frame).toBe(53); expect(scene.weapons.isHolstered(scene.self)).toBe(false);
      scene.step(0.1); expect(scene.state.frame).toBe(54);
      const saved = decodeQ2WeaponsCheckpoint(encodeQ2WeaponsCheckpoint(scene.weapons.capture(scene.game)));
      scene.weapons.restore(scene.game, saved);
      scene.step(0.2); scene.step(0.3);
      expect(scene.weapons.isHolstered(scene.self)).toBe(true);
      const state = scene.weapons.states.get(scene.player.id);
      if (state === undefined) throw new Error("Missing restored primary");
      expect(state.weapon).toBe("blaster"); expect(state.frame).toBe(55);
      expect(decodeQ2WeaponsCheckpoint(encodeQ2WeaponsCheckpoint(scene.weapons.capture(scene.game))).states[0]?.state.primaryHandoff).toBe("holstered");
      scene.step(4); expect([...scene.game.entities.values()].filter(entity => entity.classname === "bolt")).toHaveLength(0);
      scene.weapons.resumePrimary(scene.self, scene.game, { ...input, attack: false }, null);
      expect(state.primaryHandoff).toBe("active"); expect(state.phase).toBe("activating"); expect(state.frame).toBe(0);
      scene.weapons.resumePrimary(scene.self, scene.game, { ...input, attack: false }, null);
      for (let frame = 41; frame <= 46; frame++) scene.step(frame / 10, { ...input, attack: false });
      expect(state.phase).toBe("ready"); expect(state.weapon).toBe("blaster");
    }
  });

  test("external rerelease request completes despite held holster and honors instant switching", () => {
    for (const instantSwitch of [false, true]) {
      const scene = fixture("rerelease"); scene.weapons.requestHolster(scene.self);
      scene.step(0, { ...input, holster: true, instantSwitch });
      expect(scene.weapons.isHolstered(scene.self)).toBe(instantSwitch);
      for (let frame = 1; frame <= 4; frame++) scene.step(frame / 10, { ...input, holster: true, instantSwitch });
      expect(scene.weapons.isHolstered(scene.self)).toBe(true);
      scene.weapons.resumePrimary(scene.self, scene.game, { ...input, attack: false, holster: true, instantSwitch }, "missing-primary");
      expect(scene.state.primaryHandoff).toBe("active"); expect(scene.state.weapon).toBe("railgun");
    }
  });

  test("external request ends repeating native fire while its original attack input stays held", () => {
    for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) for (const name of ["machinegun", "hyperblaster", "chaingun"]) {
      const scene = fixture(edition, name);
      scene.step(0); scene.weapons.requestHolster(scene.self);
      for (let frame = 1; frame <= 70 && !scene.weapons.isHolstered(scene.self); frame++) scene.step(frame / 10);
      expect(scene.weapons.isHolstered(scene.self)).toBe(true); expect(scene.state.weapon).toBe(name);
      const count = scene.events.filter(event => event.kind === "muzzleflash").length;
      scene.step(8); scene.step(9);
      expect(scene.events.filter(event => event.kind === "muzzleflash")).toHaveLength(count);
    }
  });

  test("external handoff cancels preparation or settles a primed reservation exactly once", () => {
    for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) for (const primed of [false, true]) {
      const scene = fixture(edition, "grenades"); scene.inventory.consume(scene.player, "q2:ammo_grenades", 199);
      scene.step(0);
      if (primed) for (let frame = 1; frame <= 11; frame++) scene.step(frame / 10);
      scene.weapons.requestHolster(scene.self); scene.step(1.2);
      expect(scene.weapons.isHolstered(scene.self)).toBe(true); expect(scene.state.weapon).toBe("grenades");
      expect(scene.state.handReservation.kind).toBe("none");
      expect(scene.inventory.count(scene.player.id, "q2:ammo_grenades")).toBe(primed ? 0 : 1);
      const emitted = () => [...scene.game.entities.values()].filter(entity => entity.classname === "hgrenade" || entity.classname === "hand_grenade").length
        + scene.presentation.filter(event => event.kind === "effect" && event.effect.includes("explosion")).length;
      expect(emitted()).toBe(primed ? 1 : 0); scene.step(1.3); expect(emitted()).toBe(primed ? 1 : 0);
    }
  });

  test("external drop finishes committed BFG emission and cannot duplicate a lethal held grenade", () => {
    for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) {
      const charged = fixture(edition, "bfg"); charged.step(0); charged.weapons.requestHolster(charged.self);
      for (let frame = 1; frame <= 80 && !charged.weapons.isHolstered(charged.self); frame++) charged.step(frame / 10);
      expect(charged.weapons.isHolstered(charged.self)).toBe(true);
      expect([...charged.game.entities.values()].filter(entity => entity.classname === "bfg blast")).toHaveLength(1);
      expect(charged.inventory.count(charged.player.id, "q2:ammo_cells")).toBe(150);
      const grenade = fixture(edition, "grenades"); grenade.combat.setHealth(grenade.player, 1);
      grenade.self.die = () => grenade.weapons.tick(grenade.self, grenade.game, input);
      for (let frame = 0; frame <= 11; frame++) grenade.step(frame / 10);
      grenade.weapons.requestHolster(grenade.self); grenade.step(1.2);
      expect(grenade.state.handReservation.kind).toBe("none");
      expect(grenade.inventory.count(grenade.player.id, "q2:ammo_grenades")).toBe(199);
      expect(grenade.presentation.filter(event => event.kind === "effect" && event.effect.includes("explosion"))).toHaveLength(edition === "classic" ? 1 : 0);
      if (edition === "classic") { expect(grenade.state.weapon).toBeNull(); expect(grenade.weapons.isHolstered(grenade.self)).toBe(false); }
    }
  });

  test("actor projection preserves native handedness, pitch and rerelease aim without a source entity", () => {
    for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) {
      const scene = fixture(edition), foreign = scene.actors.allocate("q1:character", "q1:player");
      scene.bodies.create(foreign, scene.game.body(scene.self));
      expect(scene.game.entity(foreign.id)).toBeNull();
      for (const hand of ["left", "center", "right"] satisfies readonly Q2WeaponInput["hand"][]) {
        const view = { hand, viewHeight: scene.self.viewHeight, playersCollide: true }, offset = { x: 8, y: 8, z: -8 };
        const projected = projectQ2Actor(foreign.id, scene.game, view, zero, offset);
        expect(projected).toEqual(scene.weapons.projectSource(scene.self, scene.game, { ...input, hand }, zero, offset));
        expect(projected.start).toEqual({ x: 8, y: hand === "left" ? 8 : hand === "center" ? 0 : -8, z: scene.self.viewHeight - 8 });
        const pitched = projectQ2Actor(foreign.id, scene.game, view, { x: 45, y: 0, z: 0 }, offset);
        expect(pitched.start.x).toBeCloseTo(edition === "classic" ? 8 * Math.SQRT1_2 : 0, 10);
        expect(pitched.start.z).toBeCloseTo(scene.self.viewHeight - (edition === "classic" ? 8 + 8 * Math.SQRT1_2 : 16 * Math.SQRT1_2), 10);
        if (edition === "classic") expect(pitched.direction.z).toBeCloseTo(-Math.SQRT1_2, 10);
      }
    }
  });

  test("rerelease projection preserves cached native collision policy and close-target aim", () => {
    const scene = fixture("rerelease"), requests: Q2TraceRequest[] = [];
    scene.step(0, { ...input, attack: false, playersCollide: false });
    scene.tracing.trace = request => { requests.push(request); return clearTrace(request); };
    const offset = { x: 8, y: 8, z: -8 };
    scene.weapons.projectSource(scene.self, scene.game, { ...input, playersCollide: true }, zero, offset);
    expect(requests[0]?.mask).toBe(0x02004003);
    expect(requests[0]?.ignore).toBe(scene.player.id);
    const view = { hand: input.hand, viewHeight: scene.self.viewHeight, playersCollide: true };
    const aimed = projectQ2Actor(scene.player.id, scene.game, view, zero, offset);
    expect(requests[1]?.mask).toBe(0x42004003);
    expect(aimed.direction.y).toBeGreaterThan(0);
    scene.tracing.trace = request => {
      const trace = clearTrace(request);
      if (trace.kind !== "q2") throw new Error("Expected Q2 trace fixture");
      return { ...trace, contents: 0x2000000, fraction: 0.01 };
    };
    expect(projectQ2Actor(scene.player.id, scene.game, view, zero, offset).direction).toEqual({ x: 1, y: 0, z: -0 });
    scene.tracing.trace = request => ({ ...clearTrace(request), startSolid: true });
    expect(projectQ2Actor(scene.player.id, scene.game, view, zero, offset).direction).toEqual({ x: 1, y: 0, z: -0 });
  });

  test("native hand preparation reserves the last unit and cancellation refunds only before cooking", () => {
    for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) for (const refill of [false, true]) {
      const scene = fixture(edition, "grenades");
      scene.inventory.consume(scene.player, "q2:ammo_grenades", 199);
      scene.step(0);
      expect(scene.state.handReservation.kind).toBe("finite");
      expect(scene.inventory.count(scene.player.id, "q2:ammo_grenades")).toBe(0);
      if (refill) scene.inventory.give(scene.player, "q2:ammo_grenades", 200);
      scene.state.pending = "blaster";
      scene.weapons.changeWeapon(scene.self, scene.game, scene.state, { ...input, attack: false });
      expect(scene.state.handReservation.kind).toBe("none");
      expect(scene.inventory.count(scene.player.id, "q2:ammo_grenades")).toBe(refill ? 201 : 1);
      expect([...scene.game.entities.values()].some(entity => (entity.classname === "hgrenade" || entity.classname === "hand_grenade"))).toBe(false);
      scene.weapons.changeWeapon(scene.self, scene.game, scene.state, { ...input, attack: false });
      expect(scene.inventory.count(scene.player.id, "q2:ammo_grenades")).toBe(refill ? 201 : 1);
    }
  });

  test("primed native weapon change and death each resolve one reserved grenade", () => {
    for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) for (const dead of [false, true]) {
      const scene = fixture(edition, "grenades");
      scene.inventory.consume(scene.player, "q2:ammo_grenades", 199);
      for (let frame = 0; frame <= 11; frame++) scene.step(frame / 10);
      expect(scene.state.grenadeTime).toBeGreaterThan(1.1);
      if (dead) { scene.combat.setHealth(scene.player, 0); scene.step(1.2); }
      else { scene.state.pending = "blaster"; scene.weapons.changeWeapon(scene.self, scene.game, scene.state, { ...input, attack: false }); }
      expect(scene.state.handReservation.kind).toBe("none");
      expect(scene.inventory.count(scene.player.id, "q2:ammo_grenades")).toBe(0);
      const emitted = () => [...scene.game.entities.values()].filter(entity => (entity.classname === "hgrenade" || entity.classname === "hand_grenade")).length
        + scene.presentation.filter(event => event.kind === "effect" && event.effect.includes("explosion")).length;
      expect(emitted()).toBe(1);
      scene.step(1.3, { ...input, attack: false });
      expect(emitted()).toBe(1);
    }
  });

  test("overcook commits native reservation before lethal damage reenters weapon processing", () => {
    for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) {
      const scene = fixture(edition, "grenades");
      scene.inventory.consume(scene.player, "q2:ammo_grenades", 199);
      scene.combat.setHealth(scene.player, 1);
      let reactions = 0;
      scene.self.die = () => { reactions++; scene.weapons.tick(scene.self, scene.game, input); return undefined; };
      for (let frame = 0; frame <= 11; frame++) scene.step(frame / 10);
      scene.step(scene.state.grenadeTime + 0.1);
      expect(reactions).toBe(1);
      expect(scene.state.handReservation.kind).toBe("none");
      expect(scene.inventory.count(scene.player.id, "q2:ammo_grenades")).toBe(0);
      expect(scene.presentation.filter(event => event.kind === "effect" && event.effect.includes("explosion"))).toHaveLength(1);
      expect([...scene.game.entities.values()].filter(entity => (entity.classname === "hgrenade" || entity.classname === "hand_grenade"))).toHaveLength(0);
      expect(scene.state.weapon).toBeNull();
      expect(scene.state.grenadeBlewUp).toBe(false);
    }
  });

  test("native hand save restores the reservation without another debit and validates legacy ownership", () => {
    for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) {
      const scene = fixture(edition, "grenades");
      scene.inventory.consume(scene.player, "q2:ammo_grenades", 199);
      for (let frame = 0; frame <= 11; frame++) scene.step(frame / 10);
      const saved = decodeQ2WeaponsCheckpoint(encodeQ2WeaponsCheckpoint(scene.weapons.capture(scene.game)));
      scene.weapons.restore(scene.game, saved);
      expect(scene.inventory.count(scene.player.id, "q2:ammo_grenades")).toBe(0);
      expect(scene.weapons.states.get(scene.player.id)?.handReservation.kind).toBe("finite");
      scene.step(1.2, { ...input, attack: false }); scene.step(1.3, { ...input, attack: false });
      expect([...scene.game.entities.values()].filter(entity => (entity.classname === "hgrenade" || entity.classname === "hand_grenade"))).toHaveLength(1);
      expect(scene.inventory.count(scene.player.id, "q2:ammo_grenades")).toBe(0);
      const { handReservation, ...legacy } = scene.state;
      expect(handReservation.kind).toBe("finite");
      expect(() => readQ2WeaponState(new SaveReader(legacy))).toThrow("legacy active hand grenade");
      expect(readQ2WeaponState(new SaveReader({ ...legacy, phase: "ready" })).handReservation.kind).toBe("none");
      expect(() => readQ2WeaponState(new SaveReader({ ...legacy, handReservation: { kind: "invalid" } }))).toThrow();
    }
  });

  test("native infinite hand reservation keeps its admission policy through release", () => {
    for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) {
      const scene = fixture(edition, "grenades", 0.1, true);
      for (let frame = 0; frame <= 11; frame++) scene.step(frame / 10, { ...input, infiniteAmmo: true });
      expect(scene.state.handReservation.kind).toBe("infinite");
      scene.step(1.2, { ...input, attack: false }); scene.step(1.3, { ...input, attack: false });
      expect(scene.state.handReservation.kind).toBe("none");
      expect(scene.inventory.count(scene.player.id, "q2:ammo_grenades")).toBe(200);
      expect([...scene.game.entities.values()].filter(entity => (entity.classname === "hgrenade" || entity.classname === "hand_grenade"))).toHaveLength(1);
    }
  });

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


test("foreign Q2 noise owns silencer charges without a native weapon and restores by ActorId", () => {
  const scene = fixture("classic"), noises: boolean[] = [];
  const weapons = new Q2Weapons({ ...scene.weapons.hooks, noise: (_actor, _origin, secondary) => { noises.push(secondary); return undefined; } });
  weapons.grantSilencer(scene.player.id, scene.game, 2);
  expect(weapons.states.size).toBe(0);
  weapons.playerNoiseForActor(scene.player.id, scene.game, zero, "impact");
  expect(weapons.silencerShots(scene.player.id)).toBe(2); expect(noises).toEqual([true]);
  weapons.playerNoiseForActor(scene.player.id, scene.game, zero, "weapon");
  expect(weapons.silencerShots(scene.player.id)).toBe(1); expect(noises).toEqual([true]);
  const saved = decodeQ2WeaponsCheckpoint(encodeQ2WeaponsCheckpoint(weapons.capture(scene.game)));
  expect(saved.formatVersion).toBe(2); expect(saved.states).toEqual([]);
  const restored = new Q2Weapons(weapons.hooks); restored.restore(scene.game, saved);
  expect(restored.silencerShots(scene.player.id)).toBe(1); expect(restored.states.size).toBe(0);
  restored.playerNoiseForActor(scene.player.id, scene.game, zero, "weapon");
  expect(restored.silencerShots(scene.player.id)).toBe(0); expect(noises).toEqual([true]);
  restored.playerNoiseForActor(scene.player.id, scene.game, zero, "weapon"); expect(noises).toEqual([true, false]);
  restored.grantSilencer(scene.player.id, scene.game, 30); restored.resetSilencer(scene.player.id); expect(restored.silencerShots(scene.player.id)).toBe(0);
  restored.grantSilencer(scene.player.id, scene.game, 30); scene.actors.release(scene.player);
  expect(restored.silencerShots(scene.player.id)).toBe(0); expect(weapons.silencerShots(scene.player.id)).toBe(0);
});

test("native last silencer charge is captured before weapon noise debits it", () => {
  const scene = fixture("classic");
  scene.weapons.grantSilencer(scene.player.id, scene.game, 1);
  scene.step(0); scene.step(0.1);
  const flash = scene.events.find(event => event.kind === "muzzleflash");
  expect(flash?.kind === "muzzleflash" && flash.silenced).toBe(true);
  expect(scene.weapons.silencerShots(scene.player.id)).toBe(0);
  const saved = decodeQ2WeaponsCheckpoint(encodeQ2WeaponsCheckpoint(scene.weapons.capture(scene.game)));
  expect(saved.states[0]?.state).not.toHaveProperty("silencerShots");
});


test("silencer debit precedes deathmatch and notarget noise suppression", () => {
  for (const mode of ["singleplayer", "deathmatch"] satisfies readonly ("singleplayer" | "deathmatch")[]) {
    const scene = fixture("classic", "blaster", 0.1, false, mode), noises: boolean[] = [];
    const weapons = new Q2Weapons({ ...scene.weapons.hooks, noise: (_actor, _origin, secondary) => { noises.push(secondary); return undefined; } });
    weapons.grantSilencer(scene.player.id, scene.game, 2);
    weapons.inputs.set(scene.player.id, { ...input, notarget: true });
    weapons.playerNoiseForActor(scene.player.id, scene.game, zero, "weapon");
    expect(weapons.silencerShots(scene.player.id)).toBe(1); expect(noises).toEqual([]);
    weapons.playerNoiseForActor(scene.player.id, scene.game, zero, "self");
    expect(weapons.silencerShots(scene.player.id)).toBe(1); expect(noises).toEqual([]);
    weapons.bind(scene.self, scene.game);
    expect(weapons.silencerShots(scene.player.id)).toBe(0);
  }
});

test("foreign weapon noise observes live Q2 notarget without native weapon input", () => {
  const scene = fixture("classic"), noises: boolean[] = [];
  const weapons = new Q2Weapons({ ...scene.weapons.hooks, noise: (_actor, _origin, secondary) => { noises.push(secondary); return undefined; } });
  scene.self.flags |= 32;
  weapons.grantSilencer(scene.player.id, scene.game, 1);
  weapons.playerNoiseForActor(scene.player.id, scene.game, zero, "weapon");
  expect(weapons.silencerShots(scene.player.id)).toBe(0);
  for (const kind of ["self", "weapon", "impact"] satisfies readonly ("self" | "weapon" | "impact")[]) weapons.playerNoiseForActor(scene.player.id, scene.game, zero, kind);
  expect(weapons.inputs.size).toBe(0); expect(weapons.states.size).toBe(0); expect(noises).toEqual([]);
  scene.self.flags &= ~32;
  weapons.playerNoiseForActor(scene.player.id, scene.game, zero, "weapon");
  weapons.playerNoiseForActor(scene.player.id, scene.game, zero, "impact");
  expect(noises).toEqual([false, true]);
  scene.actors.close();
});

test("Q2 weapon ownership fires and restores without a source player entity", () => {
  const scene = fixture("classic");
  const actor = scene.actors.allocate("q1:character", "q1:player");
  const body = scene.bodies.read(scene.player.id);
  if (body === null) throw new Error("Missing shared body");
  scene.bodies.create(actor, { ...body, origin: { x: 128, y: 0, z: 0 } });
  scene.combat.create(actor, { health: 100, armor: { kind: "none" }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
  scene.inventory.create(actor, scene.inventory.entries(scene.player.id));
  const owner = { actor, viewHeight: 22 }, weapons = new Q2Weapons(scene.weapons.hooks);
  const state = weapons.bind(owner, scene.game, new Q2WeaponState("blaster"));
  state.phase = "ready"; state.frame = 9;
  expect(scene.game.entity(actor.id)).toBeNull();
  weapons.tick(owner, scene.game, input); weapons.tick(owner, scene.game, input);
  expect([...scene.game.entities.values()].some(entity => entity.classname === "bolt" && entity.owner === actor.id)).toBe(true);
  const saved = decodeQ2WeaponsCheckpoint(encodeQ2WeaponsCheckpoint(weapons.capture(scene.game)));
  const restored = weapons; restored.restore(scene.game, saved);
  expect(restored.states.get(actor.id)).toEqual(state);
  expect(scene.game.entity(actor.id)).toBeNull();
  scene.actors.release(actor); expect(restored.states.has(actor.id)).toBe(false);
  scene.actors.close();
});


test("BFG explosion requires owner visibility for native and foreign shared owners", () => {
  for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) for (const foreign of [false, true]) {
    const scene = fixture(edition, "bfg"), target = scene.target(350);
    if (foreign) scene.game.entities.delete(scene.player.id);
    expect(scene.game.entity(scene.player.id) === null).toBe(foreign);
    const projectile = scene.weapons.fireBfg({ actor: scene.player }, scene.game, { x: 200, y: 0, z: 0 }, forward, 300, 0, 500);
    projectile.touch?.(projectile, scene.game, { self: projectile.actor, other: scene.game.host.worldActor(), plane, surface: null });
    const before = scene.combat.read(target.actor.id)?.health;
    const ownerOrigin = scene.bodies.read(scene.player.id)?.origin;
    if (ownerOrigin === undefined) throw new Error("Missing shared shooter body");
    scene.tracing.trace = request => request.start.x === ownerOrigin.x
      ? { ...clearTrace(request), fraction: 0, end: request.start }
      : clearTrace(request);
    const explosion = projectile.think;
    if (explosion === null) throw new Error("BFG explosion continuation missing");
    explosion(projectile, scene.game);
    expect(scene.combat.read(target.actor.id)?.health).toBe(before);
    const visible = scene.weapons.fireBfg({ actor: scene.player }, scene.game, { x: 200, y: 0, z: 0 }, forward, 300, 0, 500);
    visible.touch?.(visible, scene.game, { self: visible.actor, other: scene.game.host.worldActor(), plane, surface: null });
    scene.tracing.trace = clearTrace;
    visible.think?.(visible, scene.game);
    expect(scene.combat.read(target.actor.id)?.health ?? 500).toBeLessThan(before ?? 500);
    scene.actors.close();
  }
});

test("selected Q2 rocket behavior uses the foreign shooter and keeps primary presentation and impact", () => {
  const launches: WeaponBehaviorLaunch[] = [];
  let steps = 0;
  const scene = fixture("rerelease", "rocketlauncher", 0.025, false, "singleplayer", {
    controlsTrajectory: () => true,
    launch: input => { launches.push(input); return { origin: { x: 8, y: 2, z: 16 }, velocity: { x: 300, y: 0, z: 0 }, angles: zero }; },
    step: (_projectile, body, time) => { steps++; expect(time).toBe(0.25); return { origin: body.origin, velocity: { x: 0, y: 500, z: 0 }, angles: { x: 0, y: 90, z: 0 } }; },
  });
  const rocket = scene.weapons.fireRocket(scene.self, scene.game, zero, forward, 100, 650, 120, 120);
  expect(launches).toHaveLength(1);
  expect(launches[0]?.shooter.equals(scene.player.id)).toBe(true);
  expect(launches[0]?.weapon).toBe("q2:weapon_rocketlauncher"); expect(launches[0]?.role).toBe("rocket");
  expect(launches[0]?.body.velocity).toEqual({ x: 650, y: 0, z: 0 });
  expect(scene.game.body(rocket).velocity).toEqual({ x: 300, y: 0, z: 0 });
  expect(scene.game.body(rocket).origin).toEqual({ x: 8, y: 2, z: 16 });
  const touch = rocket.touch;
  scene.game.applyProjectileBehavior(rocket.actor.id, 0.25);
  expect(scene.game.body(rocket).velocity).toEqual({ x: 0, y: 500, z: 0 });
  expect(rocket.model).toBe("models/objects/rocket/tris.md2"); expect(rocket.damage).toBe(100); expect(rocket.touch).toBe(touch);
  expect(steps).toBe(1);
  const monster = scene.target(256);
  scene.weapons.fireRocket(monster, scene.game, zero, forward, 100, 650, 120, 120);
  expect(launches).toHaveLength(1);
});

test("selected trajectory survives tracker primary aim while unselected tracker keeps source steering", () => {
  for (const selected of [false, true]) {
    const attached = new Set<ActorId>();
    const scene = fixture("rerelease", "blaster", 0.025, false, "singleplayer", {
      controlsTrajectory: actor => attached.has(actor),
      launch: input => { if (!selected) return null; attached.add(input.projectile.id); return { origin: input.body.origin, velocity: { x: 0, y: 300, z: 0 }, angles: { x: 0, y: 90, z: 0 } }; },
      step: () => null,
    });
    try {
      const projectiles = new Q2MissionPackProjectiles({ base: scene.weapons, monster: () => null, playerEffect: () => undefined });
      const target = scene.target(256), bolt = projectiles.fireTracker(scene.self, scene.game, zero, forward, 50, 1000, target.actor.id);
      const think = bolt.think, touch = bolt.touch; if (think === null) throw new Error("Missing source tracker think");
      think(bolt, scene.game); scene.game.applyProjectileBehavior(bolt.actor.id, 0.1);
      expect(scene.game.body(bolt).velocity).toEqual(selected ? { x: 0, y: 300, z: 0 } : { x: 1000, y: 0, z: 0 });
      expect(bolt.damage).toBe(50); expect(bolt.touch).toBe(touch); expect(bolt.nextThink).toBe(0.1);
    } finally { scene.actors.close(); }
  }
});
