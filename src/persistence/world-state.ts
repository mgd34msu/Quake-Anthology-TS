import type { OwnedActor } from "../contracts/identity.ts";
import type { BodyCheckpoint, SaveImage, SavedActorId, SavedBodyState } from "../contracts/session.ts";
import type { BodyState } from "../contracts/world.ts";
import type { SessionActorRegistry } from "../world/actors/registry.ts";
import type { SharedBodyTable } from "../world/actors/body.ts";
import type { GameplayAuthority } from "../world/gameplay/authority.ts";
import type { SharedInventoryTable } from "../world/gameplay/inventory.ts";
import { SaveFormatError } from "./value.ts";
import { savedActorId } from "./save-image.ts";

export function captureSharedBodies(actors: SessionActorRegistry, bodies: SharedBodyTable): readonly BodyCheckpoint[] {
  const result: BodyCheckpoint[] = [];
  const saveBody = (state: BodyState): SavedBodyState => ({ ...state, ground: state.ground === null ? null : savedActorId(state.ground) });
  for (const actor of actors.observations()) {
    const body = bodies.read(actor.id), links = bodies.linkState(actor.id);
    if (body !== null && links !== null) result.push({ actor: savedActorId(actor.id), body: saveBody(body), linkCount: links.linkCount,
      linked: links.linked === null ? null : { state: saveBody(links.linked.state), absoluteBounds: links.linked.absoluteBounds } });
  }
  return result;
}

/** Run after provider restore has made collision metadata available, before scheduling resumes. */
export function restoreSharedBodyLinks(save: Pick<SaveImage, "bodies">, host: Pick<SharedWorldRestoreHost, "actors" | "bodies">): undefined {
  for (const entry of save.bodies) {
    const actor = host.actors.resolveSaved(entry.actor);
    if (actor === null) throw new SaveFormatError("world.body-links", `missing saved actor ${entry.actor.slot}/${entry.actor.generation}`);
    host.bodies.restoreLinkState(actor, { linkCount: entry.linkCount, linked: entry.linked === null ? null : { absoluteBounds: entry.linked.absoluteBounds,
      state: { ...entry.linked.state, ground: entry.linked.state.ground === null ? null : host.actors.referenceSaved(entry.linked.state.ground) } } });
  }
  return undefined;
}

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
