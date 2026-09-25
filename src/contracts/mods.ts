import type { ContentDigest, ProviderReference } from "./content.ts";
import type { GuestCheckpoint, ModuleIdentity } from "./execution.ts";
import type { ProviderId } from "./identity.ts";
import type { ProviderCheckpoint } from "./session.ts";
import type { ModCallbackDeclaration } from "./mod-callbacks.ts";
import type { QvmModCallbackDeclaration } from "./qvm-mod-callbacks.ts";
import type { NativeModDeclaration } from "./native-mod-callbacks.ts";

/** The selected package and its authored component remain independent of the destination game. */
export interface ModSelection {
  readonly product: string;
  readonly id: string;
}

export interface ModDescription {
  readonly selection: ModSelection;
  readonly source: ProviderReference;
  readonly title: string;
  readonly sourceTitle: string;
  readonly purpose: "game-type" | "addition";
  readonly requires: readonly ModSelection[];
  readonly conflicts: readonly ModSelection[];
  readonly availability: { readonly kind: "available" } | { readonly kind: "unavailable"; readonly reason: string };
}

export interface ResolvedGameplayMod extends Pick<ModDescription, "selection" | "source" | "title" | "sourceTitle" | "requires" | "conflicts"> {
  readonly declaration: ModCallbackDeclaration | QvmModCallbackDeclaration | NativeModDeclaration;
  readonly declarationDigest: ContentDigest;
}

/** Instance ownership includes the complete selection; source provenance remains separate. */
export function modInstanceProvider(selection: ModSelection): ProviderId {
  return `mod:${encodeURIComponent(modSelectionKey(selection))}`;
}

export interface ModIdentity {
  readonly selection: ModSelection;
  readonly source: ProviderReference;
  readonly declarationDigest: ContentDigest;
  readonly modules: readonly ModuleIdentity[];
  readonly providers: readonly Omit<ProviderCheckpoint, "bytes">[];
}

/** These are the existing source formats, retained independently for each mod instance. */
export interface ModPrivateCheckpoint {
  readonly guests: readonly GuestCheckpoint[];
  readonly providers: readonly ProviderCheckpoint[];
}

export interface ModCheckpoint {
  readonly identity: ModIdentity;
  readonly state: ModPrivateCheckpoint;
}

export interface ModSessionCheckpoint {
  readonly version: 1;
  readonly mods: readonly ModCheckpoint[];
}

export interface ModTravelCheckpoint {
  readonly version: 1;
  readonly mods: readonly { readonly identity: ModIdentity; readonly state: ModPrivateCheckpoint | null }[];
}

export function modSelectionKey(selection: ModSelection): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(selection.product)
    || !/^[a-zA-Z0-9][a-zA-Z0-9._+:/-]*$/.test(selection.id)) {
    throw new Error("Mod selection requires a package and an authored component ID");
  }
  return `${selection.product}/${selection.id}`;
}

export function readModSelection(value: string): ModSelection {
  const slash = value.indexOf("/");
  const selection = { product: value.slice(0, slash), id: value.slice(slash + 1) };
  if (slash < 1 || modSelectionKey(selection) !== value) throw new Error("Mod selection must be PRODUCT/COMPONENT_ID");
  return selection;
}

export function sameModIdentity(left: ModIdentity, right: ModIdentity): boolean {
  return modSelectionKey(left.selection) === modSelectionKey(right.selection)
    && left.source.provider === right.source.provider && left.source.content === right.source.content
    && left.declarationDigest === right.declarationDigest && left.modules.length === right.modules.length
    && left.modules.every((module, index) => { const other = right.modules[index]; return other !== undefined && module.id === other.id && module.artifactPath === other.artifactPath && module.digest === other.digest && module.revision === other.revision; })
    && left.providers.length === right.providers.length && left.providers.every((provider, index) => {
      const other = right.providers[index];
      return other !== undefined && provider.provider === other.provider && provider.schema === other.schema && provider.version === other.version;
    });
}
