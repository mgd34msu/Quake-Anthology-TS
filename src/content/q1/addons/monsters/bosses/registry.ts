import type { OwnedActor } from "../../../../../contracts/identity.ts";
import { SaveReader, decodeCheckpointValue, encodeCheckpointValue } from "../../../../../persistence/value.ts";
import type { Q1Actor } from "../../../foundation/entity.ts";
import { BaseMonster, registerMonsterCallbacks } from "../../../base/monsters.ts";
import type { Q1AddonContext } from "../../context.ts";
import { registerMg3MonsterStartup } from "../startup.ts";

export function registerBossControllers<T extends BaseMonster>(context: Q1AddonContext, prefix: string, classname: string, create: (entity: Q1Actor) => T): ReadonlyMap<OwnedActor, T> {
  const { game } = context, monsters = new Map<OwnedActor, T>();
  registerMonsterCallbacks(game, prefix, entity => requireBoss(monsters, entity));
  registerMg3MonsterStartup(game, prefix, entity => requireBoss(monsters, entity));
  game.registerSpawn(classname, (_game, entity) => { const monster = create(entity); monsters.set(entity.actor, monster); return monster.spawn(); });
  game.host.actors.onRelease(actor => { monsters.delete(actor); return undefined; });
  game.registerStateExtension({ id: prefix,
    capture: () => encodeCheckpointValue([...monsters.values()].map(monster => ({ slot: monster.entity.actor.id.slot, generation: monster.entity.actor.id.generation, state: monster.capture() }))),
    restore: bytes => {
      monsters.clear(); new SaveReader(decodeCheckpointValue(bytes), prefix).list(reader => {
        const actor = game.host.actors.resolveSaved({ slot: reader.field("slot").integer(0), generation: reader.field("generation").integer(0) }), entity = actor === null ? null : game.entity(actor.id);
        if (entity === null) return reader.fail("missing MG3 boss actor");
        const monster = create(entity); monster.restore(reader.field("state")); monsters.set(entity.actor, monster); return undefined;
      }); return undefined;
    },
    clone: (source, target) => { const monster = monsters.get(source.actor); if (monster === undefined) return undefined; const clone = create(target); clone.restore(new SaveReader(monster.capture(), prefix)); monsters.set(target.actor, clone); return undefined; },
  });
  return monsters;
}
export function requireBoss<T extends BaseMonster>(monsters: ReadonlyMap<OwnedActor, T>, entity: Q1Actor): T {
  const monster = monsters.get(entity.actor); if (monster === undefined) throw new Error(`Missing MG3 boss source state for ${entity.classname}`); return monster;
}
