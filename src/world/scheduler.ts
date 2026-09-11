// Think dispatch follows Q1/QW sv_phys, Q2 g_phys, and Q3 g_main: clear before calling.
import { sameActor } from "../contracts/identity.ts";
import type { ActorId, CallbackId, OwnedActor, ProviderId } from "../contracts/identity.ts";
import type { ClockProfile, FrameContext, FrameOrdering, InvocationOrder, SourceTime, ThinkTiming } from "../contracts/time.ts";
import type { ActorRegistry, ActorSchedule, ScheduledThink } from "../contracts/world.ts";
import { copyFrame, copyTime, sameTimeUnit, validateTime } from "./session/clocks.ts";

export type ThinkCallback = (self: OwnedActor, frame: FrameContext) => undefined;
export interface SchedulerOptions {
  readonly actors: ActorRegistry;
  readonly ordering: FrameOrdering;
  readonly clocks: readonly { readonly provider: ProviderId; readonly profile: ClockProfile }[];
  readonly sourceSlot?: (actor: ActorId) => number | null;
  readonly resolve: (provider: ProviderId, callback: CallbackId) => ThinkCallback | null;
}

export interface ProviderFrame { readonly provider: ProviderId; readonly frame: FrameContext; }
export type ThinkResult =
  | { readonly kind: "not-run"; readonly reason: "unscheduled" | "boundary" | "not-due" | "stale" }
  | { readonly kind: "ran"; readonly invocations: number; readonly alive: boolean };

interface PendingThink extends ScheduledThink { readonly owned: OwnedActor; readonly sourceSlot: number; }

/** Deadlines select eligibility; source traversal, rather than deadline sorting, selects execution order. */
export function compareInvocationOrder(ordering: FrameOrdering, left: InvocationOrder, right: InvocationOrder,
  sourceSlot: (actor: ActorId) => number = actor => actor.slot): number {
  if (ordering.kind === "mixed") {
    const leftProvider = ordering.providers.indexOf(left.provider);
    const rightProvider = ordering.providers.indexOf(right.provider);
    if (leftProvider < 0 || rightProvider < 0) throw new RangeError("Provider is absent from mixed frame ordering");
    if (leftProvider !== rightProvider) return leftProvider - rightProvider;
  }
  return sourceSlot(left.actor) - sourceSlot(right.actor) || left.sequence - right.sequence;
}

/** null means not due; the returned time is the time visible inside the callback. */
export function thinkCallbackTime(profile: ClockProfile, due: SourceTime, frame: FrameContext): SourceTime | null {
  validateTime(due);
  validateTime(frame.time);
  validateTime(frame.elapsed);
  sameTimeUnit(due, frame.time);
  sameTimeUnit(frame.time, frame.elapsed);
  if (frame.elapsed.value < 0) throw new RangeError("Frame elapsed time cannot be negative");
  const seconds = profile.kind === "q1-netquake" || profile.kind === "q1-quakeworld" || profile.kind === "q2-classic";
  if (due.kind !== (seconds ? "seconds" : "milliseconds")) throw new RangeError("Think clock has the wrong source unit");
  if (due.value <= 0) return null;
  switch (profile.kind) {
    case "q1-netquake": case "q1-quakeworld":
      return due.value > frame.time.value + frame.elapsed.value ? null
        : copyTime({ kind: due.kind, value: Math.max(due.value, frame.time.value) });
    case "q2-classic": return due.value > frame.time.value + 0.001 ? null : copyTime(frame.time);
    case "q2-rerelease": return due.value > frame.time.value ? null : copyTime(frame.time);
    case "q3": return Math.fround(due.value) > frame.time.value ? null : copyTime(frame.time);
    default: { const exhaustive: never = profile; return exhaustive; }
  }
}

export class FrameScheduler implements ActorSchedule {
  private readonly scheduled = new Map<number, PendingThink>();
  private readonly profiles = new Map<ProviderId, ClockProfile>();
  private readonly ordering: FrameOrdering;
  private advancing = false;
  private closed = false;

  constructor(private readonly options: SchedulerOptions) {
    this.ordering = options.ordering.kind === "mixed"
      ? Object.freeze({ ...options.ordering, providers: Object.freeze([...options.ordering.providers]) })
      : Object.freeze({ ...options.ordering, clock: Object.freeze({ ...options.ordering.clock }) });
    for (const { provider, profile } of options.clocks) {
      if (this.profiles.has(provider)) throw new Error(`Duplicate scheduler clock: ${provider}`);
      this.profiles.set(provider, Object.freeze({ ...profile }));
    }
    if (this.ordering.kind === "mixed") {
      const seen = new Set<ProviderId>();
      for (const provider of this.ordering.providers) {
        if (seen.has(provider)) throw new Error(`Duplicate provider in frame order: ${provider}`);
        seen.add(provider);
        this.profile(provider);
      }
    }
  }

  schedule(actor: OwnedActor, callback: CallbackId, timing: ThinkTiming): undefined {
    this.assertOpen();
    this.assertOwned(actor);
    this.profile(actor.owner);
    validateTime(timing.due);
    if (!sameActor(actor.id, timing.order.actor) || actor.owner !== timing.order.provider) throw new RangeError("Think order must name its owning actor and provider");
    if (!Number.isSafeInteger(timing.order.sequence) || timing.order.sequence < 0) throw new RangeError("Think invocation sequence must be a nonnegative safe integer");
    if (this.ordering.kind === "mixed" && !this.ordering.providers.includes(actor.owner)) throw new RangeError("Provider is absent from mixed frame ordering");
    const sourceSlot = this.options.sourceSlot?.(actor.id) ?? actor.id.slot;
    if (!Number.isSafeInteger(sourceSlot) || sourceSlot < 0) throw new RangeError("Source slot must be a nonnegative safe integer");
    this.scheduled.set(actor.id.slot, Object.freeze({ actor: actor.id, owned: actor, callback, sourceSlot,
      timing: Object.freeze({ ...timing, due: copyTime(timing.due), order: Object.freeze({ ...timing.order }) }) }));
    return undefined;
  }

