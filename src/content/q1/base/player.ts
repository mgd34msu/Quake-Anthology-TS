/* player.qc/client.qc presentation and lifecycle. Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q1Foundation } from "../foundation/runtime.ts";
import { ZERO, length, normalize, vadd, vscale } from "../foundation/types.ts";
import { spawnBubble } from "./map-entities.ts";
import { throwGib } from "./projectiles.ts";

export type Q1PlayerLife = "alive" | "dying" | "dead" | "respawnable";
export interface Q1CharacterInput {
  readonly axePose: boolean;
  readonly attack: boolean;
  readonly jump: boolean;
  readonly use: boolean;
  readonly waterLevel: 0 | 1 | 2 | 3;
  readonly waterType: "empty" | "water" | "slime" | "lava";
  readonly invisible: boolean;
  readonly invulnerable: boolean;
}
export interface Q1CharacterPresentation {
  readonly model: string;
  readonly frame: number;
  readonly viewOffset: Vec3;
  readonly life: Q1PlayerLife;
  readonly solid: "slidebox" | "none";
  readonly movement: "walk" | "toss" | "bounce";
  readonly weaponVisible: boolean;
  readonly punch: Vec3;
}
export interface Q1CharacterOptions {
  /** The chosen inventory provider owns the contents and conversion of a death drop. */
  readonly dropInventory?: () => undefined;
  /** Admission/respawn placement belongs to the shared session. */
  readonly requestRespawn?: () => undefined;
}
interface PlayerAnimation { readonly first: number; readonly count: number; readonly end: "locomotion" | "dead"; }
const defaultInput: Q1CharacterInput = { axePose: false, attack: false, jump: false, use: false, waterLevel: 0, waterType: "empty", invisible: false, invulnerable: false };
const deaths: readonly PlayerAnimation[] = [
  { first: 50, count: 11, end: "dead" }, { first: 61, count: 9, end: "dead" }, { first: 70, count: 15, end: "dead" },
  { first: 85, count: 9, end: "dead" }, { first: 94, count: 9, end: "dead" }, { first: 94, count: 9, end: "dead" },
];

