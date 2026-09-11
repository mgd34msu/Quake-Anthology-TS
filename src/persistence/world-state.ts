import type { OwnedActor } from "../contracts/identity.ts";
import type { SaveImage, SavedActorId } from "../contracts/session.ts";
import type { SessionActorRegistry } from "../world/actors/registry.ts";
import type { SharedBodyTable } from "../world/actors/body.ts";
import type { GameplayAuthority } from "../world/gameplay/authority.ts";
import type { SharedInventoryTable } from "../world/gameplay/inventory.ts";
import { SaveFormatError } from "./value.ts";

export interface SharedWorldRestoreHost {
  readonly actors: SessionActorRegistry;
  readonly bodies: SharedBodyTable;
  readonly combat: GameplayAuthority;
  readonly inventory: SharedInventoryTable;
  /** Guest memory and its semantic views must already be restored and bound. */
  storage(actor: OwnedActor): "typescript" | "guest";
}

/** Run before source-provider restore binds named callbacks; link bodies after source collision metadata exists. */
export function restoreSharedWorldState(save: SaveImage, host: SharedWorldRestoreHost): undefined {
  const actor = (saved: SavedActorId): OwnedActor => {
    const restored = host.actors.resolveSaved(saved);
    if (restored === null) throw new SaveFormatError("world", `missing saved actor ${saved.slot}/${saved.generation}`);
    return restored;
  };
  for (const entry of save.bodies) {
    const restored = actor(entry.actor);
    if (host.storage(restored) === "guest") {
      if (host.bodies.read(restored.id) === null) throw new SaveFormatError("world.bodies", "guest body view has not been bound");
    } else host.bodies.create(restored, { ...entry.body, ground: entry.body.ground === null ? null : host.actors.referenceSaved(entry.body.ground) });
  }
  for (const entry of save.combat) {
    const restored = actor(entry.actor);
    if (host.storage(restored) === "guest") {
      if (host.combat.read(restored.id) === null) throw new SaveFormatError("world.combat", "guest combat view has not been bound");
    } else host.combat.create(restored, entry.state);
  }
  for (const entry of save.inventories) {
    const restored = actor(entry.actor);
    if (host.storage(restored) === "guest") {
      if (!host.inventory.has(restored.id)) throw new SaveFormatError("world.inventories", "guest inventory view has not been bound");
    } else host.inventory.create(restored, entry.entries);
  }
  return undefined;
}
