/* Quake II p_weapon.c / rerelease p_weapon.cpp. Copyright id Software.
 * GPL-2.0-or-later. The caller supplies the source clock and shared actor state. */
import type { Vec3 } from "../../../../contracts/math.ts";
import { add, normalize, scale, subtract, zero } from "../fields.ts";
import type { Q2Entity, Q2GameServices } from "../host.ts";
import { Q2Ballistics } from "./ballistics.ts";
import { Q2_BASE_WEAPONS } from "./definitions.ts";
import { angleVectors } from "./vectors.ts";
import { MOD, PLAYER_CONTENTS, Q2WeaponState } from "./types.ts";
import type { Q2WeaponDefinition, Q2WeaponInput, Q2WeaponName } from "./types.ts";
import type { Q2NoiseRecord } from "./types.ts";
import type { Q2NoiseCheckpoint, Q2WeaponsCheckpoint } from "./checkpoint.ts";
import { restoreQ2Actor } from "../checkpoint.ts";

export type Q2WeaponSelection = "selected" | "current" | "not-owned" | "no-ammo" | "not-enough-ammo";
function millisecondSum(time: number, seconds: number): number { return (Math.round(time * 1000) + Math.round(seconds * 1000)) / 1000; }
export interface Q2WeaponContext {
  readonly self: Q2Entity;
  readonly game: Q2GameServices;
  readonly state: Q2WeaponState;
  readonly input: Q2WeaponInput;
  readonly definition: Q2WeaponDefinition;
  readonly now: number;
  readonly rerelease: boolean;
  readonly silenced: boolean;
}

export interface Q2WeaponExtension {
  readonly definition: Q2WeaponDefinition;
  fire(context: Q2WeaponContext, weapons: Q2Weapons): undefined;
  readonly think?: (context: Q2WeaponContext, weapons: Q2Weapons) => undefined;
  readonly held?: (context: Q2WeaponContext, weapons: Q2Weapons, held: boolean) => undefined;
  readonly selection?: { readonly requested: Q2WeaponName; choose(self: Q2Entity, game: Q2GameServices, state: Q2WeaponState): boolean };
}

export interface Q2ThrowDefinition {
  readonly soundFrame: number;
  readonly holdFrame: number;
  readonly fireFrame: number;
  readonly cockSound: string;
  readonly holdSound: string;
  readonly explode: boolean;
  readonly wrapBeforePause: boolean;
  readonly releaseHeld: boolean;
  fire(context: Q2WeaponContext, held: boolean): undefined;
}

export type Q2WeaponSourceRules =
  | { readonly kind: "ctf"; haste(context: Q2WeaponContext): boolean; strengthSound(context: Q2WeaponContext): boolean; hasteSound(context: Q2WeaponContext): undefined }
  | { readonly kind: "lmctf"; postNativeThink(context: Q2WeaponContext, repeat: () => undefined): undefined };

export class Q2Weapons extends Q2Ballistics {
  private readonly definitions = new Map<string, Q2WeaponDefinition>(Q2_BASE_WEAPONS.map(definition => [definition.name, definition]));
  private readonly extensions = new Map<string, Q2WeaponExtension>();
  private fallbackOrder: readonly Q2WeaponName[] | null = null;
  private sourceRules: Q2WeaponSourceRules | null = null;

  setSourceRules(rules: Q2WeaponSourceRules): undefined {
    if (this.sourceRules !== null) throw new Error(`Q2 source weapon rules already selected: ${this.sourceRules.kind}`);
    this.sourceRules = rules; return undefined;
  }

  capture(game: Q2GameServices): Q2WeaponsCheckpoint {
    const saveNoise = (noise: Q2NoiseRecord | null): Q2NoiseCheckpoint | null => noise === null ? null : {
      actor: { slot: noise.actor.slot, generation: noise.actor.generation }, origin: { ...noise.origin }, time: noise.time, secondary: noise.secondary };
    return { sourceRules: this.sourceRules?.kind ?? "base", registered: [...this.definitions.keys()], fallbackOrder: this.fallbackOrder === null ? null : [...this.fallbackOrder],
      states: [...this.states].filter(([actor]) => game.host.actors.isLive(actor)).map(([actor, state]) => ({
        actor: { slot: actor.slot, generation: actor.generation }, state: { ...state, kickAngles: { ...state.kickAngles }, kickOrigin: { ...state.kickOrigin } } })),
      inputs: [...this.inputs].filter(([actor]) => game.host.actors.isLive(actor)).map(([actor, input]) => ({
        actor: { slot: actor.slot, generation: actor.generation }, input: { ...input, angles: { ...input.angles } } })),
      noises: [...this.noises].filter(([actor]) => game.host.actors.isLive(actor)).map(([actor, records]) => ({
        actor: { slot: actor.slot, generation: actor.generation }, primary: saveNoise(records.primary), secondary: saveNoise(records.secondary) })),
      soundEntity: saveNoise(this.soundEntity), sound2Entity: saveNoise(this.sound2Entity),
      blasterCauses: [...this.blasterCauses].filter(([actor]) => game.host.actors.isLive(actor)).map(([actor, meansOfDeath]) => ({ actor: { slot: actor.slot, generation: actor.generation }, meansOfDeath })),
    };
  }

