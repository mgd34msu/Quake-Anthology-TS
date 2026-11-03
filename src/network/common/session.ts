import { createHash } from "node:crypto";
import { createContentDigest } from "../../contracts/content.ts";
import type { ContentDigest, ExecutableRecipe } from "../../contracts/content.ts";
import type { ProviderId } from "../../contracts/identity.ts";
import type { ProtocolIdentity } from "../../contracts/protocol.ts";
import type { ActorConfiguration } from "../../contracts/session.ts";
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
