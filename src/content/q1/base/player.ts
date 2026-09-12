import type { Q1CharacterAttack } from "../foundation/types.ts";
/* player.qc/client.qc presentation and lifecycle. Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q1EntityServices } from "../foundation/entity-services.ts";
import { length, normalize, vadd, vscale } from "../foundation/types.ts";
import { spawnBubble } from "./map-entities.ts";
import { throwGib } from "./projectiles.ts";
import { SaveReader, encodeCheckpointValue, decodeCheckpointValue } from "../../../persistence/value.ts";

const characterTables = new WeakMap<Q1EntityServices, Map<OwnedActor, Q1CharacterActor>>();
function characterTable(game: Q1EntityServices): Map<OwnedActor, Q1CharacterActor> {
  let table = characterTables.get(game); if (table !== undefined) return table;
  const created = new Map<OwnedActor, Q1CharacterActor>(); table = created; characterTables.set(game, created);
  game.host.actors.onRelease(actor => { created.delete(actor); return undefined; }); return table;
}
export function registerCharacterCallbacks(game: Q1EntityServices): undefined {
  game.named.register("base:death_bubbles", { action: (runtime, timer) => {
    const owner = timer.owner === null ? null : runtime.host.actors.resolveOwned(timer.owner); if (owner === null) return runtime.remove(timer);
    const level = characterTable(runtime).get(owner)?.waterLevel ?? runtime.player(owner.id)?.waterLevel ?? 0;
    if (level !== 3) return undefined;
    const body = runtime.host.bodies.read(owner.id); if (body === null) return runtime.remove(timer);
    spawnBubble(runtime, vadd(body.origin, { x: 0, y: 0, z: 24 })); timer.count--;
    return timer.count <= 0 ? runtime.remove(timer) : runtime.schedule(timer, 0.1, runtime.named.action(timer, "base:death_bubbles"));
  } }); return undefined;
}

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
}
export interface Q1CharacterOptions {
  /** The chosen inventory provider owns the contents and conversion of a death drop. */
  readonly dropInventory?: () => undefined;
  /** Admission/respawn placement belongs to the shared session. */
  readonly requestRespawn?: () => undefined;
  /** Source animation state remains checkpointed by its campaign or arsenal owner. */
  readonly sourcePose?: () => Q1CharacterSourcePose;
  readonly fallDamageAllowed?: () => boolean;
}
export interface Q1CharacterFrameRange { readonly first: number; readonly count: number; }
export interface Q1CharacterDefinition {
  readonly model: string;
  readonly stand: Q1CharacterFrameRange;
  readonly run: Q1CharacterFrameRange;
  readonly pain: Q1CharacterFrameRange;
  readonly death: Q1CharacterFrameRange;
}
export interface Q1CharacterSourcePose {
  readonly axePose?: boolean;
  /** Alternate Q1 model layout, selected by the source arsenal or campaign. */
  readonly definition?: Q1CharacterDefinition;
  /** A source-owned attack frame, or null while shared locomotion/pain/death advances. */
  readonly frame: number | null;
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
  private attackAnimation = false;
  private walkFrame = 0;
  private locomotion: "stand" | "run" | null = null;
  private nextAnimation = 0;
  private painUntil = 0;
  private viewOffset: Vec3 = { x: 0, y: 0, z: 22 };
  private lastFallSpeed = 0;
  private airFinished = 12;
  private drownDamage = 2;
  private hazardAt = 0;
  private inWater = false;
  constructor(readonly game: Q1EntityServices, readonly actor: OwnedActor, readonly options: Q1CharacterOptions = {}) {
    game.host.actors.assertOwned(actor); this.airFinished = game.time + 12; characterTable(game).set(actor, this);
  }
  get waterLevel(): 0 | 1 | 2 | 3 { return this.input.waterLevel; }
  capture(): Uint8Array {
    return encodeCheckpointValue({ version: 3, input: this.input, life: this.life, model: this.model, modelFrame: this.modelFrame, animation: this.animation, animationFrame: this.animationFrame, attackAnimation: this.attackAnimation,
      walkFrame: this.walkFrame, locomotion: this.locomotion, nextAnimation: this.nextAnimation, painUntil: this.painUntil, viewOffset: this.viewOffset, lastFallSpeed: this.lastFallSpeed,
      airFinished: this.airFinished, drownDamage: this.drownDamage, hazardAt: this.hazardAt, inWater: this.inWater });
  }
  restore(bytes: Uint8Array): undefined {
    const reader = new SaveReader(decodeCheckpointValue(bytes), "q1:character"), version = reader.field("version").choice(1, 2, 3); const input = reader.field("input");
    this.input = { axePose: input.field("axePose").boolean(), attack: input.field("attack").boolean(), jump: input.field("jump").boolean(), use: input.field("use").boolean(), waterLevel: input.field("waterLevel").choice(0, 1, 2, 3), waterType: input.field("waterType").choice("empty", "water", "slime", "lava"), invisible: input.field("invisible").boolean(), invulnerable: input.field("invulnerable").boolean() };
    this.life = reader.field("life").choice("alive", "dying", "dead", "respawnable"); this.model = reader.field("model").string(); this.modelFrame = reader.field("modelFrame").number();
    this.animation = reader.field("animation").nullable(value => ({ first: value.field("first").integer(0), count: value.field("count").integer(1), end: value.field("end").choice("locomotion", "dead") }));
    this.animationFrame = reader.field("animationFrame").number(); this.attackAnimation = reader.field("attackAnimation").boolean(); this.walkFrame = reader.field("walkFrame").number();
    const restoredBody = this.game.host.bodies.read(this.actor.id);
    this.locomotion = version === 1 ? restoredBody === null ? null : restoredBody.velocity.x !== 0 || restoredBody.velocity.y !== 0 ? "run" : "stand" :
      reader.field("locomotion").nullable(value => value.choice("stand", "run"));
    this.nextAnimation = reader.field("nextAnimation").number(); this.painUntil = reader.field("painUntil").number();
    const vector = (value: SaveReader): Vec3 => ({ x: value.field("x").number(), y: value.field("y").number(), z: value.field("z").number() });
    this.viewOffset = vector(reader.field("viewOffset")); this.lastFallSpeed = reader.field("lastFallSpeed").number();
    this.airFinished = reader.field("airFinished").number(); this.drownDamage = reader.field("drownDamage").number(); this.hazardAt = reader.field("hazardAt").number(); this.inWater = reader.field("inWater").boolean(); return undefined;
  }
  get presentation(): Q1CharacterPresentation {
    const pose = this.life === "alive" ? this.options.sourcePose?.() : undefined;
    const model = this.life === "alive" ? this.input.invisible ? "progs/eyes.mdl" : pose?.definition?.model ?? "progs/player.mdl" : this.model;
    const frame = this.life === "alive" ? this.input.invisible ? 0 : pose?.frame ?? this.modelFrame : this.modelFrame;
    return { model, frame, viewOffset: this.viewOffset, life: this.life,
      solid: this.life === "alive" ? "slidebox" : "none", movement: this.life === "alive" ? "walk" : this.model === "progs/h_player.mdl" ? "bounce" : "toss", weaponVisible: this.life === "alive" };
  }
  private sound(path: string, attenuation = 1): undefined { return this.game.sound(this.actor, path, "voice", attenuation); }
  private animate(animation: PlayerAnimation, attack = false): undefined {
    this.animation = animation; this.attackAnimation = attack; this.animationFrame = 0; this.modelFrame = animation.first; this.nextAnimation = this.game.time + 0.1; return undefined;
  }
  private selectModel(pose: Q1CharacterSourcePose | undefined): undefined {
    if (this.life !== "alive") return undefined;
    const model = pose?.definition?.model ?? "progs/player.mdl";
    if (this.model === model) return undefined;
    this.model = model; this.animation = null; this.attackAnimation = false; this.walkFrame = 0; this.locomotion = null;
    this.modelFrame = pose?.definition?.stand.first ?? ((pose?.axePose ?? this.input.axePose) ? 17 : 12);
    this.nextAnimation = this.game.time; return undefined;
  }
  frame(seconds: number, incoming: Q1CharacterInput): Q1CharacterPresentation {
    this.game.time = seconds;
    const pose = this.options.sourcePose?.(), input = { ...incoming, axePose: pose?.axePose ?? incoming.axePose };
    this.input = input;
    this.selectModel(pose);
    const body = this.game.host.bodies.read(this.actor.id);
    const sourceAttack = this.life === "alive" && (pose?.frame ?? null) !== null;
    if (sourceAttack) { this.animation = null; this.attackAnimation = false; }
    if ((this.life === "dead" || this.life === "respawnable") && body !== null && body.ground !== null) {
      const speed = Math.max(0, length(body.velocity) - 20); this.game.host.bodies.write(this.actor, { ...body, velocity: vscale(normalize(body.velocity), speed) });
    }
    if (seconds >= this.nextAnimation && !sourceAttack) {
      this.nextAnimation = seconds + 0.1;
      const animation = this.animation;
      if (animation !== null) {
        this.animationFrame++;
        if (this.animationFrame < animation.count) this.modelFrame = animation.first + this.animationFrame;
        else { this.animation = null; this.attackAnimation = false; if (animation.end === "dead") this.life = "dead"; }
      }
      if (this.animation === null && this.life === "alive") {
        const running = body !== null && (body.velocity.x !== 0 || body.velocity.y !== 0);
        const locomotion = running ? "run" : "stand";
        if (this.locomotion !== locomotion) this.walkFrame = 0;
        this.locomotion = locomotion;
        const frames = (running ? pose?.definition?.run : pose?.definition?.stand) ?? {
          first: running ? input.axePose ? 0 : 6 : input.axePose ? 17 : 12, count: running ? 6 : input.axePose ? 12 : 5,
        };
        this.walkFrame %= frames.count; this.modelFrame = frames.first + this.walkFrame++;
      }
    }
    const pressed = input.attack || input.jump || input.use;
    if (this.life === "dead" && !pressed) this.life = "respawnable";
    else if (this.life === "respawnable" && pressed) this.options.requestRespawn?.();
    return this.presentation;
  }
  /** Called by the selected arsenal after an admitted shot, including foreign weapons using a Q1 pose. */
  attack(attack: Q1CharacterAttack): undefined {
    const { kind } = attack;
    if (this.life !== "alive") return undefined;
    const pose = this.options.sourcePose?.(); this.selectModel(pose);
    if (pose?.definition !== undefined || (pose?.frame ?? null) !== null) {
      this.animation = null; this.attackAnimation = false; return undefined;
    }
    if (kind === "axe") {
      const first = 119 + attack.variant * 6;
      return this.animate({ first, count: 6, end: "locomotion" }, true);
    }
    return this.animate({ first: kind === "shotgun" ? 113 : kind === "rocket" ? 107 : kind === "nail" ? 103 : 105, count: kind === "nail" || kind === "lightning" ? 2 : 6, end: "locomotion" }, true);
  }
  pain(attacker: ActorId | null, _damage = 0, axeHit = false): undefined {
    const pose = this.options.sourcePose?.();
    if (this.life !== "alive" || this.input.invisible || this.attackAnimation || (pose?.frame ?? null) !== null) return undefined;
    this.selectModel(pose);
    const { game, input } = this;
    if (attacker !== null && game.host.classname(attacker) === "teledeath") this.sound("player/teledth1.wav", 0);
    else if (input.waterLevel === 3 && input.waterType === "water") { this.bubbles(1); this.sound(game.host.random() > 0.5 ? "player/drown1.wav" : "player/drown2.wav"); }
    else if (input.waterType === "slime" || input.waterType === "lava") this.sound(game.host.random() > 0.5 ? "player/lburn1.wav" : "player/lburn2.wav");
    else if (this.painUntil <= game.time) { this.painUntil = game.time + 0.5; this.sound(axeHit ? "player/axhit1.wav" : `player/pain${Math.floor(game.host.random() * 5 + 1.5)}.wav`); }
    const frames = pose?.definition?.pain ?? { first: (pose?.axePose ?? input.axePose) ? 29 : 35, count: 6 };
    return this.animate({ ...frames, end: "locomotion" });
  }
  die(attacker: ActorId | null = null): undefined {
    if (this.life !== "alive") return undefined;
    const { game, actor } = this, body = game.host.bodies.read(actor.id); if (body === null) return undefined;
    const pose = this.options.sourcePose?.(), definition = pose?.definition;
    this.life = "dying"; this.model = definition?.model ?? "progs/player.mdl"; this.viewOffset = { x: 0, y: 0, z: -8 };
    if (game.health(actor.id) < -99) game.host.combat.setHealth(actor, -99);
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
    const animation = definition !== undefined ? { ...definition.death, end: "dead" } satisfies PlayerAnimation :
      (pose?.axePose ?? this.input.axePose) ? { first: 41, count: 9, end: "dead" } satisfies PlayerAnimation : deaths[Math.floor(game.host.random() * 6)];
    if (animation === undefined) throw new Error("Player death animation selection outside source random range"); return this.animate(animation);
  }
  respawn(health?: number): undefined {
    this.life = "alive"; this.model = "progs/player.mdl"; this.modelFrame = 12; this.animation = null; this.attackAnimation = false; this.walkFrame = 0; this.locomotion = null; this.painUntil = 0;
    this.viewOffset = { x: 0, y: 0, z: 22 }; this.airFinished = this.game.time + 12; this.drownDamage = 2;
    this.hazardAt = 0; this.inWater = false; this.lastFallSpeed = 0;
    this.selectModel(this.options.sourcePose?.());
    this.game.host.combat.setTraits(this.actor, { canTakeDamage: true }); if (health !== undefined) this.game.host.combat.setHealth(this.actor, health); return undefined;
  }
  /** Source kill/disconnect pose; the session applies its score and respawn/disconnect policy. */
  setSuicideFrame(): undefined { this.modelFrame = 60; this.life = "dead"; this.animation = null; this.attackAnimation = false; this.nextAnimation = Infinity; return undefined; }
  private bubbles(count: number): undefined {
    const timer = this.game.create("death_bubbles"); timer.owner = this.actor.id; timer.count = count;
    return this.game.schedule(timer, 0.1, this.game.named.action(timer, "base:death_bubbles"));
  }
  /** Call once after the selected movement provider; this applies Q1 landing rules. */
  postMove(): undefined {
    if (this.life !== "alive") return undefined;
    const { game, actor } = this, body = game.host.bodies.read(actor.id); if (body === null) return undefined;
    if (this.lastFallSpeed < -300 && body.ground !== null && game.health(actor.id) > 0) {
      if (this.input.waterType === "water") game.sound(actor, "player/h2ojump.wav", "body");
      else if (this.lastFallSpeed < -650 && (this.options.fallDamageAllowed?.() ?? true)) { game.damage(actor.id, game.world?.actor.id ?? actor.id, game.world?.actor.id ?? null, 5, null, "direct", "falling"); this.sound("player/land2.wav"); }
      else this.sound("player/land.wav");
      this.lastFallSpeed = 0;
    }
    if (body.ground === null) this.lastFallSpeed = body.velocity.z; return undefined;
  }
  /** The session selects this or another environmental rules provider exactly once per frame. */
  environment(seconds: number, suit = false, noclip = false): undefined {
    if (this.life !== "alive" || noclip) return undefined;
    const { game, actor, input } = this; game.time = seconds;
    if (input.waterLevel !== 3) {
      if (this.airFinished < seconds) this.sound("player/gasp2.wav"); else if (this.airFinished < seconds + 9) this.sound("player/gasp1.wav");
      this.airFinished = seconds + 12; this.drownDamage = 2;
    } else if (suit) this.airFinished = seconds + 12;
    else if (this.airFinished < seconds && this.painUntil < seconds) {
      this.drownDamage += 2; if (this.drownDamage > 15) this.drownDamage = 10;
      game.damage(actor.id, game.world?.actor.id ?? actor.id, game.world?.actor.id ?? null, this.drownDamage, null, "direct", "drown"); this.painUntil = seconds + 1;
    }
    if (input.waterLevel === 0) { if (this.inWater) game.sound(actor, "misc/outwater.wav", "body"); this.inWater = false; return undefined; }
    if (this.hazardAt < seconds && input.waterType === "lava") { this.hazardAt = seconds + (suit ? 1 : 0.2); game.damage(actor.id, game.world?.actor.id ?? actor.id, game.world?.actor.id ?? null, 10 * input.waterLevel, null, "direct", "lava"); }
    else if (this.hazardAt < seconds && input.waterType === "slime" && !suit) { this.hazardAt = seconds + 1; game.damage(actor.id, game.world?.actor.id ?? actor.id, game.world?.actor.id ?? null, 4 * input.waterLevel, null, "direct", "slime"); }
    if (!this.inWater) { game.sound(actor, input.waterType === "lava" ? "player/inlava.wav" : input.waterType === "slime" ? "player/slimbrn2.wav" : "player/inh2o.wav", "body"); this.inWater = true; this.hazardAt = 0; }
    return undefined;
  }
}
