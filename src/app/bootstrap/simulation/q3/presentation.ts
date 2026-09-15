import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import { EntityType, Weapon } from "../../../../content/q3/base/shared/definitions.ts";
import type { Product } from "../../../../content/q3/base/shared/definitions.ts";
import type { EntityState } from "../../../../content/q3/base/shared/entity-state.ts";
import type { PlayerState } from "../../../../content/q3/base/shared/player-state.ts";
import { ServerEntityFlags } from "../../../../content/q3/base/shared/entity-shared.ts";
import { evaluateTrajectory } from "../../../../content/q3/base/shared/trajectory.ts";
import { itemAt } from "../../../../content/q3/base/shared/items.ts";
import type { Q3SourceRuntime } from "./runtime.ts";
import type { SimulationPresentation } from "../types.ts";

export interface Q3SourcePresentationState {
  readonly product: Product;
  readonly time: number;
  readonly entities: readonly { readonly actor: ActorId; readonly state: EntityState; readonly origin: Vec3;
    readonly linked: boolean; readonly serverFlags: number; readonly singleClient: number }[];
  readonly clients: readonly { readonly actor: ActorId; readonly slot: number; readonly state: PlayerState }[];
  readonly configstrings: readonly { readonly index: number; readonly value: string }[];
}

/** Copies source state for cgame/network consumers without advancing events or owning authoritative state. */
export function q3SourcePresentationState(runtime: Q3SourceRuntime): Q3SourcePresentationState {
  const entities: Q3SourcePresentationState["entities"][number][] = [], clients: Q3SourcePresentationState["clients"][number][] = [];
  for (let slot = 0; slot < runtime.pool.numEntities; slot++) {
    const entity = runtime.pool.at(slot);
    if (!entity.inuse) continue;
    entities.push({ actor: entity.actor.id, state: entity.s.copy(), origin: { ...entity.r.currentOrigin }, linked: entity.r.linked,
      serverFlags: entity.r.svFlags, singleClient: entity.r.singleClient });
    if (entity.client !== null) clients.push({ actor: entity.actor.id, slot, state: entity.client.ps.copy() });
  }
  const configstrings: Q3SourcePresentationState["configstrings"][number][] = [];
  for (let index = 0; index < 1024; index++) {
    const value = runtime.host.configstrings.get(index);
    if (value !== "") configstrings.push({ index, value });
  }
  return { product: runtime.options.product, time: runtime.host.now(), entities, clients, configstrings };
}

function missileModel(weapon: number): string | null {
  switch (weapon) {
    case Weapon.WP_GRAPPLING_HOOK: case Weapon.WP_ROCKET_LAUNCHER: return "models/ammo/rocket/rocket.md3";
    case Weapon.WP_GRENADE_LAUNCHER: return "models/ammo/grenade1.md3";
    case Weapon.WP_PROX_LAUNCHER: return "models/weaphits/proxmine.md3";
    case Weapon.WP_NAILGUN: return "models/weaphits/nail.md3";
    case Weapon.WP_BFG: return "models/weaphits/bfg.md3";
    default: return null;
  }
}

/** Model access for the shared renderer; sprites, trails and portals remain in sourceState for cgame. */
export function q3SourceModels(runtime: Q3SourceRuntime): readonly SimulationPresentation[] {
  const presentations: SimulationPresentation[] = [];
  for (let slot = 0; slot < runtime.pool.numEntities; slot++) {
    const entity = runtime.pool.at(slot), state = entity.s;
    if (!entity.inuse || entity.client !== null || !entity.r.linked || (entity.r.svFlags & ServerEntityFlags.NOCLIENT) !== 0 || (state.eFlags & 0x80) !== 0) continue;
    const paths = state.eType === EntityType.ET_ITEM ? itemAt(runtime.options.product, state.modelindex).worldModels
      : state.eType === EntityType.ET_MISSILE ? [missileModel(state.weapon)]
        : entity.r.model.kind === "inline" ? ["*" + entity.r.model.index]
          : state.modelindex > 0 ? [runtime.host.configstrings.get(32 + state.modelindex)] : [];
    for (const path of paths) if (path !== null && path !== "") presentations.push({ actor: entity.actor.id,
      content: runtime.options.recipe.map.entities.content, family: "q3", path, frame: state.frame, oldFrame: state.frame,
      skin: 0, effects: state.eFlags, renderFlags: 0, origin: evaluateTrajectory(state.pos, runtime.level.time),
      angles: evaluateTrajectory(state.apos, runtime.level.time), scale: 1, visible: true, viewWeapon: false });
  }
  return presentations;
}
