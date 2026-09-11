import type { SourceBotGame } from "./game-host.ts";
import type { BotLibrary } from "./library.ts";
import { SourceBotNavigation } from "./navigation.ts";
import type { SourceBotNavigationHost } from "./navigation.ts";

export type SelectedBotNavigation = Pick<SourceBotNavigationHost,
  "runtime" | "forClient" | "crouchedBounds" | "predictClientMovement" | "travelWeapon">;

/** Source queries borrow existing game bindings; the caller owns selected movement projections. */
export function q3BotNavigation(game: SourceBotGame, library: BotLibrary, selected: SelectedBotNavigation): SourceBotNavigation {
  return new SourceBotNavigation({ ...selected, actions: library.actions, moveStates: library.moveStates,
    random: library.options.random, time: () => game.clock.time / 1000,
    pointContents: point => game.world.pointContents(point, -1),
    trace: (start, end, bounds, passEntity, mask) => game.world.trace({ start, end, passEntityNum: passEntity, mask,
      shape: bounds === null ? { kind: "point" } : { kind: "box", mins: bounds.min, maxs: bounds.max } }),
    entityModelIndex: number => game.entity(number).state.modelindex,
    entityType: number => game.entity(number).state.eType,
    entityWeapon: number => game.entity(number).state.weapon,
    nextEntity: after => {
      for (let slot = after + 1; slot < game.entityCount; slot++) if (game.entity(slot).present) return slot;
      return 0;
    },
    modelInfo: model => {
      for (let slot = 0; slot < game.entityCount; slot++) {
        const entity = game.entity(slot);
        if (!entity.present || entity.inlineModel !== model) continue;
        return { entity: slot, origin: { ...entity.origin }, bounds: { min: { ...entity.bounds.min }, max: { ...entity.bounds.max } },
          kind: entity.classname === "func_plat" ? "elevator" : entity.classname === "func_bobbing" ? "bobbing"
            : entity.classname === "func_door" ? "door" : entity.classname === "func_train" ? "train" : "static" };
      }
      return null;
    },
  });
}