  restore(game: Q2GameServices, checkpoint: Q2WeaponsCheckpoint): undefined {
    if (checkpoint.sourceRules !== (this.sourceRules?.kind ?? "base")) throw new Error("Q2 weapon checkpoint source rules differ from the selected game module");
    if (checkpoint.registered.length !== this.definitions.size || checkpoint.registered.some(name => !this.definitions.has(name))) throw new Error("Q2 weapon checkpoint arsenal differs from the selected source modules");
    this.states.clear(); this.inputs.clear(); this.noises.clear(); this.blasterCauses.clear();
    this.fallbackOrder = checkpoint.fallbackOrder === null ? null : [...checkpoint.fallbackOrder];
    if (this.fallbackOrder !== null) for (const name of this.fallbackOrder) this.definition(name);
    const restoreNoise = (noise: Q2NoiseCheckpoint | null): Q2NoiseRecord | null => noise === null ? null : {
      actor: game.host.actors.resolveSaved(noise.actor)?.id ?? game.host.actors.referenceSaved(noise.actor), origin: { ...noise.origin }, time: noise.time, secondary: noise.secondary };
    for (const saved of checkpoint.states) {
      const entity = game.entity(restoreQ2Actor(game, saved.actor).id);
      if (entity === null) throw new Error("Q2 weapon checkpoint has no admitted source player");
      for (const name of [saved.state.weapon, saved.state.pending, saved.state.lastWeapon]) if (name !== null) this.definition(name);
      const state = Object.assign(new Q2WeaponState(saved.state.weapon), saved.state, { kickAngles: { ...saved.state.kickAngles }, kickOrigin: { ...saved.state.kickOrigin } });
      this.bind(entity, game, state);
    }
    for (const saved of checkpoint.inputs) this.inputs.set(restoreQ2Actor(game, saved.actor).id, { ...saved.input, angles: { ...saved.input.angles } });
    for (const saved of checkpoint.noises) this.noises.set(restoreQ2Actor(game, saved.actor).id, { primary: restoreNoise(saved.primary), secondary: restoreNoise(saved.secondary) });
    this.soundEntity = restoreNoise(checkpoint.soundEntity); this.sound2Entity = restoreNoise(checkpoint.sound2Entity);
    for (const saved of checkpoint.blasterCauses) this.blasterCauses.set(restoreQ2Actor(game, saved.actor).id, saved.meansOfDeath);
    return game.sourceCallbacks.register(this.callbacks);
  }

  register(extension: Q2WeaponExtension): undefined {
    if (this.definitions.has(extension.definition.name)) throw new Error(`Q2 weapon already registered: ${extension.definition.name}`);
    this.definitions.set(extension.definition.name, extension.definition); this.extensions.set(extension.definition.name, extension);
    return undefined;
  }

  definition(name: Q2WeaponName): Q2WeaponDefinition {
    const definition = this.definitions.get(name);
    if (definition === undefined) throw new Error(`Q2 weapon is not registered: ${name}`);
    return definition;
  }

  definitionFromClassname(classname: string): Q2WeaponDefinition | null {
    for (const definition of this.definitions.values()) if (definition.classname === classname) return definition;
    return null;
  }

  registeredDefinitions(): readonly Q2WeaponDefinition[] { return [...this.definitions.values()]; }

  setFallbackOrder(order: readonly Q2WeaponName[]): undefined {
    for (const name of order) this.definition(name);
    this.fallbackOrder = [...order]; return undefined;
  }
  bind(self: Q2Entity, game: Q2GameServices, state = new Q2WeaponState()): Q2WeaponState {
    game.host.actors.assertOwned(self.actor);
    if (this.states.has(self.actor.id)) throw new Error("Q2 weapon state already bound to actor");
    this.states.set(self.actor.id, state);
    const removeListener = game.host.actors.onRelease(actor => {
      if (actor.id === self.actor.id) { this.states.delete(actor.id); this.inputs.delete(actor.id); this.noises.delete(actor.id); removeListener(); }
      return undefined;
    });
    return state;
  }

  requestWeapon(self: Q2Entity, game: Q2GameServices, name: Q2WeaponName, allowEmpty = false): Q2WeaponSelection {
    const state = this.requireState(self);
    for (const extension of this.extensions.values()) if (extension.selection?.requested === name && extension.selection.choose(self, game, state)) { name = extension.definition.name; break; }
    const definition = this.definition(name);
    if (state.weapon === name) return "current";
    if (game.host.inventory.count(self.actor.id, definition.item) < 1) return "not-owned";
    if (!allowEmpty && definition.ammo !== null && definition.ammo !== definition.item) {
      const ammo = game.host.inventory.count(self.actor.id, definition.ammo);
      if (ammo === 0) return "no-ammo";
      if (ammo < definition.quantity) return "not-enough-ammo";
    }
    state.pending = name;
    return "selected";
  }

  canDrop(self: Q2Entity, game: Q2GameServices, name: Q2WeaponName): boolean {
    if ((game.options.deathmatchFlags & 4) !== 0) return false;
    const state = this.requireState(self), count = game.host.inventory.count(self.actor.id, this.definition(name).item);
    return count > 0 && !((state.weapon === name || state.pending === name) && count === 1);
  }

  /** Classic callers invoke this on their 10 Hz weapon turn, including ClientThink's one early thunk. */
  tick(self: Q2Entity, game: Q2GameServices, input: Q2WeaponInput): undefined {
    const state = this.requireState(self), now = game.host.now();
    this.inputs.set(self.actor.id, input);
    state.latchedAttack ||= input.latchedAttack;
    if (input.spectator) return undefined;
    if ((game.host.combat.read(self.actor.id)?.health ?? 0) < 1) {
      if (state.grenadeTime !== 0 && (state.weapon === "grenades" || game.options.edition === "rerelease")) {
        const context = this.context(self, game, state, input);
        if (context !== null) {
          if (!context.rerelease) state.grenadeTime = now;
          this.fireHeld(context, context.rerelease);
        }
      }
      state.pending = null;
      this.changeWeapon(self, game, state, input);
      this.present(self, game, state);
      return undefined;
    }
    if (state.weapon === null) {
      if (state.pending !== null) this.changeWeapon(self, game, state, input);
      this.present(self, game, state);
      return undefined;
    }
    const classicSilenced = state.silencerShots > 0;
    const run = (): undefined => {
      const context = this.context(self, game, state, input, game.options.edition === "classic" ? classicSilenced : state.silencerShots > 0);
      if (context === null) return undefined;
      const extension = this.extensions.get(context.definition.name);
      if (extension?.think !== undefined) return extension.think(context, this);
      if (state.weapon === "grenades") return context.rerelease ? this.throwRerelease(context) : this.throwClassic(context);
      return context.rerelease ? this.genericRerelease(context) : this.genericClassic(context);
    };
    run();
    if (this.sourceRules?.kind === "lmctf") {
      const context = this.context(self, game, state, input, classicSilenced);
      if (context !== null) this.sourceRules.postNativeThink(context, run);
    }
    if (game.options.edition === "rerelease" && game.host.frameSeconds() > 0.033) {
      const context = this.context(self, game, state, input);
      if (context !== null) {
        const interval = this.animationTime(context);
        if (interval < game.host.frameSeconds()) {
          let remaining = Math.round(millisecondSum(now, game.host.frameSeconds()) * 1000) - Math.round(state.thinkTime * 1000);
          while (remaining > 0) { state.thinkTime = millisecondSum(state.thinkTime, -interval); state.fireFinished = millisecondSum(state.fireFinished, -interval); run(); remaining -= Math.round(interval * 1000); }
        }
      }
    } else if (game.options.edition === "classic" && input.quadFireUntil > now) run();
    this.present(self, game, state);
    return undefined;
  }