/** A character on an existing actor. It does not allocate actors, bind combat, or install an arsenal. */
export class Q1CharacterActor {
  private input: Q1CharacterInput = defaultInput;
  private life: Q1PlayerLife = "alive";
  private model = "progs/player.mdl";
  private modelFrame = 12;
  private animation: PlayerAnimation | null = null;
  private animationFrame = 0;
  private walkFrame = 0;
  private nextAnimation = 0;
  private painUntil = 0;
  private punch: Vec3 = ZERO;
  private viewOffset: Vec3 = { x: 0, y: 0, z: 22 };
  private lastFallSpeed = 0;
  private airFinished = 12;
  private drownDamage = 2;
  private drownAt = 0;
  private hazardAt = 0;
  private inWater = false;
  constructor(readonly game: Q1Foundation, readonly actor: OwnedActor, readonly options: Q1CharacterOptions = {}) {
    game.host.actors.assertOwned(actor); this.airFinished = game.time + 12;
  }
  get presentation(): Q1CharacterPresentation {
    return { model: this.life === "alive" && this.input.invisible ? "progs/eyes.mdl" : this.model, frame: this.modelFrame, viewOffset: this.viewOffset, life: this.life,
      solid: this.life === "alive" ? "slidebox" : "none", movement: this.life === "alive" ? "walk" : this.model === "progs/h_player.mdl" ? "bounce" : "toss", weaponVisible: this.life === "alive", punch: this.punch };
  }
  private sound(path: string, attenuation = 1): undefined { return this.game.sound(this.actor, path, "voice", attenuation); }
  private animate(animation: PlayerAnimation): undefined {
    this.animation = animation; this.animationFrame = 0; this.modelFrame = animation.first; this.nextAnimation = this.game.time + 0.1; return undefined;
  }
  frame(seconds: number, input: Q1CharacterInput): Q1CharacterPresentation {
    this.game.time = seconds; this.input = input;
    const body = this.game.host.bodies.read(this.actor.id);
    if (this.life !== "alive" && body !== null && body.ground !== null) {
      const speed = Math.max(0, length(body.velocity) - 20); this.game.host.bodies.write(this.actor, { ...body, velocity: vscale(normalize(body.velocity), speed) });
    }
    if (seconds >= this.nextAnimation) {
      this.nextAnimation = seconds + 0.1;
      const animation = this.animation;
      if (animation !== null) {
        this.animationFrame++;
        if (this.animationFrame < animation.count) this.modelFrame = animation.first + this.animationFrame;
        else { this.animation = null; if (animation.end === "dead") this.life = "dead"; }
      }
      if (this.animation === null && this.life === "alive") {
        const running = body !== null && (body.velocity.x !== 0 || body.velocity.y !== 0);
        const count = running ? 6 : input.axePose ? 12 : 5;
        this.walkFrame %= count; this.modelFrame = (running ? input.axePose ? 0 : 6 : input.axePose ? 17 : 12) + this.walkFrame++;
      }
    }
    const pressed = input.attack || input.jump || input.use;
    if (this.life === "dead" && !pressed) this.life = "respawnable";
    else if (this.life === "respawnable" && pressed) this.options.requestRespawn?.();
    return this.presentation;
  }
  /** Called by the selected arsenal after an admitted shot, including foreign weapons using a Q1 pose. */
  attack(kind: "axe" | "shotgun" | "rocket" | "nail" | "lightning"): undefined {
    if (this.life !== "alive") return undefined;
    if (kind === "axe") {
      const r = this.game.host.random(), first = r < 0.25 ? 119 : r < 0.5 ? 125 : r < 0.75 ? 131 : 137;
      return this.animate({ first, count: 6, end: "locomotion" });
    }
    return this.animate({ first: kind === "shotgun" ? 113 : kind === "rocket" ? 107 : kind === "nail" ? 103 : 105, count: kind === "nail" || kind === "lightning" ? 2 : 6, end: "locomotion" });
  }
  pain(attacker: ActorId | null, _damage = 0, axeHit = false): undefined {
    if (this.life !== "alive" || this.input.invisible || this.animation !== null) return undefined;
    const { game, input } = this;
    if (attacker !== null && game.host.classname(attacker) === "teledeath") this.sound("player/teledth1.wav", 0);
    else if (input.waterLevel === 3 && input.waterType === "water") { this.bubbles(1); this.sound(game.host.random() > 0.5 ? "player/drown1.wav" : "player/drown2.wav"); }
    else if (input.waterType === "slime" || input.waterType === "lava") this.sound(game.host.random() > 0.5 ? "player/lburn1.wav" : "player/lburn2.wav");
    else if (this.painUntil <= game.time) { this.painUntil = game.time + 0.5; this.sound(axeHit ? "player/axhit1.wav" : `player/pain${Math.floor(game.host.random() * 5 + 1.5)}.wav`); }
    return this.animate({ first: input.axePose ? 29 : 35, count: 6, end: "locomotion" });
  }
  die(attacker: ActorId | null = null): undefined {
    if (this.life !== "alive") return undefined;
    const { game, actor } = this, body = game.host.bodies.read(actor.id); if (body === null) return undefined;
    this.life = "dying"; this.model = "progs/player.mdl"; this.viewOffset = { x: 0, y: 0, z: -8 };
    game.host.combat.setTraits(actor, { canTakeDamage: false });
    const player = game.player(actor.id);
    if (player !== null) { for (const powerup of player.powerups.keys()) game.host.powerup(actor, powerup, 0); player.powerups.clear(); }
    if (game.options.deathmatch !== 0 || game.options.coop) this.options.dropInventory?.();
    let velocity = body.velocity; if (velocity.z < 10) velocity = { ...velocity, z: velocity.z + game.host.random() * 300 };
    game.host.bodies.write(actor, { ...body, velocity, ground: null });
    const health = game.health(actor.id);
    if (health < -40) {
      this.model = "progs/h_player.mdl"; this.modelFrame = 0; this.animation = null; this.life = "dead"; this.viewOffset = { x: 0, y: 0, z: 8 };
      const scale = health > -50 ? 0.7 : health > -200 ? 2 : 10;
      game.host.bodies.write(actor, { ...body, origin: vadd(body.origin, { x: 0, y: 0, z: -24 }), velocity: vscale({ x: 100 * (game.host.random() * 2 - 1), y: 100 * (game.host.random() * 2 - 1), z: 200 + 100 * game.host.random() }, scale), bounds: { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 56 } }, ground: null });
      for (const model of ["gib1", "gib2", "gib3"]) throwGib(game, body.origin, model, health);
      const cause = attacker === null ? "" : game.host.classname(attacker);
      this.sound(cause === "teledeath" || cause === "teledeath2" ? "player/teledth1.wav" : game.host.random() < 0.5 ? "player/gib.wav" : "player/udeath.wav", 0); return undefined;
    }
    if (this.input.waterLevel === 3) { this.bubbles(20); this.sound("player/h2odeath.wav", 0); }
    else this.sound(`player/death${Math.floor(game.host.random() * 4 + 1.5)}.wav`, 0);
    const current = game.host.bodies.read(actor.id); if (current !== null) game.host.bodies.write(actor, { ...current, angles: { x: 0, y: current.angles.y, z: 0 } });
    const animation = this.input.axePose ? { first: 41, count: 9, end: "dead" } satisfies PlayerAnimation : deaths[Math.floor(game.host.random() * 6)];
    if (animation === undefined) throw new Error("Player death animation selection outside source random range"); return this.animate(animation);
  }
  respawn(health?: number): undefined {
    this.life = "alive"; this.model = "progs/player.mdl"; this.modelFrame = 12; this.animation = null; this.walkFrame = 0; this.painUntil = 0;
    this.viewOffset = { x: 0, y: 0, z: 22 }; this.punch = ZERO; this.airFinished = this.game.time + 12; this.drownDamage = 2;
    this.drownAt = 0; this.hazardAt = 0; this.inWater = false; this.lastFallSpeed = 0;
    this.game.host.combat.setTraits(this.actor, { canTakeDamage: true }); if (health !== undefined) this.game.host.combat.setHealth(this.actor, health); return undefined;
  }
  private bubbles(count: number): undefined {
    const timer = this.game.create("death_bubbles"); let emitted = 0;
    const emit = (): undefined => {
      const body = this.game.host.bodies.read(this.actor.id);
      if (body === null || emitted >= count || this.input.waterLevel !== 3) return this.game.remove(timer);
      spawnBubble(this.game, vadd(body.origin, { x: 0, y: 0, z: 24 })); emitted++; return this.game.schedule(timer, 0.1, emit);
    }; return this.game.schedule(timer, 0.1, emit);
  }
  /** Call once after the selected movement provider; this applies Q1 landing rules. */
  postMove(): undefined {
    if (this.life !== "alive") return undefined;
    const { game, actor } = this, body = game.host.bodies.read(actor.id); if (body === null) return undefined;
    if (this.lastFallSpeed < -300 && body.ground !== null && game.health(actor.id) > 0) {
      if (this.input.waterType === "water") game.sound(actor, "player/h2ojump.wav", "body");
      else if (this.lastFallSpeed < -650) { game.damage(actor.id, game.world?.actor.id ?? actor.id, game.world?.actor.id ?? null, 5, null, "direct", "falling"); this.sound("player/land2.wav"); }
      else this.sound("player/land.wav");
      this.lastFallSpeed = 0;
    }
    if (body.ground === null) this.lastFallSpeed = body.velocity.z; return undefined;
  }
  /** The session selects this or another environmental rules provider exactly once per frame. */
  environment(seconds: number, suit = false): undefined {
    if (this.life !== "alive") return undefined;
    const { game, actor, input } = this; game.time = seconds;
    if (input.waterLevel !== 3 || suit) { this.airFinished = seconds + 12; this.drownDamage = 2; }
    else if (this.airFinished < seconds && this.drownAt < seconds) {
      this.drownDamage += 2; if (this.drownDamage > 15) this.drownDamage = 10;
      game.damage(actor.id, game.world?.actor.id ?? actor.id, game.world?.actor.id ?? null, this.drownDamage, null, "direct", "drown"); this.drownAt = seconds + 1;
    }
    if (input.waterLevel === 0) { if (this.inWater) game.sound(actor, "misc/outwater.wav", "body"); this.inWater = false; return undefined; }
    if (!this.inWater) { game.sound(actor, input.waterType === "lava" ? "player/inlava.wav" : input.waterType === "slime" ? "player/slimbrn2.wav" : "player/inh2o.wav", "body"); this.inWater = true; }
    if (this.hazardAt < seconds && input.waterType === "lava") { this.hazardAt = seconds + (suit ? 1 : 0.2); game.damage(actor.id, game.world?.actor.id ?? actor.id, game.world?.actor.id ?? null, 10 * input.waterLevel, null, "direct", "lava"); }
    else if (this.hazardAt < seconds && input.waterType === "slime" && !suit) { this.hazardAt = seconds + 1; game.damage(actor.id, game.world?.actor.id ?? actor.id, game.world?.actor.id ?? null, 4 * input.waterLevel, null, "direct", "slime"); }
    return undefined;
  }
}
