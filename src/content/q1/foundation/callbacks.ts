/* Named QC continuations. Only names are saved; handlers are registered by source modules. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q1Actor } from "./entity.ts";
import type { Q1Foundation } from "./runtime.ts";

export interface Q1CallbackHandlers {
  action?(game: Q1Foundation, entity: Q1Actor): undefined;
  use?(game: Q1Foundation, entity: Q1Actor, other: ActorId | null, activator: ActorId | null): undefined;
  touch?(game: Q1Foundation, entity: Q1Actor, other: ActorId, normal: Vec3 | null): undefined;
  pain?(game: Q1Foundation, entity: Q1Actor, attacker: ActorId | null, damage: number): undefined;
  die?(game: Q1Foundation, entity: Q1Actor, attacker: ActorId | null): undefined;
  blocked?(game: Q1Foundation, entity: Q1Actor, other: ActorId): undefined;
}
export interface Q1StateExtension {
  readonly id: string;
  capture(): Uint8Array;
  /** Runs after all source entity/player references exist, before thinks are scheduled. */
  restore(bytes: Uint8Array): undefined;
  /** SUB_CopyEntity duplicates initialized source state without running a spawn function. */
  clone?(source: Q1Actor, target: Q1Actor): undefined;
}
export function callbackName(callback: object | null): string | null {
  if (callback === null) return null;
  if (!("q1CallbackName" in callback) || typeof callback.q1CallbackName !== "string") throw new Error("Q1 save encountered an unnamed source callback");
  return callback.q1CallbackName;
}

export class Q1CallbackRegistry {
  private readonly handlers = new Map<string, Q1CallbackHandlers>();
  constructor(private readonly game: Q1Foundation) {}
  register(name: string, handlers: Q1CallbackHandlers): undefined {
    if (this.handlers.has(name)) throw new Error(`Duplicate Q1 callback: ${name}`);
    this.handlers.set(name, handlers); return undefined;
  }
  private get(name: string): Q1CallbackHandlers {
    const handlers = this.handlers.get(name); if (handlers === undefined) throw new Error(`Unknown Q1 saved callback: ${name}`); return handlers;
  }
  action(entity: Q1Actor, name: string): () => undefined {
    const handler = this.get(name).action; if (handler === undefined) throw new Error(`Q1 callback is not an action: ${name}`);
    return Object.assign(() => handler(this.game, entity), { q1CallbackName: name });
  }
  use(entity: Q1Actor, name: string): NonNullable<Q1Actor["use"]> {
    const handler = this.get(name).use; if (handler === undefined) throw new Error(`Q1 callback is not use: ${name}`);
    return Object.assign((other: ActorId | null, activator: ActorId | null) => handler(this.game, entity, other, activator), { q1CallbackName: name });
  }
  touch(entity: Q1Actor, name: string): NonNullable<Q1Actor["touch"]> {
    const handler = this.get(name).touch; if (handler === undefined) throw new Error(`Q1 callback is not touch: ${name}`);
    return Object.assign((other: ActorId, normal: Vec3 | null) => handler(this.game, entity, other, normal), { q1CallbackName: name });
  }
  pain(entity: Q1Actor, name: string): NonNullable<Q1Actor["pain"]> {
    const handler = this.get(name).pain; if (handler === undefined) throw new Error(`Q1 callback is not pain: ${name}`);
    return Object.assign((attacker: ActorId | null, damage: number) => handler(this.game, entity, attacker, damage), { q1CallbackName: name });
  }
  die(entity: Q1Actor, name: string): NonNullable<Q1Actor["die"]> {
    const handler = this.get(name).die; if (handler === undefined) throw new Error(`Q1 callback is not die: ${name}`);
    return Object.assign((attacker: ActorId | null) => handler(this.game, entity, attacker), { q1CallbackName: name });
  }
  blocked(entity: Q1Actor, name: string): NonNullable<Q1Actor["blocked"]> {
    const handler = this.get(name).blocked; if (handler === undefined) throw new Error(`Q1 callback is not blocked: ${name}`);
    return Object.assign((other: ActorId) => handler(this.game, entity, other), { q1CallbackName: name });
  }
}
