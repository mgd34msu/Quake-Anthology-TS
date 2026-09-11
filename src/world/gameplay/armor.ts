// Armor formulas from Quake combat.qc, Quake II g_combat.c and Quake III g_combat.c.
import type { ArmorState, DamageRequest } from "../../contracts/gameplay.ts";

export interface ArmorDamageFlags {
  readonly noArmor: boolean;
  readonly noPowerArmor: boolean;
  readonly noRegularArmor: boolean;
  readonly energy: boolean;
}

export interface ArmorResult { readonly armor: ArmorState; readonly powerSaved: number; readonly regularSaved: number; }
export interface VictimArmorContext {
  /** The Q2 caller computes normalize(point - origin) dot AngleVectors(angles).forward. */
  readonly screenFacingDot: number;
  /** Q3 multiplies armor protection in binary32. Q1/Q2 original QC/C can select the same arithmetic explicitly. */
  readonly arithmetic: "binary32" | "binary64";
  readonly q2?: { readonly product: "classic" | "rerelease"; readonly ctf: boolean; readonly alive: boolean };
}

export type VictimArmorPolicy = (request: DamageRequest, armor: ArmorState, damage: number, flags: ArmorDamageFlags) => ArmorResult;

export function absorbNativeArmor(armor: ArmorState, damage: number, flags: ArmorDamageFlags, context: VictimArmorContext): ArmorResult {
  if (armor.kind === "q2" && context.q2 === undefined) throw new Error("Q2 victim armor requires an explicit classic or rerelease source profile");
  if (damage === 0 || flags.noArmor || armor.kind === "none") return { armor, powerSaved: 0, regularSaved: 0 };
  const multiply = (left: number, right: number): number => context.arithmetic === "binary32" ? Math.fround(Math.fround(left) * Math.fround(right)) : left * right;
  switch (armor.kind) {
    case "q1": {
      if (flags.noRegularArmor) return { armor, powerSaved: 0, regularSaved: 0 };
      const regularSaved = Math.min(armor.points, Math.ceil(multiply(armor.absorption, damage)));
      return { armor: { ...armor, points: armor.points - regularSaved, absorption: regularSaved >= armor.points ? 0 : armor.absorption }, powerSaved: 0, regularSaved };
    }
    case "q2": {
      let powerSaved = 0;
      let powerArmor = armor.powerArmor;
      const rerelease = context.q2?.product === "rerelease";
      const facingLimit = rerelease ? Math.fround(0.3) : 0.3;
      if (!flags.noPowerArmor && (!rerelease || context.q2?.alive === true) && powerArmor.kind !== "none" && powerArmor.cells > 0 && (powerArmor.kind !== "screen" || context.screenFacingDot > facingLimit)) {
        const damagePerCell = powerArmor.kind === "screen" || context.q2?.ctf === true ? 1 : 2;
        const dividedDamage = Math.trunc(powerArmor.kind === "screen" ? damage / 3 : (2 * damage) / 3);
        const protectedDamage = rerelease ? Math.max(1, dividedDamage) : dividedDamage;
        const doubledCost = rerelease ? flags.energy : flags.noRegularArmor;
        const baseAvailable = powerArmor.cells * damagePerCell;
        const dividedAvailable = doubledCost ? Math.trunc(baseAvailable / 2) : baseAvailable;
        const available = rerelease ? Math.max(1, dividedAvailable) : dividedAvailable;
        powerSaved = Math.min(available, protectedDamage);
        const used = Math.trunc(powerSaved / damagePerCell) * (doubledCost ? 2 : 1);
        powerArmor = { ...powerArmor, cells: rerelease ? Math.max(0, powerArmor.cells - Math.max(damagePerCell, used)) : powerArmor.cells - used };
      }
      const protection = flags.energy ? armor.energyProtection : armor.normalProtection;
      const regularSaved = flags.noRegularArmor ? 0 : Math.min(armor.points, Math.ceil(multiply(protection, damage - powerSaved)));
      return { armor: { ...armor, points: armor.points - regularSaved, powerArmor }, powerSaved, regularSaved };
    }
    case "q3": {
      if (flags.noRegularArmor) return { armor, powerSaved: 0, regularSaved: 0 };
      const regularSaved = Math.min(armor.points, Math.ceil(Math.fround(Math.fround(damage) * Math.fround(armor.protection))));
      return { armor: { ...armor, points: armor.points - regularSaved }, powerSaved: 0, regularSaved };
    }
  }
}

/** Native flags are decoded according to their origin, never reinterpreted as another game's bit positions. */
export function attackDamageFlags(request: DamageRequest): ArmorDamageFlags & { readonly noKnockback: boolean; readonly noProtection: boolean; readonly noTeamProtection: boolean; readonly destroyArmor: boolean } {
  const cause = request.attack.cause;
  const q2 = cause.kind === "q2" ? cause.damageFlags : 0;
  const q3 = cause.kind === "q3" ? cause.damageFlags : 0;
  return {
    noArmor: ((q2 | q3) & 2) !== 0,
    noPowerArmor: (q2 & 0x100) !== 0,
    noRegularArmor: (q2 & 0x80) !== 0,
    energy: (q2 & 4) !== 0,
    noKnockback: (q2 & 8) !== 0 || (q3 & 4) !== 0,
    noProtection: (q2 & 0x20) !== 0 || (q3 & 8) !== 0,
    noTeamProtection: (q3 & 0x10) !== 0,
    destroyArmor: (q2 & 0x40) !== 0,
  };
}