  private requireState(self: Q2Entity): Q2WeaponState {
    const state = this.states.get(self.actor.id);
    if (state === undefined) throw new Error("Q2 player weapon state is not bound");
    return state;
  }

  private context(self: Q2Entity, game: Q2GameServices, state: Q2WeaponState, input: Q2WeaponInput, silenced = state.silencerShots > 0): Q2WeaponContext | null {
    return state.weapon === null ? null : { self, game, state, input, definition: this.definition(state.weapon), now: game.host.now(), rerelease: game.options.edition === "rerelease", silenced };
  }

  ammo(context: Q2WeaponContext): number {
    return context.definition.ammo === null ? Infinity : context.game.host.inventory.count(context.self.actor.id, context.definition.ammo);
  }

  consume(context: Q2WeaponContext, count = context.definition.quantity, infinite = true): undefined {
    const { self, game, definition } = context;
    if (definition.ammo === null || infinite && (context.rerelease ? context.input.infiniteAmmo : (game.options.deathmatchFlags & 8192) !== 0)) return undefined;
    const before = this.ammo(context);
    if (!game.host.inventory.consume(self.actor, definition.ammo, count)) throw new Error("Q2 weapon fired without its admitted ammunition");
    if (context.rerelease && before > definition.warning && this.ammo(context) <= definition.warning) game.sound(self, "weapons/lowammo.wav", 0);
    return this.hooks.ammoChanged(self.actor.id, definition.ammo);
  }

  noAmmo(context: Q2WeaponContext, sound = true): undefined {
    const { self, game, state, now, rerelease } = context;
    if (sound && now >= state.emptySoundTime) { game.sound(self, "weapons/noammo.wav", rerelease ? 1 : 2); state.emptySoundTime = now + 1; }
    const order: readonly Q2WeaponName[] = this.fallbackOrder ?? (rerelease
      ? ["railgun", "hyperblaster", "chaingun", "machinegun", "supershotgun", "shotgun", "rocketlauncher", "grenadelauncher", "blaster"]
      : ["railgun", "hyperblaster", "chaingun", "machinegun", "supershotgun", "shotgun", "blaster"]);
    for (const name of order) {
      const definition = this.definition(name);
      if (name !== "blaster" && game.host.inventory.count(self.actor.id, definition.item) === 0) continue;
      if (definition.ammo !== null && game.host.inventory.count(self.actor.id, definition.ammo) < definition.quantity) continue;
      state.pending = name; break;
    }
    return undefined;
  }

  animation(context: Q2WeaponContext, priority: "attack" | "pain" | "reverse", first: number, last: number): undefined {
    if (!context.input.animatePlayer) return undefined;
    return this.hooks.emit({ kind: "player-animation", actor: context.self.actor.id, priority, first, last, resetTime: context.rerelease });
  }

  attackAnimation(context: Q2WeaponContext, offset = 1): undefined {
    return this.animation(context, "attack", (context.input.ducked ? 160 : 46) - offset, context.input.ducked ? 168 : 53);
  }

  private reverseAnimation(context: Q2WeaponContext): undefined {
    return this.animation(context, "reverse", context.input.ducked ? 173 : 66, context.input.ducked ? 169 : 62);
  }

  changeWeapon(self: Q2Entity, game: Q2GameServices, state: Q2WeaponState, input: Q2WeaponInput): undefined {
    if (game.options.edition === "rerelease" && (game.host.combat.read(self.actor.id)?.health ?? 0) > 0 && !input.instantSwitch && input.holster) return undefined;
    if (state.grenadeTime !== 0 && (state.weapon === "grenades" || game.options.edition === "rerelease")) {
      const old = this.context(self, game, state, input);
      if (old !== null) { if (!old.rerelease) state.grenadeTime = game.host.now(); this.fireHeld(old, false); }
    }
    state.grenadeTime = 0;
    if (state.weapon !== null && state.pending !== null && state.pending !== state.weapon && game.options.edition === "rerelease") game.sound(self, "weapons/change.wav", 1);
    state.lastWeapon = state.weapon; state.weapon = state.pending; state.pending = null; state.machinegunShots = 0; state.viewModel = null; state.viewSkin = 0;
    this.setLoop(self, game, state, "");
    if (state.weapon === null) return undefined;
    state.phase = "activating"; state.frame = 0;
    const context = this.context(self, game, state, input);
    if (context !== null) this.animation(context, "pain", input.ducked ? 169 : 62, input.ducked ? 172 : 65);
    if (game.options.edition === "rerelease" && input.instantSwitch && context !== null) {
      const extension = this.extensions.get(context.definition.name);
      if (extension?.think !== undefined) extension.think(context, this);
      else if (state.weapon === "grenades") this.throwRerelease(context);
      else this.genericRerelease(context);
    }
    return undefined;
  }

  animationTime(context: Q2WeaponContext): number {
    const { state, input, game } = context;
    let rate = input.quickSwitch && game.host.frameSeconds() <= 0.05 && (state.phase === "activating" || state.phase === "dropping") ? 20 : 10;
    if (state.frame !== 0) { if (input.quadFireUntil > context.now) rate *= 2; if (input.haste) rate *= 2; }
    state.gunRate = rate;
    // rerelease gtime_t keeps integral milliseconds.
    return Math.trunc(1000 / rate) / 1000;
  }

  genericClassic(context: Q2WeaponContext): undefined {
    const phase = context.state.phase;
    this.genericClassicFrame(context);
    if (this.sourceRules?.kind !== "ctf") return undefined;
    const grapple = context.state.weapon === "grapple";
    if (grapple && context.state.phase === "firing") return undefined;
    return (this.sourceRules.haste(context) || grapple) && phase === context.state.phase ? this.genericClassicFrame(context) : undefined;
  }