  cancel(actor: OwnedActor): undefined {
    this.assertOpen();
    const pending = this.scheduled.get(actor.id.slot);
    if (pending !== undefined && sameActor(pending.actor, actor.id)) {
      if (pending.owned.owner !== actor.owner) throw new RangeError("Cannot cancel another provider's think");
      this.scheduled.delete(actor.id.slot);
    }
    return undefined;
  }

  pending(actor: ActorId): ScheduledThink | null {
    this.assertOpen();
    const pending = this.scheduled.get(actor.slot);
    if (pending === undefined || !sameActor(pending.actor, actor)) return null;
    if (!this.options.actors.isLive(actor)) { this.scheduled.delete(actor.slot); return null; }
    return Object.freeze({ actor: pending.actor, callback: pending.callback, timing: pending.timing });
  }

  /** Called at an actor's source-defined physics site; its result preserves Q1 liveness and Q2 ran-think distinctions. */
  run(actor: ActorId, frame: FrameContext, boundary: ThinkTiming["boundary"]): ThinkResult {
    this.assertOpen();
    let invocations = 0;
    for (;;) {
      const pending = this.scheduled.get(actor.slot);
      if (pending === undefined || !sameActor(pending.actor, actor)) return this.result(invocations, actor, "unscheduled");
      if (!this.options.actors.isLive(actor)) {
        this.scheduled.delete(actor.slot);
        return this.result(invocations, actor, "stale");
      }
      if (pending.timing.boundary !== boundary) return this.result(invocations, actor, "boundary");
      const profile = this.profile(pending.owned.owner);
      const time = thinkCallbackTime(profile, pending.timing.due, frame);
      if (time === null) return this.result(invocations, actor, "not-due");
      this.scheduled.delete(actor.slot);
      const callback = this.options.resolve(pending.owned.owner, pending.callback);
      if (callback === null) throw new Error(`Unknown think callback: ${pending.callback}`);
      callback(pending.owned, copyFrame({ ...frame, time, phase: "entity-think" }));
      invocations++;
      if (this.closed || !this.options.actors.isLive(actor) || profile.kind !== "q1-quakeworld") {
        return { kind: "ran", invocations, alive: this.options.actors.isLive(actor) };
      }
    }
  }

  /** Later-slot additions and cancellation are visible during the same traversal. */
  advance(frames: readonly ProviderFrame[], boundary: ThinkTiming["boundary"]): readonly { readonly actor: ActorId; readonly result: ThinkResult }[] {
    this.assertOpen();
    if (this.advancing) throw new Error("Scheduler advance is already running");
    const contexts = new Map<ProviderId, FrameContext>();
    for (const { provider, frame } of frames) {
      this.profile(provider);
      if (contexts.has(provider)) throw new Error(`Duplicate provider frame: ${provider}`);
      contexts.set(provider, copyFrame(frame));
    }
    const results: { readonly actor: ActorId; readonly result: ThinkResult }[] = [];
    let cursor: PendingThink | null = null;
    this.advancing = true;
    try {
      while (!this.closed) {
        let next: PendingThink | null = null;
        for (const pending of this.scheduled.values()) {
          if (!this.options.actors.isLive(pending.actor)) { this.scheduled.delete(pending.actor.slot); continue; }
          if (cursor !== null && this.comparePending(pending, cursor, false) <= 0) continue;
          if (next === null || this.comparePending(pending, next, true) < 0) next = pending;
        }
        if (next === null) break;
        cursor = next;
        const frame = contexts.get(next.owned.owner);
        if (frame === undefined) throw new Error(`Missing source frame for provider: ${next.owned.owner}`);
        results.push({ actor: next.actor, result: this.run(next.actor, frame, boundary) });
      }
    } finally { this.advancing = false; }
    return results;
  }

  close(): undefined { this.closed = true; this.scheduled.clear(); return undefined; }

  private comparePending(left: PendingThink, right: PendingThink, invocations: boolean): number {
    const provider = this.ordering.kind === "native" ? 0
      : this.ordering.providers.indexOf(left.owned.owner) - this.ordering.providers.indexOf(right.owned.owner);
    return provider || left.sourceSlot - right.sourceSlot || (invocations ? left.timing.order.sequence - right.timing.order.sequence : 0);
  }

  private result(invocations: number, actor: ActorId, reason: Extract<ThinkResult, { readonly kind: "not-run" }>["reason"]): ThinkResult {
    return invocations === 0 ? { kind: "not-run", reason } : { kind: "ran", invocations, alive: this.options.actors.isLive(actor) };
  }

  private profile(provider: ProviderId): ClockProfile {
    const profile = this.profiles.get(provider);
    if (profile !== undefined) return profile;
    if (this.ordering.kind === "native") return this.ordering.clock;
    throw new Error(`Missing scheduler clock: ${provider}`);
  }

  private assertOpen(): undefined {
    if (this.closed) throw new Error("Frame scheduler is closed");
    return undefined;
  }

  private assertOwned(actor: OwnedActor): undefined {
    const observed = this.options.actors.observe(actor.id);
    if (observed === null || observed.owner !== actor.owner) throw new RangeError("Cannot schedule a stale or foreign actor");
    return undefined;
  }
}
