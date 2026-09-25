import type { DamageRequest, SourceDamageModifier } from "../../contracts/gameplay.ts";
import type { ActorId } from "../../contracts/identity.ts";

/** Source kick remains independent; expired actor lifetimes use the original world context. */
export function applySourceDamageModifier(request: DamageRequest, modifier: SourceDamageModifier | undefined, isLive: (actor: ActorId) => boolean): DamageRequest {
  if (modifier === undefined) return request;
  const current = (actor: ActorId | null): ActorId | null => actor !== null && isLive(actor) ? actor : null;
  const attack = { ...request.attack, attacker: current(request.attack.attacker), inflictor: current(request.attack.inflictor) };
  const amount = attack.damagePowerupOwner === modifier.owner ? request.amount : modifier.transform(attack.attacker, request.amount);
  return { ...request, amount, attack: { ...attack, damagePowerupOwner: modifier.owner } };
}
