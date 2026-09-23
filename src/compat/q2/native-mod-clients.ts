import type { ActorId, ClientId } from "../../contracts/identity.ts";
import type { NativeModClients, NativeModSourceCall, NativeModInputOutput } from "../../contracts/native-mod-callbacks.ts";
import type { ModClientInputOutput } from "../../contracts/mod-callbacks.ts";
import type { ModClientApplication, ModClientServices } from "../../world/session/mod-clients.ts";
import { subscribeModClientInput } from "../../world/session/mod-client-input.ts";
import type { CommandOrigin } from "../../contracts/common.ts";
import type { CommandInvocation } from "../../core/commands/index.ts";
import type { ContentId } from "../../contracts/content.ts";
import { q2Userinfo } from "../../content/q2/base/player/index.ts";

export interface NativeModClientSlot { readonly actor: ActorId; readonly slot: number; readonly admitted: boolean; }
interface Entry extends NativeModClientSlot { readonly client: ClientId; }
interface Operations {
  readonly services: ModClientServices;
  readonly declaration: NativeModClients;
  readonly content: ContentId;
  project(actor: ActorId): void;
  admitted?(actor: ActorId): void;
  release(actor: ActorId): void;
  invoke(call: NativeModSourceCall, actor: ActorId): number;
  invokeInput(call: NativeModSourceCall, application: ModClientApplication): void;
  openInput(application: ModClientApplication): () => void;
  inputOutput(outputs: readonly NativeModInputOutput[], application: ModClientApplication, run: () => void): readonly ModClientInputOutput[];
  withCommand(command: CommandInvocation, invoke: () => void): void;
}

