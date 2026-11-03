// SPDX-License-Identifier: GPL-2.0-or-later
import type { SessionActorRegistry, SharedBodyTable } from "../../src/world/actors/index.ts";
import type { GameplayAuthority, SharedInventoryTable } from "../../src/world/gameplay/index.ts";
import { captureSharedBodies } from "../../src/persistence/world-state.ts";

export interface SharedActorWorld {
  readonly actors: SessionActorRegistry;
  readonly bodies: SharedBodyTable;
  readonly combat: GameplayAuthority;
  readonly inventory: SharedInventoryTable;
}

/** The shared half of a test save: slots, sources, bodies, combat and inventories. The caller adds the game's own `source`. */
export function captureSharedActors(world: SharedActorWorld) {
  const { actors, bodies, combat, inventory } = world;
  return {
    slots: actors.checkpoint(),
    sources: actors.sourceCheckpoint(),
    bodies: captureSharedBodies(actors, bodies),
    combat: actors.observations().flatMap(actor => {
      const state = combat.read(actor.id);
      return state === null ? [] : [{ actor: { slot: actor.id.slot, generation: actor.id.generation }, state }];
    }),
    inventories: actors
      .observations()
      .flatMap(actor =>
        inventory.has(actor.id) ? [{ actor: { slot: actor.id.slot, generation: actor.id.generation }, entries: inventory.entries(actor.id) }] : [],
      ),
  };
}
