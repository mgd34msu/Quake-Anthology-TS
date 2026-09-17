import type { MonsterSourceDefinition } from "../../../content/monsters/definitions.ts";
import type { Q1EntityServices } from "../../../content/q1/foundation/entity-services.ts";
import { Q1Base } from "../../../content/q1/base/provider.ts";
import { registerMissionPackMonsters } from "../../../content/q1/missionpacks/monsters/index.ts";
import { Q1AddonContext } from "../../../content/q1/addons/context.ts";
import type { Q1AddonServices } from "../../../content/q1/addons/context.ts";
import { registerAddonMonsters } from "../../../content/q1/addons/monsters/index.ts";

export function registerSelectedQ1Expansion(game: Q1EntityServices, program: Exclude<Extract<MonsterSourceDefinition, { readonly family: "q1" }>["program"], "id1">, services: Q1AddonServices): Q1AddonContext | null {
  const base = new Q1Base(game, { officialCampaign: false });
  if (program === "hipnotic" || program === "rogue") registerMissionPackMonsters(game, base, program);
  else { const context = new Q1AddonContext(base, program, services); registerAddonMonsters(context); return context; }
  return null;
}
