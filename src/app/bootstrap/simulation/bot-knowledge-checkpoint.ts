import type { ActorId } from "../../../contracts/identity.ts";
import type { SavedActorId } from "../../../contracts/session.ts";
import { readSavedActor, savedActorId } from "../../../persistence/save-image.ts";
import { SaveReader } from "../../../persistence/value.ts";

export interface BotKnowledgeCheckpoint {
  readonly version: 1;
  readonly source: "q1" | "q2" | "q3";
  readonly actors: readonly { readonly handle: number; readonly actor: SavedActorId }[];
}
export interface BotKnowledgePersistence {
  checkpoint(): BotKnowledgeCheckpoint;
  restoreCheckpoint(value: unknown, actor: (saved: SavedActorId) => ActorId, weaponHandle: (saved: number) => number): void;
}
export function botKnowledgePersistence(source: BotKnowledgeCheckpoint["source"], actors: Map<number, ActorId>): BotKnowledgePersistence {
  return {
    checkpoint() { return { version: 1, source, actors: Array.from(actors, ([handle, actor]) => ({ handle, actor: savedActorId(actor) })) }; },
    restoreCheckpoint(value, actor, weaponHandle) {
      const reader = new SaveReader(value, "botKnowledge");
      reader.field("version").literal(1); reader.field("source").literal(source);
      const restored = new Map<number, ActorId>(), seen = new Set<number>();
      reader.field("actors").list(entry => {
        const saved = entry.field("handle").integer(0), handle = weaponHandle(saved);
        if (seen.has(saved) || !Number.isSafeInteger(handle) || handle < 0 || restored.has(handle)) entry.fail("invalid or duplicate weapon handle mapping");
        seen.add(saved); restored.set(handle, actor(readSavedActor(entry.field("actor"))));
      });
      actors.clear(); for (const [handle, actor] of restored) actors.set(handle, actor);
    },
  };
}
