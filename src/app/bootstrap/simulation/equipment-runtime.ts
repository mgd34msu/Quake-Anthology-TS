import type { HandGrenadeSelection } from "../../../contracts/content.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import type { InventoryEntry } from "../../../contracts/gameplay.ts";
import type { RandomState } from "../../../contracts/numeric.ts";
import type { SavedActorId } from "../../../contracts/session.ts";
import type { Q2FoundationCheckpoint } from "../../../content/q2/foundation/checkpoint.ts";
import type { Q2EntityServices } from "../../../content/q2/foundation/entity-services.ts";
import type { HandAction } from "../../../content/q2/foundation/weapons/hand-action.ts";
import { HAND_GRENADE_AMMO, Q2HandGrenadeEquipment } from "../../../content/q2/equipment/hand-grenades.ts";
import type { HandGrenadesCheckpoint, HandGrenadeEquipmentInput, HandGrenadeEquipmentState } from "../../../content/q2/equipment/hand-grenades.ts";
import type { SourceRandom } from "./random.ts";

interface HandControl { readonly held: boolean; readonly pressed: boolean; readonly released: boolean; }
export interface HandGrenadeRuntimeCheckpoint {
  readonly version: 1;
  readonly controller: HandGrenadesCheckpoint;
  readonly controls: readonly ({ readonly actor: SavedActorId } & HandControl)[];
  readonly source: { readonly entities: Q2FoundationCheckpoint;
    readonly random: Extract<RandomState, { readonly kind: "glibc-random" | "q2-rerelease-mt19937" }> };
}
export interface HandGrenadeTravel {
  readonly state: HandGrenadeEquipmentState;
  readonly ammo: InventoryEntry;
  readonly seconds: number;
}

function rebase(action: HandAction, delta: number): HandAction {
  switch (action.kind) {
    case "idle": case "disarmed": return action;
    case "preparing": return { ...action, nextAt: action.nextAt + delta };
    case "cooking": return { ...action, expiresAt: action.expiresAt + delta };
    case "releasing": return { ...action, expiresAt: action.expiresAt + delta, throwAt: action.throwAt + delta };
    case "recovering": return { ...action, readyAt: action.readyAt + delta };
  }
}

/** Action and input edges share the session's actors, ammunition and source continuations. */
export class HandGrenadeRuntime {
  private readonly controls = new Map<ActorId, HandControl>();
  constructor(readonly selection: Extract<HandGrenadeSelection, { readonly kind: "enabled" }>,
    readonly controller: Q2HandGrenadeEquipment, readonly independent: { readonly game: Q2EntityServices; readonly random: SourceRandom }) {
    controller.game.host.actors.onRelease(actor => { this.controls.delete(actor.id); return undefined; });
  }

  admit(actor: ActorId, carry?: HandGrenadeTravel): undefined {
    const game = this.controller.game;
    const first = this.controller.state(actor) === null;
    this.controller.configure(actor, { enabled: true, initialAmmo: this.selection.initialAmmo, capacity: this.selection.capacity, infiniteAmmo: false });
    this.controls.set(actor, { held: false, pressed: false, released: false });
    if (first && carry === undefined) this.grantInitial(actor);
    if (carry !== undefined) {
      const owner = game.host.actors.resolveOwned(actor);
      if (owner === null) throw new Error("Equipment travel requires a live actor");
      game.host.inventory.configure(owner, carry.ammo);
      const checkpoint = this.controller.capture();
      this.controller.restore({ ...checkpoint, actors: checkpoint.actors.map(entry => entry.actor.slot === actor.slot && entry.actor.generation === actor.generation
        ? { ...entry, state: { ...carry.state, action: rebase(carry.state.action, game.host.now() - carry.seconds) } } : entry) });
    }
    return undefined;
  }

  private grantInitial(actor: ActorId): undefined {
    const game = this.controller.game, owner = game.host.actors.resolveOwned(actor);
    const ammo = game.host.inventory.entries(actor).find(entry => entry.item === HAND_GRENADE_AMMO);
    if (owner === null || ammo === undefined) throw new Error("Equipment allowance requires shared inventory");
    game.host.inventory.configure(owner, { ...ammo, count: Math.max(ammo.count, this.selection.initialAmmo),
      capacity: Math.max(ammo.capacity, this.selection.capacity) });
    return undefined;
  }

  respawn(actor: ActorId): undefined {
    this.admit(actor);
    this.grantInitial(actor);
    const checkpoint = this.controller.capture();
    this.controller.restore({ ...checkpoint, actors: checkpoint.actors.map(entry => entry.actor.slot === actor.slot && entry.actor.generation === actor.generation
      ? { ...entry, state: { ...entry.state, action: { kind: "idle" } } } : entry) });
    return undefined;
  }

  input(actor: ActorId, held: boolean): undefined {
    const previous = this.controls.get(actor);
    if (previous === undefined) throw new Error("Actor has no selected hand grenade equipment");
    this.controls.set(actor, { held, pressed: previous.pressed || held && !previous.held, released: previous.released || !held && previous.held });
    return undefined;
  }

  step(actor: ActorId, input: Omit<HandGrenadeEquipmentInput, "pressed" | "held" | "released">, enabled = true): undefined {
    const controls = this.controls.get(actor);
    if (controls === undefined) return undefined;
    const state = this.controller.state(actor);
    if (state !== null && state.config.enabled !== enabled) this.controller.configure(actor, { ...state.config, enabled });
    this.controls.set(actor, { held: controls.held, pressed: false, released: false });
    return this.controller.step(actor, { ...input, ...controls });
  }

  travel(actor: ActorId): HandGrenadeTravel | undefined {
    const state = this.controller.state(actor);
    if (state === null) return undefined;
    const ammo = this.controller.game.host.inventory.entries(actor).find(entry => entry.item === HAND_GRENADE_AMMO);
    if (ammo === undefined) throw new Error("Equipment travel lost its canonical ammunition");
    return { state, ammo, seconds: this.controller.game.host.now() };
  }

  capture(): HandGrenadeRuntimeCheckpoint {
    return { version: 1, controller: this.controller.capture(),
      controls: [...this.controls].map(([actor, state]) => ({ actor: { slot: actor.slot, generation: actor.generation }, ...state })),
      source: { entities: this.independent.game.capture(), random: this.independent.random.checkpoint() } };
  }

  restore(checkpoint: HandGrenadeRuntimeCheckpoint): undefined {
    this.independent.random.restore(checkpoint.source.random);
    this.independent.game.restore(checkpoint.source.entities);
    this.controller.restore(checkpoint.controller);
    this.controls.clear();
    for (const entry of checkpoint.controls) {
      const actor = this.controller.game.host.actors.resolveSaved(entry.actor);
      if (actor === null || this.controller.state(actor.id) === null || this.controls.has(actor.id)) throw new Error("Invalid equipment input owner");
      this.controls.set(actor.id, { held: entry.held, pressed: entry.pressed, released: entry.released });
    }
    if (this.controls.size !== checkpoint.controller.actors.length) throw new Error("Equipment checkpoint is missing an action's input state");
    return undefined;
  }
}
