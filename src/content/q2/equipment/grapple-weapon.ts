/* CTF g_ctf.c/g_ctf.cpp and LMCTF p_weapon.c weapon-slot continuations. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q2GameServices } from "../foundation/host.ts";
import type { Q2WeaponDefinition } from "../foundation/weapons/types.ts";
import { stepQ2ClassicFrame, stepQ2RereleaseFrame } from "../foundation/weapons/generic-frame.ts";
import type { Q2GenericFrameState, Q2RereleaseFrameInput, Q2RereleaseFrameHooks } from "../foundation/weapons/generic-frame.ts";
import { scale } from "../foundation/fields.ts";
import { angleVectors } from "../foundation/weapons/vectors.ts";
import type { Q2CtfGrappleEquipment } from "./ctf-grapple.ts";
import type { LmctfGrappleEquipment } from "./lmctf-grapple.ts";
import type { CtfGrappleState, LmctfGrappleState } from "./grapple-services.ts";

export const Q2_CTF_GRAPPLE: Q2WeaponDefinition = {
  name: "grapple", classname: "weapon_grapple", item: "q2:weapon_grapple", ammo: null, quantity: 0, warning: 0,
  viewModel: "models/weapons/grapple/tris.md2", worldModel: "", playerModel: 12,
  activateLast: 5, fireLast: 9, idleLast: 31, deactivateLast: 36, pauses: [10, 18, 27], fires: [6], repeating: false,
};
export const Q2_RERELEASE_CTF_GRAPPLE: Q2WeaponDefinition = { ...Q2_CTF_GRAPPLE, fireLast: 10 };
export const LMCTF_GRAPPLE: Q2WeaponDefinition = {
  name: "lmctf:hook", item: "q2:weapon_hook", classname: "weapon_hook", ammo: null, quantity: 0, warning: 0,
  viewModel: "models/weapons/v_hook/tris.md2", worldModel: "models/objects/debris2/tris.md2", playerModel: 11,
  activateLast: 9, fireLast: 13, idleLast: 34, deactivateLast: 38, pauses: [14, 18, 26, 30], fires: [8, 9, 10, 11], repeating: true,
};

export interface GrappleWeaponInput {
  readonly attack: boolean;
  readonly changeRequested: boolean;
  readonly holster: boolean;
  readonly latchedHolster: boolean;
}

/** Native adapters pass their existing animation fields; foreign slots pass only equipment animation. */
export function stepCtfGrappleWeapon(
  state: Q2GenericFrameState, source: CtfGrappleState, input: GrappleWeaponInput, edition: "classic" | "rerelease",
  hooks: { reset(): undefined; prepareDrop(): undefined; generic(): undefined },
): undefined {
  const rerelease = edition === "rerelease", held = input.attack || rerelease && input.holster;
  if (held && state.phase === "firing" && source.grapple !== null) state.frame = rerelease ? 6 : 9;
  if (!held && source.grapple !== null) { hooks.reset(); if (state.phase === "firing") state.phase = "ready"; }
  if ((input.changeRequested || rerelease && (input.holster || input.latchedHolster)) && source.grappleState !== "fly" && state.phase === "firing") {
    hooks.prepareDrop(); state.phase = "dropping"; state.frame = 32;
  }
  const before = state.phase;
  hooks.generic();
  if (rerelease && held && state.phase === "firing" && source.grapple !== null) state.frame = 6;
  if (before === "activating" && state.phase === "ready" && source.grappleState !== "fly") {
    state.frame = held ? 5 : rerelease ? 6 : 9; state.phase = "firing";
  }
  return undefined;
}

export function stepLmctfGrappleWeapon(
  state: Q2GenericFrameState, source: LmctfGrappleState, input: GrappleWeaponInput,
  hooks: { abort(): undefined; generic(): undefined },
): undefined {
  if (state.phase === "activating") state.frame++;
  if (input.changeRequested && state.phase !== "dropping") { state.phase = "dropping"; state.frame = 36; return undefined; }
  if (!input.attack && !state.latchedAttack && !source.hookHeld) hooks.abort();
  return hooks.generic();
}

export interface GrappleWeaponPresentation {
  kick(origin: Vec3, pitch: number): undefined;
  attackAnimation(): undefined;
  reverseAnimation(): undefined;
  powerupSound(): undefined;
  animationTime(state: Q2GenericFrameState): number;
}

export function fireCtfGrappleWeapon(
  actor: ActorId, game: Q2GameServices, core: Q2CtfGrappleEquipment, state: Q2GenericFrameState,
  edition: "classic" | "rerelease", presentation: Pick<GrappleWeaponPresentation, "kick">,
): undefined {
  if (core.state(actor).grappleState !== "fly") { if (edition === "classic") state.frame++; return undefined; }
  if (edition === "classic") presentation.kick(scale(angleVectors(core.hooks.pose(actor, game).angles).forward, -2), -1);
  core.fireFromPose(actor, game);
  if (edition === "classic" && game.host.actors.isLive(actor)) state.frame++;
  return undefined;
}

