import type { ActorId, ClientId } from "../../contracts/identity.ts";
import type { ModCallbackDeclaration, ModSourceCall, ModQcInputOutput, ModClientInputOutput } from "../../contracts/mod-callbacks.ts";
import type { ModClientApplication, ModClientServices } from "../../world/session/mod-clients.ts";
import { subscribeModClientInput } from "../../world/session/mod-client-input.ts";
import { infoValueForKey } from "../../core/info-string.ts";

export interface QcModClientSlot { readonly actor: ActorId; readonly slot: number; readonly admitted: boolean; }
interface Entry extends QcModClientSlot { readonly client: ClientId | null; }
interface Operations {
  readonly services: ModClientServices;
  readonly declaration: NonNullable<ModCallbackDeclaration["clients"]>;
  project(actor: ActorId): void;
  release(actor: ActorId): "released" | "deferred";
  invoke(call: ModSourceCall, actor: ActorId): void;
  reserve?(actor: ActorId): void;
  admitted?(actor: ActorId): void;
  readonly input?: {
    open(application: ModClientApplication): () => void;
    invoke(call: ModSourceCall, application: ModClientApplication): void;
    output(outputs: readonly ModQcInputOutput[], application: ModClientApplication, run: () => void): readonly ModClientInputOutput[];
  };
}

/** QuakeC reserves edicts after world; canonical clients retain their independent identities. */
export class QcModClientBindings {
  private readonly entries = new Map<ActorId, Entry>();
  private unsubscribe: (() => undefined) | null = null;
  private unsubscribeInput: (() => undefined) | null = null;
  constructor(private readonly operations: Operations) {}
  slot(actor: ActorId): number | null {
    const client = this.operations.services.forActor(actor);
    if (client === null) return this.entries.has(actor) ? this.require(actor).slot : null;
    if (this.entries.has(actor)) return this.require(actor).slot;
    const used = new Set([...this.entries.values()].map(entry => entry.slot));
    let slot = 1; while (used.has(slot)) slot++;
    if (slot > this.operations.declaration.maximum) throw new Error("QuakeC component source client capacity exceeded");
    this.entries.set(actor, { actor, client, slot, admitted: false }); return slot;
  }
  private require(actor: ActorId): Entry {
    const entry = this.entries.get(actor), client = this.operations.services.forActor(actor);
    if (entry === undefined || client === null || entry.client !== null && !entry.client.equals(client)
      || this.operations.services.actor(client)?.equals(actor) !== true) throw new Error("QuakeC component client identity is no longer live");
    if (entry.client !== null) return entry;
    const current = { ...entry, client }; this.entries.set(actor, current); return current;
  }
  private invoke(calls: readonly ModSourceCall[], actor: ActorId): void { for (const call of calls) { this.require(actor); this.operations.invoke(call, actor); } }
  private admit(actor: ActorId): void {
    if (this.slot(actor) === null) throw new Error("QuakeC component admission requires a live client");
    const entry = this.require(actor); this.operations.reserve?.(actor); this.operations.project(actor);
    if (!entry.admitted) { this.entries.set(actor, { ...entry, admitted: true }); this.invoke(this.operations.declaration.admit, actor); }
    this.operations.admitted?.(actor);
  }
  start(): void {
    if (this.unsubscribe !== null) return;
    this.unsubscribe = this.operations.services.subscribe(event => {
      const actor = event.identity.actor;
      if (event.kind === "admitted") this.admit(actor);
      else if (event.kind === "userinfo") { this.admit(actor); this.invoke(this.operations.declaration.userinfo, actor); }
      else if (this.entries.has(actor)) {
        this.require(actor); this.invoke(this.operations.declaration.disconnect, actor);
        if (this.operations.release(actor) === "released") this.entries.delete(actor);
      }
      return undefined;
    });
    for (const client of this.operations.services.clients()) this.admit(client.actor);
    const bindings = this.operations.declaration.input ?? [], input = this.operations.input;
    if (bindings.length !== 0) {
      if (input === undefined) throw new Error("QuakeC client input requires a source application owner");
      this.unsubscribeInput = subscribeModClientInput(this.operations.services, bindings, {
        open: application => {
          if (!this.require(application.identity.actor).admitted) throw new Error("QuakeC client input requires source admission");
          return input.open(application);
        },
        invoke: (call, application) => { this.require(application.identity.actor); input.invoke(call, application); },
        output: (outputs, application, run) => input.output(outputs, application, run),
      });
    }
  }
  userinfo(actor: ActorId, key: string): string {
    const client = this.require(actor).client;
    if (client === null) throw new Error("QuakeC component userinfo requires a restored client");
    return infoValueForKey(this.operations.services.userinfo(client), key);
  }
  setUserinfo(actor: ActorId, key: string, value: string): void {
    if (/[\\\x00]/u.test(value)) throw new Error("QuakeC component userinfo field cannot contain a delimiter or NUL");
    const client = this.require(actor).client;
    if (client === null) throw new Error("QuakeC component userinfo requires a restored client");
    const source = this.operations.services.userinfo(client), fields = source.split("\\"), result: string[] = [];
    for (let index = fields[0] === "" ? 1 : 0; index + 1 < fields.length; index += 2) {
      const name = fields[index], text = fields[index + 1];
      if (name !== undefined && text !== undefined && name !== key) result.push(name, text);
    }
    if (value !== "") result.push(key, value);
    this.operations.services.setUserinfo(client, result.length === 0 ? "" : `\\${result.join("\\")}`);
  }
  checkpoint(): readonly QcModClientSlot[] { return [...this.entries.values()].map(({ actor, slot, admitted }) => ({ actor, slot, admitted })); }
  restore(entries: readonly QcModClientSlot[]): void {
    this.entries.clear(); const slots = new Set<number>();
    for (const entry of entries) {
      if (!Number.isInteger(entry.slot) || entry.slot < 1 || entry.slot > this.operations.declaration.maximum || slots.has(entry.slot) || this.entries.has(entry.actor))
        throw new Error("Invalid saved QuakeC component client mapping");
      slots.add(entry.slot); this.entries.set(entry.actor, { ...entry, client: this.operations.services.forActor(entry.actor) });
    }
  }
  forget(actor: ActorId): void { this.entries.delete(actor); }
  close(): void {
    this.unsubscribe?.(); this.unsubscribe = null;
    try { this.unsubscribeInput?.(); } finally { this.unsubscribeInput = null; this.entries.clear(); }
  }
}
