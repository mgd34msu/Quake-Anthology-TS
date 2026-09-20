import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { FrameContext } from "../../contracts/time.ts";
import type { ActorCallbacks, DeathReaction, PainReaction, TouchContact } from "../../contracts/world.ts";
import type { SessionActorRegistry } from "./registry.ts";
import { ModOperation } from "../gameplay/mod-composition.ts";

export interface ActorInvocation {
  readonly self: OwnedActor;
  readonly kind: "think" | "touch" | "use" | "pain" | "die";
  readonly parent: ActorInvocation | null;
}

export class ActorCallbackTable {
  readonly operations = {
    think: new ModOperation<Readonly<Parameters<NonNullable<ActorCallbacks["think"]>>>, boolean>("actor.think"),
    touch: new ModOperation<Readonly<Parameters<NonNullable<ActorCallbacks["touch"]>>>, boolean>("actor.touch"),
    use: new ModOperation<Readonly<Parameters<NonNullable<ActorCallbacks["use"]>>>, boolean>("actor.use"),
    pain: new ModOperation<Readonly<Parameters<NonNullable<ActorCallbacks["pain"]>>>, boolean>("actor.pain"),
    die: new ModOperation<Readonly<Parameters<NonNullable<ActorCallbacks["die"]>>>, boolean>("actor.die"),
  };
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

  think(self: OwnedActor, frame: FrameContext): boolean {
    return this.operations.think.active ? this.compose(self, this.operations.think, [self, frame], args => this.thinkCanonical(...args)) : this.thinkCanonical(self, frame);
  }
  private thinkCanonical(self: OwnedActor, frame: FrameContext): boolean { return this.invoke(self, "think", callbacks => callbacks.think?.(self, frame)); }
  touch(contact: TouchContact): boolean {
    return this.operations.touch.active ? this.compose(contact.self, this.operations.touch, [contact], args => this.touchCanonical(...args)) : this.touchCanonical(contact);
  }
  private touchCanonical(contact: TouchContact): boolean {
    if (!this.actors.isLive(contact.other) && contact.sourceTrace?.inverted !== true) return false;
    return this.invoke(contact.self, "touch", callbacks => callbacks.touch?.(contact));
  }
  use(self: OwnedActor, other: ActorId | null, activator: ActorId | null): boolean {
    return this.operations.use.active ? this.compose(self, this.operations.use, [self, other, activator], args => this.useCanonical(...args)) : this.useCanonical(self, other, activator);
  }
  private useCanonical(self: OwnedActor, other: ActorId | null, activator: ActorId | null): boolean {
    return this.invoke(self, "use", callbacks => callbacks.use?.(self, other, activator));
  }
  pain(reaction: PainReaction): boolean {
    return this.operations.pain.active ? this.compose(reaction.self, this.operations.pain, [reaction], args => this.painCanonical(...args)) : this.painCanonical(reaction);
  }
  private painCanonical(reaction: PainReaction): boolean { return this.invoke(reaction.self, "pain", callbacks => callbacks.pain?.(reaction)); }
  die(reaction: DeathReaction): boolean {
    return this.operations.die.active ? this.compose(reaction.self, this.operations.die, [reaction], args => this.dieCanonical(...args)) : this.dieCanonical(reaction);
  }
  private dieCanonical(reaction: DeathReaction): boolean { return this.invoke(reaction.self, "die", callbacks => callbacks.die?.(reaction)); }

  sourcePain(reaction: PainReaction, execute: (reaction: PainReaction) => undefined): boolean {
    const canonical = (args: readonly [PainReaction]) => this.invokeSource(args[0].self, "pain", () => execute(args[0]));
    return this.operations.pain.active ? this.compose(reaction.self, this.operations.pain, [reaction], canonical) : canonical([reaction]);
  }
  sourceDie(reaction: DeathReaction, execute: (reaction: DeathReaction) => undefined): boolean {
    const canonical = (args: readonly [DeathReaction]) => this.invokeSource(args[0].self, "die", () => execute(args[0]));
    return this.operations.die.active ? this.compose(reaction.self, this.operations.die, [reaction], canonical) : canonical([reaction]);
  }

  sourceUse(self: OwnedActor, other: ActorId | null, activator: ActorId | null, execute: (self: OwnedActor, other: ActorId | null, activator: ActorId | null) => undefined): boolean {
    const canonical = (args: readonly [OwnedActor, ActorId | null, ActorId | null]) => this.invokeSource(args[0], "use", () => execute(...args));
    return this.operations.use.active ? this.compose(self, this.operations.use, [self, other, activator], canonical) : canonical([self, other, activator]);
  }

  sourceTouch(contact: TouchContact, execute: (contact: TouchContact) => undefined): boolean {
    const canonical = (args: readonly [TouchContact]) => {
      if (!this.actors.isLive(args[0].other) && args[0].sourceTrace?.inverted !== true) return false;
      return this.invokeSource(args[0].self, "touch", () => execute(args[0]));
    };
    return this.operations.touch.active ? this.compose(contact.self, this.operations.touch, [contact], canonical) : canonical([contact]);
  }

  private invokeSource(self: OwnedActor, kind: "pain" | "die" | "touch" | "use", execute: () => undefined): boolean {
    if (!this.actors.isLive(self.id)) return false;
    this.actors.assertOwned(self);
    const parent = this.invocation;
    this.invocation = Object.freeze({ self, kind, parent });
    try { execute(); } finally { this.invocation = parent; }
    return true;
  }

  private compose<Request>(self: OwnedActor, operation: ModOperation<Request, boolean>, request: Request, canonical: (request: Request) => boolean): boolean {
    if (!this.actors.isLive(self.id)) return false;
    this.actors.assertOwned(self);
    return operation.dispatch(request, canonical);
  }

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
