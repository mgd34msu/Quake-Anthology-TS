import type { GrappleSelection } from "../../../contracts/content.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { SavedActorId } from "../../../contracts/session.ts";
import type { Q1FoundationCheckpoint } from "../../../content/q1/foundation/checkpoint.ts";
import type { Q1EntityServices } from "../../../content/q1/foundation/entity-services.ts";
import type { ThreewaveGrapple } from "../../../content/q1/equipment/threewave-grapple.ts";
import type { Q2FoundationCheckpoint } from "../../../content/q2/foundation/checkpoint.ts";
import type { Q2EntityServices } from "../../../content/q2/foundation/entity-services.ts";
import type { Q2CtfGrappleEquipment } from "../../../content/q2/equipment/ctf-grapple.ts";
import type { LmctfGrappleEquipment } from "../../../content/q2/equipment/lmctf-grapple.ts";
import { captureCtfGrapple, captureLmctfGrapple, restoreCtfGrapple, restoreLmctfGrapple } from "../../../content/q2/equipment/grapple-services.ts";
import { ThreewaveWeapon } from "../../../content/q1/equipment/threewave-weapon.ts";
import { Q2GrappleWeapon, createGrappleWeaponState } from "../../../content/q2/equipment/grapple-weapon.ts";
import type { GrappleWeaponState, GrappleWeaponPresentation } from "../../../content/q2/equipment/grapple-weapon.ts";
import type { EquipmentWeaponHandoff, WeaponReference } from "./weapon-slot.ts";
import type { SourceRandom } from "./random.ts";

export type GrappleSource =
  | { readonly kind: "q1-threewave"; readonly game: Q1EntityServices; readonly core: ThreewaveGrapple }
  | { readonly kind: "q2-ctf"; readonly game: Q2EntityServices; readonly core: Q2CtfGrappleEquipment }
  | { readonly kind: "q2-lmctf"; readonly game: Q2EntityServices; readonly core: LmctfGrappleEquipment };
interface GrappleControl {
  readonly teleportBit: number | null;
  readonly jump: boolean;
  readonly held: boolean;
  readonly pressed: boolean;
  readonly released: boolean;
  readonly previousVelocity: Vec3;
  readonly predictionSuppressed: boolean;
}
export interface GrappleSlotHost {
  selected(actor: ActorId): boolean;
  available(actor: ActorId): boolean;
  frame(actor: ActorId, frame: number): undefined;
  presentation(actor: ActorId): Omit<GrappleWeaponPresentation, "kick">;
}
export interface GrappleWeaponAnimation {
  readonly state: GrappleWeaponState;
  nextFrameAt: number;
  kickOrigin: Vec3;
  kickPitch: number;
}
export interface GrappleRuntimeCheckpoint {
  readonly version: 2;
  readonly weaponAnimations: readonly ({ readonly actor: SavedActorId } & GrappleWeaponAnimation)[];
  readonly controls: readonly ({ readonly actor: SavedActorId } & GrappleControl)[];
  readonly random: ReturnType<SourceRandom["checkpoint"]>;
  readonly source:
    | { readonly kind: "q1-threewave"; readonly entities: Q1FoundationCheckpoint }
    | { readonly kind: "q2-ctf"; readonly entities: Q2FoundationCheckpoint;
        readonly states: readonly { readonly actor: SavedActorId; readonly state: ReturnType<typeof captureCtfGrapple> }[] }
    | { readonly kind: "q2-lmctf"; readonly entities: Q2FoundationCheckpoint;
        readonly states: readonly { readonly actor: SavedActorId; readonly state: ReturnType<typeof captureLmctfGrapple> }[] };
}
const zero: Vec3 = { x: 0, y: 0, z: 0 };
function saved(actor: ActorId): SavedActorId { return { slot: actor.slot, generation: actor.generation }; }

