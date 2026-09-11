import type { DamageDecision } from "../../../../contracts/gameplay.ts";
import type { ActorId, OwnedActor } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { SavedActorId } from "../../../../contracts/session.ts";
import type { BodyState, DeathReaction, PainReaction } from "../../../../contracts/world.ts";
import type { SharedBodyTable } from "../../../../world/actors/body.ts";
import type { GameplayAuthority } from "../../../../world/gameplay/authority.ts";
import type { SharedInventoryTable } from "../../../../world/gameplay/inventory.ts";
import { Q2Entity } from "../../foundation/host.ts";
import type { Q2PresentationEvent } from "../../foundation/host.ts";
import type { Q2PlayerPowerups } from "../../foundation/items.ts";
import { add, dot, zero } from "../../foundation/fields.ts";
import { angleVectors } from "../../foundation/weapons/vectors.ts";
import { q2WorldEffects, q2FallingDamage } from "./environment.ts";
import { q2BuildView, q2ClientAnimation, q2ClientEffects, q2DamageFeedback } from "./view.ts";
import { createQ2PlayerRules, Q2PlayerState } from "./types.ts";
import type { Q2CharacterContext, Q2CharacterWeapon, Q2PlayerMovement, Q2PlayerRules, Q2PlayerView } from "./types.ts";
import { saveQ2Actor } from "../../foundation/checkpoint.ts";
import type { Q2CharacterCheckpoint } from "./checkpoint.ts";

export interface Q2CharacterGib {
  readonly model: string;
  readonly origin: Vec3;
  readonly velocity: Vec3;
  readonly angularVelocity: Vec3;
  readonly expiresAt: number;
}
export interface Q2CharacterHost {
  readonly bodies: SharedBodyTable;
  readonly combat: GameplayAuthority;
  readonly inventory: SharedInventoryTable;
  now(): number;
  random(): number;
  movement(actor: ActorId): Q2PlayerMovement;
  pointContents(point: Vec3): number;
  powerups(actor: ActorId): Readonly<Q2PlayerPowerups>;
  weapon(actor: ActorId): Q2CharacterWeapon | null;
  emit(event: Q2PresentationEvent): undefined;
  view(actor: ActorId, view: Q2PlayerView): undefined;
  noise(actor: ActorId, origin: Vec3): undefined;
  environmentDamage(actor: OwnedActor, amount: number, means: number, flags: number): undefined;
  /** The selected campaign/inventory owns death drops, scoring and respawn travel. */
  died(actor: OwnedActor, reaction: DeathReaction): undefined;
  requestRespawn(actor: OwnedActor): undefined;
  motion(actor: OwnedActor, kind: "toss" | "bounce", solid: "box" | "none"): undefined;
  spawnGib(gib: Q2CharacterGib): undefined;
}
export interface Q2CharacterOptions {
  readonly edition?: "classic" | "rerelease";
  readonly model: string;
  readonly skin: number;
  readonly slot: number;
  readonly mode: "singleplayer" | "coop" | "deathmatch";
  readonly deathmatchFlags: number;
  readonly environment: boolean;
  readonly viewRules?: Partial<Q2PlayerRules>;
}

