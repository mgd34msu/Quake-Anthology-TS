import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { FrameContext } from "../../contracts/time.ts";
import type { ActorCallbacks, DeathReaction, PainReaction, TouchContact } from "../../contracts/world.ts";
import type { SessionActorRegistry } from "./registry.ts";

export interface ActorInvocation {
  readonly self: OwnedActor;
  readonly kind: "think" | "touch" | "use" | "pain" | "die";
  readonly parent: ActorInvocation | null;
}

export class ActorCallbackTable {
  private readonly bindings = new Map<OwnedActor, ActorCallbacks>();
  private invocation: ActorInvocation | null = null;

  constructor(private readonly actors: SessionActorRegistry) {
    actors.onRelease(actor => { this.bindings.delete(actor); return undefined; });
  }

  get current(): ActorInvocation | null { return this.invocation; }

  bind(actor: OwnedActor, callbacks: ActorCallbacks): undefined {
    this.actors.assertOwned(actor);
    this.bindings.set(actor, Object.freeze({ ...callbacks }));
    return undefined;
  }

  think(self: OwnedActor, frame: FrameContext): boolean { return this.invoke(self, "think", callbacks => callbacks.think?.(self, frame)); }
  touch(contact: TouchContact): boolean {
    if (!this.actors.isLive(contact.other) && contact.sourceTrace?.inverted !== true) return false;
    return this.invoke(contact.self, "touch", callbacks => callbacks.touch?.(contact));
  }
  use(self: OwnedActor, other: ActorId | null, activator: ActorId | null): boolean {
    return this.invoke(self, "use", callbacks => callbacks.use?.(self, other, activator));
  }
  pain(reaction: PainReaction): boolean { return this.invoke(reaction.self, "pain", callbacks => callbacks.pain?.(reaction)); }
  die(reaction: DeathReaction): boolean { return this.invoke(reaction.self, "die", callbacks => callbacks.die?.(reaction)); }

  private invoke(self: OwnedActor, kind: ActorInvocation["kind"], call: (callbacks: ActorCallbacks) => undefined): boolean {
    if (!this.actors.isLive(self.id)) return false;
    this.actors.assertOwned(self);
    const callbacks = this.bindings.get(self);
    if (callbacks === undefined || callbacks[kind] === null) return false;
    const parent = this.invocation;
    this.invocation = Object.freeze({ self, kind, parent });
    try { call(callbacks); } finally { this.invocation = parent; }
    return true;
  }
}
