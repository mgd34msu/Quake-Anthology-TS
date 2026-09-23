import type { ContentDigest, ResolvedResourceReference } from "../../../contracts/content.ts";
import type { Bounds } from "../../../contracts/math.ts";
import type { ModCallbackDeclaration } from "../../../contracts/mod-callbacks.ts";
import type { ModDescription } from "../../../contracts/mods.ts";
import { modInstanceProvider } from "../../../contracts/mods.ts";
import type { PreparedMod } from "../../../world/session/mods.ts";
import { QcModProvider, validateQcMod } from "../../../compat/qc/mod-provider.ts";
import { loadQcProgram } from "../../../compat/qc/program.ts";
import { SourceRandom } from "./random.ts";
import { prepareQuakeCResources } from "./quakec-source.ts";
import type { MountedContent } from "../../../content/mounts/index.ts";
import type { QcModMedia } from "../../../compat/qc/mod-provider.ts";

import { registerModCallbacks } from "./mod-callbacks.ts";

export interface PrepareQuakeCModOptions {
  readonly description: ModDescription;
  readonly declaration: ModCallbackDeclaration;
  readonly declarationDigest: ContentDigest;
  readonly program: Uint8Array;
  readonly resources?: QcModMedia["resources"];
  readScript?(name: string): Promise<string | undefined>;
}

export async function prepareMountedQuakeCMod(options: Omit<PrepareQuakeCModOptions, "program" | "resources"> & { readonly mounts: MountedContent }): Promise<PreparedMod> {
  const artifact = await options.mounts.open(options.declaration.program.path);
  if (artifact === null || artifact.reference.digest !== options.declaration.program.digest) throw new Error("Selected mod program differs from its resolved artifact");
  const resources = await prepareQuakeCResources(loadQcProgram(artifact.bytes), options.mounts);
  return prepareQuakeCMod({ ...options, program: artifact.bytes, resources, readScript: async name => {
    const script = await options.mounts.open(name); return script === null ? undefined : new TextDecoder().decode(script.bytes);
  } });
}

export function prepareQuakeCMod(options: PrepareQuakeCModOptions): PreparedMod {
  const { description, declaration, declarationDigest } = options, program = loadQcProgram(options.program);
  validateQcMod(program, declaration);
  const module = { id: modInstanceProvider(description.selection), artifactPath: declaration.program.path, digest: program.digest, revision: declarationDigest };
  return { description, ...(declaration.clientPresentation === undefined ? {} : { clientPresentation: { hud: declaration.clientPresentation.hud === "none" ? "none" : "replace", view: declaration.clientPresentation.view !== "none" } }), identity: { selection: description.selection, source: description.source, declarationDigest, modules: [module], providers: [] },
    validateState(state) {
      const guest = state.guests[0];
      if (state.guests.length !== 1 || state.providers.length !== 0 || guest?.kind !== "quakec" || guest.module.id !== module.id || guest.module.digest !== program.digest
        || guest.api.kind !== program.api.kind || guest.globals.length !== program.initialGlobals.length || guest.functionIndex !== 0
        || guest.callStack.length !== 0 || guest.locals.length !== 0 || guest.hostState.format !== "quakec:host-v1")
        throw new Error("Incompatible QuakeC gameplay mod checkpoint");
    },
    async initialize(context) {
      const services = context.services;
      if (services === null) throw new Error("QuakeC gameplay mods require destination world services");
      const random = new SourceRandom(services.seed);
      const source = new QcModProvider(program, module, declaration, services, {
        nextInteger: () => random.nextInteger(), nextUnit: () => random.nextUnit(), checkpoint: () => random.checkpoint(),
        restore: state => { if (state.kind !== "glibc-random") throw new Error("Invalid QuakeC mod random state"); return random.restore(state); },
      }, { content: description.source.content, resources: options.resources ?? new Map<string, { readonly resource: ResolvedResourceReference; readonly modelBounds: Bounds | null }>() });
      context.resources.own(source);
      if (services.commands !== undefined) source.bindCommands(services.commands.bind({ selection: description.selection, module, cvars: source.cvars,
        names: declaration.commands?.map(command => command.name) ?? [], invoke: command => source.consoleCommand(command),
        ...(options.readScript === undefined ? {} : { readScript: options.readScript }) }, context.resources));
      if (context.restoring !== true) source.initialize();
      return {
        register(registrations) {
          return registerModCallbacks(declaration.callbacks, registrations, () => services.time(), (callback, inputs) => {
            context.assertCurrent(); return source.invoke(callback, inputs);
          });
        },
        async checkpoint() { return { guests: [source.checkpoint()], providers: [] }; },
        advance(frame) { return source.advance(frame); },
        presentations() { return source.presentations(); },
        clientPresentation: () => source.clientPresentation(),
        async restore(state) { const guest = state.guests[0]; if (guest?.kind !== "quakec") throw new Error("Missing QuakeC mod checkpoint"); source.restore(guest); },
        close() { return source.close(); },
      };
    },
  };
}