/** Input and tether state reference the same session actors and body table as the primary weapon. */
export class GrappleRuntime {
  private readonly controls = new Map<ActorId, GrappleControl>();
  private readonly weaponAnimations = new Map<ActorId, GrappleWeaponAnimation>();
  private readonly q2Weapons = new Map<ActorId, Q2GrappleWeapon>();
  private readonly q1Weapon: ThreewaveWeapon | null;
  constructor(readonly selection: Extract<GrappleSelection, { readonly kind: "enabled" }>, readonly source: GrappleSource,
    readonly random: SourceRandom, private readonly slotHost: GrappleSlotHost | null = null) {
    if (selection.binding === "slot" && slotHost === null) throw new Error("Selected grapple slot needs its source weapon host");
    this.q1Weapon = source.kind === "q1-threewave" && selection.binding === "slot" && slotHost !== null
      ? new ThreewaveWeapon(source.core, { selected: actor => slotHost.selected(actor), available: actor => slotHost.available(actor), frame: (actor, frame) => slotHost.frame(actor, frame) }) : null;
    source.game.host.actors.onRelease(actor => { this.controls.delete(actor.id); this.weaponAnimations.delete(actor.id); this.q2Weapons.delete(actor.id); return undefined; });
    if (source.kind !== "q1-threewave") {
      source.game.sourceCallbacks.register(source.core.callbacks);
      source.core.bind(source.game);
    }
  }
  admit(actor: ActorId): undefined {
    if (!this.source.game.host.actors.isLive(actor) || this.source.game.host.bodies.read(actor) === null) throw new Error("Grapple needs an admitted actor and body");
    this.controls.set(actor, { teleportBit: null, jump: false, held: false, pressed: false, released: false, previousVelocity: zero, predictionSuppressed: false });
    if (this.selection.binding === "slot") {
      if (this.source.kind === "q1-threewave") this.source.core.state(actor);
      else this.bindWeapon(actor, { state: createGrappleWeaponState(), nextFrameAt: 0, kickOrigin: zero, kickPitch: 0 });
    }
    return undefined;
  }
  private bindWeapon(actor: ActorId, animation: GrappleWeaponAnimation): undefined {
    const source = this.source, host = this.slotHost;
    if (source.kind === "q1-threewave" || host === null) throw new Error("Q2 grapple animation requires its selected slot host");
    this.weaponAnimations.set(actor, animation);
    const presentation = host.presentation(actor);
    this.q2Weapons.set(actor, new Q2GrappleWeapon(actor, source.game, source.kind === "q2-ctf" ? { kind: "ctf", core: source.core, edition: this.selection.edition } : { kind: "lmctf", core: source.core }, animation.state,
      { ...presentation, kick: (origin, pitch) => { animation.kickOrigin = origin; animation.kickPitch = pitch; return undefined; } }));
    return undefined;
  }
  weapon(): WeaponReference {
    return { provider: this.selection.source.provider, item: this.selection.mechanic === "q1-threewave" ? "q1:ctf/weapon/grapple" : this.selection.mechanic === "q2-ctf" ? "q2:weapon_grapple" : "q2:weapon_hook" };
  }
  handoff(actor: ActorId): EquipmentWeaponHandoff {
    if (this.selection.binding !== "slot") throw new Error("Offhand grapple has no weapon slot");
    const q1 = this.q1Weapon, q2 = this.q2Weapons.get(actor);
    if (q1 !== null) return { weapon: this.weapon(), holster: () => q1.holster(actor), isHolstered: () => q1.isHolstered(), resume: () => q1.resume(actor) };
    if (q2 === undefined) throw new Error("Missing grapple weapon animation owner");
    return { weapon: this.weapon(), holster: () => q2.holster(), isHolstered: () => q2.isHolstered(), resume: () => { q2.resume(); const animation = this.weaponAnimations.get(actor); if (animation !== undefined) animation.nextFrameAt = Math.round((q2.game.host.now() + 0.1) * 1000) / 1000; } };
  }
  weaponView(actor: ActorId) {
    if (this.selection.binding !== "slot") return null;
    if (this.source.kind === "q1-threewave") return { path: "progs/v_star.mdl", frame: this.source.core.state(actor).weaponFrame, kickOrigin: zero, kickPitch: 0 };
    const weapon = this.q2Weapons.get(actor), animation = this.weaponAnimations.get(actor);
    return weapon === undefined || animation === undefined ? null : { path: weapon.definition.viewModel, frame: animation.state.animation.frame, kickOrigin: animation.kickOrigin, kickPitch: animation.kickPitch };
  }
  released(actor: ActorId): undefined { return this.q2Weapons.get(actor)?.released(); }
  private stepSlot(actor: ActorId): undefined {
    const source = this.source, host = this.slotHost;
    if (host === null) throw new Error("Missing grapple slot host");
    const input = this.controls.get(actor);
    if (input !== undefined) this.controls.set(actor, { ...input, pressed: false, released: false });
    if (source.kind === "q1-threewave") {
      if (host.selected(actor) && this.held(actor)) this.q1Weapon?.attack(actor);
      this.q1Weapon?.animate(actor);
      return source.core.trail(actor);
    }
    const weapon = this.q2Weapons.get(actor), animation = this.weaponAnimations.get(actor);
    if (weapon === undefined || animation === undefined) throw new Error("Missing Q2 slot animation");
    if (input?.pressed && host.selected(actor)) animation.state.animation.latchedAttack = true;
    const now = source.game.host.now();
    if (this.selection.edition === "rerelease" || now + 0.000001 >= animation.nextFrameAt) {
      animation.nextFrameAt = Math.round((animation.nextFrameAt + 0.1) * 1000) / 1000;
      weapon.step({ attack: this.held(actor), now, frameSeconds: source.game.host.frameSeconds(), instantSwitch: false, holster: false, latchedHolster: false, weaponThunk: false });
    }
    return weapon.playerFrame();
  }
  observeTeleport(actor: ActorId, bit: number): undefined {
    const state = this.controls.get(actor);
    if (state === undefined) return undefined;
    if (state.teleportBit !== null && state.teleportBit !== bit) this.release(actor);
    const current = this.controls.get(actor);
    if (current !== undefined) this.controls.set(actor, { ...current, teleportBit: bit });
    return undefined;
  }
  jump(actor: ActorId): boolean { return this.controls.get(actor)?.jump ?? false; }
  setJump(actor: ActorId, jump: boolean): undefined {
    const state = this.controls.get(actor);
    if (state !== undefined) this.controls.set(actor, { ...state, jump });
    return undefined;
  }
  held(actor: ActorId): boolean { return this.controls.get(actor)?.held ?? false; }
  input(actor: ActorId, held: boolean): undefined {
    const previous = this.controls.get(actor);
    if (previous === undefined) throw new Error("Actor has no selected offhand grapple");
    this.controls.set(actor, { ...previous, held, pressed: previous.pressed || held && !previous.held,
      released: previous.released || !held && previous.held });
    return undefined;
  }
  previousVelocity(actor: ActorId): Vec3 { return this.controls.get(actor)?.previousVelocity ?? zero; }
  setPreviousVelocity(actor: ActorId, velocity: Vec3): undefined {
    const state = this.controls.get(actor);
    if (state !== undefined) this.controls.set(actor, { ...state, previousVelocity: { ...velocity } });
    return undefined;
  }
  prediction(actor: ActorId): boolean { return this.controls.get(actor)?.predictionSuppressed ?? false; }
  setPrediction(actor: ActorId, suppressed: boolean): undefined {
    const state = this.controls.get(actor);
    if (state !== undefined) this.controls.set(actor, { ...state, predictionSuppressed: suppressed });
    return undefined;
  }
  hook(actor: ActorId): ActorId | null {
    const source = this.source;
    switch (source.kind) {
      case "q1-threewave": return source.core.hook(actor)?.actor.id ?? null;
      case "q2-ctf": return source.core.states.get(actor)?.grapple ?? null;
      case "q2-lmctf": return source.core.states.get(actor)?.hook ?? null;
    }
  }
  pulling(actor: ActorId): boolean {
    const source = this.source;
    switch (source.kind) {
      case "q1-threewave": return source.core.pulling(actor);
      case "q2-ctf": { const state = source.core.states.get(actor); return state !== undefined && state.grappleState !== "fly"; }
      case "q2-lmctf": return source.core.states.get(actor)?.hookState === 2;
    }
  }
  gravityScale(actor: ActorId): 0 | 1 { return this.source.kind === "q2-lmctf" ? this.source.core.gravityScale(actor) : 1; }
  release(actor: ActorId): undefined {
    const state = this.controls.get(actor);
    if (state !== undefined) this.controls.set(actor, { ...state, held: false, pressed: false, released: false, predictionSuppressed: false });
    if (this.hook(actor) === null && this.source.kind !== "q1-threewave") return undefined;
    switch (this.source.kind) {
      case "q1-threewave": return this.source.core.release(actor);
      case "q2-ctf": return this.source.core.reset(actor, this.source.game);
      case "q2-lmctf": return this.source.core.abort(actor, this.source.game);
    }
  }
  step(actor: ActorId, enabled: boolean): undefined {
    const state = this.controls.get(actor);
    if (state === undefined) return undefined;
    if (!enabled) return this.release(actor);
    if (this.selection.binding === "slot") return this.stepSlot(actor);
    if (state.released) return this.release(actor);
    if (!state.held) return undefined;
    this.controls.set(actor, { ...state, pressed: false, released: false });
    const source = this.source;
    switch (source.kind) {
      case "q1-threewave":
        if (state.pressed) source.core.fire(actor);
        return source.core.trail(actor);
      case "q2-ctf":
        if (state.pressed) source.core.offhand(actor, source.game, true);
        if (!source.game.host.actors.isLive(actor)) return undefined;
        return source.core.playerFrame(actor, source.game);
      case "q2-lmctf":
        return state.pressed || source.core.states.get(actor)?.hook != null ? source.core.fire(actor, source.game) : undefined;
    }
  }
  capture(): GrappleRuntimeCheckpoint {
    const common = { version: 2, weaponAnimations: [...this.weaponAnimations].map(([actor, state]) => ({ actor: saved(actor), ...state })), controls: [...this.controls].map(([actor, state]) => ({ actor: saved(actor), ...state })), random: this.random.checkpoint() } satisfies Omit<GrappleRuntimeCheckpoint, "source">;
    const source = this.source;
    switch (source.kind) {
      case "q1-threewave": return { ...common, source: { kind: source.kind, entities: source.game.capture() } };
      case "q2-ctf": return { ...common, source: { kind: source.kind, entities: source.game.capture(), states: [...source.core.states].map(([actor, state]) => ({ actor: saved(actor), state: captureCtfGrapple(state) })) } };
      case "q2-lmctf": return { ...common, source: { kind: source.kind, entities: source.game.capture(), states: [...source.core.states].map(([actor, state]) => ({ actor: saved(actor), state: captureLmctfGrapple(state) })) } };
    }
  }
  restore(checkpoint: GrappleRuntimeCheckpoint): undefined {
    this.random.restore(checkpoint.random);
    const source = this.source, savedSource = checkpoint.source;
    if (source.kind === "q1-threewave" && savedSource.kind === "q1-threewave") source.game.restore(savedSource.entities, { scheduleThinks: false });
    else if (source.kind === "q2-ctf" && savedSource.kind === "q2-ctf") {
      source.game.restore(savedSource.entities); source.core.states.clear();
      for (const entry of savedSource.states) source.core.states.set(source.game.host.actors.referenceSaved(entry.actor), restoreCtfGrapple(entry.state, source.game));
    } else if (source.kind === "q2-lmctf" && savedSource.kind === "q2-lmctf") {
      source.game.restore(savedSource.entities); source.core.states.clear();
      for (const entry of savedSource.states) source.core.states.set(source.game.host.actors.referenceSaved(entry.actor), restoreLmctfGrapple(entry.state, source.game));
    } else throw new Error("Saved grapple source differs from selected equipment");
    this.weaponAnimations.clear(); this.q2Weapons.clear();
    for (const entry of checkpoint.weaponAnimations) { const actor = source.game.host.actors.resolveSaved(entry.actor); if (actor === null) throw new Error("Missing grapple animation owner"); this.bindWeapon(actor.id, entry); }
    this.controls.clear();
    for (const entry of checkpoint.controls) {
      const actor = source.game.host.actors.resolveSaved(entry.actor);
      if (actor === null || this.controls.has(actor.id)) throw new Error("Invalid saved grapple input owner");
      const { actor: _savedActor, ...state } = entry;
      this.controls.set(actor.id, state);
    }
    return undefined;
  }
}
