import { createHash } from "node:crypto";
import type { ContentDigest, ResolvedExecutionModule, ResolvedResourceReference } from "../../../contracts/content.ts";
import type { ModDescription } from "../../../contracts/mods.ts";
import { modInstanceProvider } from "../../../contracts/mods.ts";
import type { NativeModDeclaration } from "../../../contracts/native-mod-callbacks.ts";
import type { MountedContent } from "../../../content/mounts/index.ts";
import type { PreparedMod } from "../../../world/session/mods.ts";
import { parsePe } from "../../../guest/pe/index.ts";
import { NativeModProvider, validateNativeModCheckpoint, validateNativeModDeclaration } from "../../../compat/q2/native-mod-provider.ts";
import { loadServerLocalizationResources } from "../../../text/localization-resources.ts";
import { q2LocalizedText } from "../q2-localization.ts";
import { createNativeModHost } from "./native-mod-host.ts";
import { registerModCallbacks } from "./mod-callbacks.ts";

export interface PrepareNativeModOptions {
  readonly description: ModDescription;
  readonly declaration: NativeModDeclaration;
  readonly declarationDigest: ContentDigest;
  readonly program: Uint8Array;
  readonly artifact: ResolvedResourceReference;
  localize(key: string, arguments_: readonly string[]): string;
}
export async function prepareMountedNativeMod(options: Pick<PrepareNativeModOptions, "description" | "declaration" | "declarationDigest"> & { readonly mounts: MountedContent }): Promise<PreparedMod> {
  const resource = await options.mounts.open(options.declaration.program.path);
  if (resource === null || resource.reference.digest !== options.declaration.program.digest) throw new Error("Selected native mod differs from its resolved artifact");
  const localization = await loadServerLocalizationResources("english", async path => (await options.mounts.open(path))?.bytes ?? null, "q2-rerelease");
  return prepareNativeMod({ ...options, program: resource.bytes, artifact: resource.reference, localize: (key, arguments_) => q2LocalizedText(localization, key, arguments_) });
}
export function prepareNativeMod(options: PrepareNativeModOptions): PreparedMod {
  const { description, declaration, declarationDigest } = options; validateNativeModDeclaration(declaration);
  if (options.artifact.digest !== declaration.program.digest || options.artifact.requestedPath !== declaration.program.path
    || `sha256:${createHash("sha256").update(options.program).digest("hex")}` !== declaration.program.digest
    || !((parsePe(options.program).abi.kind === "windows-i386" && declaration.target.api.kind === "q2-classic-game")
      || (parsePe(options.program).abi.kind === "windows-x86-64" && declaration.target.api.kind === "q2-rerelease-game"))) throw new Error("Native mod artifact or ABI differs from its declaration");
  const instance = modInstanceProvider(description.selection), source = { ...description.source, provider: instance };
  const module = { id: instance, artifactPath: declaration.program.path, digest: declaration.program.digest, revision: declaration.program.digest };
  const execution: Extract<ResolvedExecutionModule, { readonly kind: "native" }> = { kind: "native", owner: source, role: "server-game",
    api: declaration.target.api, profile: declaration.target.abi, artifact: options.artifact };
  const prepared = declaration.target.api.kind === "q2-classic-game" ? { edition: "classic", execution, bytes: options.program } satisfies import("./classic-guest-source.ts").PreparedClassicGuest
    : { edition: "rerelease", execution, bytes: options.program } satisfies import("./rerelease-guest-source.ts").PreparedRereleaseGuest;
  return { description, moduleCheckpoint: "provider", identity: { selection: description.selection, source: description.source, declarationDigest, modules: [module], providers: [{ provider: instance, schema: "native:mod", version: 1 }] },
    validateState(state) { const record = state.providers[0];
      if (state.guests.length !== 0 || state.providers.length !== 1 || record === undefined) throw new Error("Missing native gameplay mod checkpoint");
      validateNativeModCheckpoint(record, module, declaration);
    },
    async initialize(context) {
      const services = context.services;
      if (services === null || services.native === undefined) throw new Error("Native gameplay mods require the destination's native engine context");
      const native = services.native;
      const provider = new NativeModProvider(declaration, services, instance, native.mapPath, context.assertCurrent); context.resources.own(provider);
      const host = createNativeModHost({ prepared, declaration, source, services, context: native, projection: provider, localize: options.localize, nextFrame: context.nextFrame });
      provider.attach(host); await provider.initialize(context.restoring); context.assertCurrent();
      return { register: registrations => registerModCallbacks(declaration.callbacks, registrations, () => services.time(), (callback, inputs) => provider.invoke(callback, inputs)),
        async checkpoint() { return { guests: [], providers: [await provider.checkpoint()] }; },
        async restore(state) { const record = state.providers[0]; if (record === undefined) throw new Error("Missing native gameplay mod checkpoint"); await provider.restore(record); },
        advance: frame => provider.advance(frame), presentations: () => provider.presentations(),
        appearanceOverrides: () => provider.appearanceOverrides(),
        close: () => provider.close() };
    } };
}