/** Source row numbers are private; every external operation resolves the destination generation. */
export class NativeModClientsBinding {
  private readonly entries = new Map<ActorId, Entry>();
  private readonly denied = new Set<ActorId>();
  private unsubscribe: (() => undefined) | null = null;
  private unsubscribeInput: (() => undefined) | null = null;
  constructor(private readonly operations: Operations) {}
  private require(actor: ActorId): Entry {
    const entry = this.entries.get(actor), client = this.operations.services.forActor(actor);
    if (entry === undefined || client === null || !entry.client.equals(client)
      || this.operations.services.actor(client)?.equals(actor) !== true) throw new Error("Native component client identity is no longer live");
    return entry;
  }
  slot(actor: ActorId): number | null {
    if (this.entries.has(actor)) return this.require(actor).slot;
    if (this.denied.has(actor)) throw new Error("Rejected native client lost its reserved source row");
    const client = this.operations.services.forActor(actor);
    if (client === null) return null;
    if (this.operations.services.actor(client)?.equals(actor) !== true) throw new Error("Native component client identity is no longer live");
    const occupied = new Set([...this.entries.values()].map(entry => entry.slot));
    let slot = 0; while (occupied.has(slot)) slot++;
    if (slot >= this.operations.declaration.maximum) throw new Error("Native component source client capacity exceeded");
    this.entries.set(actor, { actor, client, slot, admitted: false });
    return slot;
  }
  has(actor: ActorId): boolean { return this.entries.has(actor); }
  admitted(actor: ActorId): boolean { return this.entries.has(actor) && this.require(actor).admitted && !this.denied.has(actor); }
  rejects(actor: ActorId): boolean { return this.denied.has(actor); }
  private calls(calls: readonly NativeModSourceCall[], actor: ActorId): void {
    for (const call of calls) { this.require(actor); this.operations.invoke(call, actor); }
  }
  private admit(actor: ActorId): boolean {
    if (this.denied.has(actor)) return false;
    if (this.slot(actor) === null) throw new Error("Native component admission requires a live client");
    const entry = this.require(actor);
    this.operations.project(actor);
    if (entry.admitted) return true;
    try {
      for (const call of this.operations.declaration.admit) {
        this.require(actor);
        const result = this.operations.invoke(call, actor);
        if (call.accepts === "nonzero" && result === 0) {
          const reason = q2Userinfo(this.userinfo(actor)).get("rejmsg") || "Connection refused";
          this.operations.services.drop(this.require(actor).client, reason, this.operations.content);
          this.denied.add(actor); return false;
        }
      }
      this.entries.set(actor, { ...this.require(actor), admitted: true });
      this.operations.admitted?.(actor);
      return true;
    } catch (error) {
      this.operations.release(actor); this.entries.delete(actor); throw error;
    }
  }
  start(): void {
    if (this.unsubscribe !== null) return;
    this.unsubscribe = this.operations.services.subscribe(event => {
      const actor = event.identity.actor;
      if (event.kind === "admitted") this.admit(actor);
      else if (event.kind === "userinfo") { if (this.admit(actor)) this.calls(this.operations.declaration.userinfo, actor); }
      else { if (this.entries.has(actor)) this.disconnect(actor); this.denied.delete(actor); }
      return undefined;
    });
    for (const identity of this.operations.services.clients()) this.admit(identity.actor);
    this.unsubscribeInput = subscribeModClientInput(this.operations.services, this.operations.declaration.input ?? [], {
      open: application => this.require(application.identity.actor).admitted && !this.denied.has(application.identity.actor)
        ? this.operations.openInput(application) : () => undefined,
      invoke: (call, application) => {
        const actor = application.identity.actor;
        if (this.require(actor).admitted && !this.denied.has(actor)) this.operations.invokeInput(call, application);
      },
      output: (outputs, application, run) => this.operations.inputOutput(outputs, application, run),
    });
  }
  frame(slot: number): boolean {
    const entry = [...this.entries.values()].find(entry => entry.slot + 1 === slot);
    if (entry === undefined) return false;
    const client = this.operations.services.forActor(entry.actor);
    if (client !== null && this.operations.services.actor(client)?.equals(entry.actor) === true && this.admitted(entry.actor))
      this.calls(this.operations.declaration.frame ?? [], entry.actor);
    return true;
  }
  private disconnect(actor: ActorId): void {
    try { if (this.require(actor).admitted) this.calls(this.operations.declaration.disconnect, actor); }
    finally { this.operations.release(actor); this.entries.delete(actor); }
  }
  userinfo(actor: ActorId): string { return this.operations.services.userinfo(this.require(actor).client); }
  setUserinfo(actor: ActorId, value: string): void { this.operations.services.setUserinfo(this.require(actor).client, value); }
  invokeCommand(command: CommandInvocation): boolean {
    if (this.operations.declaration.command.length === 0) return false;
    let origin: CommandOrigin = command.source.origin;
    while (origin.kind === "script") origin = origin.caller;
    if (origin.kind !== "local-seat" && origin.kind !== "remote-client") return false;
    const actor = this.operations.services.actor(origin.client);
    if (actor === null) throw new Error("Native component command client is no longer live");
    if (!this.admit(actor)) return true;
    this.operations.withCommand(command, () => this.calls(this.operations.declaration.command, actor));
    return true;
  }
  checkpoint(): readonly NativeModClientSlot[] {
    for (const actor of this.denied) if (this.operations.services.forActor(actor) === null) this.denied.delete(actor);
    if (this.denied.size !== 0) throw new Error("Cannot save a native component before its rejected client disconnects");
    return [...this.entries.values()].map(({ actor, slot, admitted }) => ({ actor, slot, admitted }));
  }
  validateRestore(entries: readonly NativeModClientSlot[]): void {
    for (const entry of entries) {
      const client = this.operations.services.forActor(entry.actor);
      if (client === null || this.operations.services.actor(client)?.equals(entry.actor) !== true) throw new Error("Saved native component client is unavailable");
    }
  }
  restore(entries: readonly NativeModClientSlot[]): void {
    this.validateRestore(entries); this.entries.clear(); this.denied.clear();
    for (const entry of entries) {
      const client = this.operations.services.forActor(entry.actor);
      if (client === null) throw new Error("Saved native component client is unavailable");
      this.entries.set(entry.actor, { ...entry, client });
    }
  }
  forget(actor: ActorId): void { this.entries.delete(actor); }
  close(): void {
    this.unsubscribe?.(); this.unsubscribe = null;
    const errors: unknown[] = [];
    try { this.unsubscribeInput?.(); } catch (error) { errors.push(error); } this.unsubscribeInput = null;
    for (const actor of [...this.entries.keys()]) {
      try { this.operations.release(actor); }
      catch (error) { errors.push(error); }
    }
    this.entries.clear(); this.denied.clear();
    if (errors.length !== 0) throw new AggregateError(errors, "Native component client cleanup failed");
  }
}
