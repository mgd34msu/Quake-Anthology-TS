import { createHash } from "node:crypto";
import { createContentDigest } from "../../contracts/content.ts";
import type { ContentDigest, ExecutableRecipe } from "../../contracts/content.ts";
import type { ClientId, IdentityOwner, ProviderId, SeatId, SessionId } from "../../contracts/identity.ts";
import type { ProtocolIdentity } from "../../contracts/protocol.ts";
import type { ActorConfiguration, SimulationEvent } from "../../contracts/session.ts";
import { sameAddress } from "./endpoint.ts";
import type { NetworkAddress } from "./endpoint.ts";
import { isRecord, isUnknownArray } from "./value.ts";

export interface SessionComposition {
  readonly schemaVersion: 1;
  /** Includes mount precedence, executable byte identities, numeric profiles and timing. */
  readonly recipe: ExecutableRecipe;
  readonly snapshotSchema: ProviderId;
  readonly actorConfigurations: readonly { readonly slot: number; readonly generation: number; readonly configuration: Omit<ActorConfiguration, "actor"> }[];
}
export interface CompositionIdentity { readonly digest: ContentDigest; readonly composition: SessionComposition; }
export type WireSelection =
  | { readonly kind: "unified"; readonly version: 1; readonly composition: ContentDigest; readonly snapshotSchema: ProviderId }
  | { readonly kind: "source"; readonly protocol: ProtocolIdentity };
export type WireAdmission = { readonly kind: "supported" } | { readonly kind: "unsupported"; readonly reasons: readonly string[] };
export interface SourceWireCapability { supports(composition: SessionComposition, protocol: ProtocolIdentity): WireAdmission; }

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError("Composition identity contains a non-finite number");
    return Object.is(value, -0) ? "-0" : String(value);
  }
  if (isUnknownArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    const fields = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${fields.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  throw new TypeError("Composition identity contains a non-serializable value");
}

export function compositionIdentity(composition: SessionComposition): CompositionIdentity {
  const owned = structuredClone(composition);
  return { digest: createContentDigest(createHash("sha256").update(canonical(owned)).digest("hex")), composition: owned };
}

/** The initial offer carries the complete canonical composition; it is never a legacy packet. */
export function encodeCompositionOffer(identity: CompositionIdentity): Uint8Array {
  const payload = new TextEncoder().encode(canonical(identity.composition));
  const bytes = new Uint8Array(payload.length + 10), header = new DataView(bytes.buffer);
  bytes.set([81, 84, 83, 85]); header.setUint16(4, 1, true); header.setUint32(6, payload.length, true); bytes.set(payload, 10);
  return bytes;
}

/** A client resolves the proposed content locally and compares every byte before admitting it. */
export function admitCompositionOffer(local: CompositionIdentity, bytes: Uint8Array): WireAdmission {
  if (bytes.length < 10 || bytes[0] !== 81 || bytes[1] !== 84 || bytes[2] !== 83 || bytes[3] !== 85) return { kind: "unsupported", reasons: ["Not a unified composition offer"] };
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint16(4, true) !== 1 || header.getUint32(6, true) !== bytes.length - 10) return { kind: "unsupported", reasons: ["Invalid unified composition version or length"] };
  const digest = createContentDigest(createHash("sha256").update(bytes.subarray(10)).digest("hex"));
  return digest === local.digest ? { kind: "supported" } : { kind: "unsupported", reasons: ["Content, executable, numeric, actor or snapshot composition differs"] };
}
export function admitWire(identity: CompositionIdentity, selection: WireSelection, source: SourceWireCapability): WireAdmission {
  if (selection.kind === "source") return source.supports(identity.composition, selection.protocol);
  const reasons: string[] = [];
  if (selection.composition !== identity.digest) reasons.push("Session composition differs");
  if (selection.snapshotSchema !== identity.composition.snapshotSchema) reasons.push("Snapshot schema differs");
  return reasons.length === 0 ? { kind: "supported" } : { kind: "unsupported", reasons };
}

export type ClientAttachment =
  | { readonly kind: "local"; readonly seat: SeatId; readonly endpoint: NetworkAddress }
  | { readonly kind: "remote"; readonly endpoint: NetworkAddress; readonly remoteSeats: readonly { readonly seat: SeatId; readonly index: number }[] }
  | { readonly kind: "headless"; readonly endpoint: NetworkAddress };
export type ConnectionPhase = "connected" | "primed" | "active";
export interface SessionClient {
  readonly id: ClientId;
  readonly attachment: ClientAttachment;
  readonly wire: WireSelection;
  readonly phase: ConnectionPhase;
  readonly connectedAt: number;
  readonly lastReceivedAt: number;
}
interface ClientRecord { value: SessionClient; readonly events: SimulationEvent[]; }

