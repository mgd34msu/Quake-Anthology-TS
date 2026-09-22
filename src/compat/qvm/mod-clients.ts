import type { ActorId, ClientId } from "../../contracts/identity.ts";
import type { ContentId } from "../../contracts/content.ts";
import type { Q3PlayerState } from "../../contracts/protocol.ts";
import type { QvmModClients, QvmModSourceCall } from "../../contracts/qvm-mod-callbacks.ts";
import type { ModClientApplication, ModClientServices } from "../../world/session/mod-clients.ts";
import { subscribeModClientInput } from "../../world/session/mod-client-input.ts";
import { q3CommandForControls, relativeQ3SourceCommand } from "../../app/bootstrap/simulation/q3-commands.ts";
import type { QvmClientGameServices } from "./client-game-syscalls.ts";

export interface QvmModClientSlot { readonly actor: ActorId; readonly slot: number; readonly admitted: boolean; }
interface ClientSlot extends QvmModClientSlot { readonly client: ClientId | null; }
interface Operations {
  readonly content: ContentId;
  readonly services: ModClientServices;
  readonly declaration: QvmModClients;
  project(actor: ActorId): void;
  admitted?(actor: ActorId): void;
  release(actor: ActorId): void;
  invoke(call: QvmModSourceCall, actor: ActorId, application?: ModClientApplication): void;
  reservedSlots?(): Iterable<number, undefined, unknown>;
  playerState(actor: ActorId): Q3PlayerState;
  send(text: string, recipient: ActorId | null): void;
}

/** Source slots belong to this component; every use resolves the live destination identity. */
export class QvmModClientBindings {
  private readonly entries = new Map<ActorId, ClientSlot>();
  private unsubscribe: (() => undefined) | null = null;
  private unsubscribeInput: (() => undefined) | null = null;
  private readonly applications: ModClientApplication[] = [];
  constructor(private readonly operations: Operations) {}

  has(actor: ActorId): boolean { return this.entries.has(actor); }
  admitted(actor: ActorId): boolean { return this.entries.has(actor) && this.require(actor).admitted; }
  slot(actor: ActorId): number | null {
    const client = this.operations.services.forActor(actor);
    if (client === null) return this.entries.has(actor) ? this.require(actor).slot : null;
    const previous = this.entries.get(actor);
    if (previous !== undefined) { this.require(actor); return previous.slot; }
    const used = new Set([...this.entries.values()].map(entry => entry.slot));
    for (const slot of this.operations.reservedSlots?.() ?? []) used.add(slot);
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
    this.operations.admitted?.(actor);
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
        try { this.operations.release(actor); } finally { this.entries.delete(actor); }
      }
      return undefined;
    });
    for (const identity of this.operations.services.clients()) this.admit(identity.actor);
    this.unsubscribeInput = subscribeModClientInput(this.operations.services, this.operations.declaration.input ?? [], {
      open: application => {
        const entry = this.require(application.identity.actor);
        if (!entry.admitted) throw new Error("QVM input callback requires admitted source client state");
        this.applications.push(application);
        return () => { const index = this.applications.indexOf(application); if (index !== -1) this.applications.splice(index, 1); };
      },
      invoke: (call, application) => {
        this.require(application.identity.actor);
        this.operations.invoke(call, application.identity.actor, application);
      },
    });
  }
  restore(entries: readonly QvmModClientSlot[]): void {
    this.entries.clear();
    for (const entry of entries) this.entries.set(entry.actor, { ...entry, client: this.operations.services.forActor(entry.actor) });
  }
  checkpoint(): readonly QvmModClientSlot[] {
    if (this.applications.length !== 0) throw new Error("Cannot save during QVM component input application");
    return [...this.entries.values()].map(({ actor, slot, admitted }) => ({ actor, slot, admitted }));
  }
  forget(actor: ActorId): void { this.entries.delete(actor); }
  close(): void {
    try { this.unsubscribeInput?.(); }
    finally { this.unsubscribeInput = null; this.unsubscribe?.(); this.unsubscribe = null; this.applications.length = 0; this.entries.clear(); }
  }

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
  private applied(actor: ActorId): ModClientApplication | undefined {
    for (let index = this.applications.length - 1; index >= 0; index--) {
      const application = this.applications[index];
      if (application?.identity.actor.equals(actor)) return application;
    }
    return undefined;
  }
  getUserCommand(slot: number): ReturnType<QvmClientGameServices["getUserCommand"]> {
    const entry = this.at(slot);
    const application = entry === null ? undefined : this.applied(entry.actor);
    if (application !== undefined && entry !== null) {
      const ps = this.operations.playerState(entry.actor), time = application.frame.time;
      const command = q3CommandForControls({ command: application.command }, time.kind === "seconds" ? time.value * 1000 : time.value,
        { requestedWeapon: ps.weapon, useHoldable: application.command.kind === "q3" && (application.command.buttons & 4) !== 0 });
      const words = (angle: number): number => Math.trunc(angle * 65536 / 360) & 65535;
      return { ...command, angles: [words(application.absoluteAim.x) - ps.deltaAngleWords[0],
        words(application.absoluteAim.y) - ps.deltaAngleWords[1], words(application.absoluteAim.z) - ps.deltaAngleWords[2]] };
    }
    const accepted = entry?.client == null ? null : this.operations.services.command(entry.client);
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
