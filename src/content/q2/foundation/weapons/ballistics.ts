import type { ProjectileRole, WeaponTrajectoryUpdate } from "../../../../contracts/weapon-behavior.ts";
import type { Q2WeaponsCheckpoint } from "./checkpoint.ts";
import { restoreQ2Actor } from "../checkpoint.ts";
import type { Q2WeaponOwner } from "./types.ts";
/* Adapted from id Software Quake II g_weapon.c and rerelease g_weapon.cpp.
 * GPL-2.0-or-later. All damage is admitted by the session combat authority. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { ItemId } from "../../../../contracts/gameplay.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { TraceResult } from "../../../../contracts/scene.ts";
import type { TouchContact } from "../../../../contracts/world.ts";
import { add, dot, length, normalize, scale, subtract, zero } from "../fields.ts";
import type { Q2Entity, Q2GameServices, Q2Think, Q2Touch } from "../host.ts";
import { angleVectors, lerpAngle, vectorAngles } from "./vectors.ts";
import { q2ActorShotMask } from "./projection.ts";
import { freeQ2Entity as free } from "../callbacks.ts";
import type { Q2CallbackDefinitions } from "../callbacks.ts";
import { MOD, PLAYER_CONTENTS, WATER_MASK, Q2WeaponState } from "./types.ts";
import type { Q2GrenadeAdjustment, Q2NoiseRecord, Q2WeaponHooks, Q2WeaponInput } from "./types.ts";

function normal(trace: TraceResult): Vec3 { return trace.contact.kind === "plane" ? trace.contact.plane.normal : zero; }
function contents(trace: TraceResult): number { return trace.kind === "q1" ? 0 : trace.contents; }
function sky(trace: TraceResult): boolean { return trace.kind === "q2" ? trace.surface !== null && ((trace.surface.flags & 4) !== 0 || trace.surface.name.startsWith("sky")) : trace.kind === "q3" && (trace.surfaceFlags & 4) !== 0; }
function hit(trace: TraceResult): ActorId | null { return trace.hit.kind === "actor" ? trace.hit.actor : null; }
function canHurt(game: Q2GameServices, actor: ActorId | null): actor is ActorId { return actor !== null && game.host.combat.read(actor)?.canTakeDamage === true; }
function centroid(game: Q2GameServices, actor: ActorId): Vec3 | null {
  const body = game.host.bodies.read(actor);
  return body === null ? null : add(body.origin, scale(add(body.bounds.min, body.bounds.max), 0.5));
}
function effect(game: Q2GameServices, name: string, origin: Vec3, direction: Vec3 = zero, count = 0, color = 0): undefined {
  return game.host.emit({ kind: "effect", effect: name, origin, direction, count, color });
}

function weaponForMod(mod: number): ItemId | null {
  switch (mod) {
    case MOD.blaster: return "q2:weapon_blaster";
    case MOD.shotgun: return "q2:weapon_shotgun";
    case MOD.supershotgun: return "q2:weapon_supershotgun";
    case MOD.machinegun: return "q2:weapon_machinegun";
    case MOD.chaingun: return "q2:weapon_chaingun";
    case MOD.hyperblaster: return "q2:weapon_hyperblaster";
    default: return null;
  }
}

export interface Q2HandGrenadeLaunch {
  readonly start: Vec3;
  readonly direction: Vec3;
  readonly damage: number;
  readonly speed: number;
  readonly timer: number;
  readonly radius: number;
  readonly held: boolean;
  readonly gravity: number;
  readonly playersCollide: boolean;
}

export class Q2Ballistics {
  readonly blasterCauses = new Map<ActorId, number>();
  private readonly releaseRegistries = new WeakSet<Q2GameServices["host"]["actors"]>();
  get callbacks(): Q2CallbackDefinitions { return { think: { G_FreeEdict: free, Grenade_Explode: this.grenadeExplode, grenade_think: this.grenadeUpdate, bfg_think: this.bfgThink, bfg_explode: this.bfgExplode }, touch: { blaster_touch: this.blasterTouch, Grenade_Touch: this.grenadeTouch, rocket_touch: this.rocketTouch, bfg_touch: this.bfgTouch }, die: { q2_weapon_debris_die: free } }; }
  protected readonly silencerCharges = new Map<ActorId, number>();
  readonly states = new Map<ActorId, Q2WeaponState>();
  readonly inputs = new Map<ActorId, Q2WeaponInput>();
  readonly noises = new Map<ActorId, { primary: Q2NoiseRecord | null; secondary: Q2NoiseRecord | null }>();
  soundEntity: Q2NoiseRecord | null = null;
  sound2Entity: Q2NoiseRecord | null = null;

  constructor(readonly hooks: Q2WeaponHooks) {}

  registerCallbacks(game: Q2GameServices): undefined {
    this.trackActors(game);
    return game.sourceCallbacks.register(this.callbacks);
  }

  captureProjectiles(): Pick<Q2WeaponsCheckpoint, "blasterCauses"> {
    return { blasterCauses: [...this.blasterCauses].map(([actor, meansOfDeath]) => ({ actor: { slot: actor.slot, generation: actor.generation }, meansOfDeath })) };
  }

  restoreProjectiles(game: Q2GameServices, checkpoint: Pick<Q2WeaponsCheckpoint, "blasterCauses">): undefined {
    this.registerCallbacks(game);
    this.blasterCauses.clear();
    for (const saved of checkpoint.blasterCauses) this.blasterCauses.set(restoreQ2Actor(game, saved.actor).id, saved.meansOfDeath);
    return undefined;
  }

  silencerShots(actor: ActorId): number { return this.silencerCharges.get(actor) ?? 0; }

  grantSilencer(actor: ActorId, game: Q2GameServices, charges: number): undefined {
    if (!game.host.actors.isLive(actor)) throw new Error("Silencer owner is not live");
    if (!Number.isSafeInteger(charges) || charges < 0) throw new RangeError("Silencer charges must be a nonnegative integer");
    this.trackActors(game);
    this.silencerCharges.set(actor, this.silencerShots(actor) + charges);
    return undefined;
  }

  resetSilencer(actor: ActorId): undefined { this.silencerCharges.delete(actor); return undefined; }

  protected trackActors(game: Q2GameServices): void {
    if (this.releaseRegistries.has(game.host.actors)) return;
    this.releaseRegistries.add(game.host.actors);
    game.host.actors.onRelease(actor => {
      this.states.delete(actor.id); this.inputs.delete(actor.id);
      this.blasterCauses.delete(actor.id); this.silencerCharges.delete(actor.id); this.noises.delete(actor.id);
      if (this.soundEntity?.actor.equals(actor.id)) this.soundEntity = null;
      if (this.sound2Entity?.actor.equals(actor.id)) this.sound2Entity = null;
      return undefined;
    });
  }

  protected shotMask(self: Pick<Q2WeaponOwner, "actor">, game: Q2GameServices): number {
    return this.actorShotMask(game, this.inputs.get(self.actor.id)?.playersCollide !== false);
  }

  private actorShotMask(game: Q2GameServices, playersCollide: boolean): number {
    return q2ActorShotMask(game, playersCollide);
  }

  playerNoise(self: Pick<Q2WeaponOwner, "actor">, game: Q2GameServices, origin: Vec3, kind: "self" | "weapon" | "impact"): undefined {
    return this.playerNoiseForActor(self.actor.id, game, origin, kind);
  }

  playerNoiseForActor(owner: ActorId, game: Q2GameServices, origin: Vec3, kind: "self" | "weapon" | "impact"): undefined {
    if (!game.host.actors.isLive(owner) || !game.host.isPlayer(owner)) return undefined;
    this.trackActors(game);
    const charges = this.silencerShots(owner);
    if (kind === "weapon") {
      if (game.options.edition === "rerelease") this.hooks.emit({ kind: "invisibility-reveal", actor: owner, until: game.host.now() + (charges > 0 ? 0.4 : 2) });
      if (charges > 0) { this.silencerCharges.set(owner, charges - 1); return undefined; }
    }
    if (game.options.mode === "deathmatch" || this.inputs.get(owner)?.notarget === true || game.monsterTarget(owner)?.notarget === true) return undefined;
    const record: Q2NoiseRecord = { actor: owner, origin, time: game.host.now(), secondary: kind === "impact" };
    const records = this.noises.get(owner) ?? { primary: null, secondary: null };
    if (kind === "impact") { records.secondary = record; this.sound2Entity = record; }
    else { records.primary = record; this.soundEntity = record; }
    this.noises.set(owner, records);
    return this.hooks.noise(owner, origin, kind === "impact");
  }

  private impactNoise(projectile: Q2Entity, game: Q2GameServices): undefined {
    return projectile.owner === null ? undefined : this.playerNoiseForActor(projectile.owner, game, game.body(projectile).origin, "impact");
  }

  checkDodge(self: Pick<Q2WeaponOwner, "actor">, game: Q2GameServices, start: Vec3, direction: Vec3, speed: number): undefined {
    if (game.options.edition !== "classic" || !game.host.isPlayer(self.actor.id)) return undefined;
    if (game.options.skill === 0 && game.host.random() > 0.25) return undefined;
    const trace = game.host.trace({ start, end: add(start, scale(direction, 8192)), bounds: null, ignore: self.actor.id, mask: this.shotMask(self, game) });
    const target = hit(trace);
    if (target === null || !game.host.isMonster(target) || (game.host.combat.read(target)?.health ?? 0) <= 0) return undefined;
    const body = game.host.bodies.read(target);
    if (body === null) return undefined;
    if (dot(normalize(subtract(game.body(self).origin, body.origin)), angleVectors(body.angles).forward) <= 0.3) return undefined;
    return this.hooks.dodge(target, self.actor.id, (length(subtract(trace.end, start)) - body.bounds.max.x) / speed, trace);
  }

  fireBullet(self: Pick<Q2WeaponOwner, "actor">, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, kick: number, horizontalSpread: number, verticalSpread: number, mod: number): undefined {
    return this.fireLead(self, game, start, direction, damage, kick, horizontalSpread, verticalSpread, mod, "gunshot");
  }

  fireShotgun(self: Pick<Q2WeaponOwner, "actor">, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, kick: number, horizontalSpread: number, verticalSpread: number, count: number, mod: number): undefined {
    for (let pellet = 0; pellet < count; pellet++) this.fireLead(self, game, start, direction, damage, kick, horizontalSpread, verticalSpread, mod, "shotgun");
    return undefined;
  }

  private fireLead(self: Pick<Q2WeaponOwner, "actor">, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, kick: number, horizontalSpread: number, verticalSpread: number, mod: number, impact: string): undefined {
    const rerelease = game.options.edition === "rerelease", shotMask = this.shotMask(self, game);
    const spread = (origin: Vec3, aim: Vec3, factor: number): Vec3 => {
      const axes = angleVectors(vectorAngles(aim));
      const r = (game.host.random() * 2 - 1) * horizontalSpread * factor;
      const u = (game.host.random() * 2 - 1) * verticalSpread * factor;
      return add(add(add(origin, scale(axes.forward, 8192)), scale(axes.right, r)), scale(axes.up, u));
    };
    let waterStart: Vec3 | null = (game.host.pointContents(start) & WATER_MASK) !== 0 ? start : null;
    let mask = shotMask | (waterStart === null ? WATER_MASK : 0);
    let from = game.body(self).origin, end = start;
    const excluded: ActorId[] = [];
    let initial = true;
    let trace: TraceResult;
    for (;;) {
      trace = game.host.trace({ start: from, end, bounds: null, ignore: self.actor.id, exclude: excluded, mask: initial && !rerelease ? shotMask : mask });
      if (trace.fraction === 1 && initial) {
        initial = false; excluded.length = 0; from = start; end = spread(start, direction, 1); continue;
      }
      if (trace.fraction === 1) break;
      if ((contents(trace) & WATER_MASK) !== 0 && (mask & WATER_MASK) !== 0) {
        waterStart = trace.end;
        if (length(subtract(start, trace.end)) !== 0) {
          const c = contents(trace);
          const brownName = rerelease ? "brwater" : "*brwater";
          const color = (c & 32) !== 0 ? trace.kind === "q2" && trace.surface?.name === brownName ? 3 : 2 : (c & 16) !== 0 ? 4 : 5;
          effect(game, "splash", trace.end, normal(trace), 8, color);
          end = spread(trace.end, subtract(end, start), 2);
        }
        mask &= ~WATER_MASK;
        if (!rerelease) from = trace.end;
        continue;
      }
      const actor = hit(trace);
      if ((rerelease || !sky(trace)) && canHurt(game, actor)) {
        game.damage(actor, self.actor.id, self.actor.id, damage, kick, direction, trace.end, normal(trace), mod, 16, weaponForMod(mod));
        const state = game.host.combat.read(actor);
        if (rerelease && ((contents(trace) & 0x4000000) !== 0 || game.host.isMonster(actor) && state !== null && state.health <= 0) && !excluded.includes(actor)) {
          if (excluded.length === 16) break;
          excluded.push(actor);
          continue;
        }
      } else if (!sky(trace)) {
        effect(game, impact, trace.end, normal(trace));
        this.playerNoise(self, game, trace.end, "impact");
      }
      break;
    }
    if (waterStart !== null) {
      const pos = add(trace.end, scale(normalize(subtract(trace.end, waterStart)), -2));
      const waterEnd = (game.host.pointContents(pos) & WATER_MASK) !== 0 ? pos : game.host.trace({ start: pos, end: waterStart, bounds: null, ignore: hit(trace), mask: WATER_MASK }).end;
      this.hooks.emit({ kind: "beam", actor: self.actor.id, effect: "bubble-trail", start: waterStart, end: waterEnd, duration: 0 });
    }
    return undefined;
  }

  fireRail(self: Pick<Q2WeaponOwner, "actor">, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, kick: number): undefined {
    const end = add(start, scale(direction, 8192)), excluded: ActorId[] = [];
    let from = start, ignore: ActorId | null = self.actor.id, water = false;
    let mask = this.shotMask(self, game) | 8 | 16;
    let trace: TraceResult;
    for (;;) {
      trace = game.host.trace({ start: from, end, bounds: null, ignore, exclude: excluded, mask });
      if (trace.fraction === 1) break;
      if ((contents(trace) & mask & (8 | 16)) !== 0) { mask &= ~(8 | 16); water = true; }
      else {
        const actor = hit(trace);
        if (actor === null) break;
        if (actor !== self.actor.id && canHurt(game, actor)) game.damage(actor, self.actor.id, self.actor.id, damage, kick, direction, trace.end, normal(trace), MOD.railgun, 0, "q2:weapon_railgun");
        const entity = game.weaponTarget(actor);
        const pierce = game.host.isMonster(actor) || game.host.isPlayer(actor) || entity?.solid === "box" || game.options.edition === "rerelease" && (entity?.damageableTarget === true || entity?.solid === "none" || entity?.solid === "trigger" || !game.host.actors.isLive(actor));
        if (!pierce || excluded.includes(actor)) break;
        if (game.options.edition === "rerelease" && excluded.length === 16) break;
        excluded.push(actor);
        if (game.options.edition === "classic") ignore = actor;
      }
      if (game.options.edition === "classic") from = trace.end;
    }
    this.hooks.emit({ kind: "beam", effect: "rail", actor: self.actor.id, start, end: trace.end, duration: 0 });
    if (water && game.options.edition === "classic") this.hooks.emit({ kind: "beam", effect: "rail-water", actor: self.actor.id, start, end: trace.end, duration: 0 });
    return this.playerNoise(self, game, trace.end, "impact");
  }

  fireHit(self: Q2Entity, game: Q2GameServices, aim: Vec3, damage: number, kick: number): boolean {
    const enemy = self.enemy;
    if (enemy === null) throw new Error("Q2 fireHit requires an enemy");
    const targetBody = game.host.bodies.read(enemy);
    if (targetBody === null) return false;
    const body = game.body(self), delta = subtract(targetBody.origin, body.origin);
    let range = length(delta), side = aim.y;
    const rerelease = game.options.edition === "rerelease";
    const min = add(targetBody.origin, targetBody.bounds.min), max = add(targetBody.origin, targetBody.bounds.max);
    if (rerelease) {
      const selfMin = add(body.origin, body.bounds.min), selfMax = add(body.origin, body.bounds.max);
      range = Math.hypot(Math.max(0, min.x - selfMax.x, selfMin.x - max.x), Math.max(0, min.y - selfMax.y, selfMin.y - max.y), Math.max(0, min.z - selfMax.z, selfMin.z - max.z));
    }
    if (range > aim.x) return false;
    if (side > body.bounds.min.x && side < body.bounds.max.x) { if (!rerelease) range -= targetBody.bounds.max.x; }
    else side = side < 0 ? targetBody.bounds.min.x : targetBody.bounds.max.x;
    const point = rerelease ? { x: Math.max(min.x, Math.min(max.x, body.origin.x)), y: Math.max(min.y, Math.min(max.y, body.origin.y)), z: Math.max(min.z, Math.min(max.z, body.origin.z)) } : add(body.origin, scale(delta, range));
    let target = enemy;
    const traces = [game.host.trace({ start: body.origin, end: point, bounds: null, ignore: self.actor.id, mask: this.shotMask(self, game) })];
    if (rerelease) traces.push(game.host.trace({ start: point, end: targetBody.origin, bounds: null, ignore: self.actor.id, mask: this.shotMask(self, game) }));
    for (const trace of traces) if (trace.fraction < 1) {
      const actor = hit(trace);
      if (!canHurt(game, actor)) return false;
      target = game.host.isMonster(actor) || game.host.isPlayer(actor) ? enemy : actor;
    }
    const axes = angleVectors(body.angles), impact = add(add(add(body.origin, scale(axes.forward, range)), scale(axes.right, side)), scale(axes.up, aim.z));
    game.damage(target, self, self.actor.id, damage, Math.trunc(kick / 2), subtract(impact, targetBody.origin), impact, zero, MOD.hit, 8);
    if (!game.host.isMonster(target) && !game.host.isPlayer(target)) return false;
    const owned = game.host.actors.resolveOwned(enemy), current = game.host.bodies.read(enemy);
    if (owned !== null && current !== null) {
      const center = add(current.origin, scale(add(current.bounds.min, current.bounds.max), 0.5));
      const velocity = add(current.velocity, scale(normalize(subtract(center, impact)), kick));
      game.host.bodies.write(owned, { ...current, velocity, ground: velocity.z > 0 ? null : current.ground });
    }
    return true;
  }

  private projectile(self: Pick<Q2WeaponOwner, "actor">, game: Q2GameServices, classname: string, start: Vec3, direction: Vec3, speed: number, model: string, effects: number): Q2Entity {
    return this.projectileForActor(self.actor.id, game, classname, start, direction, speed, model, effects, this.shotMask(self, game));
  }

  private projectileForActor(owner: ActorId, game: Q2GameServices, classname: string, start: Vec3, direction: Vec3, speed: number, model: string, effects: number, clipMask: number): Q2Entity {
    this.registerCallbacks(game);
    const projectile = game.create(classname);
    projectile.owner = owner; projectile.model = model; projectile.effects = effects;
    projectile.clipMask = clipMask; projectile.projectile = true;
    projectile.dodgeable = game.options.edition === "rerelease";
    projectile.movedir = direction;
    game.move(projectile, { origin: start, angles: vectorAngles(direction), velocity: scale(direction, speed), bounds: { min: zero, max: zero } }, false);
    return projectile;
  }

  private launchBehavior(projectile: Q2Entity, game: Q2GameServices, weapon: ItemId, role: ProjectileRole): WeaponTrajectoryUpdate | null {
    if (projectile.owner === null || !game.host.isPlayer(projectile.owner)) return null;
    const update = game.host.weaponBehavior?.launch({ projectile: projectile.actor,
      shooter: projectile.owner, weapon, role, timeSeconds: game.host.now(), body: game.body(projectile) }) ?? null;
    if (update !== null) { game.projectTrajectory(projectile, update); }
    return update;
  }

  private loop(projectile: Q2Entity, game: Q2GameServices, path: string, start: boolean): undefined {
    return game.host.emit({ kind: "sound", actor: projectile.actor.id, origin: game.body(projectile).origin, path, channel: 0, volume: 1, attenuation: 1, reliable: false, loop: start ? "start" : "stop" });
  }

  fireBlaster(self: Pick<Q2WeaponOwner, "actor">, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number, effects: number, hyper = false, meansOfDeath = hyper ? MOD.hyperblaster : MOD.blaster): Q2Entity {
    const dir = game.options.edition === "classic" ? normalize(direction) : direction;
    const bolt = this.projectile(self, game, "bolt", start, dir, speed, "models/objects/laser/tris.md2", effects);
    bolt.damage = damage;
    this.blasterCauses.set(bolt.actor.id, meansOfDeath); bolt.touch = this.blasterTouch;
    game.schedule(bolt, 2, free); game.solid(bolt, "box"); game.motion(bolt, "fly-missile");
    const trajectory = this.launchBehavior(bolt, game, hyper ? "q2:weapon_hyperblaster" : "q2:weapon_blaster", "bolt");
    const launchOrigin = game.body(bolt).origin, launchDirection = trajectory === null ? dir : normalize(trajectory.velocity);
    game.show(bolt); this.loop(bolt, game, "misc/lasfly.wav", true);
    this.checkDodge(self, game, start, dir, speed);
    const trace = game.host.trace({ start: game.body(self).origin, end: launchOrigin, bounds: null, ignore: bolt.actor.id, mask: bolt.clipMask });
    if (trace.fraction < 1) {
      game.move(bolt, { origin: game.options.edition === "classic" ? add(launchOrigin, scale(launchDirection, -10)) : add(trace.end, normal(trace)) });
      this.blasterImpact(bolt, game, hit(trace), game.options.edition === "classic" ? zero : normal(trace), game.options.edition !== "classic" && sky(trace));
    }
    return bolt;
  }

  fireGrenade(self: Pick<Q2WeaponOwner, "actor">, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number, timer: number, radius: number, hand = false, held = false, monster = false, adjustment?: Q2GrenadeAdjustment): Q2Entity {
    return this.launchGrenade(self.actor.id, game, start, direction, damage, speed, timer, radius, hand, held, monster, adjustment?.gravity ?? this.inputs.get(self.actor.id)?.gravity ?? 800, this.shotMask(self, game), adjustment);
  }

  fireHandGrenade(owner: ActorId, game: Q2GameServices, spec: Q2HandGrenadeLaunch): Q2Entity {
    return this.launchGrenade(owner, game, spec.start, spec.direction, spec.damage, spec.speed, spec.timer, spec.radius, true, spec.held, false, spec.gravity, this.actorShotMask(game, spec.playersCollide));
  }

  private launchGrenade(owner: ActorId, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number, timer: number, radius: number, hand: boolean, held: boolean, monster: boolean, ownerGravity: number, clipMask: number, adjustment?: Q2GrenadeAdjustment): Q2Entity {
    const rerelease = game.options.edition === "rerelease", axes = angleVectors(vectorAngles(direction));
    const model = hand ? rerelease ? "grenade3" : "grenade2" : rerelease && !monster ? "grenade4" : "grenade";
    const grenade = this.projectileForActor(owner, game, hand ? rerelease ? "hand_grenade" : "hgrenade" : "grenade", start, direction, speed, `models/objects/${model}/tris.md2`, 32 + (rerelease && monster && !hand ? 2 ** 37 : 0), clipMask);
    grenade.damageRadius = radius; grenade.damage = damage; grenade.speed = speed; grenade.spawnflags = hand ? held ? 3 : 1 : 0;
    const gravity = rerelease ? ownerGravity / 800 : 1;
    const up = (adjustment?.up ?? 200 + (game.host.random() * 2 - 1) * 10) * gravity, right = adjustment?.right ?? (game.host.random() * 2 - 1) * 10;
    game.move(grenade, { velocity: add(add(scale(direction, speed), scale(axes.up, up)), scale(axes.right, right)) }, false);
    grenade.angularVelocity = rerelease ? hand || monster ? { x: (game.host.random() * 2 - 1) * 360, y: (game.host.random() * 2 - 1) * 360, z: (game.host.random() * 2 - 1) * 360 } : zero : { x: 300, y: 300, z: 300 };

    grenade.touch = this.grenadeTouch;
    if (rerelease && !hand && !monster) {
      grenade.timestamp = game.host.now() + timer;
      grenade.renderFlags |= 1;
      game.move(grenade, { angles: vectorAngles(game.body(grenade).velocity) }, false);
      game.schedule(grenade, game.host.frameSeconds(), this.grenadeUpdate);
    } else game.schedule(grenade, Math.max(0, timer), this.grenadeExplode);
    if (hand) this.loop(grenade, game, "weapons/hgrenc1b.wav", true);
    if (hand && timer <= 0) this.grenadeExplode(grenade, game);
    else {
      if (hand) {
        const body = game.host.bodies.read(owner);
        if (body === null) throw new Error("Q2 grenade thrower has no shared body");
        game.host.emit({ kind: "sound", actor: owner, origin: body.origin, path: "weapons/hgrent1a.wav", channel: 1, volume: 1, attenuation: 1, reliable: false, loop: "once" });
      }
      game.solid(grenade, "box"); game.motion(grenade, "bounce");
      this.launchBehavior(grenade, game, hand ? "q2:ammo_grenades" : "q2:weapon_grenadelauncher", "grenade"); game.show(grenade);
    }
    return grenade;
  }

  fireRocket(self: Pick<Q2WeaponOwner, "actor">, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number, radius: number, radiusDamage: number): Q2Entity {
    const rocket = this.projectile(self, game, "rocket", start, direction, speed, "models/objects/rocket/tris.md2", 16);
    rocket.damage = damage; rocket.damageRadius = radius; rocket.radiusDamage = radiusDamage;
    rocket.touch = this.rocketTouch;
    game.schedule(rocket, 8000 / speed, free); game.solid(rocket, "box"); game.motion(rocket, "fly-missile");
    this.launchBehavior(rocket, game, "q2:weapon_rocketlauncher", "rocket"); game.show(rocket);
    this.loop(rocket, game, "weapons/rockfly.wav", true); this.checkDodge(self, game, start, direction, speed);
    return rocket;
  }

  private debris(source: Q2Entity, game: Q2GameServices): undefined {
    const piece = game.create("debris"), body = game.body(source), random = () => game.host.random() * 2 - 1;
    piece.model = "models/objects/debris2/tris.md2";
    game.move(piece, { origin: body.origin, velocity: add(body.velocity, scale({ x: 100 * random(), y: 100 * random(), z: 100 + 100 * random() }, 2)) }, false);
    piece.angularVelocity = { x: game.host.random() * 600, y: game.host.random() * 600, z: game.host.random() * 600 };
    game.host.combat.create(piece.actor, { health: 0, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 0, canTakeDamage: true, invulnerable: false, team: null });
    piece.die = free;
    game.motion(piece, "bounce"); game.solid(piece, "none"); game.show(piece);
    return game.schedule(piece, 5 + game.host.random() * 5, free);
  }

  fireBfg(self: Pick<Q2WeaponOwner, "actor">, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number, radius: number): Q2Entity {
    const bfg = this.projectile(self, game, "bfg blast", start, direction, speed, "sprites/s_bfg1.sp2", 128 | 8192);
    bfg.dodgeable = false; bfg.damage = damage; bfg.damageRadius = radius;

    bfg.touch = this.bfgTouch;

    this.checkDodge(self, game, start, direction, speed);
    game.schedule(bfg, game.host.frameSeconds(), this.bfgThink); game.solid(bfg, "box"); game.motion(bfg, "fly-missile");
    this.launchBehavior(bfg, game, "q2:weapon_bfg", "energy"); game.show(bfg); this.loop(bfg, game, "weapons/bfg__l1a.wav", true);
    return bfg;
  }

  private readonly grenadeExplode: Q2Think = (entity, current) => {
      const hand = (entity.spawnflags & 1) !== 0, held = (entity.spawnflags & 2) !== 0;
      this.impactNoise(entity, current);
      const body = current.body(entity), direct = entity.enemy;
      if (direct !== null) {
        const center = centroid(current, direct), targetBody = current.host.bodies.read(direct);
        if (center !== null && targetBody !== null) {
          const points = Math.trunc(entity.damage - 0.5 * length(subtract(body.origin, center)));
          current.damage(direct, entity, entity.owner, points, points, subtract(targetBody.origin, body.origin), body.origin, zero, hand ? MOD.handGrenade : MOD.grenade, 1, hand ? "q2:ammo_grenades" : "q2:weapon_grenadelauncher");
        }
      }
      current.radiusDamage(entity, entity.owner, entity.damage, direct, entity.damageRadius, held ? MOD.heldGrenade : hand ? MOD.handGrenadeSplash : MOD.grenadeSplash, 0, hand ? "q2:ammo_grenades" : "q2:weapon_grenadelauncher");
      const wet = (current.host.pointContents(body.origin) & WATER_MASK) !== 0;
      effect(current, `${body.ground === null ? "rocket" : "grenade"}-explosion${wet ? "-water" : ""}`, add(body.origin, scale(body.velocity, -0.02)));
      return current.remove(entity);

  };

  private readonly grenadeTouch: Q2Touch = (entity, current, contact) => {
      const hand = (entity.spawnflags & 1) !== 0;
      if (contact.other === entity.owner) return undefined;
      if (((contact.surface?.nativeFlags ?? 0) & 4) !== 0) return current.remove(entity);
      if (!canHurt(current, contact.other)) return current.sound(entity, hand ? current.host.random() > 0.5 ? "weapons/hgrenb1a.wav" : "weapons/hgrenb2a.wav" : "weapons/grenlb1b.wav", 2);
      entity.enemy = contact.other;
      return this.grenadeExplode(entity, current);

  };

  private readonly grenadeUpdate: Q2Think = (entity, current) => {
        if (current.host.now() >= entity.timestamp) return this.grenadeExplode(entity, current);
        const body = current.body(entity), velocitySquared = dot(body.velocity, body.velocity);
        if (velocitySquared !== 0) {
          const fraction = Math.min(1, velocitySquared / (entity.speed * entity.speed));
          const angles = vectorAngles(body.velocity);
          current.move(entity, { angles: { x: lerpAngle(body.angles.x, angles.x, fraction), y: angles.y, z: body.angles.z + current.host.frameSeconds() * 360 * fraction } });
        }
        return current.schedule(entity, current.host.frameSeconds(), this.grenadeUpdate);

  };

  private readonly rocketTouch: Q2Touch = (entity, current, contact) => {
      if (contact.other === entity.owner) return undefined;
      if (((contact.surface?.nativeFlags ?? 0) & 4) !== 0) return current.remove(entity);
      this.impactNoise(entity, current);
      const body = current.body(entity), plane = contact.plane?.normal ?? zero;
      if (canHurt(current, contact.other)) current.damage(contact.other, entity, entity.owner, entity.damage, 0, body.velocity, body.origin, plane, MOD.rocket, 0, "q2:weapon_rocketlauncher");
      else if (current.options.mode === "singleplayer" && contact.surface !== null && (contact.surface.nativeFlags & (8 | 16 | 32 | 64)) === 0) {
        const count = Math.floor(current.host.random() * 5);
        for (let i = 0; i < count; i++) this.debris(entity, current);
      }
      current.radiusDamage(entity, entity.owner, entity.radiusDamage, contact.other, entity.damageRadius, MOD.rocketSplash, 0, "q2:weapon_rocketlauncher");
      effect(current, (current.host.pointContents(body.origin) & WATER_MASK) !== 0 ? "rocket-explosion-water" : "rocket-explosion", current.options.edition === "classic" ? add(body.origin, scale(body.velocity, -0.02)) : add(body.origin, plane));
      return current.remove(entity);

  };

  private readonly bfgExplode: Q2Think = (entity, current) => {
      if (current.options.edition === "rerelease") this.bfgAmbient(entity, current);
      if (entity.frame === 0) for (const actor of current.host.nearby(current.body(entity).origin, entity.damageRadius)) {
        if (actor === entity.owner || !canHurt(current, actor) || !current.canDamage(actor, entity)) continue;
        const owner = entity.owner === null ? null : current.host.actors.resolveOwned(entity.owner);
        if (owner !== null && current.host.bodies.read(owner.id) !== null && !current.canDamage(actor, { actor: owner })) continue;
        if (current.options.edition === "rerelease" && (!this.bfgTarget(current, actor) || !this.hooks.canTarget(entity.owner, actor))) continue;
        const center = centroid(current, actor), body = current.host.bodies.read(actor);
        if (center === null || body === null) continue;
        const distance = length(subtract(current.body(entity).origin, center));
        const points = Math.trunc(entity.damage * (1 - Math.sqrt(distance / entity.damageRadius)));
        if (current.options.edition === "classic") effect(current, "bfg-explosion", body.origin);
        current.damage(actor, entity, entity.owner, points, 0, current.body(entity).velocity, current.options.edition === "classic" ? body.origin : center, zero, MOD.bfgEffect, 4, "q2:weapon_bfg");
        if (current.options.edition === "rerelease") this.hooks.emit({ kind: "beam", effect: "bfg-zap", actor: entity.actor.id, start: current.body(entity).origin, end: center, duration: 0 });
      }
      entity.frame++; current.show(entity);
      return current.schedule(entity, 0.1, entity.frame === 5 ? free : this.bfgExplode);

  };

  private readonly bfgTouch: Q2Touch = (entity, current, contact) => {
      if (contact.other === entity.owner) return undefined;
      if (((contact.surface?.nativeFlags ?? 0) & 4) !== 0) return current.remove(entity);
      this.impactNoise(entity, current);
      const body = current.body(entity), energy = current.options.edition === "rerelease" ? 4 : 0;
      if (canHurt(current, contact.other)) current.damage(contact.other, entity, entity.owner, 200, 0, body.velocity, body.origin, contact.plane?.normal ?? zero, MOD.bfgBlast, energy, "q2:weapon_bfg");
      current.radiusDamage(entity, entity.owner, 200, contact.other, 100, MOD.bfgBlast, energy, "q2:weapon_bfg");
      current.sound(entity, "weapons/bfg__x1b.wav", 2); this.loop(entity, current, "weapons/bfg__l1a.wav", false);
      entity.touch = null; entity.enemy = contact.other; entity.model = "sprites/s_bfg3.sp2"; entity.frame = 0; entity.effects &= ~8192;
      current.move(entity, { origin: add(body.origin, scale(body.velocity, -current.host.frameSeconds())), velocity: zero });
      current.solid(entity, "none"); current.motion(entity, "stationary"); current.show(entity);
      effect(current, "bfg-bigexplosion", current.body(entity).origin);
      return current.schedule(entity, 0.1, this.bfgExplode);

  };

  private readonly bfgThink: Q2Think = (entity, current) => {
      if (current.options.edition === "rerelease") this.bfgAmbient(entity, current);
      const origin = current.body(entity).origin;
      for (const actor of current.host.nearby(origin, 256)) {
        if (actor === entity.actor.id || actor === entity.owner || !canHurt(current, actor) || !this.bfgTarget(current, actor)) continue;
        if (current.options.edition === "rerelease" && !this.hooks.canTarget(entity.owner, actor)) continue;
        const center = centroid(current, actor);
        if (center === null) continue;
        if (current.options.edition === "rerelease" && current.host.trace({ start: origin, end: center, bounds: null, ignore: null, mask: 3 }).fraction < 1) continue;
        const direction = normalize(subtract(center, origin)), end = add(origin, scale(direction, 2048)), excluded: ActorId[] = [];
        let from = origin, ignore: ActorId | null = entity.actor.id;
        let trace: TraceResult;
        for (;;) {
          trace = current.host.trace({ start: from, end, bounds: null, ignore, exclude: excluded, mask: 1 | 0x2000000 | 0x4000000 | (current.options.edition === "rerelease" ? PLAYER_CONTENTS : 0) });
          if (trace.fraction === 1) break;
          const target = hit(trace);
          if (target !== entity.owner && canHurt(current, target) && current.weaponTarget(target)?.laserImmune !== true) current.damage(target, entity, entity.owner, current.options.mode === "deathmatch" ? 5 : 10, 1, direction, trace.end, zero, MOD.bfgLaser, 4, "q2:weapon_bfg");
          if (target === null || !current.host.isMonster(target) && !current.host.isPlayer(target) && !(current.options.edition === "rerelease" && current.weaponTarget(target)?.damageableTarget === true)) {
            effect(current, "laser-sparks", trace.end, normal(trace), 4, entity.skin); break;
          }
          if (excluded.includes(target) || current.options.edition === "rerelease" && excluded.length === 16) break;
          excluded.push(target);
          if (current.options.edition === "classic") { from = trace.end; ignore = target; }
        }
        this.hooks.emit({ kind: "beam", effect: "bfg-laser", actor: entity.actor.id, start: origin, end: trace.end, duration: 0 });
      }
      return current.schedule(entity, 0.1, this.bfgThink);

  };

  private blasterImpact(entity: Q2Entity, current: Q2GameServices, other: ActorId | null, plane: Vec3, skyHit: boolean): undefined {
    const meansOfDeath = this.blasterCauses.get(entity.actor.id);
    if (meansOfDeath === undefined) throw new Error("Q2 blaster projectile lost its source cause");
      if (other === entity.owner) return undefined;
      if (skyHit) return current.remove(entity);
      this.impactNoise(entity, current);
      if (canHurt(current, other)) current.damage(other, entity, entity.owner, entity.damage, 1, current.body(entity).velocity, current.body(entity).origin, plane, meansOfDeath, 4, meansOfDeath === MOD.hyperblaster ? "q2:weapon_hyperblaster" : meansOfDeath === MOD.blaster ? "q2:weapon_blaster" : null);
      else effect(current, "blaster", current.body(entity).origin, plane);
      return current.remove(entity);

  }
  private readonly blasterTouch: Q2Touch = (entity, current, contact) => this.blasterImpact(entity, current, contact.other, contact.plane?.normal ?? zero, ((contact.surface?.nativeFlags ?? 0) & 4) !== 0);

  private bfgTarget(game: Q2GameServices, actor: ActorId): boolean {
    return game.host.isMonster(actor) || game.host.isPlayer(actor) || game.weaponTarget(actor)?.bfgExplobox === true || game.options.edition === "rerelease" && game.weaponTarget(actor)?.damageableTarget === true;
  }

  private bfgAmbient(entity: Q2Entity, game: Q2GameServices): undefined {
    const theta = game.host.random() * 2 * Math.PI, phi = Math.acos(game.host.random() * 2 - 1);
    const direction = { x: Math.sin(phi) * Math.cos(theta), y: Math.sin(phi) * Math.sin(theta), z: Math.cos(phi) };
    const start = game.body(entity).origin;
    const trace = game.host.trace({ start, end: add(start, scale(direction, 256)), bounds: null, ignore: entity.actor.id, mask: 1 | 16 | 8 });
    if (trace.fraction < 1) this.hooks.emit({ kind: "beam", effect: "bfg-lightning", actor: entity.actor.id, start, end: trace.end, duration: 0.3 });
    return undefined;
  }
}

export type Q2ProjectileContact = TouchContact;
