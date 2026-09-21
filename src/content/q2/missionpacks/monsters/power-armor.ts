import type { OwnedActor } from "../../../../contracts/identity.ts";
import type { MonsterContext } from "../../foundation/monsters/types.ts";

const bindings = new WeakSet<OwnedActor>();

export function monsterPowerArmor(context: MonsterContext, kind: "screen" | "shield", cells: number): undefined {
  const { entity, game } = context;
  if (!game.host.inventory.has(entity.actor.id)) game.host.inventory.create(entity.actor, []);
  game.host.inventory.configure(entity.actor, { item: "q2:monster-power", count: cells, capacity: cells });
  restoreMonsterPowerArmor(context);
  return game.host.combat.setPoweredProtection(entity.actor, { kind, cells });
}

export function restoreMonsterPowerArmor(context: MonsterContext): undefined {
  const { entity, game } = context;
  if (!bindings.has(entity.actor)) {
    const entry = game.host.inventory.entries(entity.actor.id).find(candidate => candidate.item === "q2:monster-power");
    if (entry === undefined) throw new Error("Monster power armor is missing its shared inventory cells");
    game.host.combat.bindPowerArmorCells(entity.actor, {
      read: () => game.host.inventory.count(entity.actor.id, "q2:monster-power"),
      write: count => game.host.inventory.configure(entity.actor, { item: "q2:monster-power", count, capacity: entry.capacity }),
    });
    bindings.add(entity.actor);
  }
  return undefined;
}
