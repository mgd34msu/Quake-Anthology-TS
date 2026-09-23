import type { ModClientApplication, ModClientApplicationEvent, ModClientIdentity } from "./mod-clients.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { UserCommand } from "../../contracts/protocol.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { ModClientInputOutput } from "../../contracts/mod-callbacks.ts";
import { modClientCommandAim, modClientCommandImpulse, modClientCommandScalar, modClientOutputChanges } from "./mod-client-command.ts";

type Listener = (event: ModClientApplicationEvent) => undefined;
type ApplicationInput = Omit<ModClientApplication, "invocation" | "parentInvocation"> & { readonly parentInvocation?: number | null };
type Publication = Omit<Extract<ModClientApplicationEvent, { phase: "before" }>, "output"> | Extract<ModClientApplicationEvent, { phase: "after" }>;

/** One ordered application journal; source owners decide where an operation begins and ends. */
export class ModClientApplications {
  private readonly listeners = new Set<Listener>();
  private readonly pending = new Map<ModClientApplication, Listener[]>();
  private readonly outputs = new Map<ModClientApplication, (output: ModClientInputOutput) => void>();
  private ordinal = 0;
  private current: ModClientApplication | null = null;
  constructor(private readonly live: (identity: ModClientIdentity) => boolean) {}
  get active(): boolean { return this.listeners.size !== 0; }
  subscribe(listener: Listener): () => undefined {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); return undefined; };
  }
  begin(input: ApplicationInput, encodeAim?: (aim: Vec3, command: UserCommand) => UserCommand): ModClientApplication | null {
    if (!this.active || !this.live(input.identity)) return null;
    if (this.ordinal === Number.MAX_SAFE_INTEGER) throw new RangeError("Client application ordinal exhausted");
    let parent = this.current;
    if (input.parentInvocation !== undefined && input.parentInvocation !== null) {
      let found = this.current?.invocation === input.parentInvocation;
      for (const pending of this.pending.keys()) if (pending.invocation === input.parentInvocation) {
        found = true;
        if (parent === null || pending.invocation > parent.invocation) parent = pending;
        break;
      }
      if (!found) throw new Error("Input application parent is no longer active");
    }
    let command = input.command, aim = input.absoluteAim;
    let arsenal = input.arsenal === undefined ? parent?.identity.actor.equals(input.identity.actor) === true ? parent.arsenal ?? null : input.accepted?.input.arsenal ?? null : input.arsenal;
    let impulse = input.controls?.impulse ?? arsenal?.impulse ?? modClientCommandImpulse(command);
    const application: ModClientApplication = { ...input, get command() { return command; }, get absoluteAim() { return aim; },
      get arsenal() { return arsenal; }, get controls() { return { impulse }; }, invocation: ++this.ordinal,
      parentInvocation: parent?.invocation ?? null };
    this.pending.set(application, []);
    this.outputs.set(application, output => {
      for (const change of modClientOutputChanges(output)) {
        if (change.input === "view-angles") {
          if (![change.value.x, change.value.y, change.value.z].every(Number.isFinite)) throw new RangeError("Source input aim must be finite");
          const next = encodeAim?.(change.value, command) ?? modClientCommandAim(command, change.value, aim);
          if (next.kind !== command.kind) throw new Error("Input output changed command dialect");
          command = next; aim = change.value;
        } else {
          command = modClientCommandScalar(command, change.input, change.value);
          if (change.input === "impulse") { impulse = change.value; if (arsenal !== null) arsenal = { ...arsenal, impulse }; }
        }
      }
    });
    try { this.publish({ phase: "before", application }, [...this.listeners]); }
    catch (error) {
      try { this.finish(application, true); } catch (cleanup) { throw new AggregateError([error, cleanup], "Input callback and cleanup failed"); }
      throw error;
    }
    return application;
  }
  finish(application: ModClientApplication | null, failed = false): void {
    if (application === null) return;
    const listeners = this.pending.get(application);
    if (listeners === undefined) return;
    this.pending.delete(application);
    this.outputs.delete(application);
    this.publish({ phase: "after", application, outcome: failed ? "failed" : this.live(application.identity) ? "completed" : "actor-removed" }, listeners);
  }
  release(actor: ActorId): void {
    const errors: unknown[] = [];
    for (const application of [...this.pending.keys()].reverse()) if (application.identity.actor === actor) {
      try { this.finish(application); } catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Client input release callbacks failed");
  }
  private publish(event: Publication, listeners: readonly Listener[]): void {
    const previous = this.current; this.current = event.application;
    const errors: unknown[] = [];
    try {
      for (const listener of listeners) {
        if (!this.listeners.has(listener)) continue;
        if (event.phase === "before") {
          const entered = this.pending.get(event.application);
          if (entered === undefined || !this.live(event.application.identity)) break;
          entered.push(listener);
        }
        let open = true; const failure: { value?: { readonly error: unknown } } = {};
        try {
          if (event.phase === "before") {
            listener({ ...event, output: value => {
              try {
                const output = this.outputs.get(event.application);
                if (!open || !this.listeners.has(listener) || this.current !== event.application || output === undefined || !this.live(event.application.identity)) throw new Error("Input output is outside its live before callback");
                output(value); return undefined;
              } catch (error) { failure.value = { error }; throw error; }
            } });
            if (failure.value !== undefined) throw failure.value.error;
          } else listener(event.outcome === "completed" && !this.live(event.application.identity) ? { ...event, outcome: "actor-removed" } : event);
        } catch (error) { if (event.phase === "before") throw error; errors.push(error); }
        finally { open = false; }
      }
    } finally { this.current = previous; }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Client input completion callbacks failed");
  }
  checkpoint(): number {
    if (this.pending.size !== 0) throw new Error("Cannot save during client input application");
    return this.ordinal;
  }
  restore(ordinal: number): void {
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || this.pending.size !== 0) throw new Error("Invalid client application continuation");
    this.ordinal = ordinal;
  }
  close(): void { this.listeners.clear(); this.pending.clear(); this.outputs.clear(); this.current = null; }
}
