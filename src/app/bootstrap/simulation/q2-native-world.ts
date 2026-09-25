import type { ModuleIdentity } from "../../../contracts/execution.ts";
import { builtinNativePrimary, type NativePrimaryProfile } from "../../../compat/q2/native-primary.ts";
import type { ClassicGuestWorld } from "./classic-guest-world.ts";
import type { RereleaseGuestWorld } from "./rerelease-guest-world.ts";
import type { PreparedClassicGuest } from "./classic-guest-source.ts";
import type { PreparedRereleaseGuest } from "./rerelease-guest-source.ts";

export type Q2NativeWorld = ClassicGuestWorld | RereleaseGuestWorld;
export type PreparedQ2NativeGuest = PreparedClassicGuest | PreparedRereleaseGuest;

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