/** Session identity authority stays with the engine. This table accepts caller-issued ClientIds. */
export class NetworkSession {
  private readonly clients = new Map<number, ClientRecord>();
  private ended = false;
  constructor(private readonly identities: IdentityOwner, readonly identity: CompositionIdentity, readonly source: SourceWireCapability) {}
  get session(): SessionId { return this.identities.session; }
  private opened(): void { if (this.ended) throw new Error("Network session is closed"); }
  private record(id: ClientId): ClientRecord {
    this.opened();
    const record = this.clients.get(id.slot);
    if (!this.identities.owns(id) || record === undefined || !record.value.id.equals(id)) throw new Error("Client is stale or belongs to another network session");
    return record;
  }
  connect(id: ClientId, attachment: ClientAttachment, wire: WireSelection, now: number): WireAdmission {
    this.opened();
    if (!this.identities.owns(id) || this.clients.has(id.slot)) throw new Error("Client slot is foreign or already connected");
    if (attachment.kind === "local") {
      if (!this.identities.owns(attachment.seat)) throw new Error("Seat belongs to another session");
      for (const record of this.clients.values()) {
        if (record.value.attachment.kind === "local" && record.value.attachment.seat.equals(attachment.seat)) throw new Error("Seat is already connected");
      }
    }
    if (attachment.kind === "remote" && (new Set(attachment.remoteSeats.map(seat => seat.index)).size !== attachment.remoteSeats.length
      || new Set(attachment.remoteSeats.map(seat => seat.seat.index)).size !== attachment.remoteSeats.length
      || attachment.remoteSeats.some(seat => !Number.isSafeInteger(seat.index) || seat.index < 0 || !this.identities.owns(seat.seat)))) throw new RangeError("Invalid remote seat bindings");
    const assigned = attachment.kind === "local" ? [attachment.seat] : attachment.kind === "remote" ? attachment.remoteSeats.map(seat => seat.seat) : [];
    for (const record of this.clients.values()) {
      const existing = record.value.attachment;
      const seats = existing.kind === "local" ? [existing.seat] : existing.kind === "remote" ? existing.remoteSeats.map(seat => seat.seat) : [];
      if (seats.some(seat => assigned.some(candidate => candidate.equals(seat)))) throw new Error("Seat already belongs to a connected client");
    }
    const result = admitWire(this.identity, wire, this.source);
    if (result.kind === "unsupported") return result;
    this.clients.set(id.slot, { value: { id, attachment, wire, phase: "connected", connectedAt: now, lastReceivedAt: now }, events: [] });
    return result;
  }
  get(id: ClientId): SessionClient { return this.record(id).value; }
  list(): readonly SessionClient[] { this.opened(); return [...this.clients.values()].map(record => record.value); }
  prime(id: ClientId): void {
    const record = this.record(id);
    if (record.value.phase !== "connected") throw new Error("Client is not awaiting gamestate");
    record.value = { ...record.value, phase: "primed" };
  }
  activate(id: ClientId): void {
    const record = this.record(id);
    if (record.value.phase !== "primed") throw new Error("Client has not received gamestate");
    record.value = { ...record.value, phase: "active" };
  }
  received(id: ClientId, now: number): void { const record = this.record(id); record.value = { ...record.value, lastReceivedAt: now }; }
  /** qport matching remains in each wire adapter; only an authenticated match calls this. */
  rebind(id: ClientId, endpoint: NetworkAddress): void {
    const record = this.record(id), previous = record.value.attachment;
    if (!sameAddress(previous.endpoint, endpoint, false)) throw new Error("Port rebinding cannot change base address");
    record.value = { ...record.value, attachment: { ...previous, endpoint } };
  }
  route(event: SimulationEvent): void {
    this.opened();
    for (const record of this.clients.values()) {
      const { id, attachment } = record.value, audience = event.audience;
      if (audience.kind === "world" || (audience.kind === "client" && id.equals(audience.client))
        || (audience.kind === "seat" && ((attachment.kind === "local" && attachment.seat.equals(audience.seat))
          || (attachment.kind === "remote" && attachment.remoteSeats.some(seat => seat.seat.equals(audience.seat)))))) record.events.push(event);
    }
  }
  drain(id: ClientId): readonly SimulationEvent[] { return this.record(id).events.splice(0); }
  expired(now: number, timeoutMilliseconds: number): readonly ClientId[] {
    return this.list().filter(client => client.attachment.kind !== "local" && now - client.lastReceivedAt > timeoutMilliseconds).map(client => client.id);
  }
  disconnect(id: ClientId): void { this.record(id); this.clients.delete(id.slot); }
  close(): void { if (!this.ended) { this.ended = true; this.clients.clear(); } }
}
