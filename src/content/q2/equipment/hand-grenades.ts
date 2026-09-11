import type { ActorId } from "../../../contracts/identity.ts";
import type { SavedActorId } from "../../../contracts/session.ts";
import type { Q2Edition, Q2GameServices } from "../foundation/host.ts";
import { stepHandAction } from "../foundation/weapons/hand-action.ts";
import type { HandAction, HandActionHost, HandActionInput } from "../foundation/weapons/hand-action.ts";
import type { HandProjectileSpec } from "../foundation/weapons/hand-grenade.ts";
import type { Q2Ballistics } from "../foundation/weapons/ballistics.ts";
import type { Q2WeaponInput } from "../foundation/weapons/types.ts";

export const HAND_GRENADE_AMMO = "q2:ammo_grenades";

export interface HandGrenadeLoadout {
  readonly enabled: boolean;
  /** Initial allowance applies only when the canonical ammo entry does not exist. */
  readonly initialAmmo: number;
  readonly capacity: number;
  readonly infiniteAmmo: boolean;
}

export interface HandGrenadeEquipmentInput extends Pick<Q2WeaponInput,
  "angles" | "gravity" | "quadUntil" | "doubleUntil" | "quadFireUntil" | "haste" | "noStackDouble" | "playersCollide"> {
  readonly pressed: boolean;
  readonly held: boolean;
  readonly released: boolean;
  readonly lifecycle: HandActionInput["lifecycle"];
  readonly project: HandActionInput["throw"]["project"];
}

export interface HandGrenadeEquipmentState {
  readonly config: HandGrenadeLoadout;
  /** Preparing, cooking, and releasing own one reservation, already debited unless infiniteAmmo. */
  readonly action: HandAction;
}

export interface HandGrenadesCheckpoint {
  readonly version: 1;
  readonly edition: Q2Edition;
  readonly actors: readonly { readonly actor: SavedActorId; readonly state: HandGrenadeEquipmentState }[];
}

type HandEffect = { readonly kind: "sound"; readonly event: Parameters<HandActionHost["sound"]>[0] }
  | { readonly kind: "emit"; readonly spec: HandProjectileSpec }
  | { readonly kind: "ammo" };

function reserved(action: HandAction): boolean {
  return action.kind === "preparing" || action.kind === "cooking" || action.kind === "releasing";
}

function checkLoadout(config: HandGrenadeLoadout): undefined {
  if (!Number.isSafeInteger(config.capacity) || config.capacity < 0 || !Number.isSafeInteger(config.initialAmmo)
    || config.initialAmmo < 0 || config.initialAmmo > config.capacity) throw new RangeError("Hand grenade allowance must be whole ammunition within capacity");
  return undefined;
}

/** Equipment owns action state only. Actors, inventory, projectile callbacks and clocks belong to the session. */
export class Q2HandGrenadeEquipment {
  private readonly states = new Map<ActorId, HandGrenadeEquipmentState>();
  private activeSteps = 0;

  constructor(readonly game: Q2GameServices, readonly ballistics: Q2Ballistics) {
    game.sourceCallbacks.register(ballistics.callbacks);
    game.host.actors.onRelease(actor => { this.states.delete(actor.id); return undefined; });
  }

  configure(actor: ActorId, config: HandGrenadeLoadout): undefined {
    checkLoadout(config);
    const owner = this.game.host.actors.resolveOwned(actor);
    if (owner === null || this.game.host.bodies.read(actor) === null || !this.game.host.inventory.has(actor)) {
      throw new Error("Hand grenade equipment requires an existing shared actor, body and inventory");
    }
    const previous = this.states.get(owner.id);
    if (previous !== undefined && reserved(previous.action) && previous.config.infiniteAmmo !== config.infiniteAmmo) {
      throw new Error("Cannot change hand grenade resource policy while a grenade is reserved");
    }
    const ammo = this.game.host.inventory.entries(actor).find(entry => entry.item === HAND_GRENADE_AMMO);
    if (ammo === undefined) this.game.host.inventory.configure(owner, { item: HAND_GRENADE_AMMO, count: config.initialAmmo, capacity: config.capacity });
    this.states.set(owner.id, { config: { ...config }, action: previous?.action ?? { kind: "idle" } });
    return undefined;
  }

  state(actor: ActorId): HandGrenadeEquipmentState | null {
    const state = this.states.get(actor);
    return state === undefined ? null : structuredClone(state);
  }

