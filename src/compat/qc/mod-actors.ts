import type { ActorId, OwnedActor, ProviderId } from "../../contracts/identity.ts";
import type { FrameContext } from "../../contracts/time.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import { SourceActorSlots, quakeEdictLifetime } from "../../world/actors/source-slots.ts";
import { FrameScheduler } from "../../world/scheduler.ts";
import { createQcActorBindings, createQcSourceSlotStorage } from "./entity-host.ts";
import type { QcBuiltin } from "./machine.ts";
import type { QcMachine } from "./machine.ts";
import type { BodyStateBinding } from "../../world/actors/body.ts";
import type { PainReaction, DeathReaction } from "../../contracts/world.ts";

export interface QcModActorOptions {
  readonly machine: QcMachine;
  readonly provider: ProviderId;
  readonly services: ModHostServices;
  readonly think: number | null;
  readonly nextthink: number | null;
  body(slot: number): BodyStateBinding;
  admitted(actor: OwnedActor, slot: number): void;
  retired(actor: OwnedActor): void;
  step(actor: OwnedActor, frame: FrameContext, think: () => undefined): undefined;
  touch(actor: OwnedActor, other: ActorId): undefined;
  use(actor: OwnedActor, other: ActorId | null, activator: ActorId | null): undefined;
  pain(reaction: PainReaction): undefined;
  die(reaction: DeathReaction): undefined;
  remember(actor: ActorId, slot: number): void;
  invoke(actor: OwnedActor, functionIndex: number, frame: FrameContext): undefined;
}

/** QC owns private edicts and deadlines; shared actors and callbacks retain their normal lifetimes. */
export class QcModActors {
  readonly slots: SourceActorSlots;
  readonly spawn: QcBuiltin;
  readonly remove: QcBuiltin;
  private readonly scheduler: FrameScheduler;
  private readonly release: () => undefined;
  private readonly owned = new Map<OwnedActor, number>();
  private closed = false;

  constructor(private readonly options: QcModActorOptions) {
    const { machine, provider, services } = options;
    const clock: import("../../contracts/time.ts").ClockProfile = machine.program.api.kind === "q1-quakeworld"
      ? { kind: "q1-quakeworld", maximumCommandMilliseconds: 100 }
      : { kind: "q1-netquake", minimumFrameSeconds: 0, maximumFrameSeconds: 0.1, fixedFrameSeconds: null };
    this.scheduler = new FrameScheduler({ actors: services.actors, ordering: { kind: "native", traversal: "source-slot-order", clock },
      clocks: [{ provider, profile: clock }], sourceSlot: actor => services.actors.sourceOf(actor)?.slot ?? null,
      resolve: (_provider, callback) => callback === "quakec:mod-think" ? (actor, frame) => {
        if (services.callbacks === undefined) throw new Error("Scheduled mod actors require shared callbacks");
        services.callbacks.think(actor, frame); return undefined;
      } : null });
    const storage = createQcSourceSlotStorage(machine, { freeOffsetBytes: 0, freeTimeOffsetBytes: machine.program.api.kind === "q1-quakeworld" ? 100 : 92 });
    this.slots = new SourceActorSlots(services.actors, { provider, capacity: machine.entities.capacity, lifetime: quakeEdictLifetime(1),
      storage: { ...storage, initialize: (slot, actor) => {
        storage.initialize(slot, actor); options.remember(actor.id, slot);
        services.bodies.bind(actor, options.body(slot));
        this.admit(actor, slot); return undefined;
      } }, now: () => {
        const now = services.time(); return { kind: "seconds", value: now.kind === "seconds" ? now.value : now.value / 1000 };
      }, unlink: actor => services.bodies.unlink(actor), exhausted: () => { throw new Error("Gameplay mod source edicts exhausted"); } });
    const bindings = createQcActorBindings(machine.entities, services.actors, this.slots).host;
    const spawn = bindings?.get("spawn"), remove = bindings?.get("remove");
    if (spawn === undefined || remove === undefined) throw new Error("Missing QuakeC actor lifetime builtins");
    this.spawn = spawn;
    this.remove = vm => {
      const slot = vm.entities.slot(vm.argInt(0));
      if (this.slots.at(slot) === null) return vm.fail("Mod remove requires its own actor; foreign source removal needs its owner continuation");
      return remove(vm);
    };
    this.release = services.actors.onRelease(actor => {
      const slot = this.owned.get(actor);
      if (slot === undefined) return undefined;
      storage.clearFreed(slot, this.slots.options.now()); this.owned.delete(actor); this.scheduler.cancel(actor); options.retired(actor); return undefined;
    });
  }