  private genericClassicFrame(context: Q2WeaponContext): undefined {
    const { state, definition: d, input, self, game } = context;
    if (this.sourceRules?.kind === "lmctf") state.sourceFiring = false;
    const idleFirst = d.fireLast + 1;
    if (state.phase === "dropping") {
      if (state.frame === d.deactivateLast) return this.changeWeapon(self, game, state, input);
      if (d.deactivateLast - state.frame === 4) this.reverseAnimation(context);
      state.frame++; return undefined;
    }
    if (state.phase === "activating") {
      if (state.frame === d.activateLast) { state.phase = "ready"; state.frame = idleFirst; }
      else state.frame++;
      return undefined;
    }
    if (state.pending !== null && state.phase !== "firing") {
      state.phase = "dropping"; state.frame = d.idleLast + 1;
      if (d.deactivateLast - state.frame < 4) this.reverseAnimation(context);
      return undefined;
    }
    if (state.phase === "ready") {
      if (input.attack || state.latchedAttack) {
        state.latchedAttack = false;
        if (this.ammo(context) < d.quantity) return this.noAmmo(context);
        state.frame = d.activateLast + 1; state.phase = "firing";
        this.attackAnimation(context);
      } else {
        if (state.frame === d.idleLast) { state.frame = idleFirst; return undefined; }
        if (d.pauses.includes(state.frame) && Math.floor(game.host.random() * 16) !== 0) return undefined;
        state.frame++; return undefined;
      }
    }
    if (state.phase === "firing") {
      if (d.fires.includes(state.frame)) { state.sourceFiring = true; this.powerupSound(context); this.fire(context); }
      else state.frame++;
      if (state.frame === idleFirst + 1) state.phase = "ready";
    }
    return undefined;
  }

  genericRerelease(context: Q2WeaponContext): undefined {
    const { state, definition: d, input, self, game, now } = context;
    const idleFirst = d.fireLast + 1, idleLast = d.name === "bfg" ? 54 : d.idleLast;
    if (state.phase === "dropping") {
      if (state.thinkTime <= now) {
        if (state.frame === d.deactivateLast) return this.changeWeapon(self, game, state, input);
        if (d.deactivateLast - state.frame === 4) this.reverseAnimation(context);
        state.frame++; state.thinkTime = millisecondSum(now, this.animationTime(context));
      }
      return undefined;
    }
    if (state.phase === "activating") {
      if (state.thinkTime <= now || input.instantSwitch) {
        state.thinkTime = millisecondSum(now, this.animationTime(context));
        if (state.frame === d.activateLast || input.instantSwitch) {
          state.phase = "ready"; state.frame = idleFirst; state.fireBuffered = false;
          state.fireFinished = input.instantSwitch ? 0 : millisecondSum(now, this.animationTime(context));
        } else state.frame++;
        return undefined;
      }
    }
    if ((state.pending !== null || !input.instantSwitch && input.holster) && state.phase !== "firing") {
      if (input.instantSwitch || state.thinkTime <= now) {
        state.pending ??= state.weapon; state.phase = "dropping";
        if (input.instantSwitch) return this.changeWeapon(self, game, state, input);
        state.frame = idleLast + 1;
        if (d.deactivateLast - state.frame < 4) this.reverseAnimation(context);
        state.thinkTime = millisecondSum(now, this.animationTime(context));
      }
      return undefined;
    }
    if (state.phase === "ready") {
      if ((state.fireBuffered || state.latchedAttack || input.attack) && state.fireFinished <= now) {
        state.latchedAttack = false; state.thinkTime = now;
        if (this.ammo(context) < d.quantity) return this.noAmmo(context);
        state.phase = "firing"; state.lastFiringTime = millisecondSum(now, 2.5);
        if (!d.repeating) {
          state.frame = d.activateLast + 1; state.fireBuffered = false;
          state.thinkTime = millisecondSum(state.thinkTime, (input.weaponThunk ? game.host.frameSeconds() : 0) + this.animationTime(context));
          state.fireFinished = millisecondSum(now, this.animationTime(context));
          if (d.fires.includes(state.frame)) { this.powerupSound(context); this.fire(context); }
          this.attackAnimation(context);
          return undefined;
        }
      } else if (state.thinkTime <= now) {
        state.thinkTime = millisecondSum(now, this.animationTime(context));
        if (state.frame === idleLast) { state.frame = idleFirst; return undefined; }
        if (!d.pauses.includes(state.frame) || Math.floor(game.host.random() * 16) === 0) state.frame++;
        return undefined;
      }
    }
    if (state.phase === "firing" && state.thinkTime <= now) {
      state.lastFiringTime = millisecondSum(now, 2.5);
      if (!d.repeating) state.frame++;
      state.fireFinished = millisecondSum(now, this.animationTime(context));
      const firingContext = state.fireBuffered ? { ...context, input: { ...input, attack: true } } : context;
      state.fireBuffered = false;
      if (d.repeating) this.fire(firingContext);
      else if (d.fires.includes(state.frame) && !(d.name === "shotgun" && state.frame === 9)) { this.powerupSound(context); this.fire(firingContext); }
      if (state.frame === idleFirst) { state.phase = "ready"; state.fireBuffered = false; }
      state.thinkTime = millisecondSum(now, this.animationTime(context) + (d.repeating && input.weaponThunk ? game.host.frameSeconds() : 0));
    }
    return undefined;
  }

  multiplier(context: Q2WeaponContext): number {
    const quad = context.input.quadUntil > context.now;
    return (quad ? 4 : 1) * (context.input.doubleUntil > context.now && !(quad && context.input.noStackDouble) ? 2 : 1);
  }

  powerupSound(context: Q2WeaponContext): undefined {
    const { self, game, input, now } = context;
    const ctf = this.sourceRules?.kind === "ctf" ? this.sourceRules : null;
    if (ctf?.strengthSound(context) !== true) {
      if (input.quadUntil > now && input.doubleUntil > now && context.rerelease) game.sound(self, "ctf/tech2x.wav", 3);
      else if (input.quadUntil > now) game.sound(self, "items/damage3.wav", 3);
      else if (input.doubleUntil > now) game.sound(self, "misc/ddamage3.wav", 3);
    }
    ctf?.hasteSound(context);
    return undefined;
  }

