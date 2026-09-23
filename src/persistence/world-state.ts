import { readSourceItems } from "./source-items.ts";
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
import { readPrimaryProtection } from "./protection.ts";

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
export function restoreSharedBodyLinks(save: Pick<SaveImage, "bodies">,
  host: Pick<SharedWorldRestoreHost, "actors" | "bodies"> & { readonly storage?: SharedWorldRestoreHost["storage"] }): undefined {
  for (const entry of save.bodies) {
    const actor = host.actors.resolveSaved(entry.actor);
    if (actor === null) throw new SaveFormatError("world.body-links", `missing saved actor ${entry.actor.slot}/${entry.actor.generation}`);
    if (host.storage?.(actor) === "source-reconstructed") {
      if (host.bodies.read(actor.id) === null) throw new SaveFormatError("world.body-links", "reconstructed source body has not been bound");
      continue;
    }
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
  /** Exact prebound checkpoints retain saved values; original-file callbacks own reconstructed values. */
  storage(actor: OwnedActor): "copied" | "prebound" | "source-reconstructed";
}

export interface SharedWorldRestoreCompletion {
  /** Finish after component source state and its combat layers have been attached. */
  finish(): undefined;
  assertComplete(): undefined;
}

/** Run before source-provider restore binds named callbacks; link bodies after source collision metadata exists. */
export function restoreSharedWorldState(save: SaveImage, host: SharedWorldRestoreHost): undefined;
export function restoreSharedWorldState(save: SaveImage, host: SharedWorldRestoreHost,
  options: { readonly deferProtection: true }): SharedWorldRestoreCompletion;
export function restoreSharedWorldState(save: SaveImage, host: SharedWorldRestoreHost,
  options?: { readonly deferProtection: true }): undefined | SharedWorldRestoreCompletion {
  host.combat.assertIdle();
  const hidden = readPrimaryProtection(save, host.actors);
  const sourceItems = new Map(readSourceItems(save).map(entry => [host.actors.resolveSaved(entry.actor), entry]));
  const actor = (saved: SavedActorId): OwnedActor => {
    const restored = host.actors.resolveSaved(saved);
    if (restored === null) throw new SaveFormatError("world", `missing saved actor ${saved.slot}/${saved.generation}`);
    return restored;
  };
  const bodyActors = new Set(save.bodies.map(entry => actor(entry.actor)));
  const combatActors = new Set(save.combat.map(entry => actor(entry.actor)));
  for (const owner of hidden.entries.keys()) if (!combatActors.has(owner) || host.storage(owner) !== "copied")
    throw new SaveFormatError("world.combat", "hidden armor checkpoint requires a copied combat owner");
  const inventories = new Map(save.inventories.map(entry => [actor(entry.actor), entry.entries]));
  for (const entry of save.actors) if (entry.lifetime.kind === "active") {
    const restored = actor(entry);
    if (host.storage(restored) === "copied") continue;
    if ((host.bodies.read(restored.id) !== null) !== bodyActors.has(restored)
      || (host.combat.read(restored.id) !== null) !== combatActors.has(restored)
      || host.inventory.has(restored.id) !== inventories.has(restored))
      throw new SaveFormatError("world", "source bindings disagree with saved shared state coverage");
  }
  for (const entry of save.bodies) {
    const restored = actor(entry.actor);
    const storage = host.storage(restored);
    if (storage !== "copied") {
      const body = host.bodies.read(restored.id);
      if (body === null) throw new SaveFormatError("world.bodies", "source body view has not been bound");
      if (storage === "source-reconstructed") continue;
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
    const storage = host.storage(restored);
    const saved = options === undefined && save.legacyArmorLayout === true && storage !== "copied"
      ? { ...entry.state, armor: host.combat.normalizeLegacyArmor(restored, entry.state.armor) } : entry.state;
    if (storage !== "copied") {
      const state = host.combat.read(restored.id);
      if (state === null) throw new SaveFormatError("world.combat", "source combat view has not been bound");
      if (options === undefined && storage === "prebound" && !isDeepStrictEqual(state, saved)) throw new SaveFormatError("world.combat", "source combat disagrees with saved shared state");
    } else {
      const primary = hidden.entries.get(restored);
      if (options === undefined && primary !== undefined) throw new SaveFormatError("world.combat", "hidden primary armor requires component restoration");
      host.combat.create(restored, options === undefined ? saved : { ...saved, armor: {
        regular: primary?.regular ?? (saved.armor.regular.kind === "source" ? { kind: "none" } : saved.armor.regular),
        powered: primary?.powered ?? { kind: "none" },
      } });
    }
  }
  for (const entry of save.inventories) {
    const restored = actor(entry.actor);
    const storage = host.storage(restored), primary = sourceItems.get(restored)?.primary ?? entry.entries;
    if (storage !== "copied") {
      if (!host.inventory.has(restored.id)) throw new SaveFormatError("world.inventories", "source inventory view has not been bound");
      if (storage === "prebound" && !isDeepStrictEqual(host.inventory.entries(restored.id), primary))
        throw new SaveFormatError("world.inventories", "source inventory disagrees with saved shared state");
    } else host.inventory.create(restored, primary);
  }
  if (options === undefined) return undefined;
  let state: "pending" | "complete" | "failed" = "pending";
  return {
    finish() {
      if (state !== "pending") throw new SaveFormatError("world.combat", `shared restoration is ${state}`);
      try {
        host.combat.assertIdle();
        const copied: { readonly actor: OwnedActor; readonly state: SaveImage["combat"][number]["state"] }[] = [];
        for (const entry of save.combat) {
          const restored = actor(entry.actor), storage = host.storage(restored);
          const saved = save.legacyArmorLayout === true && storage !== "copied"
            ? { ...entry.state, armor: host.combat.normalizeLegacyArmor(restored, entry.state.armor) } : entry.state;
          const current = host.combat.read(restored.id);
          const externalRegular = host.combat.protectionOwner(restored, "regular") !== null;
          const externalPower = host.combat.protectionOwner(restored, "powered") !== null;
          const componentItems = { regular: host.combat.protectionInventoryItems(restored, "regular"), powered: host.combat.protectionInventoryItems(restored, "powered") };
          const primary = hidden.entries.get(restored), ownsCopy = host.combat.copiedPrimaryArmor(restored) !== null;
          if (current === null) throw new SaveFormatError("world.combat", "restored combat view has not been bound");
          if (primary !== undefined && !ownsCopy) throw new SaveFormatError("world.combat", "source binding cannot restore copied primary armor");
          if (ownsCopy && (hidden.recorded || externalRegular)) {
            if ((primary?.regular !== undefined) !== externalRegular || (primary?.powered !== undefined) !== externalPower)
              throw new SaveFormatError("world.combat", "hidden primary armor coverage differs from restored component ownership");
          }
          if (storage === "source-reconstructed") {
            for (const channel of ["regular", "powered"] satisfies readonly ("regular" | "powered")[]) {
              if (host.combat.protectionOwner(restored, channel) !== null && !isDeepStrictEqual(current.armor[channel], saved.armor[channel]))
                throw new SaveFormatError("world.combat", `component ${channel} protection disagrees with saved shared state`);
              for (const item of componentItems[channel]) {
                const savedItem = inventories.get(restored)?.find(entry => entry.item === item);
                const currentItem = host.inventory.entries(restored.id).find(entry => entry.item === item);
                if (savedItem === undefined || currentItem === undefined || !Object.is(savedItem.count, currentItem.count))
                  throw new SaveFormatError("world.inventories", "component protection inventory disagrees with saved shared state");
              }
            }
          } else if (storage === "copied" && !externalPower) {
            if (!isDeepStrictEqual({ ...current, armor: { ...current.armor, powered: saved.armor.powered } }, saved))
              throw new SaveFormatError("world.combat", "copied combat disagrees with saved shared state");
            copied.push({ actor: restored, state: saved });
          } else if (!isDeepStrictEqual(current, saved)) throw new SaveFormatError("world.combat", "source combat disagrees with saved shared state");
        }
        for (const entry of save.inventories) {
          const restored = actor(entry.actor);
          if (host.storage(restored) !== "source-reconstructed" && (!host.inventory.has(restored.id)
            || !isDeepStrictEqual(host.inventory.entries(restored.id), entry.entries)))
            throw new SaveFormatError("world.inventories", "restored inventory disagrees with saved shared state");
        }
        for (const entry of copied) {
          host.combat.setPoweredProtection(entry.actor, entry.state.armor.powered);
          if (!isDeepStrictEqual(host.combat.read(entry.actor.id), entry.state))
            throw new SaveFormatError("world.combat", "copied powered protection disagrees with saved shared state");
        }
        state = "complete";
      } catch (error) { state = "failed"; throw error; }
      return undefined;
    },
    assertComplete() {
      if (state !== "complete") throw new SaveFormatError("world.combat", `shared restoration is ${state}`);
      return undefined;
    },
  };
}
