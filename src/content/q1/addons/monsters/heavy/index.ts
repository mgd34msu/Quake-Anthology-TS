import type { Q1AddonContext } from "../../context.ts";
import { Q1Mg3Heavy } from "./runtime.ts";
import { superShamblerDefinition } from "./super-shambler.ts";
import { runeKnightDefinition } from "./rune-knight.ts";
import { lavaManDefinition } from "./lava-man.ts";
import { registerHeavyProjectiles } from "./projectiles.ts";

export function registerMg3Heavy(context: Q1AddonContext): Q1Mg3Heavy {
  const runtime = new Q1Mg3Heavy(context); registerHeavyProjectiles(context.game);
  runtime.register(superShamblerDefinition); runtime.register(runeKnightDefinition); runtime.register(lavaManDefinition(runtime)); return runtime;
}
export { Q1HeavyMonster, Q1Mg3Heavy } from "./runtime.ts";
export type { HeavyDefinition } from "./runtime.ts";
