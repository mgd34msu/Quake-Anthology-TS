/* Quake II g_turret.c. Turret drivers reuse the permanent infantry AI/death runner. GPL-2.0-or-later. */
import type { Vec3 } from "../../../../contracts/math.ts";
import { add, length, numberField, scale, subtract, zero } from "../../foundation/fields.ts";
import type { Q2Entity, Q2GameServices, Q2Think } from "../../foundation/host.ts";
import { visible } from "../../foundation/monsters/ai.ts";
import { infantryStand } from "../../foundation/monsters/infantry.ts";
import type { MonsterContext } from "../../foundation/monsters/types.ts";
import { angleVectors, vectorAngles } from "../../foundation/weapons/vectors.ts";
import type { Q2BaseEntityHooks } from "./types.ts";

interface Breach {
  goal: Vec3;
  muzzle: Vec3;
  readonly pitchMax: number;
  readonly pitchMin: number;
  readonly yawMin: number;
  readonly yawMax: number;
}
interface Driver {
  readonly context: MonsterContext;
  breach: Q2Entity | null;
  radius: number;
  yawOffset: number;
  height: number;
}

export function snapQ2TurretEighth(value: number): number { return Math.trunc(value * 8 + (value > 0 ? 0.5 : -0.5)) * 0.125; }
function normalizeAngle(value: number): number { while (value > 360) value -= 360; while (value < 0) value += 360; return value; }
function shortAngle(value: number): number { return value < -180 ? value + 360 : value > 180 ? value - 360 : value; }

export class Q2TurretEntities {
  private readonly breaches = new WeakMap<Q2Entity, Breach>();
  private readonly drivers = new WeakMap<Q2Entity, Driver>();
  constructor(private readonly hooks: Q2BaseEntityHooks) {}

  private team(entity: Q2Entity, game: Q2GameServices): readonly Q2Entity[] {
    const master = game.entity(entity.teamMaster);
    if (master !== null) {
      const members: Q2Entity[] = [];
      for (let member: Q2Entity | null = master; member !== null; member = game.entity(member.teamChain)) members.push(member);
      return members;
    }
    const team = entity.spawn.values.get("team");
    return team === undefined ? [entity] : [...game.entities.values()].filter(member => member.spawn.values.get("team") === team);
  }

  private blocked(entity: Q2Entity, game: Q2GameServices): undefined {
    entity.blocked = (self, services, other) => {
      const body = services.host.bodies.read(other);
      if (body === null || services.host.combat.read(other)?.canTakeDamage !== true) return undefined;
      const master = this.team(self, services)[0] ?? self;
      services.damage(other, self, master.owner ?? master.actor.id, master.damage, 10, zero, body.origin, zero, 20);
      return undefined;
    };
    game.solid(entity, "brush"); game.motion(entity, "push"); return game.show(entity);
  }

  private fire(entity: Q2Entity, game: Q2GameServices, state: Breach, driver: Q2Entity): undefined {
    const body = game.body(entity), axes = angleVectors(body.angles);
    const start = add(add(add(body.origin, scale(axes.forward, state.muzzle.x)), scale(axes.right, state.muzzle.y)), scale(axes.up, state.muzzle.z));
    const damage = Math.trunc(100 + game.host.random() * 50), speed = 550 + 50 * game.options.skill;
    this.hooks.weapons.fireRocket(driver, game, start, axes.forward, damage, speed, 150, damage);
    return game.host.emit({ kind: "sound", actor: entity.actor.id, origin: start, path: "weapons/rocklf1a.wav",
      channel: 1, volume: 1, attenuation: 1, reliable: false, loop: "once" });
  }

  private readonly breachThink: Q2Think = (entity, game) => {
    const state = this.breaches.get(entity);
    if (state === undefined) return undefined;
    const body = game.body(entity), frame = game.host.frameSeconds();
    let pitch = normalizeAngle(state.goal.x), yaw = normalizeAngle(state.goal.y);
    if (pitch > 180) pitch -= 360;
    pitch = Math.max(state.pitchMin, Math.min(state.pitchMax, pitch));
    if (yaw < state.yawMin || yaw > state.yawMax) {
      const min = Math.abs(shortAngle(Math.abs(state.yawMin - yaw))), max = Math.abs(shortAngle(Math.abs(state.yawMax - yaw)));
      yaw = min < max ? state.yawMin : state.yawMax;
    }
    state.goal = { x: pitch, y: yaw, z: state.goal.z };
    const clamp = (delta: number): number => Math.max(-entity.speed * frame, Math.min(entity.speed * frame, shortAngle(delta))) / frame;
    entity.angularVelocity = { x: clamp(pitch - normalizeAngle(body.angles.x)), y: clamp(yaw - normalizeAngle(body.angles.y)), z: 0 };
    game.motion(entity, "push");
    for (const member of this.team(entity, game)) {
      member.angularVelocity = { ...member.angularVelocity, y: entity.angularVelocity.y }; game.motion(member, "push");
    }
    const owner = game.entity(entity.owner), driver = owner === null ? undefined : this.drivers.get(owner);
    if (owner !== null && driver !== undefined) {
      const driverBody = game.body(owner), radians = (body.angles.y + driver.yawOffset) * Math.PI / 180;
      const target = { x: snapQ2TurretEighth(body.origin.x + Math.cos(radians) * driver.radius),
        y: snapQ2TurretEighth(body.origin.y + Math.sin(radians) * driver.radius),
        z: snapQ2TurretEighth(body.origin.z + driver.radius * Math.tan(body.angles.x * Math.PI / 180) + driver.height) };
      owner.angularVelocity = { ...owner.angularVelocity, x: entity.angularVelocity.x, y: entity.angularVelocity.y };
      game.move(owner, { velocity: scale(subtract(target, driverBody.origin), 1 / frame) }, false); game.motion(owner, "push");
      if ((entity.spawnflags & 65536) !== 0) { this.fire(entity, game, state, owner); entity.spawnflags &= ~65536; }
    }
    return game.schedule(entity, frame, this.breachThink);
  };

