import type { ActivePowerupTimer } from "../../../contracts/gameplay.ts";
import type { Q2PlayerPowerups } from "../../../content/q2/foundation/items.ts";
import type { Q2MissionPackPowerups } from "../../../content/q2/missionpacks/items.ts";

export function q2PowerupTimers(base: Readonly<Q2PlayerPowerups>, expansion: Readonly<Q2MissionPackPowerups> | undefined, now: number): readonly ActivePowerupTimer[] {
  const timers: readonly ActivePowerupTimer[] = [
    { item: "q2:item_quad", label: "Quad Damage", remainingSeconds: base.quadUntil - now },
    { item: "q2:item_quadfire", label: "DualFire Damage", remainingSeconds: (expansion?.quadFireUntil ?? 0) - now },
    { item: "q2:item_double", label: "Double Damage", remainingSeconds: (expansion?.doubleUntil ?? 0) - now },
    { item: "q2:item_invulnerability", label: "Invulnerability", remainingSeconds: base.invulnerabilityUntil - now },
    { item: "q2:item_enviro", label: "Environment Suit", remainingSeconds: base.enviroUntil - now },
    { item: "q2:item_breather", label: "Rebreather", remainingSeconds: base.breatherUntil - now },
    { item: "q2:item_ir_goggles", label: "IR Goggles", remainingSeconds: (expansion?.irUntil ?? 0) - now },
  ];
  return timers.filter(timer => timer.remainingSeconds > 0);
}
