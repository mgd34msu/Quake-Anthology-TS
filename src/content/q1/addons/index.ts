import { registerAddonMonsters } from "./monsters/index.ts";
import type { Q1Base } from "../base/provider.ts";
import { Q1AddonContext } from "./context.ts";
import type { Q1AddonServices } from "./context.ts";
import { registerCampaignAddons } from "./campaign.ts";
import { registerAddonTriggers } from "./triggers.ts";
import { registerAddonBaseTriggers } from "./base-triggers.ts";
import { registerAddonFieldTriggers } from "./field-triggers.ts";
import { registerAddonBrushes } from "./brushes.ts";
import { registerAddonEffects, registerAddonFog } from "./effects.ts";
import { registerAddonLights } from "./lights.ts";
import { registerAddonRopes } from "./rope.ts";
import { registerMg3Items } from "./items/index.ts";
import { registerAddonCorpses } from "./corpses.ts";
import { spawnMapActor } from "../foundation/spawns.ts";


export { Q1AddonContext } from "./context.ts";
export type { Q1AddonEvent, Q1AddonProgram, Q1AddonServices } from "./context.ts";
export { MG1_ALL_SIGILS, MG1_LAST_SIGIL_SHIFT, MG3_RUNE_MASK, BLOODY_NIGHTMARE_ACTIVE, BLOODY_NIGHTMARE_DISCOVERED, BLOODY_NIGHTMARE_NEWGAME, mg1LastSigil, mg1ClearLastSigil, mg3RuneCount } from "./campaign.ts";
export { Q1Horde, registerQ1Horde } from "./horde/index.ts";
export type { Q1HordeServices } from "./horde/types.ts";
export { registerCTF } from "./ctf/index.ts";
export type { Q1Ctf } from "./ctf/index.ts";
export type { Q1CtfServices } from "./ctf/types.ts";
export { newQ1AddonTravel, captureQ1AddonTravel, decodeQ1AddonTravel, admitQ1AddonTravel } from "./travel.ts";
export { registerMg3Demodog, Q1Demodog } from "./monsters/demodog.ts";
export { registerMg3Infected, Q1Infected } from "./monsters/infected/index.ts";
export { registerMg3Heavy } from "./monsters/heavy/index.ts";
export { handleQ1AddonImpulse, frameQ1AddonPlayer, omnicideQ1Addons } from "./commands.ts";

/** Register before map spawning; call context.frame from the shared Q1 source frame phase. */
export function registerQ1CampaignAddons(base: Q1Base, program: "dopa" | "mg1" | "mg3", services: Q1AddonServices): Q1AddonContext {
  const context = new Q1AddonContext(base, program, services);
  if (program === "mg3") base.game.registerSpawn("worldspawn", (game, entity) => {
    spawnMapActor(game, entity); context.setNumber(entity, "isHordeMode", services.cvar("horde")); context.setNumber(entity, "cheats_allowed", services.cvar("sv_cheats")); return undefined;
  });
  registerCampaignAddons(context); registerAddonTriggers(context); registerAddonBaseTriggers(context); registerAddonFieldTriggers(context); registerAddonBrushes(context);
  registerAddonEffects(context); registerAddonFog(context); registerAddonLights(context);
  registerAddonCorpses(context);
  registerAddonMonsters(context);
  if (program === "mg3") { registerAddonRopes(context); registerMg3Items(context); }
  return context;
}
