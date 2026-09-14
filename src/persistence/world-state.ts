import { isDeepStrictEqual } from "node:util";
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
    const body = bodies.read(actor.id), links = bodies.linkState(actor.id), attachment = bodies.attachment(actor.id);
    if (body !== null && links !== null) result.push({ actor: savedActorId(actor.id), body: saveBody(body), linkCount: links.linkCount,
      attachment: attachment === null ? null : { ...attachment, anchor: savedActorId(attachment.anchor) },
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
  /** Prebound source storage and its semantic views must already contain the saved values. */
  storage(actor: OwnedActor): "copied" | "prebound";
}

/** Run before source-provider restore binds named callbacks; link bodies after source collision metadata exists. */
export function restoreSharedWorldState(save: SaveImage, host: SharedWorldRestoreHost): undefined {
  const actor = (saved: SavedActorId): OwnedActor => {
    const restored = host.actors.resolveSaved(saved);
    if (restored === null) throw new SaveFormatError("world", `missing saved actor ${saved.slot}/${saved.generation}`);
    return restored;
  };
  const bodyActors = new Set(save.bodies.map(entry => actor(entry.actor)));
  const combatActors = new Set(save.combat.map(entry => actor(entry.actor)));
  const inventoryActors = new Set(save.inventories.map(entry => actor(entry.actor)));
  for (const entry of save.actors) if (entry.lifetime.kind === "active") {
    const restored = actor(entry);
    if (host.storage(restored) !== "prebound") continue;
    if ((host.bodies.read(restored.id) !== null) !== bodyActors.has(restored)
      || (host.combat.read(restored.id) !== null) !== combatActors.has(restored)
      || host.inventory.has(restored.id) !== inventoryActors.has(restored))
      throw new SaveFormatError("world", "source bindings disagree with saved shared state coverage");
  }
  for (const entry of save.bodies) {
    const restored = actor(entry.actor);
    if (host.storage(restored) === "prebound") {
      const body = host.bodies.read(restored.id);
      if (body === null) throw new SaveFormatError("world.bodies", "source body view has not been bound");
      const ground = entry.body.ground === null ? null : host.actors.referenceSaved(entry.body.ground);
      const sameGround = body.ground === null ? ground === null : ground !== null && body.ground.equals(ground);
      if (!sameGround || !isDeepStrictEqual({ ...body, ground: null }, { ...entry.body, ground: null }))
        throw new SaveFormatError("world.bodies", "source body disagrees with saved shared state");
    } else host.bodies.create(restored, { ...entry.body, ground: entry.body.ground === null ? null : host.actors.referenceSaved(entry.body.ground) });
  }
  for (const entry of save.bodies) if (entry.attachment !== null) {
    host.bodies.attach(actor(entry.actor), { ...entry.attachment, anchor: actor(entry.attachment.anchor).id });
  }
  for (const entry of save.combat) {
    const restored = actor(entry.actor);
    if (host.storage(restored) === "prebound") {
      const state = host.combat.read(restored.id);
      if (state === null) throw new SaveFormatError("world.combat", "source combat view has not been bound");
      if (!isDeepStrictEqual(state, entry.state)) throw new SaveFormatError("world.combat", "source combat disagrees with saved shared state");
    } else host.combat.create(restored, entry.state);
  }
  for (const entry of save.inventories) {
    const restored = actor(entry.actor);
    if (host.storage(restored) === "prebound") {
      if (!host.inventory.has(restored.id)) throw new SaveFormatError("world.inventories", "source inventory view has not been bound");
      if (!isDeepStrictEqual(host.inventory.entries(restored.id), entry.entries))
        throw new SaveFormatError("world.inventories", "source inventory disagrees with saved shared state");
    } else host.inventory.create(restored, entry.entries);
  }
  return undefined;
}
