import type { ActorId } from "../../../../contracts/identity.ts";
import { GameEntity } from "./state.ts";
import type { UseParticipant } from "./state.ts";

export interface UseParticipantServices {
  live(actor: ActorId): boolean;
  isPlayer(actor: ActorId): boolean;
  native(actor: ActorId): GameEntity | null;
  event(actor: ActorId, event: number, parameter: number): void;
}

export function useActor(participant: UseParticipant): ActorId {
  return participant instanceof GameEntity ? participant.actor.id : participant.actor;
}

export function requireUseParticipant(participant: UseParticipant | null): UseParticipant {
  if (participant === null) throw new Error("Target handler requires an activator");
  return participant;
}

export function useClient(participant: UseParticipant, services?: UseParticipantServices): GameEntity | null {
  requireUseParticipant(participant);
  if (participant instanceof GameEntity) return participant.client === null ? null : participant;
  if (services === undefined) throw new Error("Shared target activator requires actor observations");
  if (!services.live(participant.actor) || !services.isPlayer(participant.actor)) return null;
  const entity = services.native(participant.actor);
  if (entity?.client == null) throw new Error("Admitted Q3 map player has no native client behavior record");
  return entity;
}

