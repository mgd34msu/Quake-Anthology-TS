import type { SourceBotGame } from "./game-host.ts";
import type { BotLibrary } from "./library.ts";
import { SourceBotNavigation } from "./navigation.ts";
import type { SourceBotNavigationHost } from "./navigation.ts";

export type SelectedBotNavigation = Pick<SourceBotNavigationHost,
  "runtime" | "forClient" | "crouchedBounds" | "predictClientMovement" | "travelWeapon">;

/** Source queries borrow existing game bindings; the caller owns selected movement projections. */
export function q3BotNavigation(game: SourceBotGame, library: BotLibrary, selected: SelectedBotNavigation): SourceBotNavigation {
  return new SourceBotNavigation({ ...selected, actions: library.actions, moveStates: library.moveStates,
    random: library.options.random, time: () => game.level.time / 1000,
    pointContents: point => game.world.pointContents(point, -1),
    trace: (start, end, bounds, passEntity, mask) => game.world.trace({ start, end, passEntityNum: passEntity, mask,
      shape: bounds === null ? { kind: "point" } : { kind: "box", mins: bounds.min, maxs: bounds.max } }),
    entityModelIndex: number => game.pool.at(number).s.modelindex,
    entityType: number => game.pool.at(number).s.eType,
    entityWeapon: number => game.pool.at(number).s.weapon,
    nextEntity: after => {
      for (let slot = after + 1; slot < game.pool.numEntities; slot++) if (game.pool.at(slot).inuse) return slot;
      return 0;
    },
    modelInfo: model => {
      for (let slot = 0; slot < game.pool.numEntities; slot++) {
        const entity = game.pool.at(slot);
        if (!entity.inuse || entity.r.model.kind !== "inline" || entity.r.model.index !== model) continue;
        return { entity: slot, origin: { ...entity.r.currentOrigin }, bounds: { min: { ...entity.r.mins }, max: { ...entity.r.maxs } },
          kind: entity.classname === "func_plat" ? "elevator" : entity.classname === "func_bobbing" ? "bobbing"
            : entity.classname === "func_door" ? "door" : entity.classname === "func_train" ? "train" : "static" };
      }
      return null;
    },
  });
}