  private readonly driverThink: Q2Think = (entity, game) => {
    const driver = this.drivers.get(entity);
    if (driver === undefined || driver.breach === null) return undefined;
    game.schedule(entity, game.host.frameSeconds(), this.driverThink);
    const { context } = driver, state = context.state;
    if (entity.enemy !== null && (!game.host.actors.isLive(entity.enemy) || (game.host.combat.read(entity.enemy)?.health ?? 0) <= 0)) entity.enemy = null;
    if (entity.enemy === null) {
      if (!context.findTarget()) return undefined;
      state.trailTime = game.host.now(); state.lostSight = false;
    } else if (visible(context)) {
      if (state.lostSight) { state.trailTime = game.host.now(); state.lostSight = false; }
    } else { state.lostSight = true; return undefined; }
    const enemy = entity.enemy === null ? null : game.host.bodies.read(entity.enemy), breach = this.breaches.get(driver.breach);
    if (enemy === null || breach === undefined) return undefined;
    const target = add(enemy.origin, { x: 0, y: 0, z: game.entity(entity.enemy)?.viewHeight ?? 22 });
    breach.goal = vectorAngles(subtract(target, game.body(driver.breach).origin));
    if (game.host.now() < state.attackFinished) return undefined;
    const reactionTime = 3 - game.options.skill;
    if (game.host.now() - state.trailTime < reactionTime) return undefined;
    state.attackFinished = game.host.now() + reactionTime + 1; driver.breach.spawnflags |= 65536;
    return undefined;
  };

  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    switch (entity.classname) {
      case "turret_base": this.blocked(entity, game); return true;
      case "turret_breach": {
        this.blocked(entity, game); entity.speed ||= 50; entity.damage ||= 10;
        const state: Breach = { goal: { x: 0, y: game.body(entity).angles.y, z: 0 }, muzzle: zero,
          pitchMax: -(numberField(entity.spawn, "minpitch") || -30), pitchMin: -(numberField(entity.spawn, "maxpitch") || 30),
          yawMin: numberField(entity.spawn, "minyaw"), yawMax: numberField(entity.spawn, "maxyaw") || 360 };
        this.breaches.set(entity, state);
        game.schedule(entity, game.host.frameSeconds(), (self, services) => {
          const muzzle = services.pickTarget(self.target);
          if (muzzle === null) services.host.diagnostic(`turret_breach missing muzzle target ${self.target}`);
          else { state.muzzle = subtract(services.body(muzzle).origin, services.body(self).origin); services.remove(muzzle); }
          const master = this.team(self, services)[0] ?? self; master.damage = self.damage;
          return this.breachThink(self, services);
        });
        return true;
      }
      case "turret_driver": {
        if (game.options.mode === "deathmatch") { game.remove(entity); return true; }
        const context = this.hooks.turretDriver(entity, game);
        const monsterDie = entity.die;
        if (monsterDie === null) throw new Error("Turret driver admission did not bind infantry death");
        const state: Driver = { context, breach: null, radius: 0, yawOffset: 0, height: 0 };
        this.drivers.set(entity, state);
        context.state.gibHealth = 0; context.state.standGround = true; context.state.ducked = true;
        entity.flags |= 2048; entity.serverFlags |= 4; entity.renderFlags |= 64; entity.viewHeight = 24;
        infantryStand(context); entity.frame = 0;
        entity.die = (self, services, reaction) => {
          if (state.breach !== null) {
            const breach = this.breaches.get(state.breach);
            if (breach !== undefined) breach.goal = { ...breach.goal, x: 0 };
            state.breach.owner = null;
            const master = this.team(state.breach, services)[0] ?? state.breach; master.owner = null;
            for (const member of this.team(state.breach, services)) {
              if (member.teamChain?.equals(self.actor.id)) { member.teamChain = self.teamChain; break; }
            }
          }
          state.breach = null; self.teamMaster = null; self.teamChain = null; self.flags &= ~1024; self.angularVelocity = zero;
          services.motion(self, "step");
          monsterDie(self, services, reaction);
          if (!context.state.gibbed && services.host.actors.isLive(self.actor.id)) this.hooks.resumeMonster(self, services);
          return undefined;
        };
        game.motion(entity, "push"); game.solid(entity, "box"); game.show(entity);
        game.schedule(entity, game.host.frameSeconds(), (self, services) => {
          const breach = services.pickTarget(self.target);
          if (breach === null || !this.breaches.has(breach)) { services.host.diagnostic(`turret_driver has invalid breach ${self.target}`); return undefined; }
          state.breach = breach; breach.owner = self.actor.id;
          const team = this.team(breach, services), master = team[0] ?? breach, last = team.at(-1) ?? breach;
          master.owner = self.actor.id; master.teamMaster = master.actor.id;
          last.teamChain = self.actor.id; self.teamMaster = master.actor.id; self.teamChain = null;
          const body = services.body(self), target = services.body(breach), delta = subtract(body.origin, target.origin);
          state.radius = length({ x: delta.x, y: delta.y, z: 0 }); state.yawOffset = normalizeAngle(vectorAngles(delta).y); state.height = delta.z;
          services.move(self, { angles: target.angles }, false); self.flags |= 1024;
          return services.schedule(self, services.host.frameSeconds(), this.driverThink);
        });
        return true;
      }
      default: return false;
    }
  }
}
