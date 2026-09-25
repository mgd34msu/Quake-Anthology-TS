export type QvmDamageRole = "target" | "inflictor" | "attacker" | "direction" | "point" | "amount" | "flags" | "method";
export type QvmArmorRole = "target" | "amount" | "flags";
export interface QvmCombatCall<Role extends string> {
  readonly roles: Readonly<Record<Role, number>>;
  readonly extras: readonly { readonly index: number; readonly kind: "int32" | "float32" | "address"; readonly value: number }[];
}

export interface QvmReactionCall {
  readonly arguments: number;
  readonly roles: { readonly target: number; readonly amount: number };
}

export type QvmDamageFlags = { readonly radius: number; readonly noArmor: number; readonly noKnockback: number; readonly noProtection: number; readonly noTeamProtection: number; }
export type QvmCombatMass = { readonly kind: "constant"; readonly value: number }
  | { readonly kind: "entity"; readonly offset: number; readonly storage: "int32" | "float32" };
export interface QvmCombatTeam { readonly value: number; readonly team: `${string}:${string}`; }