  projectSource(self: Q2Entity, game: Q2GameServices, input: Q2WeaponInput, angles: Vec3, offset: Vec3): { start: Vec3; direction: Vec3 } {
    const axes = angleVectors(angles), side = input.hand === "left" ? -offset.y : input.hand === "center" ? 0 : offset.y;
    const origin = game.body(self).origin;
    if (game.options.edition === "classic") return { start: add(add(add(origin, scale(axes.forward, offset.x)), scale(axes.right, side)), { x: 0, y: 0, z: self.viewHeight + offset.z }), direction: axes.forward };
    const eye = add(origin, { x: 0, y: 0, z: self.viewHeight });
    const start = add(add(add(eye, scale(axes.forward, offset.x)), scale(axes.right, side)), scale(axes.up, offset.z));
    const trace = game.host.trace({ start: eye, end: add(eye, scale(axes.forward, 8192)), bounds: null, ignore: self.actor.id, mask: this.shotMask(self, game) & ~0x4000000 });
    const close = trace.kind !== "q1" && (trace.contents & (0x2000000 | PLAYER_CONTENTS)) !== 0 && trace.fraction * 8192 < 128;
    return { start, direction: trace.startSolid || close ? axes.forward : normalize(subtract(trace.end, start)) };
  }

  project(context: Q2WeaponContext, offset: Vec3, angles = context.input.angles): { start: Vec3; direction: Vec3 } {
    return this.projectSource(context.self, context.game, context.input, angles, offset);
  }

  kick(context: Q2WeaponContext, origin: Vec3, angles: Vec3, duration = 0.2): undefined {
    const state = context.state;
    state.kickOrigin = origin; state.kickAngles = angles; state.kickDuration = duration; state.kickUntil = context.rerelease ? millisecondSum(context.now, duration) : context.now + duration;
    return undefined;
  }

  flash(context: Q2WeaponContext, flash: number): undefined { return this.hooks.emit({ kind: "muzzleflash", actor: context.self.actor.id, flash, silenced: context.silenced }); }

  setLoop(self: Q2Entity, game: Q2GameServices, state: Q2WeaponState, path: string): undefined {
    if (state.loopSound === path) return undefined;
    const origin = game.body(self).origin;
    if (state.loopSound !== "") game.host.emit({ kind: "sound", actor: self.actor.id, origin, path: state.loopSound, channel: 1, volume: 1, attenuation: 1, reliable: false, loop: "stop" });
    state.loopSound = path;
    if (path !== "") game.host.emit({ kind: "sound", actor: self.actor.id, origin, path, channel: 1, volume: 1, attenuation: 1, reliable: false, loop: "start" });
    return undefined;
  }

  private present(self: Q2Entity, game: Q2GameServices, state: Q2WeaponState): undefined {
    const definition = state.weapon === null ? null : this.definition(state.weapon);
    const factor = game.options.edition === "classic" ? 1 : Math.max(0, (state.kickUntil - game.host.now()) / state.kickDuration);
    return this.hooks.emit({ kind: "view-weapon", actor: self.actor.id, weapon: state.weapon, model: state.viewModel ?? definition?.viewModel ?? "", playerModel: definition?.playerModel ?? 0, frame: state.frame, skin: state.viewSkin, rate: state.gunRate, kickOrigin: scale(state.kickOrigin, factor), kickAngles: scale(state.kickAngles, factor) });
  }

  private fire(context: Q2WeaponContext): undefined {
    const extension = this.extensions.get(context.definition.name);
    if (extension !== undefined) return extension.fire(context, this);
    switch (context.definition.name) {
      case "blaster": this.blaster(context, zero, context.rerelease || context.game.options.mode === "deathmatch" ? 15 : 10, false, 8); if (!context.rerelease) context.state.frame++; return undefined;
      case "hyperblaster": return this.hyperblaster(context);
      case "machinegun": return this.machinegun(context);
      case "chaingun": return this.chaingun(context);
      case "shotgun": return this.shotgun(context, false);
      case "supershotgun": return this.shotgun(context, true);
      case "grenadelauncher": return this.grenadeLauncher(context);
      case "rocketlauncher": return this.rocketLauncher(context);
      case "railgun": return this.railgun(context);
      case "bfg": return this.bfg(context);
      case "grenades": return this.throwGrenade(context, false);
      default: throw new Error(`Q2 weapon has no source fire callback: ${context.definition.name}`);
    }
  }

  private blaster(context: Q2WeaponContext, offset: Vec3, damage: number, hyper: boolean, effects: number): undefined {
    const { self, game, input, rerelease } = context, projection = this.project(context, add({ x: 24, y: 8, z: -8 }, offset));
    const random = () => (game.host.random() * 2 - 1) * 0.7;
    this.kick(context, scale(angleVectors(input.angles).forward, -2), hyper && rerelease ? { x: random(), y: random(), z: random() } : { x: -1, y: 0, z: 0 });
    this.fireBlaster(self, game, projection.start, projection.direction, damage * this.multiplier(context), rerelease && !hyper ? 1500 : 1000, effects, hyper);
    this.flash(context, hyper ? 14 : 0);
    return this.playerNoise(self, game, projection.start, "weapon");
  }

  private hyperblaster(context: Q2WeaponContext): undefined {
    const { state, input, self, game, rerelease } = context;
    if (rerelease) {
      state.frame = state.frame > 20 ? 6 : state.frame + 1;
      if (state.frame === 12) {
        if (this.ammo(context) > 0 && input.attack) state.frame = 6;
        else game.sound(self, "weapons/hyprbd1a.wav", 0);
      }
      this.setLoop(self, game, state, state.frame >= 6 && state.frame <= 11 ? "weapons/hyprbl1a.wav" : "");
      if (input.attack && state.frame >= 6 && state.frame <= 11) {
        if (this.ammo(context) < 1) return this.noAmmo(context);
        const rotation = (state.frame - 5) * 2 * Math.PI / 6;
        this.blaster(context, { x: -4 * Math.sin(rotation), y: 4 * Math.cos(rotation), z: 0 }, game.options.mode === "deathmatch" ? 15 : 20, true, state.frame % 4 === 0 ? 64 : 0);
        this.powerupSound(context); this.consume(context); this.attackAnimation(context, Math.trunc(game.host.random() + 0.25));
      }
    } else {
      this.setLoop(self, game, state, "weapons/hyprbl1a.wav");
      if (!input.attack) state.frame++;
      else {
        if (this.ammo(context) < 1) this.noAmmo(context);
        else {
          const rotation = (state.frame - 5) * 2 * Math.PI / 6;
          this.blaster(context, { x: -4 * Math.sin(rotation), y: 0, z: 4 * Math.cos(rotation) }, game.options.mode === "deathmatch" ? 15 : 20, true, state.frame === 6 || state.frame === 9 ? 64 : 0);
          this.consume(context); this.attackAnimation(context);
        }
        state.frame++;
        if (state.frame === 12 && this.ammo(context) > 0) state.frame = 6;
      }
      if (state.frame === 12) { game.sound(self, "weapons/hyprbd1a.wav", 0); this.setLoop(self, game, state, ""); }
    }
    return undefined;
  }

