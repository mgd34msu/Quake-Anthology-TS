import type { AttackProvenance } from "../../../contracts/gameplay.ts";
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { SavedActorId } from "../../../contracts/session.ts";
import type { Q2Entity, Q2GameServices } from "./host.ts";

export function saveQ2Actor(actor: ActorId | null): SavedActorId | null {
  return actor === null ? null : { slot: actor.slot, generation: actor.generation };
}

export function restoreQ2Actor(game: Q2GameServices, actor: SavedActorId): OwnedActor {
  const owner = game.host.actors.resolveSaved(actor);
  if (owner === null) throw new Error(`Q2 checkpoint references missing actor ${actor.slot}:${actor.generation}`);
  return owner;
}

export interface Q2AttackCheckpoint extends Omit<AttackProvenance, "attacker" | "inflictor"> {
  readonly attacker: SavedActorId | null;
  readonly inflictor: SavedActorId | null;
}

export interface Q2EntityCheckpoint {
  readonly actor: SavedActorId;
  readonly sourceSlot: number | null;
  readonly spawn: { readonly classname: string; readonly ordinal: number; readonly values: readonly { readonly key: string; readonly value: string }[] };
  readonly values: Omit<Q2Entity, "actor" | "spawn" | "activator" | "enemy" | "owner" | "goal" | "teamMaster" | "teamChain" | "chain" | "beam" | "beam2" | "proboscus" | "lastAttack" | "think" | "prethink" | "postthink" | "use" | "touch" | "pain" | "die" | "blocked">;
  readonly links: { readonly activator: SavedActorId | null; readonly enemy: SavedActorId | null; readonly owner: SavedActorId | null; readonly goal: SavedActorId | null;
    readonly teamMaster: SavedActorId | null; readonly teamChain: SavedActorId | null; readonly chain: SavedActorId | null; readonly beam: SavedActorId | null; readonly beam2: SavedActorId | null; readonly proboscus: SavedActorId | null; };
  readonly lastAttack: Q2AttackCheckpoint | null;
  readonly callbacks: { readonly think: string | null; readonly prethink: string | null; readonly postthink: string | null; readonly use: string | null; readonly touch: string | null;
    readonly pain: string | null; readonly die: string | null; readonly blocked: string | null; };
}

export interface Q2FoundationCheckpoint {
  readonly version: 1;
  readonly nextSourceSlot: number;
  readonly sequence: number;
  readonly freedSlots: readonly { readonly slot: number; readonly time: number }[];
  readonly counters: Readonly<Q2GameServices["counters"]>;
  readonly entities: readonly Q2EntityCheckpoint[];
}