/** A Q2 character on an existing actor. It allocates no actor, body, arsenal or inventory. */
export class Q2CharacterActor {
  readonly state: Q2PlayerState;
  readonly entity: Q2Entity;
  readonly rules: Q2PlayerRules;
  private painIndex = 0;
  private deathIndex = 0;
  constructor(readonly actor: OwnedActor, readonly host: Q2CharacterHost, readonly options: Q2CharacterOptions) {
    this.entity = new Q2Entity(actor, { classname: "player", ordinal: -1, values: new Map<string, string>() });
    this.entity.model = options.model; this.entity.skin = options.skin; this.entity.viewHeight = 22;
    this.entity.renderFlags = options.edition === "rerelease" ? 32768 : 0;
    this.state = new Q2PlayerState(options.slot, host.now()); this.state.airFinished = host.now() + 12;
    this.rules = createQ2PlayerRules(options.viewRules);
  }
  capture(): Q2CharacterCheckpoint {
    const { entity, state } = this, attack = entity.lastAttack;
    return { version: 1, painIndex: this.painIndex, deathIndex: this.deathIndex, state: structuredClone({ ...state, chaseTarget: saveQ2Actor(state.chaseTarget) }), rules: structuredClone(this.rules),
      entity: { model: entity.model, model2: entity.model2, model3: entity.model3, model4: entity.model4, skin: entity.skin, frame: entity.frame, oldFrame: entity.oldFrame, scale: entity.scale,
        effects: entity.effects, renderFlags: entity.renderFlags, flags: entity.flags, serverFlags: entity.serverFlags, viewHeight: entity.viewHeight, maxHealth: entity.maxHealth, sound: entity.sound, visible: entity.visible },
      lastAttack: attack === null ? null : structuredClone({ ...attack, attacker: saveQ2Actor(attack.attacker), inflictor: saveQ2Actor(attack.inflictor) }) };
  }
  restore(checkpoint: Q2CharacterCheckpoint, resolveActor: (actor: SavedActorId) => ActorId): undefined {
    this.painIndex = checkpoint.painIndex; this.deathIndex = checkpoint.deathIndex;
    const { chaseTarget, ...values } = structuredClone(checkpoint.state), attack = checkpoint.lastAttack;
    Object.assign(this.state, values); this.state.chaseTarget = chaseTarget === null ? null : resolveActor(chaseTarget);
    Object.assign(this.rules, structuredClone(checkpoint.rules)); Object.assign(this.entity, checkpoint.entity);
    this.entity.lastAttack = attack === null ? null : { ...attack, attacker: attack.attacker === null ? null : resolveActor(attack.attacker), inflictor: attack.inflictor === null ? null : resolveActor(attack.inflictor) };
    return undefined;
  }
  private body(): BodyState {
    const body = this.host.bodies.read(this.actor.id);
    if (body === null) throw new Error("Q2 character actor has no shared body");
    return body;
  }
  private context(): Q2CharacterContext {
    const actor = this.actor, host = this.host;
    return { entity: this.entity, state: this.state, rules: this.rules, movement: host.movement(actor.id), hooks: { noise: (id, origin) => host.noise(id, origin) },
      powerups: () => host.powerups(actor.id), weaponState: () => host.weapon(actor.id), environmentDamage: (amount, means, flags) => host.environmentDamage(actor, amount, means, flags),
      game: { host: { now: () => host.now(), random: () => host.random(), combat: host.combat, inventory: host.inventory, pointContents: point => host.pointContents(point), emit: event => host.emit(event) },
        options: { mode: this.options.mode, deathmatchFlags: this.options.deathmatchFlags, edition: this.options.edition ?? "classic" }, body: () => this.body(),
        move: (_entity, changes, link = true) => { host.bodies.write(actor, { ...this.body(), ...changes }); if (link) host.bodies.link(actor); return undefined; },
        sound: (_entity, path, channel = 2, volume = 1, attenuation = 1) => host.emit({ kind: "sound", actor: actor.id, origin: this.body().origin, path, channel, volume, attenuation, reliable: false, loop: "once" }) } };
  }
  pain(_reaction: PainReaction): undefined { return undefined; }
  recordDamage(decision: DamageDecision): undefined {
    this.entity.lastAttack = decision.request.attack;
    if (decision.reaction === "death") return undefined;
    const feedback = decision.feedback;
    this.state.damageBlood += feedback?.blood ?? decision.appliedDamage;
    this.state.damageArmor += feedback?.armor ?? 0; this.state.damagePowerArmor += feedback?.powerArmor ?? 0;
    this.state.damageKnockback += feedback?.knockback ?? decision.request.knockback; this.state.damageFrom = decision.request.point;
    if ((feedback?.powerArmor ?? 0) > 0) this.state.powerArmorTime = this.host.now() + 0.2;
    return undefined;
  }
  die(reaction: DeathReaction): undefined {
    const { host, actor, state, entity } = this, body = this.body(), first = !state.dead;
    host.bodies.write(actor, { ...body, angles: { x: 0, y: body.angles.y, z: 0 }, bounds: { ...body.bounds, max: { ...body.bounds.max, z: -8 } } });
    host.motion(actor, "toss", "box");
    if (first) {
      state.dead = true; state.respawnTime = host.now() + 1;
      const attacker = reaction.attacker === actor.id ? null : reaction.attacker;
      const killer = attacker === null ? reaction.inflictor === null || reaction.inflictor === actor.id ? null : host.bodies.read(reaction.inflictor) : host.bodies.read(attacker);
      state.killerYaw = killer === null ? body.angles.y : (Math.atan2(killer.origin.y - body.origin.y, killer.origin.x - body.origin.x) * 180 / Math.PI + 360) % 360;
      host.died(actor, reaction);
    }
    const health = host.combat.read(actor.id)?.health ?? 0;
    if (health < -40 && !state.gibbed) {
      this.sound("misc/udeath.wav", 4);
      const half = { x: (body.bounds.max.x - body.bounds.min.x) * 0.5, y: (body.bounds.max.y - body.bounds.min.y) * 0.5, z: (body.bounds.max.z - body.bounds.min.z) * 0.5 };
      const center = add(body.origin, add(body.bounds.min, half));
      for (let index = 0; index < 4; index++) {
        const origin = add(center, { x: (host.random() * 2 - 1) * half.x, y: (host.random() * 2 - 1) * half.y, z: (host.random() * 2 - 1) * half.z });
        const impulse = this.gibVelocity(reaction.damage), velocity = add(body.velocity, { x: impulse.x * 0.5, y: impulse.y * 0.5, z: impulse.z * 0.5 });
        host.spawnGib({ model: "models/objects/gibs/sm_meat/tris.md2", origin,
          velocity: { x: Math.max(-300, Math.min(300, velocity.x)), y: Math.max(-300, Math.min(300, velocity.y)), z: Math.max(200, Math.min(500, velocity.z)) },
          angularVelocity: { x: host.random() * 600, y: host.random() * 600, z: host.random() * 600 }, expiresAt: host.now() + 10 + host.random() * 10 });
      }
      const head = host.random() < 0.5;
      entity.model = head ? "models/objects/gibs/head2/tris.md2" : "models/objects/gibs/skull/tris.md2"; entity.skin = head ? 1 : 0; entity.frame = 0; entity.effects = 2;
      host.bodies.write(actor, { ...this.body(), origin: add(this.body().origin, { x: 0, y: 0, z: 32 }), velocity: add(this.body().velocity, this.gibVelocity(reaction.damage)),
        bounds: { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 16 } } });
      host.motion(actor, "bounce", "none"); host.combat.setTraits(actor, { canTakeDamage: false }); state.gibbed = true;
    } else if (first) {
      this.deathIndex = (this.deathIndex + 1) % 3; state.animationPriority = 5;
      const ducked = host.movement(actor.id).ducked;
      entity.frame = ducked ? 172 : this.deathIndex === 0 ? 177 : this.deathIndex === 1 ? 183 : 189;
      state.animationEnd = ducked ? 177 : this.deathIndex === 0 ? 183 : this.deathIndex === 1 ? 189 : 197;
      this.sound(`*death${Math.floor(host.random() * 4) + 1}.wav`, 2);
    }
    host.bodies.link(actor); this.show(); return undefined;
  }
  private gibVelocity(damage: number): Vec3 {
    const factor = damage < 50 ? 0.7 : 1.2;
    return { x: (this.host.random() * 2 - 1) * 100 * factor, y: (this.host.random() * 2 - 1) * 100 * factor, z: (200 + this.host.random() * 100) * factor };
  }
  private sound(path: string, channel: number): undefined {
    return this.host.emit({ kind: "sound", actor: this.actor.id, origin: this.body().origin, path, channel, volume: 1, attenuation: 1, reliable: false, loop: "once" });
  }
  private show(): undefined {
    const entity = this.entity;
    return this.host.emit({ kind: "model", actor: this.actor.id, path: entity.model, attachedModels: [entity.model2, entity.model3, entity.model4], frame: entity.frame, oldFrame: entity.oldFrame, scale: entity.scale, alpha: entity.alpha, skin: entity.skin, effects: entity.effects, renderFlags: entity.renderFlags });
  }
  afterClientThink(): undefined {
    const buttons = this.host.movement(this.actor.id).buttons;
    this.state.latchedButtons |= buttons & ~this.state.buttons; this.state.buttons = buttons;
    return undefined;
  }
  beginFrame(): undefined {
    const state = this.state;
    if (state.dead && this.host.now() > state.respawnTime && ((state.latchedButtons & (this.options.mode === "deathmatch" ? 1 : -1)) !== 0 ||
      this.options.mode === "deathmatch" && (this.options.deathmatchFlags & 1024) !== 0)) {
      state.latchedButtons = 0; return this.host.requestRespawn(this.actor);
    }
    if (!state.dead) state.latchedButtons = 0;
    return undefined;
  }
  /** Called after selected campaign and inventory owners have respawned the same actor. */
  respawned(): undefined {
    this.state.dead = false; this.state.gibbed = false; this.state.respawnTime = this.host.now(); this.state.airFinished = this.host.now() + 12;
    this.state.drownDamage = 2; this.state.oldWaterLevel = 0; this.state.oldVelocity = zero; this.state.damageAlpha = 0; this.state.bonusAlpha = 0;
    this.state.fallTime = 0; this.state.damageTime = 0; this.state.damageBlood = 0; this.state.damageArmor = 0; this.state.damagePowerArmor = 0; this.state.damageKnockback = 0;
    this.state.animationPriority = 0; this.state.animationEnd = 39; this.entity.frame = 0; this.entity.model = this.options.model; this.entity.skin = this.options.skin;
    this.entity.effects = 0; this.entity.renderFlags = this.options.edition === "rerelease" ? 32768 : 0; this.entity.viewHeight = 22; this.state.event = "q2:player-teleport";
    return this.show();
  }
  setAnimation(priority: "attack" | "pain" | "reverse", first: number, last: number): undefined {
    this.state.animationPriority = priority === "attack" ? 4 : priority === "pain" ? 3 : 6;
    this.entity.frame = first; this.state.animationEnd = last;
    return undefined;
  }
  endFrame(intermission = false): undefined {
    const context = this.context(), { state, host, actor } = this, movement = context.movement;
    if (intermission) return host.view(actor.id, q2BuildView(context, 0, true));
    if (this.options.environment) q2WorldEffects(context);
    const body = this.body(), vectors = angleVectors(movement.viewAngles), side = dot(body.velocity, vectors.right);
    const roll = (side < 0 ? -1 : 1) * Math.min(Math.abs(side) * this.rules.rollAngle / this.rules.rollSpeed, this.rules.rollAngle);
    host.bodies.write(actor, { ...body, angles: { x: (movement.viewAngles.x > 180 ? movement.viewAngles.x - 360 : movement.viewAngles.x) / 3, y: movement.viewAngles.y, z: roll * 4 } });
    const speed = Math.hypot(body.velocity.x, body.velocity.y);
    if (speed < 5) { state.bobMove = 0; state.bobTime = 0; }
    else if (movement.grounded) state.bobMove = speed > 210 ? 0.25 : speed > 100 ? 0.125 : 0.0625;
    state.bobTime += state.bobMove;
    if (this.options.environment) q2FallingDamage(context);
    const feedback = q2DamageFeedback(context, this.painIndex); this.painIndex = feedback.painIndex;
    const view = q2BuildView(context, feedback.flashes, false); host.view(actor.id, view);
    const cycle = Math.trunc(movement.ducked ? state.bobTime * 4 : state.bobTime);
    if (state.event === "" && movement.grounded && speed > 225 && Math.trunc(state.bobTime + state.bobMove) !== cycle) state.event = "q2:footstep";
    if (state.event !== "") {
      const event = state.event === "q2:footstep" ? 2 : state.event === "q2:fall-short" ? 3 : state.event === "q2:fall" ? 4 : state.event === "q2:fall-far" ? 5 : state.event === "q2:player-teleport" ? 6 : null;
      if (event !== null) host.emit({ kind: "entity-event", actor: actor.id, event });
      else host.emit({ kind: "effect", effect: state.event, origin: this.body().origin, direction: zero, count: 1, color: 0 });
      state.event = "";
    }
    q2ClientEffects(context); q2ClientAnimation(context);
    state.oldVelocity = this.body().velocity; state.oldViewAngles = view.angles;
    return this.show();
  }
}