export function fireLmctfGrappleWeapon(
  actor: ActorId, game: Q2GameServices, core: LmctfGrappleEquipment, state: Q2GenericFrameState,
  presentation: Pick<GrappleWeaponPresentation, "kick">,
): undefined {
  state.sourceFiring = core.state(actor).hookState === 0;
  if (state.sourceFiring) presentation.kick(scale(angleVectors(core.hooks.pose(actor, game).angles).forward, -2), -1);
  return core.fire(actor, game);
}

export function releaseLmctfGrappleWeapon(state: Q2GenericFrameState): undefined {
  if (state.phase === "firing") state.phase = "ready";
  return undefined;
}

export function ctfGrappleWeaponShouldReset(state: Q2GenericFrameState, selected: boolean, changeRequested: boolean): boolean {
  return selected && !changeRequested && state.phase !== "firing" && state.phase !== "activating";
}

export type GrappleWeaponSource =
  | { readonly kind: "ctf"; readonly core: Q2CtfGrappleEquipment; readonly edition: "classic" | "rerelease" }
  | { readonly kind: "lmctf"; readonly core: LmctfGrappleEquipment };

export interface GrappleWeaponState {
  readonly animation: Q2GenericFrameState;
  handoff: "active" | "holstering" | "holstered";
}

export function createGrappleWeaponState(): GrappleWeaponState {
  return { animation: { phase: "activating", frame: 0, latchedAttack: false, sourceFiring: false, thinkTime: 0, fireFinished: 0, fireBuffered: false, lastFiringTime: 0 }, handoff: "holstered" };
}

/** Actor-bound slot adapter. Its supplied state is saved with equipment, never a primary arsenal. */
export class Q2GrappleWeapon {
  constructor(
    readonly actor: ActorId, readonly game: Q2GameServices, readonly source: GrappleWeaponSource,
    readonly state: GrappleWeaponState, readonly presentation: GrappleWeaponPresentation,
  ) {}

  get definition(): Q2WeaponDefinition {
    return this.source.kind === "lmctf" ? LMCTF_GRAPPLE : this.source.edition === "rerelease" ? Q2_RERELEASE_CTF_GRAPPLE : Q2_CTF_GRAPPLE;
  }
  holster(): undefined { if (this.state.handoff === "active") this.state.handoff = "holstering"; return undefined; }
  isHolstered(): boolean { return this.state.handoff === "holstered"; }
  /** Connect to the LM core's existing released callback, including hook death and sky. */
  released(): undefined { return this.source.kind === "lmctf" ? releaseLmctfGrappleWeapon(this.state.animation) : undefined; }
  resume(): undefined {
    this.state.handoff = "active"; this.state.animation.phase = "activating"; this.state.animation.frame = 0;
    return undefined;
  }

  /** Source player-end work, once after movement; it remains live when another weapon owns the slot. */
  playerFrame(): undefined {
    const source = this.source;
    if (source.kind === "ctf") {
      if (ctfGrappleWeaponShouldReset(this.state.animation, this.state.handoff === "active", this.state.handoff === "holstering")) return source.core.reset(this.actor, this.game);
      return source.core.playerFrame(this.actor, this.game);
    }
    return source.core.state(this.actor).hookState !== 0 ? source.core.fire(this.actor, this.game) : undefined;
  }

  step(input: Omit<Q2RereleaseFrameInput, "changeRequested"> & { readonly latchedHolster: boolean }): undefined {
    if (this.isHolstered()) return undefined;
    const state = this.state.animation, source = this.source, actor = this.actor, game = this.game;
    const frameInput = { ...input, changeRequested: this.state.handoff === "holstering" };
    const hooks: Q2RereleaseFrameHooks = {
      random: () => game.host.random(), ammo: () => 0,
      noAmmo: () => { throw new Error("An ammunition-free grapple cannot run out of ammo"); },
      fire: () => this.fire(), changeWeapon: () => { this.state.handoff = "holstered"; return undefined; },
      reverseAnimation: () => this.presentation.reverseAnimation(), attackAnimation: () => this.presentation.attackAnimation(),
      powerupSound: () => this.presentation.powerupSound(), animationTime: () => this.presentation.animationTime(state),
      prepareDrop: () => this.holster(),
    };
    const generic = (): undefined => {
      if (source.kind === "ctf" && source.edition === "rerelease") return stepQ2RereleaseFrame(state, this.definition, frameInput, hooks);
      const before = state.phase;
      if (source.kind === "lmctf") state.sourceFiring = false;
      stepQ2ClassicFrame(state, this.definition, frameInput, hooks);
      if (source.kind === "ctf" && state.phase !== "firing" && before === state.phase && !this.isHolstered()) stepQ2ClassicFrame(state, this.definition, frameInput, hooks);
      return undefined;
    };
    if (source.kind === "ctf") return stepCtfGrappleWeapon(state, source.core.state(actor), frameInput, source.edition, {
      reset: () => source.core.reset(actor, game), prepareDrop: hooks.prepareDrop, generic,
    });
    return stepLmctfGrappleWeapon(state, source.core.state(actor), frameInput, { abort: () => source.core.abort(actor, game), generic });
  }

  private fire(): undefined {
    const source = this.source, state = this.state.animation, actor = this.actor, game = this.game;
    return source.kind === "ctf" ? fireCtfGrappleWeapon(actor, game, source.core, state, source.edition, this.presentation)
      : fireLmctfGrappleWeapon(actor, game, source.core, state, this.presentation);
  }
}