  private machinegun(context: Q2WeaponContext): undefined {
    const { state, input, self, game, rerelease } = context;
    if (!input.attack) { state.machinegunShots = 0; state.frame = rerelease ? 6 : state.frame + 1; return undefined; }
    state.frame = state.frame === 4 ? 5 : 4;
    if (this.ammo(context) < 1) { state.frame = 6; return this.noAmmo(context); }
    const random = () => game.host.random() * 2 - 1;
    let origin: Vec3, angles: Vec3;
    if (rerelease) { origin = { x: random() * 0.35, y: random() * 0.35, z: random() * 0.35 }; angles = { x: random() * 0.7, y: random() * 0.7, z: random() * 0.7 }; }
    else {
      const oy = random() * 0.35, ay = random() * 0.7, oz = random() * 0.35, az = random() * 0.7;
      origin = { x: random() * 0.35, y: oy, z: oz }; angles = { x: state.machinegunShots * -1.5, y: ay, z: az };
      if (game.options.mode !== "deathmatch") state.machinegunShots = Math.min(9, state.machinegunShots + 1);
    }
    this.kick(context, origin, angles);
    const projection = this.project(context, { x: 0, y: rerelease ? 0 : 8, z: -8 }, rerelease ? input.angles : add(input.angles, angles));
    const restore = rerelease && this.hooks.lagCompensation.kind === "history" ? this.hooks.lagCompensation.begin(self.actor.id, projection.start, projection.direction) : null;
    try { this.fireBullet(self, game, projection.start, projection.direction, 8 * this.multiplier(context), 2 * this.multiplier(context), 300, 500, MOD.machinegun); }
    finally { restore?.(); }
    if (rerelease) this.powerupSound(context);
    this.flash(context, 1); this.playerNoise(self, game, projection.start, "weapon"); this.consume(context);
    return this.attackAnimation(context, Math.trunc(game.host.random() + 0.25));
  }

  private chaingun(context: Q2WeaponContext): undefined {
    const { state, input, self, game, rerelease } = context;
    if (rerelease && state.frame > 31) { state.frame = 5; game.sound(self, "weapons/chngnu1a.wav", 0, 1, 2); }
    else {
      if (!rerelease && state.frame === 5) game.sound(self, "weapons/chngnu1a.wav", 0, 1, 2);
      if (state.frame === 14 && !input.attack) { state.frame = 32; this.setLoop(self, game, state, ""); return undefined; }
      if (state.frame === 21 && input.attack && this.ammo(context) > 0) state.frame = 15;
      else state.frame++;
    }
    if (state.frame === 22) { this.setLoop(self, game, state, ""); game.sound(self, "weapons/chngnd1a.wav", 0, 1, 2); }
    else if (!rerelease) this.setLoop(self, game, state, "weapons/chngnl1a.wav");
    if (rerelease && (state.frame < 5 || state.frame > 21)) return undefined;
    if (rerelease) this.setLoop(self, game, state, "weapons/chngnl1a.wav");
    this.attackAnimation(context, state.frame & 1);
    const shots = Math.min(this.ammo(context), state.frame <= 9 ? 1 : state.frame <= 14 ? input.attack ? 2 : 1 : 3);
    if (shots === 0) return this.noAmmo(context);
    const random = () => game.host.random() * 2 - 1;
    let origin: Vec3, angles: Vec3;
    if (rerelease) {
      origin = { x: random() * 0.35, y: random() * 0.35, z: random() * 0.35 };
      const factor = 0.5 + shots * 0.15; angles = { x: random() * factor, y: random() * factor, z: random() * factor };
    } else {
      const ox = random() * 0.35, ax = random() * 0.7, oy = random() * 0.35, ay = random() * 0.7, oz = random() * 0.35, az = random() * 0.7;
      origin = { x: ox, y: oy, z: oz }; angles = { x: ax, y: ay, z: az };
    }
    this.kick(context, origin, angles);
    let projection = this.project(context, { x: 0, y: 0, z: -8 });
    const restore = rerelease && this.hooks.lagCompensation.kind === "history" ? this.hooks.lagCompensation.begin(self.actor.id, projection.start, projection.direction) : null;
    try {
      for (let shot = 0; shot < shots; shot++) {
        projection = this.project(context, { x: 0, y: (rerelease ? 0 : 7) + random() * 4, z: random() * 4 - 8 });
        this.fireBullet(self, game, projection.start, projection.direction, (game.options.mode === "deathmatch" ? 6 : 8) * this.multiplier(context), 2 * this.multiplier(context), 300, 500, MOD.chaingun);
      }
    } finally { restore?.(); }
    if (rerelease) this.powerupSound(context);
    this.flash(context, 3 + shots - 1); this.playerNoise(self, game, projection.start, "weapon");
    return this.consume(context, shots);
  }

  private shotgun(context: Q2WeaponContext, superShotgun: boolean): undefined {
    const { state, self, game, input, rerelease } = context;
    if (!superShotgun && state.frame === 9) { if (!rerelease) state.frame++; return undefined; }
    const start = this.project(context, { x: 0, y: rerelease ? 0 : 8, z: -8 });
    this.kick(context, scale(angleVectors(input.angles).forward, -2), { x: -2, y: 0, z: 0 });
    const restore = rerelease && this.hooks.lagCompensation.kind === "history" ? this.hooks.lagCompensation.begin(self.actor.id, start.start, start.direction) : null;
    let noiseOrigin = start.start;
    try {
      if (superShotgun) for (const yaw of [-5, 5]) {
        const angles = { ...input.angles, y: input.angles.y + yaw };
        const projection = rerelease ? this.project(context, { x: 0, y: 0, z: -8 }, angles) : { start: start.start, direction: angleVectors(angles).forward };
        noiseOrigin = projection.start;
        this.fireShotgun(self, game, projection.start, projection.direction, 6 * this.multiplier(context), 12 * this.multiplier(context), 1000, 500, 10, MOD.supershotgun);
      } else this.fireShotgun(self, game, start.start, start.direction, 4 * this.multiplier(context), 8 * this.multiplier(context), 500, 500, 12, MOD.shotgun);
    } finally { restore?.(); }
    this.flash(context, superShotgun ? 13 : 2);
    if (!rerelease) state.frame++;
    this.playerNoise(self, game, noiseOrigin, "weapon"); return this.consume(context);
  }

