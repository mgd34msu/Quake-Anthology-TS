import type { Q1AddonContext } from "../context.ts";
import { registerOrdinaryAddonMonsters } from "./ordinary/index.ts";
import { registerMg3PathTargets } from "./ai/targets.ts";
import { registerMg3Demodog } from "./demodog.ts";
import { registerMg3Infected } from "./infected/index.ts";
import { registerMg3Heavy } from "./heavy/index.ts";
import { registerSacrifice } from "./bosses/sacrifice.ts";
import { registerGhost } from "./bosses/ghost.ts";
import { registerOrb } from "./bosses/orb.ts";
import { registerShubZombie } from "./bosses/szombie.ts";
import { registerOldnew } from "./bosses/oldnew.ts";
import { registerFinalBoss } from "./bosses/final.ts";

/** Native maps and selected foreign rosters install the same named source controllers. */
export function registerAddonMonsters(context: Q1AddonContext): undefined {
  registerOrdinaryAddonMonsters(context);
  if (context.program === "mg3") {
    registerMg3PathTargets(context); registerMg3Demodog(context); registerMg3Infected(context); registerMg3Heavy(context);
    registerSacrifice(context); registerGhost(context); registerOrb(context); registerShubZombie(context); registerOldnew(context); registerFinalBoss(context);
  }
  return undefined;
}
