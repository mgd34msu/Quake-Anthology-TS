import type { ModuleIdentity } from "../../../contracts/execution.ts";
import type { ResolvedExecutionModule } from "../../../contracts/content.ts";
import type { MountedContent } from "../../../content/mounts/index.ts";
import { parsePe } from "../../../guest/pe/index.ts";
import { builtinNativePrimary, type NativePrimaryProfile } from "../../../compat/q2/native-primary.ts";
import type { ClassicGuestWorld } from "./classic-guest-world.ts";
import type { RereleaseGuestWorld } from "./rerelease-guest-world.ts";
import { prepareClassicGuest, type PreparedClassicGuest } from "./classic-guest-source.ts";
import { prepareRereleaseGuest, type PreparedRereleaseGuest } from "./rerelease-guest-source.ts";

export type Q2NativeWorld = ClassicGuestWorld | RereleaseGuestWorld;
export type PreparedQ2NativeGuest = PreparedClassicGuest | PreparedRereleaseGuest;

type NativeExecution = Extract<ResolvedExecutionModule, { readonly kind: "native" }>;

/** Prepare a Q2 guest from its artifact alone: the PE header decides the
 * edition (i386 classic API vs x86-64 rerelease API), so a custom DLL
 * hosted by any product runs under the guest matching its own ABI. The
 * prepared execution carries the corrected api/profile. */
export async function prepareQ2Guest(execution: NativeExecution, mounts: MountedContent): Promise<PreparedQ2NativeGuest> {
  if (execution.role !== "server-game") throw new Error("Q2 guest preparation requires a server-game artifact");
  const pe = parsePe(await mounts.read(execution.artifact));
  return pe.abi.kind === "windows-x86-64"
    ? prepareRereleaseGuest({ ...execution, api: { kind: "q2-rerelease-game", version: 2023 }, profile: pe.abi }, mounts)
    : prepareClassicGuest({ ...execution, api: { kind: "q2-classic-game", version: 3 }, profile: pe.abi }, mounts);
}

export function nativeModuleIdentity(prepared: PreparedQ2NativeGuest): ModuleIdentity {
  const execution = prepared.execution;
  return { id: execution.owner.provider, artifactPath: execution.artifact.requestedPath, digest: execution.artifact.digest,
    revision: prepared.primary === undefined ? execution.artifact.digest : `${execution.artifact.digest}/${prepared.primary.declaration.requestedPath}/${prepared.primary.declaration.digest}` };
}
const primaryProfiles = new WeakMap<PreparedQ2NativeGuest, NativePrimaryProfile | null>();
export function preparedNativePrimary(prepared: PreparedQ2NativeGuest): NativePrimaryProfile | null {
  if (prepared.primary !== undefined) return prepared.primary.profile;
  if (primaryProfiles.has(prepared)) return primaryProfiles.get(prepared) ?? null;
  const profile = builtinNativePrimary(prepared.execution.artifact.digest, prepared.edition);
  primaryProfiles.set(prepared, profile); return profile;
}
