/* quakec_mg3/monsters/mg3_*_infected.qc. GPL-2.0-or-later. */
import type { OwnedActor } from "../../../../../contracts/identity.ts";
import { SaveReader, decodeCheckpointValue, encodeCheckpointValue } from "../../../../../persistence/value.ts";
import type { Q1Actor } from "../../../foundation/entity.ts";
import { registerMonsterCallbacks } from "../../../base/monsters.ts";
import type { Q1AddonContext } from "../../context.ts";
import { Q1Infected, infectedPrefix } from "./controller.ts";
import { infectedClassnames } from "./species.ts";
import { registerMg3MonsterStartup } from "../startup.ts";

export { Q1Infected } from "./controller.ts";
export function registerMg3Infected(context: Q1AddonContext): ReadonlyMap<OwnedActor, Q1Infected> {
  const { game } = context, monsters = new Map<OwnedActor, Q1Infected>();
  const replace = (entity: Q1Actor): Q1Infected => { const value = new Q1Infected(context, entity, replace); monsters.set(entity.actor, value); return value; };
  const monster = (entity: Q1Actor): Q1Infected => { const value = monsters.get(entity.actor); if (value === undefined) throw new Error("Missing MG3 infected source state"); return value; };
  registerMonsterCallbacks(game, infectedPrefix, monster);
  registerMg3MonsterStartup(game, infectedPrefix, monster);
  game.named.register(`${infectedPrefix}:resurrect`, { action: (_game, entity) => monster(entity).resurrect() });
  context.base.registerKillCountRule(infectedPrefix, value => {
    if (!monsters.has(value.entity.actor) || value.entity.number("infected") !== 1) return true;
    context.setNumber(value.entity, "infected", 0); return false;
  });
  for (const [classname, kind] of infectedClassnames) game.registerSpawn(classname, (_game, entity) => {
    entity.fields.set("infected.kind", kind); return replace(entity).spawn();
  });
  game.host.actors.onRelease(actor => { monsters.delete(actor); return undefined; });
  game.registerStateExtension({ id: infectedPrefix,
    capture: () => encodeCheckpointValue([...monsters.values()].map(value => ({ slot: value.entity.actor.id.slot, generation: value.entity.actor.id.generation, state: value.capture() }))),
    restore: bytes => {
      monsters.clear(); new SaveReader(decodeCheckpointValue(bytes), infectedPrefix).list(reader => {
        const owner = game.host.actors.resolveSaved({ slot: reader.field("slot").integer(0), generation: reader.field("generation").integer(0) }), entity = owner === null ? null : game.entity(owner.id);
        if (entity === null) return reader.fail("missing infected actor");
        replace(entity).restore(reader.field("state")); return undefined;
      }); return undefined;
    },
    clone: (source, target) => { const value = monsters.get(source.actor); if (value !== undefined) replace(target).restore(new SaveReader(value.capture(), infectedPrefix)); return undefined; },
  });
  return monsters;
}