  private grenadeLauncher(context: Q2WeaponContext): undefined {
    const { self, game, input, rerelease, state } = context;
    const angles = rerelease ? { ...input.angles, x: Math.max(-62.5, input.angles.x) } : input.angles;
    const projection = this.project(context, { x: 8, y: rerelease ? 0 : 8, z: -8 }, angles);
    this.kick(context, scale(angleVectors(input.angles).forward, -2), { x: -1, y: 0, z: 0 });
    if (rerelease) {
      const randomOpen = () => -0.9999999403953552 + game.host.random() * 1.9999999403953552;
      const right = randomOpen() * 10, up = 200 + randomOpen() * 10;
      this.fireGrenade(self, game, projection.start, projection.direction, 120 * this.multiplier(context), 600, 2.5, 160, false, false, false, { right, up, gravity: input.gravity });
    } else this.fireGrenade(self, game, projection.start, projection.direction, 120 * this.multiplier(context), 600, 2.5, 160);
    this.flash(context, 8); if (!rerelease) state.frame++;
    this.playerNoise(self, game, projection.start, "weapon"); return this.consume(context);
  }

  private rocketLauncher(context: Q2WeaponContext): undefined {
    const { self, game, input, rerelease, state } = context;
    const damage = 100 + Math.floor(game.host.random() * 20), projection = this.project(context, { x: 8, y: 8, z: -8 });
    this.kick(context, scale(angleVectors(input.angles).forward, -2), { x: -1, y: 0, z: 0 });
    this.fireRocket(self, game, projection.start, projection.direction, damage * this.multiplier(context), 650, 120, 120 * this.multiplier(context));
    this.flash(context, 7); if (!rerelease) state.frame++;
    this.playerNoise(self, game, projection.start, "weapon"); return this.consume(context);
  }

  private railgun(context: Q2WeaponContext): undefined {
    const { self, game, input, rerelease, state } = context;
    const projection = this.project(context, { x: 0, y: 7, z: -8 }), dm = game.options.mode === "deathmatch";
    this.kick(context, scale(angleVectors(input.angles).forward, -3), { x: -3, y: 0, z: 0 });
    const restore = rerelease && this.hooks.lagCompensation.kind === "history" ? this.hooks.lagCompensation.begin(self.actor.id, projection.start, projection.direction) : null;
    try { this.fireRail(self, game, projection.start, projection.direction, (dm ? 100 : rerelease ? 125 : 150) * this.multiplier(context), (dm ? 200 : rerelease ? 225 : 250) * this.multiplier(context)); }
    finally { restore?.(); }
    this.flash(context, 6); if (!rerelease) state.frame++;
    this.playerNoise(self, game, projection.start, "weapon"); return this.consume(context);
  }

  private bfg(context: Q2WeaponContext): undefined {
    const { self, game, input, rerelease, state } = context;
    if (state.frame === 9) {
      this.flash(context, 12); if (!rerelease) state.frame++;
      // Classic C reads an uninitialized stack vector here; keep the donor's explicit zero vector.
      return this.playerNoise(self, game, rerelease ? game.body(self).origin : zero, "weapon");
    }
    if (this.ammo(context) < 50) { if (!rerelease) state.frame++; return undefined; }
    const projection = this.project(context, { x: 8, y: 8, z: -8 });
    this.fireBfg(self, game, projection.start, projection.direction, (game.options.mode === "deathmatch" ? 200 : 500) * this.multiplier(context), 400, 1000);
    this.kick(context, scale(angleVectors(input.angles).forward, -2), { x: rerelease ? -20 : -40, y: 0, z: (game.host.random() * 2 - 1) * 8 }, rerelease ? 0.6 - game.host.frameSeconds() : 0.5);
    if (rerelease) this.flash(context, 19); else state.frame++;
    this.playerNoise(self, game, projection.start, "weapon"); return this.consume(context);
  }

  private throwGrenade(context: Q2WeaponContext, held: boolean): undefined {
    const { self, game, state, input, now, rerelease } = context;
    const angles = rerelease ? { ...input.angles, x: Math.max(-62.5, input.angles.x) } : input.angles;
    const projection = this.project(context, rerelease ? { x: 2, y: 0, z: -14 } : { x: 8, y: 8, z: -8 }, angles);
    const timer = state.grenadeTime - now;
    const chargedSpeed = 400 + (3 - timer) * (400 / 3);
    const speed = Math.trunc(rerelease ? (game.host.combat.read(self.actor.id)?.health ?? 0) <= 0 ? 400 : Math.min(800, chargedSpeed) : chargedSpeed);
    if (rerelease) state.grenadeTime = 0;
    this.fireGrenade(self, game, projection.start, projection.direction, 125 * this.multiplier(context), speed, timer, 165, true, held);
    this.consume(context, 1);
    if (!rerelease) {
      state.grenadeTime = now + 1;
      if ((game.host.combat.read(self.actor.id)?.health ?? 0) > 0) this.animation(context, input.ducked ? "attack" : "reverse", input.ducked ? 159 : 119, input.ducked ? 162 : 112);
    }
    return undefined;
  }

