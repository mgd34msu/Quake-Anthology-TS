export { GameplayAuthority, copyArmor, copyCombat } from "./authority.ts";
export type { CombatStateBinding, CombatTraits, GameplayHooks, PowerArmorCellBinding } from "./authority.ts";
export { SharedInventoryTable } from "./inventory.ts";
export type { InventoryStateBinding } from "./inventory.ts";
export { SharedTransitionCoordinator } from "./transitions.ts";
export { absorbNativeArmor, attackDamageFlags } from "./armor.ts";
export type { ArmorDamageFlags, ArmorResult, VictimArmorContext, VictimArmorPolicy } from "./armor.ts";
export { createQ1CombatPolicy, createQ2CombatPolicy, createQ3CombatPolicy, nativeVictimArmor } from "./policies.ts";
export type { Q1CombatContext, Q1CombatPolicyOptions, Q1DamageSourceEffects, Q2CombatContext, Q3CombatContext } from "./policies.ts";

export type { Q2DamageSourceEffects, Q2CombatPolicyOptions } from "./policies.ts";
