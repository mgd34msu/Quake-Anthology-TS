import type { ActorId, ClientId } from "../../contracts/identity.ts";
import type { ContentId } from "../../contracts/content.ts";
import type { Q3PlayerState } from "../../contracts/protocol.ts";
import type { QvmModClients, QvmModSourceCall } from "../../contracts/qvm-mod-callbacks.ts";
import type { ModClientServices } from "../../world/session/mod-clients.ts";
import { q3CommandForControls, relativeQ3SourceCommand } from "../../app/bootstrap/simulation/q3-commands.ts";
import type { QvmClientGameServices } from "./client-game-syscalls.ts";

export interface QvmModClientSlot { readonly actor: ActorId; readonly slot: number; readonly admitted: boolean; }
interface ClientSlot extends QvmModClientSlot { readonly client: ClientId | null; }
interface Operations {
  readonly content: ContentId;
  readonly services: ModClientServices;
  readonly declaration: QvmModClients;
  project(actor: ActorId): void;
  release(actor: ActorId): void;
  invoke(call: QvmModSourceCall, actor: ActorId): void;
  playerState(actor: ActorId): Q3PlayerState;
  send(text: string, recipient: ActorId | null): void;
}

/** Source slots belong to this component; every use resolves the live destination identity. */
export class QvmModClientBindings {
  private readonly entries = new Map<ActorId, ClientSlot>();
  private unsubscribe: (() => undefined) | null = null;
  constructor(private readonly operations: Operations) {}

  has(actor: ActorId): boolean { return this.entries.has(actor); }
  slot(actor: ActorId): number | null {
    const client = this.operations.services.forActor(actor);
    if (client === null) return this.entries.has(actor) ? this.require(actor).slot : null;
    const previous = this.entries.get(actor);
    if (previous !== undefined) { this.require(actor); return previous.slot; }
    const used = new Set([...this.entries.values()].map(entry => entry.slot));
    let slot = 0; while (used.has(slot)) slot++;
    if (slot >= this.operations.declaration.maximum) throw new Error("QVM component source client capacity exceeded");
    this.entries.set(actor, { actor, client, slot, admitted: false });
    return slot;
  }
  private require(actor: ActorId): ClientSlot {
    const entry = this.entries.get(actor), client = this.operations.services.forActor(actor);
    if (entry === undefined || client === null || entry.client !== null && !entry.client.equals(client)
      || this.operations.services.actor(client)?.equals(actor) !== true) throw new Error("QVM component client identity is no longer live");
    if (entry.client === null) { const current = { ...entry, client }; this.entries.set(actor, current); return current; }
    return entry;
  }
  private at(slot: number): ClientSlot | null {
    const entry = [...this.entries.values()].find(entry => entry.slot === slot);
    return entry === undefined ? null : this.require(entry.actor);
  }
  private calls(calls: readonly QvmModSourceCall[], actor: ActorId): void {
    for (const call of calls) this.operations.invoke(call, actor);
  }
  private admit(actor: ActorId): void {
    if (this.slot(actor) === null) throw new Error("QVM component admission requires a live client");
    const entry = this.require(actor);
    this.operations.project(actor);
    if (!entry.admitted) {
      this.entries.set(actor, { ...entry, admitted: true });
      this.calls(this.operations.declaration.admit, actor);
    }
  }
  start(): void {
    if (this.unsubscribe !== null) return;
    this.unsubscribe = this.operations.services.subscribe(event => {
      const actor = event.identity.actor;
      if (event.kind === "admitted") this.admit(actor);
      else if (event.kind === "userinfo") {
        this.admit(actor); this.calls(this.operations.declaration.userinfo, actor);
      } else if (this.entries.has(actor)) {
        this.require(actor); this.calls(this.operations.declaration.disconnect, actor);
        this.entries.delete(actor); this.operations.release(actor);
      }
      return undefined;
    });
    for (const identity of this.operations.services.clients()) this.admit(identity.actor);
  }
  restore(entries: readonly QvmModClientSlot[]): void {
    this.entries.clear();
    for (const entry of entries) this.entries.set(entry.actor, { ...entry, client: this.operations.services.forActor(entry.actor) });
  }
  checkpoint(): readonly QvmModClientSlot[] { return [...this.entries.values()].map(({ actor, slot, admitted }) => ({ actor, slot, admitted })); }
  forget(actor: ActorId): void { this.entries.delete(actor); }
  close(): void { this.unsubscribe?.(); this.unsubscribe = null; this.entries.clear(); }

  getUserinfo(slot: number): string {
    const entry = this.at(slot);
    return entry?.client == null ? "" : this.operations.services.userinfo(entry.client);
  }
  setUserinfo(slot: number, value: string): void {
    const entry = this.at(slot);
    if (entry?.client == null) throw new Error("QVM component cannot update an unbound source client");
    this.operations.services.setUserinfo(entry.client, value);
  }
  dropClient(slot: number, reason: string): void {
    const entry = this.at(slot); if (entry?.client != null) this.operations.services.drop(entry.client, reason, this.operations.content);
  }
  sendServerCommand(slot: number, text: string): void {
    if (slot === -1) { this.operations.send(text, null); return; }
    const entry = this.at(slot); if (entry !== null) this.operations.send(text, entry.actor);
  }
  getUserCommand(slot: number): ReturnType<QvmClientGameServices["getUserCommand"]> {
    const entry = this.at(slot), accepted = entry?.client == null ? null : this.operations.services.command(entry.client);
    if (entry === null || accepted === null) throw new Error("QVM component usercmd requires an accepted destination client command");
    const input = accepted.input, milliseconds = accepted.time.kind === "seconds" ? accepted.time.value * 1000 : accepted.time.value;
    const ps = this.operations.playerState(entry.actor);
    const command = relativeQ3SourceCommand(input.source, input.command.kind,
      q3CommandForControls(input, milliseconds, { requestedWeapon: ps.weapon,
        useHoldable: input.arsenal?.useHoldable ?? (input.command.kind === "q3" && (input.command.buttons & 4) !== 0) }),
      { x: ps.deltaAngleWords[0], y: ps.deltaAngleWords[1], z: ps.deltaAngleWords[2] }, input.angleSpace);
    return { ...command, angles: [command.angles.x, command.angles.y, command.angles.z] };
  }
}