  throwClassic(context: Q2WeaponContext, throwing?: Q2ThrowDefinition): undefined {
    const { state, input, self, game, now, definition } = context;
    const idleFirst = definition.fireLast + 1;
    if (state.pending !== null && state.phase === "ready") return this.changeWeapon(self, game, state, input);
    if (state.phase === "activating") { state.phase = "ready"; state.frame = idleFirst; return undefined; }
    if (state.phase === "ready") {
      if (state.latchedAttack || input.attack) {
        state.latchedAttack = false;
        if (this.ammo(context) > 0) { state.frame = 1; state.phase = "firing"; state.grenadeTime = 0; }
        else this.noAmmo(context);
        return undefined;
      }
      if (throwing?.wrapBeforePause === true && state.frame === definition.idleLast) { state.frame = idleFirst; return undefined; }
      if (definition.pauses.includes(state.frame) && Math.floor(game.host.random() * 16) !== 0) return undefined;
      if (++state.frame > definition.idleLast) state.frame = idleFirst;
      return undefined;
    }
    if (state.phase !== "firing") return undefined;
    if (state.frame === (throwing?.soundFrame ?? 5)) game.sound(self, throwing?.cockSound ?? "weapons/hgrena1b.wav", 1);
    if (state.frame === (throwing?.holdFrame ?? 11)) {
      if (state.grenadeTime === 0) { state.grenadeTime = now + 3.2; this.setLoop(self, game, state, throwing?.holdSound ?? "weapons/hgrenc1b.wav"); }
      if ((throwing?.explode ?? true) && !state.grenadeBlewUp && now >= state.grenadeTime) {
        this.setLoop(self, game, state, "");
        if (throwing === undefined) this.throwGrenade(context, true); else throwing.fire(context, true);
        state.grenadeBlewUp = true;
      }
      if (input.attack) return undefined;
      if (state.grenadeBlewUp) {
        if (now >= state.grenadeTime) { state.frame = definition.fireLast; state.grenadeBlewUp = false; }
        else return undefined;
      }
    }
    if (state.frame === (throwing?.fireFrame ?? 12)) {
      this.setLoop(self, game, state, "");
      if (throwing === undefined) this.throwGrenade(context, false); else throwing.fire(context, throwing.releaseHeld);
    }
    if (state.frame === definition.fireLast && now < state.grenadeTime) return undefined;
    state.frame++;
    if (state.frame === idleFirst) { state.grenadeTime = 0; state.phase = "ready"; }
    return undefined;
  }

  private fireHeld(context: Q2WeaponContext, held: boolean): undefined {
    const extension = this.extensions.get(context.definition.name);
    return extension?.held === undefined ? this.throwGrenade(context, held) : extension.held(context, this, held);
  }

  throwRerelease(context: Q2WeaponContext, throwing?: Q2ThrowDefinition): undefined {
    const { state, input, self, game, now, definition } = context;
    const fireLast = definition.fireLast, idleFirst = fireLast + 1, idleLast = definition.idleLast, idleReady = throwing === undefined ? idleLast + 1 : idleFirst;
    const soundFrame = throwing?.soundFrame ?? 5, holdFrame = throwing?.holdFrame ?? 11, cockSound = throwing?.cockSound ?? "weapons/hgrena1b.wav";
    const holdSound = throwing?.holdSound ?? "weapons/hgrenc1b.wav", explodes = throwing?.explode ?? true;
    const fire = (held: boolean): undefined => throwing === undefined ? this.throwGrenade(context, held) : throwing.fire(context, held);
    if (state.pending !== null && state.phase === "ready") {
      if (state.thinkTime <= now) { this.changeWeapon(self, game, state, input); state.thinkTime = millisecondSum(now, this.animationTime(context)); }
      return undefined;
    }
    if (state.phase === "activating") {
      if (state.thinkTime <= now) { state.phase = "ready"; state.frame = idleReady; state.thinkTime = millisecondSum(now, this.animationTime(context)); state.fireFinished = millisecondSum(now, this.animationTime(context)); }
      return undefined;
    }
    if (state.phase === "ready") {
      if ((state.fireBuffered || state.latchedAttack || input.attack) && state.fireFinished <= now) {
        state.latchedAttack = false;
        if (this.ammo(context) > 0) { state.frame = throwing === undefined ? 2 : 1; state.phase = "firing"; state.grenadeTime = 0; state.thinkTime = millisecondSum(now, this.animationTime(context)); }
        else this.noAmmo(context);
      } else if (state.thinkTime <= now) {
        state.thinkTime = millisecondSum(now, this.animationTime(context));
        if (state.frame >= idleLast) state.frame = idleFirst;
        else if (!definition.pauses.includes(state.frame) || Math.floor(game.host.random() * 16) === 0) state.frame++;
      }
      return undefined;
    }
    if (state.phase !== "firing") return undefined;
    state.lastFiringTime = millisecondSum(now, 2.5);
    if (state.thinkTime > now) return undefined;
    if (state.frame === soundFrame && cockSound !== "") game.sound(self, cockSound, 1);
    const wait = (input.haste ? 0.5 : 1) * (input.quadFireUntil > now ? 0.5 : 1);
    if (state.frame === holdFrame) {
      if (state.grenadeTime === 0 && state.grenadeFinished === 0) state.grenadeTime = millisecondSum(now, 3.2);
      if (!state.grenadeBlewUp && holdSound !== "") this.setLoop(self, game, state, holdSound);
      if (explodes && !state.grenadeBlewUp && now >= state.grenadeTime) {
        this.powerupSound(context); this.setLoop(self, game, state, ""); fire(true); state.grenadeBlewUp = true; state.grenadeFinished = millisecondSum(now, wait);
      }
      if (input.attack) { state.thinkTime = millisecondSum(now, 0.001); return undefined; }
      if (state.grenadeBlewUp) {
        if (now >= state.grenadeFinished) { state.frame = fireLast; state.grenadeBlewUp = false; state.thinkTime = millisecondSum(now, this.animationTime(context)); }
        else return undefined;
      } else {
        state.frame++; this.powerupSound(context); this.setLoop(self, game, state, ""); fire(false);
        state.grenadeFinished = millisecondSum(now, wait);
        this.animation(context, input.ducked ? "attack" : "reverse", input.ducked ? 159 : 119, input.ducked ? 162 : 112);
      }
    }
    state.thinkTime = millisecondSum(now, this.animationTime(context));
    if (state.frame === fireLast && now < state.grenadeFinished) return undefined;
    state.frame++;
    if (state.frame === idleFirst) {
      state.grenadeFinished = 0; state.phase = "ready"; state.fireBuffered = false; state.fireFinished = millisecondSum(now, this.animationTime(context)); state.frame = idleReady;
      if (this.ammo(context) === 0) { this.noAmmo(context, false); this.changeWeapon(self, game, state, input); }
    }
    return undefined;
  }
}
