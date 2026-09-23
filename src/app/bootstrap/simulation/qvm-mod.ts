import type { ContentDigest } from "../../../contracts/content.ts";
import type { ModDescription } from "../../../contracts/mods.ts";
import { modInstanceProvider } from "../../../contracts/mods.ts";
import type { QvmModCallbackDeclaration } from "../../../contracts/qvm-mod-callbacks.ts";
import type { MountedContent } from "../../../content/mounts/index.ts";
import type { PreparedMod } from "../../../world/session/mods.ts";
import { borrowModFileMounts } from "../../../world/session/mod-files.ts";
import { resolveQvmArtifact } from "../../../compat/qvm/artifacts.ts";
import { QvmModProvider, validateQvmMod, validateQvmModCheckpoint } from "../../../compat/qvm/mod-provider.ts";
import { validateQvmModPresentation } from "../../../compat/qvm/mod-presentation.ts";
import { registerModCallbacks } from "./mod-callbacks.ts";

export interface PrepareQvmModOptions {
  readonly description: ModDescription;
  readonly declaration: QvmModCallbackDeclaration;
  readonly declarationDigest: ContentDigest;
  readonly program: Uint8Array;
  readonly presentationProgram?: Uint8Array;
  readonly mounts?: MountedContent;
}
export async function prepareMountedQvmMod(options: Omit<PrepareQvmModOptions, "program" | "presentationProgram" | "mounts"> & { readonly mounts: MountedContent }): Promise<PreparedMod> {
  const program = await options.mounts.open(options.declaration.program.path);
  if (program === null || program.reference.digest !== options.declaration.program.digest) throw new Error("Selected QVM mod differs from its resolved artifact");
  const presentation = options.declaration.presentation;
  if (presentation !== undefined) {
    const cgame = await options.mounts.open(presentation.cgame.path);
    if (cgame === null || cgame.reference.digest !== presentation.cgame.digest) throw new Error("Selected QVM mod presentation differs from its resolved artifact");
    return prepareQvmMod({ ...options, program: program.bytes, presentationProgram: cgame.bytes });
  }
  return prepareQvmMod({ ...options, program: program.bytes });
}
export function prepareQvmMod(options: PrepareQvmModOptions): PreparedMod {
  const { description, declaration, declarationDigest } = options;
  const module = { id: modInstanceProvider(description.selection), artifactPath: declaration.program.path, digest: declaration.program.digest, revision: declarationDigest };
  const artifact = resolveQvmArtifact({ module, role: "qagame", bytes: options.program, abiProfile: declaration.abiProfile });
  if (artifact.kind !== "bytecode") throw new Error("Gameplay mod callbacks require their authored QVM executable");
  validateQvmMod(artifact, declaration);
  let presentation: PreparedMod["presentation"];
  if (declaration.presentation !== undefined) {
    if (options.presentationProgram === undefined) throw new Error("Declared QVM mod presentation requires its authored cgame bytes");
    if (declaration.presentation.gameplay.abiProfile !== declaration.abiProfile) throw new Error("QVM mod presentation differs from its gameplay ABI");
    const cgame = declaration.presentation.cgame;
    const presentationArtifact = resolveQvmArtifact({ module: { ...module, artifactPath: cgame.path, digest: cgame.digest },
      role: "cgame", bytes: options.presentationProgram, abiProfile: cgame.abiProfile });
    if (presentationArtifact.kind !== "bytecode") throw new Error("Mod presentation requires its authored QVM executable");
    presentation = { kind: "qvm", artifact: presentationArtifact, source: module, declaration: declaration.presentation };
    validateQvmModPresentation(presentation);
  } else if (options.presentationProgram !== undefined) throw new Error("QVM mod presentation bytes require a declaration");
  return { description, identity: { selection: description.selection, source: description.source, declarationDigest, modules: [module], providers: [] },
    ...(presentation === undefined ? {} : { presentation }),
    validateState(state) {
      const guest = state.guests[0];
      if (state.guests.length !== 1 || state.providers.length !== 0 || guest?.kind !== "qvm") throw new Error("Missing QVM gameplay mod checkpoint");
      validateQvmModCheckpoint(artifact, declaration, guest);
    },
    async initialize(context) {
      if (context.services === null) throw new Error("QVM gameplay mods require destination world services");
      const services = context.services, writable = services.files?.for(description.selection) ?? null;
      const mounts = writable === null ? options.mounts : borrowModFileMounts(description.selection, description.source.content, options.mounts, writable);
      if (mounts !== undefined && mounts !== options.mounts) context.resources.defer(() => { mounts.close(); return undefined; });
      const source = new QvmModProvider(artifact, declaration, services, context.assertCurrent, description.source.content, mounts, writable);
      context.resources.own(source);
      source.reserveProtection();
      if (services.commands !== undefined) source.bindCommands(services.commands.bind({ selection: description.selection, module, cvars: source.cvars,
        invoke: command => source.consoleCommand(command), readScript: name => source.readScript(name) }, context.resources));
      if (context.restoring !== true) await source.initialize();
      context.assertCurrent();
      return {
        qvmPresentation() { return source.presentationSource; },
        activate() { source.activateProtection(); return undefined; },
        register(registrations) { return registerModCallbacks(declaration.callbacks, registrations, () => services.time(), (callback, inputs) => source.invoke(callback, inputs)); },
        advance(frame) { return source.advance(frame); },
        presentations() { return source.presentations(); },
        async checkpoint() { return { guests: [source.checkpoint()], providers: [] }; },
        async restore(state) { const guest = state.guests[0]; if (guest?.kind !== "qvm") throw new Error("Missing QVM mod checkpoint"); source.restore(guest); },
        close() { return source.close(); },
      };
    },
  };
}