  admit(actor: OwnedActor, slot: number): void {
    const { machine, services, think, nextthink } = this.options;
    this.owned.set(actor, slot);
    this.options.admitted(actor, slot);
    if (services.callbacks !== undefined) services.callbacks.bind(actor, { touch: contact => this.options.touch(actor, contact.other),
      use: (actor, other, activator) => this.options.use(actor, other, activator), pain: reaction => this.options.pain(reaction), die: reaction => this.options.die(reaction),
      think: (_actor, frame) => {
        if (think === null || nextthink === null) throw new Error("Mod think needs explicit think/nextthink field mappings");
        const fields = machine.entities.at(slot), functionIndex = fields.int(think);
        fields.setFloat(nextthink, 0);
        if (functionIndex !== 0) this.options.invoke(actor, functionIndex, frame);
        return undefined;
      } });
  }
  schedule(actor: OwnedActor): undefined {
    const slot = this.owned.get(actor), { nextthink, machine, provider } = this.options;
    if (slot === undefined) throw new Error("Mod scheduling requires its own source actor");
    if (nextthink === null) throw new Error("Mod scheduling requires a nextthink binding");
    const due = machine.entities.at(slot).float(nextthink);
    if (due <= 0) return this.scheduler.cancel(actor);
    return this.scheduler.schedule(actor, "quakec:mod-think", { due: { kind: "seconds", value: due }, boundary: "during-physics",
      order: { actor: actor.id, provider, sequence: 0 } });
  }
  advance(frame: FrameContext): undefined {
    const value = (time: FrameContext["time"]): number => time.kind === "seconds" ? time.value : time.value / 1000;
    const sourceFrame: FrameContext = { ...frame, time: { kind: "seconds", value: value(frame.time) - value(frame.elapsed) }, elapsed: { kind: "seconds", value: value(frame.elapsed) } };
    for (let slot = 1; slot < this.options.machine.entities.count; slot++) {
      const actor = this.slots.at(slot); if (actor === null) continue;
      this.options.step(actor, sourceFrame, () => { this.scheduler.run(actor.id, sourceFrame, "during-physics"); return undefined; });
    }
    return undefined;
  }
  restored(): void {
    for (const actor of this.options.services.actors.ownedBy(this.options.provider)) {
      const source = this.options.services.actors.sourceOf(actor.id);
      if (source === null || source.provider !== this.options.provider) throw new Error("Saved mod actor lost its source slot");
      // The full save restored a copied shared body before its source guest was opened.
      this.options.services.bodies.rebind(actor, this.options.body(source.slot));
      this.admit(actor, source.slot);
      if (this.options.nextthink !== null) this.schedule(actor);
    }
  }
  close(): undefined {
    if (this.closed) return undefined;
    this.closed = true; this.release(); this.scheduler.close();
    const errors: unknown[] = [];
    for (const actor of this.owned.keys()) if (this.options.services.actors.isLive(actor.id)) {
      try { this.options.services.actors.release(actor); } catch (error) { errors.push(error); }
    }
    this.owned.clear();
    if (errors.length !== 0) throw new AggregateError(errors, "Mod actor release failed");
    return undefined;
  }
}