  step(actor: ActorId, input: HandGrenadeEquipmentInput): undefined {
    const current = this.states.get(actor);
    if (current === undefined) return undefined;
    const owner = this.game.host.actors.resolveOwned(actor);
    if (owner === null || input.lifecycle === "removed") { this.states.delete(actor); return undefined; }
    const now = this.game.host.now(), config = current.config, effects: HandEffect[] = [];
    const lifecycle = input.lifecycle === "alive" && (this.game.host.combat.read(actor)?.health ?? 0) <= 0 ? "dead" : input.lifecycle;
    const quad = input.quadUntil > now;
    const host: HandActionHost = {
      reserve: () => {
        if (config.infiniteAmmo) return true;
        if (!this.game.host.inventory.consume(owner, HAND_GRENADE_AMMO, 1)) return false;
        effects.push({ kind: "ammo" }); return true;
      },
      consume: () => undefined,
      refund: () => {
        if (config.infiniteAmmo || !this.game.host.actors.isLive(actor)) return undefined;
        const entry = this.game.host.inventory.entries(actor).find(candidate => candidate.item === HAND_GRENADE_AMMO);
        if (entry === undefined) throw new Error("Reserved hand grenade lost its canonical inventory entry");
        this.game.host.inventory.configure(owner, { ...entry, count: entry.count + 1 });
        effects.push({ kind: "ammo" }); return undefined;
      },
      emit: spec => { effects.push({ kind: "emit", spec }); return undefined; },
      sound: event => { effects.push({ kind: "sound", event }); return undefined; },
    };
    this.activeSteps++;
    try {
      const action = stepHandAction(current.action, { now, edition: this.game.options.edition, enabled: config.enabled,
        pressed: input.pressed, held: input.held, released: input.released, lifecycle, haste: input.haste, quadFire: input.quadFireUntil > now,
        throw: { angles: input.angles, gravity: input.gravity, project: input.project,
          damageMultiplier: (quad ? 4 : 1) * (input.doubleUntil > now && !(quad && input.noStackDouble) ? 2 : 1) } }, host);
      const next: HandGrenadeEquipmentState = { config, action };
      this.states.set(actor, next);
      // Immediate explosions can synchronously kill or remove their owner. Publish the
      // consumed action first, and never overwrite a nested lifecycle update afterward.
      for (const effect of effects) {
        if (this.states.get(actor) !== next || !this.game.host.actors.isLive(actor)) break;
        switch (effect.kind) {
          case "ammo": this.ballistics.hooks.ammoChanged(actor, HAND_GRENADE_AMMO); break;
          case "emit": this.ballistics.fireHandGrenade(actor, this.game, { ...effect.spec, timer: effect.spec.fuse, playersCollide: input.playersCollide }); break;
          case "sound": {
            const body = this.game.host.bodies.read(actor);
            if (body === null) throw new Error("Hand grenade owner lost its shared body before removal");
            this.game.host.emit({ kind: "sound", actor, origin: body.origin,
              path: effect.event === "cock" ? "weapons/hgrena1b.wav" : "weapons/hgrenc1b.wav", channel: 1, volume: 1, attenuation: 1, reliable: false,
              loop: effect.event === "cock" ? "once" : effect.event === "cook-start" ? "start" : "stop" });
            break;
          }
        }
      }
    } finally { this.activeSteps--; }
    return undefined;
  }

  capture(): HandGrenadesCheckpoint {
    if (this.activeSteps !== 0) throw new Error("Hand grenade saves require a completed action boundary");
    return { version: 1, edition: this.game.options.edition,
      actors: [...this.states].map(([actor, state]) => ({ actor: { slot: actor.slot, generation: actor.generation }, state: structuredClone(state) })) };
  }

  /** Restore shared actors and the already debited inventory first. No action effects are replayed. */
  restore(checkpoint: HandGrenadesCheckpoint): undefined {
    if (this.activeSteps !== 0) throw new Error("Hand grenade restore requires a completed action boundary");
    if (checkpoint.edition !== this.game.options.edition) throw new Error("Hand grenade checkpoint source edition differs");
    const restored = new Map<ActorId, HandGrenadeEquipmentState>();
    for (const entry of checkpoint.actors) {
      checkLoadout(entry.state.config);
      const owner = this.game.host.actors.resolveSaved(entry.actor);
      if (owner === null || this.game.host.bodies.read(owner.id) === null || !this.game.host.inventory.has(owner.id)) {
        throw new Error("Hand grenade checkpoint owner has no restored shared actor, body or inventory");
      }
      if (restored.has(owner.id)) throw new Error("Duplicate hand grenade checkpoint owner");
      if (!this.game.host.inventory.entries(owner.id).some(item => item.item === HAND_GRENADE_AMMO)) throw new Error("Hand grenade checkpoint has no canonical ammo entry");
      restored.set(owner.id, structuredClone(entry.state));
    }
    this.states.clear();
    for (const [actor, state] of restored) this.states.set(actor, state);
    return undefined;
  }
}
