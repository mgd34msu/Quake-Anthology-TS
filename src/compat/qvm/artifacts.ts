import { createContentDigest } from "../../contracts/content.ts";
import type { ContentDigest } from "../../contracts/content.ts";
import type { ModuleIdentity, QvmAbiProfile } from "../../contracts/execution.ts";
import type { ProviderId } from "../../contracts/identity.ts";
import { parseQvm } from "./image.ts";
import type { QvmImage } from "./image.ts";
import type { QvmArguments } from "./interpreter.ts";
import type { QvmHost, QvmRole } from "./syscalls.ts";

export interface KnownQvmArtifact {
  readonly role: QvmRole;
  readonly product: "baseq3" | "missionpack";
  readonly referencePackage: string;
  readonly relatedGameBuildDate: string;
  readonly byteLength: number;
  readonly digest: ContentDigest;
}

/** These are donor-observed artifact identities, not claims of parity with every source revision. */
export const knownQvmArtifacts: readonly KnownQvmArtifact[] = [
  { role: "ui", product: "baseq3", referencePackage: "baseq3/pak8", relatedGameBuildDate: "2002-09-30", byteLength: 278308, digest: "sha256:3a6fd12b889f5d35df20a09b51bf8eca46966d014be55ffad38ddc2ffb38c807" },
  { role: "cgame", product: "baseq3", referencePackage: "baseq3/pak8", relatedGameBuildDate: "2002-09-30", byteLength: 325220, digest: "sha256:4ea18569bf56a282d26dc89eb9efcc5eedbe0b69c10182fc38446174c1e55b49" },
  { role: "qagame", product: "baseq3", referencePackage: "baseq3/pak8", relatedGameBuildDate: "2002-09-30", byteLength: 469796, digest: "sha256:57c52bf22e4f528c064f8af1553a7103723bab0a02276bb11eed944bf829b219" },
  { role: "ui", product: "missionpack", referencePackage: "missionpack/pak0", relatedGameBuildDate: "2000-12-04", byteLength: 272040, digest: "sha256:7b157f32acdb21a3904d078296672ed2d32195c5b7a206922f6f7d33c6c40e40" },
  { role: "cgame", product: "missionpack", referencePackage: "missionpack/pak0", relatedGameBuildDate: "2000-12-04", byteLength: 442304, digest: "sha256:09d0b6eb41ea623d67031d2d7a73058ccb3bc6556ec044ead529d48b58d15f4c" },
  { role: "qagame", product: "missionpack", referencePackage: "missionpack/pak0", relatedGameBuildDate: "2000-12-04", byteLength: 547700, digest: "sha256:da041f17f296feeaf8269eabc9062cefdecddfd24ff4d84eb291902e527d1d8a" },
];

export interface QvmReplacementInstance {
  readonly invoke: (arguments_: QvmArguments) => number;
  readonly shutdown: () => undefined;
}
export interface QvmReplacement {
  readonly artifact: KnownQvmArtifact;
  readonly implementation: ProviderId;
  readonly create: (module: ModuleIdentity, host: QvmHost) => QvmReplacementInstance;
}
export type ResolvedQvmArtifact = { readonly abiProfile?: QvmAbiProfile; readonly module: ModuleIdentity; readonly role: QvmRole; readonly known: KnownQvmArtifact | null } & (
  | { readonly kind: "bytecode"; readonly image: QvmImage }
  | { readonly kind: "typescript"; readonly replacement: QvmReplacement }
);

/** Caller supplies resolved archive provenance in ModuleIdentity; names alone never select game code. */
export function resolveQvmArtifact(options: {
  readonly module: ModuleIdentity;
  readonly role: QvmRole;
  readonly bytes: Uint8Array;
  readonly replacements?: readonly QvmReplacement[];
  readonly abiProfile?: QvmAbiProfile;
}): ResolvedQvmArtifact {
  if (options.abiProfile === "q3-1.16n-base" && options.role !== "qagame") throw new Error("Legacy QVM client and UI profiles are not implemented");
  const digest = createContentDigest(new Bun.CryptoHasher("sha256").update(options.bytes).digest("hex"));
  if (options.module.digest !== digest) throw new Error("QVM artifact bytes do not match their module identity");
  const known = knownQvmArtifacts.find(entry => entry.digest === digest && entry.byteLength === options.bytes.length) ?? null;
  if (known !== null && known.role !== options.role) throw new Error(`QVM artifact is ${known.role}, requested ${options.role}`);
  const replacement = options.replacements?.find(entry => entry.artifact.digest === digest
    && entry.artifact.role === options.role && entry.artifact.byteLength === options.bytes.length);
  if (replacement !== undefined) return { kind: "typescript", module: options.module, role: options.role, known, replacement };
  return { kind: "bytecode", abiProfile: options.abiProfile ?? "q3-modern", module: options.module, role: options.role, known, image: parseQvm(options.bytes, options.module.artifactPath) };
}
