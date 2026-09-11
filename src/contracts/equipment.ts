import type { GrappleSelection } from "./content.ts";
import type { ActorId } from "./identity.ts";

export interface SharedGrappleControl {
  readonly selection: GrappleSelection;
  nativeSlot(mechanic: Extract<GrappleSelection, { readonly kind: "enabled" }>["mechanic"]): boolean;
  input(actor: ActorId, held: boolean): undefined;
  release(actor: ActorId): undefined;
  pulling(actor: ActorId): boolean;
  gravityScale(actor: ActorId): 0 | 1;
}
