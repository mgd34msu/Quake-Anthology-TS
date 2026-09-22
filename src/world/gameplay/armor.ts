// Armor formulas from Quake combat.qc, Quake II g_combat.c and Quake III g_combat.c.
import type { ArmorDamageFlags, ArmorResult, ArmorState, DamageRequest } from "../../contracts/gameplay.ts";
export type { ArmorDamageFlags, ArmorResult } from "../../contracts/gameplay.ts";
export interface VictimArmorContext {
  /** The Q2 caller computes normalize(point - origin) dot AngleVectors(angles).forward. */
  readonly screenFacingDot: number;
  /** Q3 multiplies armor protection in binary32. Q1/Q2 original QC/C can select the same arithmetic explicitly. */
  readonly arithmetic: "binary32" | "binary64";
  readonly q2?: { readonly product: "classic" | "rerelease"; readonly ctf: boolean; readonly alive: boolean };
}

export type VictimArmorPolicy = (request: DamageRequest, armor: ArmorState, damage: number, flags: ArmorDamageFlags) => ArmorResult;

export function absorbNativeArmor(armor: ArmorState, damage: number, flags: ArmorDamageFlags, context: VictimArmorContext): ArmorResult {
  if ((flags.stage !== "power" && armor.regular.kind === "q2" || flags.stage !== "regular" && armor.powered.kind !== "none") && context.q2 === undefined)
    throw new Error("Q2 victim armor requires an explicit classic or rerelease source profile");
  if (damage === 0 || flags.noArmor || armor.regular.kind === "none" && armor.powered.kind === "none") return { armor, powerSaved: 0, regularSaved: 0 };
  const multiply = (left: number, right: number): number => context.arithmetic === "binary32" ? Math.fround(Math.fround(left) * Math.fround(right)) : left * right;
  const protectionScale = flags.regularProtectionScale ?? 1;
  let powerSaved = 0, powered = armor.powered;
  const rerelease = context.q2?.product === "rerelease";
  const facingLimit = rerelease ? Math.fround(0.3) : 0.3;
  if (flags.stage !== "regular" && !flags.noPowerArmor && (!rerelease || context.q2?.alive === true) && powered.kind !== "none" && powered.cells > 0 && (powered.kind !== "screen" || context.screenFacingDot > facingLimit)) {
    const damagePerCell = powered.kind === "screen" || context.q2?.ctf === true ? 1 : 2;
    const dividedDamage = Math.trunc(powered.kind === "screen" ? damage / 3 : (2 * damage) / 3);
    const protectedDamage = rerelease ? Math.max(1, dividedDamage) : dividedDamage;
    const doubledCost = rerelease ? flags.energy : flags.noRegularArmor;
    const baseAvailable = powered.cells * damagePerCell;
    const dividedAvailable = doubledCost ? Math.trunc(baseAvailable / 2) : baseAvailable;
    const available = rerelease ? Math.max(1, dividedAvailable) : dividedAvailable;
    powerSaved = Math.min(available, protectedDamage);
    const used = Math.trunc(powerSaved / damagePerCell) * (doubledCost ? 2 : 1);
    powered = { ...powered, cells: rerelease ? Math.max(0, powered.cells - Math.max(damagePerCell, used)) : powered.cells - used };
  }
  let regular = armor.regular, regularSaved = 0;
  if (!flags.noRegularArmor && flags.stage !== "power") switch (regular.kind) {
    case "none": break;
    case "source": throw new Error("Source regular armor requires its original absorption binding");
    case "q1":
      regularSaved = Math.min(regular.points, Math.ceil(multiply(multiply(regular.absorption, protectionScale), damage - powerSaved)));
      regular = { ...regular, points: regular.points - regularSaved, absorption: regularSaved >= regular.points ? 0 : regular.absorption };
      break;
    case "q2": {
      const protection = flags.energy ? regular.energyProtection : regular.normalProtection;
      regularSaved = Math.min(regular.points, Math.ceil(multiply(multiply(protection, protectionScale), damage - powerSaved)));
      regular = { ...regular, points: regular.points - regularSaved };
      break;
    }
    case "q3":
      regularSaved = Math.min(regular.points, Math.ceil(Math.fround(Math.fround(damage - powerSaved) * Math.fround(Math.fround(regular.protection) * Math.fround(protectionScale)))));
      regular = { ...regular, points: regular.points - regularSaved };
      break;
  }
  return { armor: regular === armor.regular && powered === armor.powered ? armor : { regular, powered }, powerSaved, regularSaved };
}

/** Native flags are decoded according to their origin, never reinterpreted as another game's bit positions. */
export function attackDamageFlags(request: DamageRequest): ArmorDamageFlags & { readonly noKnockback: boolean; readonly noProtection: boolean; readonly noTeamProtection: boolean; readonly destroyArmor: boolean } {
  const cause = request.attack.cause;
  const q2 = cause.kind === "q2" ? cause.damageFlags : 0;
  const q3 = cause.kind === "q3" ? cause.damageFlags : 0;
  return {
    noArmor: ((q2 | q3) & 2) !== 0 || cause.kind === "q1" && cause.armorEffect === "bypass",
    noPowerArmor: (q2 & 0x100) !== 0,
    noRegularArmor: (q2 & 0x80) !== 0,
    energy: (q2 & 4) !== 0,
    regularProtectionScale: cause.kind === "q1" && cause.armorEffect === "half-effectiveness" ? 0.5 : 1,
    noKnockback: (q2 & 8) !== 0 || (q3 & 4) !== 0,
    noProtection: (q2 & 0x20) !== 0 || (q3 & 8) !== 0,
    noTeamProtection: (q3 & 0x10) !== 0,
    destroyArmor: (q2 & 0x40) !== 0,
  };
}
