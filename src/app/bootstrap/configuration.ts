import { applyQ3MapLaunch } from "./q3-map-command.ts";
import { q3ProductMapCommands } from "../../core/q3-product-policy.ts";
import { registerRunCvar } from "./shared-setting-cvars.ts";
import { inputDeviceStore, loadInputDeviceSettings } from "./input-devices.ts";
import { audioOutputCvarNames, writeAudioOutputCvars } from "./audio/output-settings.ts";
import { defaultAudioOutputFormat } from "../../audio/output.ts";
import type { ApplicationHost } from "./application.ts";
import type { ApplicationOptions } from "./options.ts";
import type { ApplicationConfigurationContent } from "./content.ts";
import { applicationDiscoversMods, applicationConfigurationPreset, openApplicationConfigurationContent } from "./content.ts";
import { discoverInstalledContent, presetChoice, type InstalledCatalog } from "../../content/catalog/index.ts";
import type { ExecutableRecipe } from "../../contracts/content.ts";
import type { ContentId } from "../../contracts/content.ts";
import type { ClientId, IdentityOwner, SeatId } from "../../contracts/identity.ts";
import type { CommandContext, CommandDialect } from "../../contracts/common.ts";
import type { EngineSession, SessionSeat } from "../../world/session/index.ts";
import { CvarRegistry, type CvarArchiveEntry } from "../../core/cvars/index.ts";
import { ConfigStore } from "../../settings/config.ts";
import { defaultUserContentRoot, userProductDirectory } from "../../content/user-data.ts";
import { serverDefinitionsForSelection } from "../../settings/server/index.ts";
import { PreparedStartup, allowSeatConfigurationCommand, type PreparedClientCommands, type PreparedSeatConfiguration } from "./prepared-startup.ts";
import { ApplicationConsoleRouting } from "./console.ts";
import { StartupConfig, type StartupConfigOptions } from "./startup-config.ts";
import { defaultBindings, namedPhysicalInput } from "../../input/bindings.ts";
import { physicalInputKey, type SeatInput } from "../../input/seat.ts";
import type { CommandCvarRouting } from "../../core/commands/index.ts";
import { asciiFold } from "../../core/commands/index.ts";
import type { InputBinding } from "../../contracts/ui.ts";
import { registerQ1ClientCommands } from "./q1-client-commands.ts";
import { registerQ2ClientCommands } from "./q2-client-commands.ts";
import { prepareQ3ApplicationProduct } from "./q3-product.ts";
import { createStartupSource, resolveStartupRules } from "./startup-source.ts";
import { ApplicationImageSettings } from "./image-settings.ts";
import { ApplicationViewSettings } from "./view-settings.ts";
import { loadAudioSettings } from "./audio-settings.ts";
import { loadCvarArchive } from "./cvar-archives.ts";
import { initializeQ3ClientCvars } from "./q3-client/userinfo.ts";
import { MouseSettings } from "../../input/mouse-settings.ts";
import { ConsoleScriptFiles, consoleConfigRoot, sourceScriptReader } from "./config-scripts.ts";
import { createStartupScriptReader } from "./startup-config.ts";
import { TeamArenaLaunchOverrides } from "./team-arena-skirmish.ts";

export interface ConfigurationCommandRequest { readonly target: "application"; readonly name: string; readonly arguments_: readonly string[]; readonly seat: SeatId | null; readonly source: CommandContext; }

export interface PreparedProfileConfiguration {
  readonly source: CvarRegistry;
  readonly movement: CvarRegistry;
  readonly fallback: CvarRegistry;
  readonly seats: readonly (PreparedSeatConfiguration & { readonly input: SeatInput })[];
  readonly program: PreparedClientCommands;
  readonly routing: ApplicationConsoleRouting;
  readonly scripts: ConsoleScriptFiles;
  readonly read: StartupConfigOptions["read"];
  readonly options: ApplicationOptions;
  readonly maxClients: number;
  readonly requests: readonly ConfigurationCommandRequest[];
  readonly bindingChoices: readonly { readonly id: SeatId; readonly overriddenKeys: readonly string[]; readonly allBindingsChosen: boolean; readonly selectedBindings: readonly InputBinding[] }[];
  publishContinuation(owner: PreparedStartup): void;
  applyBindingDefaults(seat: SeatId, defaults: readonly InputBinding[]): void;
  forwardCommands(forward: (request: ConfigurationCommandRequest) => void): void;
}

export async function prepareProfileConfiguration(args: {
  readonly prepared: PreparedStartup;
  readonly clientSource?: { readonly inputState: "fresh" | "retained"; readonly cvars: CvarRegistry; readonly archive: string | null; route(base: CommandCvarRouting): CommandCvarRouting };
  readonly seats: readonly { readonly seat: SessionSeat; readonly input: SeatInput; readonly selectedBindings?: readonly InputBinding[] }[];
  readonly options: ApplicationOptions;
  readonly content: ApplicationConfigurationContent;
  readonly settings: ConfigStore;
  readonly shared: CvarRegistry;
  readonly host: Pick<ApplicationHost, "print">;
  readonly sourceArchive: readonly CvarArchiveEntry[];
  readonly defaultCapacity: number;
  readonly nextFrame: () => Promise<void>;
}): Promise<PreparedProfileConfiguration> {
  const { prepared, content, settings, shared, host } = args;
  const options = content.q3Product === undefined ? args.options : { ...args.options, q3Product: content.q3Product };
  const dialect = configurationDialect(content), movementDialect = configurationMovementDialect(content);
  const source = args.clientSource?.cvars ?? createStartupSource(options, content.selection, dialect, prepared.source.context, args.defaultCapacity, host.print);
  if (source.dialect !== dialect) throw new Error("Configuration source dialect differs from its selected product");
  const movement = new CvarRegistry({ dialect: movementDialect, context: prepared.movement.context, print: host.print });
  const fallback = args.clientSource?.cvars ?? (movementDialect === dialect ? movement : new CvarRegistry({ dialect, context: prepared.commands.context, print: host.print }));
  const seats = await Promise.all(args.seats.map(async ({ seat, input }) => {
    if (!input.seat.equals(seat.id)) throw new Error("Configuration input belongs to another seat");
    const context: CommandContext = { session: seat.id.session, origin: { kind: "local-seat", seat: seat.id, client: seat.client.id } };
    const cvars = args.clientSource?.cvars ?? new CvarRegistry({ dialect, context, print: host.print, cheatsAllowed: () => source.variableValue("sv_cheats") === 1 });
    if (args.clientSource !== undefined && (args.seats.length !== 1 || cvars.context.origin.kind !== "local-seat" || !cvars.context.origin.seat.equals(seat.id) || !cvars.context.origin.client.equals(seat.client.id)))
      throw new Error("Client configuration requires its actual primary seat cvar owner");
    if (args.clientSource === undefined && dialect === "q3") initializeQ3ClientCvars(cvars, { name: `Player ${seat.id.index + 1}`, model: options.characterModel });
    const mouse = new MouseSettings(new CvarRegistry({ dialect, context, print: host.print }));
    registerRunCvar(mouse.cvars, movementDialect);
    const [profile, archive, mouseArchive] = await Promise.all([
      settings.loadSeat(`input/seat-${seat.id.index + 1}.json`),
      loadCvarArchive(configurationStore(options, content, content.selection.engineBehavior.content), ["client", content.selection.engineBehavior.content, content.selection.engineBehavior.provider, String(seat.id.index)], dialect),
      loadCvarArchive(settings, ["input", dialect, String(seat.id.index)], dialect),
    ]);
    return { id: seat.id, context, cvars, mouse, input, profile, archive, mouseArchive };
  }));
  const [movementArchive, fallbackArchive] = await Promise.all([
    loadCvarArchive(settings, ["movement", movementDialect], movementDialect), loadCvarArchive(settings, ["fallback", dialect], dialect),
  ]);
  const sharedArchive = [...shared.archiveEntries(), ...(args.clientSource?.inputState === "fresh"
    ? await loadInputDeviceSettings(inputDeviceStore(options.userContentRoot)) : [])];
  const routing = new ApplicationConsoleRouting({ fallback, sourceDialect: () => dialect,
    server: () => args.clientSource === undefined ? { cvars: source, sharedNames: source.snapshots().map(variable => variable.name) } : null,
    seat: id => seats.find(seat => seat.id.equals(id))?.cvars ?? null,
    input: id => seats.find(seat => id === null || seat.id.equals(id))?.mouse.cvars ?? null,
    movement: () => movement, shared: () => published?.sharedCvars ?? shared });
  const scripts = new ConsoleScriptFiles({ ...legacyConfigurationOptions(options, content.catalog, content.selection.engineBehavior.content),
    consoleRoot: consoleConfigRoot(options.userContentRoot), settings,
    mountedScript: sourceScriptReader(content.catalog, content.mounts, content.selection.engineBehavior.content),
    mountedResource: name => content.mounts.open(name),
    mountedFiles: (directory, extension) => content.mounts.listFiles(directory, extension),
    mounted: name => content.mounts.open(name).then(resource => resource?.bytes) }, () => content.close());
  const read = configurationScriptReader(content, options, scripts);
  const requests: ConfigurationCommandRequest[] = [];
  let forward = (request: ConfigurationCommandRequest): void => { requests.push(request); };
  let stopped = false;
  let published: PreparedStartup | undefined;
  const dispatch = (name: string, args_: readonly string[], sourceContext: CommandContext): undefined => {
    let origin = sourceContext.origin; while (origin.kind === "script") origin = origin.caller;
    stopped = true;
    forward({ target: "application", name, arguments_: args_, seat: origin.kind === "local-seat" ? origin.seat : null, source: sourceContext });
    return undefined;
  };
  let active: StartupConfig | null = null;
  try {
    const program = prepared.prepareClientCommands({ dialect, context: prepared.commands.context, cvars: fallback, cvarRouting: args.clientSource?.route(routing) ?? routing,
      readScript: (name, context) => active?.readScript(name, context) ?? scripts.read(name, context),
      onScriptComplete: event => active?.onScriptComplete(event), print: host.print,
      allowCommand: command => !active?.restrictSharedConfiguration || allowSeatConfigurationCommand(command, routing, seats, host.print),
      forwardToServer: command => dispatch(command.argv[0] ?? "", command.args, command.source),
    }, seats);
    for (const name of [...(dialect === "q3" ? q3ProductMapCommands(options.q3Product?.policy ?? { kind: "retail" }) : ["map"]), "save", "load", "weapnext", "weapprev", "use", "weapon", "say", "say_team", "connect", "disconnect", "quit",
      "in_restart", "midiinfo", "local_join", "local_drop", "downloadstatus", "stopdownload", "retrydownload", "demopause", "cinematic", "cinematicpause", "stopcinematic", "record", "rerecord", "stop", "stoprecord", "playdemo", "demo", "demomap", "startdemos", "demos", "stopdemo", ...(dialect === "q1-netquake" || dialect === "q1-quakeworld" ? ["timedemo"] : [])])
      program.commands.register(name, command => dispatch(name, command.args, command.source));
    registerQ1ClientCommands(program.commands, dialect, (name, args_, _seat, context) => dispatch(name, args_, context));
    registerQ2ClientCommands(program.commands, dialect, (name, args_, _seat, context) => dispatch(name, args_, context));
    const product = content.catalog.product(content.selection.engineBehavior.content);
    const base = product.expectation.baseProduct === null ? product : content.catalog.product(product.expectation.baseProduct);
    const bindingChoices = new Map(seats.map((seat, index) => [seat.id, { overridden: new Set<string>(), all: false, selected: args.seats[index]?.selectedBindings ?? defaultBindings(0, movementDialect) }]));
    const currentCommands = () => published?.commands ?? program.commands;
    const currentSeat = (id: SeatId) => {
      const seat = (published?.seats ?? seats).find(seat => seat.id.equals(id));
      if (seat === undefined) throw new Error("Configuration seat has retired");
      return seat;
    };
    const currentBindings = (id: SeatId) => published === undefined ? program.input(id) : currentSeat(id).input;
    const retainedConfigurations = seats.map(seat => {
      const prior = args.clientSource?.inputState === "fresh" ? undefined
        : prepared.seats.find(previous => previous.id.equals(seat.id) && previous.input === seat.input);
      return prior === undefined ? undefined : { bindings: prior.input.bindings, mouse: prior.mouse.read(), run: prior.mouse.cvars.find("cl_run")?.value,
        allBindingsChosen: prior.allBindingsChosen, overriddenKeys: [...prior.overriddenKeys],
        selectedBindings: prior.selectedBindings ?? defaultBindings(0, prepared.movement.dialect) };
    });
    const publishChoices = (id: SeatId): void => {
      const seat = published?.seats.find(seat => seat.id.equals(id)), choices = bindingChoices.get(id);
      if (seat === undefined || choices === undefined) return;
      seat.allBindingsChosen = choices.all; seat.selectedBindings = choices.selected;
      for (const key of choices.overridden) seat.overriddenKeys.add(key);
    };
    const applyBindingDefaults = (id: SeatId, defaults: readonly InputBinding[]): void => {
      const choices = bindingChoices.get(id), bindings = currentBindings(id);
      if (choices === undefined || bindings === null) throw new Error("Profile defaults belong to another seat");
      choices.selected = defaults;
      publishChoices(id);
      if (!choices.all) for (const binding of defaults)
        if (!choices.overridden.has(physicalInputKey(binding.input))) bindings.bind(binding);
    };
    async function* run(): AsyncGenerator<void, void, void> {
      for (const [index, seat] of seats.entries()) {
        const bindings = () => {
          const owner = currentBindings(seat.id);
          if (owner === null) throw new Error("Prepared configuration has no binding owner");
          return owner;
        };
        const choices = bindingChoices.get(seat.id);
        if (choices === undefined) throw new Error("Prepared configuration has no binding owner");
        const retained = retainedConfigurations[index];
        let collectingBindings = index !== 0;
        const defaults = args.seats[index]?.selectedBindings ?? defaultBindings(0, movementDialect);
        if (index !== 0) applyBindingDefaults(seat.id, defaults);
        active = new StartupConfig({ dialect, context: seat.context, hasMod: product.expectation.contentDirectory !== base.expectation.contentDirectory,
          scope: index === 0 ? "source" : "seat", read: (name, context, scope) => published === undefined ? read(name, context, scope) : published.readConfiguration(name, context, scope),
          applySelectedDefaults: () => {
            for (const binding of bindings().bindings) if (binding.target.kind === "command" && /^(?:weapon|impulse|use)\s/i.test(binding.target.text)) bindings().unbind(binding.input);
            for (const binding of defaults) bindings().bind(binding);
            collectingBindings = true;
            publishChoices(seat.id);
          },
          applyArchive: () => {
            if (index === 0) { if (args.clientSource === undefined) (published?.source ?? source).applyArchive(args.sourceArchive); (published?.movement ?? movement).applyArchive(movementArchive); (published?.fallback ?? fallback).applyArchive(fallbackArchive); (published === undefined ? shared : published.sharedCvars)?.applyArchive(sharedArchive); }
            currentSeat(seat.id).cvars.applyArchive(seat.archive); currentSeat(seat.id).mouse.cvars.applyArchive(seat.mouseArchive);
            if (args.clientSource !== undefined) currentSeat(seat.id).cvars.applyArchive(args.sourceArchive);
            if (retained !== undefined) {
              bindings().unbindAll(); for (const binding of retained.bindings) bindings().bind(binding);
              choices.all = retained.allBindingsChosen;
              for (const key of retained.overriddenKeys) choices.overridden.add(key);
              const expected = new Map(retained.selectedBindings.map(binding => [physicalInputKey(binding.input), binding.target]));
              const current = new Map(retained.bindings.map(binding => [physicalInputKey(binding.input), binding.target]));
              for (const key of new Set([...expected.keys(), ...current.keys()]))
                if (JSON.stringify(expected.get(key)) !== JSON.stringify(current.get(key))) choices.overridden.add(key);
              currentSeat(seat.id).mouse.write(retained.mouse);
              if (retained.run !== undefined) currentSeat(seat.id).mouse.cvars.setCommandFlags("cl_run", retained.run, "archive");
            } else if (seat.profile !== null) {
              bindings().unbindAll(); for (const binding of seat.profile.bindings) bindings().bind(binding);
              choices.all = true;
              currentSeat(seat.id).mouse.write(seat.profile.mouse);
              if (seat.profile.alwaysRun !== undefined) currentSeat(seat.id).mouse.cvars.setCommandFlags("cl_run", seat.profile.alwaysRun ? "1" : "0", "archive");
            }
            if (index === 0 && args.clientSource?.archive !== undefined && args.clientSource.archive !== null)
              currentCommands().insert(args.clientSource.archive, { ...seat.context, origin: { kind: "script", name: "client.cfg", caller: seat.context.origin } });
            collectingBindings = true;
          }, applyLaunchOptions: () => {},
        });
        while (!await active.executeFrame({
          append: (text, context) => currentCommands().appendPreparation(text, context, dialect),
          executeScriptsAsync: (afterDispatch, shouldContinue) => currentCommands().executeScriptsAsync(afterDispatch, shouldContinue),
        }, async () => {
          if (!collectingBindings) return;
          const [rawName, key] = currentCommands().tokenizedArguments, name = asciiFold(rawName ?? "");
          if (name === "unbindall") choices.all = true;
          if ((name === "bind" || name === "unbind") && key !== undefined) {
            const input = namedPhysicalInput(key); if (input !== null) choices.overridden.add(physicalInputKey(input));
          }
          publishChoices(seat.id);
        }, () => published === undefined ? !stopped : published.configurationCanContinue)) yield;
        active = null;
      }
      while (!currentCommands().preparationComplete) { yield; await currentCommands().advanceProgramFrame(); }
    }
    const continuation = run();
    const complete = await program.preparePrefix(async () => {
      do {
        if ((await continuation.next()).done) return true;
        if (stopped || args.clientSource !== undefined) return false;
        await args.nextFrame();
      } while (true);
    });
    const launch = args.clientSource !== undefined || options.teamArenaSkirmish === undefined ? null : new TeamArenaLaunchOverrides(options.teamArenaSkirmish);
    launch?.apply(source, seats);
    if (options.q3MapLaunch !== undefined) applyQ3MapLaunch(source, options.q3MapLaunch);
    const resolved = args.clientSource === undefined ? resolveStartupRules(options, source, options.q3MapLaunch?.maxClients ?? options.teamArenaSkirmish?.maxClients ?? args.defaultCapacity,
      serverDefinitionsForSelection(content.selection), launch === null && options.q3MapLaunch === undefined) : { options, maxClients: args.defaultCapacity };
    return { source, movement, fallback, seats, program, routing, scripts, read, ...resolved, requests, applyBindingDefaults,
      publishContinuation: owner => {
        if (owner !== prepared) throw new Error("Configuration continuation belongs to another client");
        if (published !== undefined) throw new Error("Configuration continuation already published");
        published = owner;
        if (!complete) owner.adoptConfigurationContinuation({
          get active() { return active; },
          advance: async current => {
            if (current !== owner) throw new Error("Configuration continuation belongs to another client");
            return (await continuation.next()).done === true;
          },
        });
      },
      get bindingChoices() { return [...bindingChoices].map(([id, choices]) => ({ id, overriddenKeys: [...choices.overridden], allBindingsChosen: choices.all, selectedBindings: choices.selected })); },
      forwardCommands: handler => { forward = handler; } };
  } catch (error) {
    routing.close();
    try { await scripts.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Profile configuration and cleanup failed"); }
    throw error;
  }
}

export async function openInitialConfigurationContent(options: ApplicationOptions, recipe?: ExecutableRecipe, installedCatalog?: InstalledCatalog): Promise<ApplicationConfigurationContent> {
  let catalog = installedCatalog ?? await discoverInstalledContent({ corpusRoot: options.corpusRoot, userContentRoot: options.userContentRoot ?? defaultUserContentRoot(),
    discoverMods: applicationDiscoversMods(options, recipe) });
  const product = await prepareQ3ApplicationProduct(catalog, recipe?.map.entities.content ?? options.product, options);
  catalog = product.catalog;
  if (product.q3Product !== null) options = { ...options, q3Product: product.q3Product };
  if (recipe !== undefined) return openApplicationConfigurationContent(catalog, { kind: "recipe", recipe }, options.q3Product);
  const preset = applicationConfigurationPreset(catalog, options);
  return openApplicationConfigurationContent(catalog, { kind: "launch", preset, choice: presetChoice(preset.id) }, options.q3Product);
}

export function configurationDialect(content: ApplicationConfigurationContent): CommandDialect {
  const source = content.catalog.product(content.selection.engineBehavior.content).expectation;
  return source.family === "q1" ? source.edition === "quakeworld" ? "q1-quakeworld" : "q1-netquake" : source.family === "q2" ? source.edition === "rerelease" ? "q2-rerelease" : "q2-classic" : "q3";
}

function configurationMovementDialect(content: ApplicationConfigurationContent): CommandDialect {
  const timing = content.selection.timing.find(profile => profile.provider === content.selection.movement.provider);
  if (timing === undefined) throw new Error(`Configuration has no timing for ${content.selection.movement.provider}`);
  return timing.clock.kind;
}

export function legacyConfigurationOptions(options: ApplicationOptions, catalog: InstalledCatalog,
  reference: ContentId): Pick<ConstructorParameters<typeof ConsoleScriptFiles>[0], "legacyConfig"> {
  const selected = catalog.product(reference);
  if (selected.expectation.family !== "q1" || selected.expectation.edition === "quakeworld") return {};
  const sharedRoot = options.userContentRoot ?? defaultUserContentRoot();
  const products = [selected, ...catalog.products.filter(product => product.expectation.family === "q1" && product.expectation.edition !== "quakeworld")];
  const gameRoots = [...new Set(products.map(product => product.userContent?.root ?? userProductDirectory(sharedRoot, product.expectation.contentDirectory)))];
  return { legacyConfig: { sharedRoot, gameRoots } };
}

export function configurationStore(options: ApplicationOptions, content: ApplicationConfigurationContent, reference: ContentId): ConfigStore {
  const product = content.catalog.product(reference);
  return new ConfigStore(product.userContent?.root ?? userProductDirectory(options.userContentRoot ?? defaultUserContentRoot(), product.expectation.contentDirectory));
}

function configurationScriptReader(content: ApplicationConfigurationContent, options: ApplicationOptions, scripts: ConsoleScriptFiles): ReturnType<typeof createStartupScriptReader> {
  const product = content.catalog.product(content.selection.engineBehavior.content);
  const base = product.expectation.baseProduct === null ? product : content.catalog.product(product.expectation.baseProduct);
  const roots = (selected: typeof product): readonly string[] => [selected.userContent?.root, selected.looseRoot].filter((root): root is string => root !== undefined && root !== null);
  return createStartupScriptReader({ mounted: name => scripts.readMountedScript(name), user: (name, source) => scripts.read(name, source),
    baseLooseRoots: roots(base), gameLooseRoots: roots(product), seatRoot: consoleConfigRoot(options.userContentRoot) });
}

export async function prepareInitialConfiguration(options: ApplicationOptions, content: ApplicationConfigurationContent,
  session: EngineSession, identity: IdentityOwner, localSeats: Map<ClientId, SessionSeat>, settings: ConfigStore,
  host: Pick<ApplicationHost, "print">, sourceArchive: readonly CvarArchiveEntry[], defaultCapacity: number, nextFrame: () => Promise<void>,
  onPrepared?: (prepared: PreparedStartup) => void): Promise<{
    readonly prepared: PreparedStartup; readonly image: ApplicationImageSettings | null; readonly options: ApplicationOptions;
    readonly maxClients: number; readonly requests: readonly ConfigurationCommandRequest[]; readonly scripts: ConsoleScriptFiles;
  }> {
  if (content.q3Product !== undefined) options = { ...options, q3Product: content.q3Product };
  const dialect = configurationDialect(content), movement = configurationMovementDialect(content);
  const context: CommandContext = { session: session.session, origin: { kind: "server-console" } };
  const source = createStartupSource(options, { source: content.selection.source, match: content.selection.match }, dialect, context, defaultCapacity, text => host.print(text));
  const inputCvars = new CvarRegistry({ dialect: movement, context, print: text => host.print(text) });
  const image = options.dedicated ? null : await ApplicationImageSettings.open({ deferPersistence: true, context, dialect,
    ...(options.renderWorker === undefined ? {} : { renderWorker: options.renderWorker }),
    audioOutputFormat: (await loadAudioSettings(settings)).outputFormat ?? defaultAudioOutputFormat,
    ...(options.userContentRoot === undefined ? {} : { userContentRoot: options.userContentRoot }), print: text => host.print(text) });
  const scripts = new ConsoleScriptFiles({ ...legacyConfigurationOptions(options, content.catalog, content.selection.engineBehavior.content),
    consoleRoot: consoleConfigRoot(options.userContentRoot), settings,
    mountedScript: sourceScriptReader(content.catalog, content.mounts, content.selection.engineBehavior.content),
    mountedResource: name => content.mounts.open(name),
    mountedFiles: (directory, extension) => content.mounts.listFiles(directory, extension),
    mounted: name => content.mounts.open(name).then(resource => resource?.bytes) }, () => content.close());
  try {
    const sharedArchive = [...image?.persistedEntries ?? [], ...await loadInputDeviceSettings(inputDeviceStore(options.userContentRoot))];
    if (image?.cvars.find("volume") !== undefined) {
      const audio = await loadAudioSettings(settings);
      if (audio.outputFormat !== undefined) {
        writeAudioOutputCvars(image.cvars, audio.outputFormat);
        sharedArchive.push(...audioOutputCvarNames.map(name => ({ name, value: image.cvars.variableString(name) })));
      }
      if (audio.effectsVolume !== undefined) sharedArchive.push({ name: "volume", value: String(audio.effectsVolume) });
      if (audio.musicVolume !== undefined) sharedArchive.push({ name: "bgmvolume", value: String(audio.musicVolume) });
      if (audio.musicShuffle !== undefined) sharedArchive.push({ name: "music_shuffle", value: audio.musicShuffle ? "1" : "0" });
      if (audio.menuTrack !== undefined) sharedArchive.push({ name: "music_menu_track", value: audio.menuTrack });
    }
    if (image !== null) {
      const view = new ApplicationViewSettings(value => image.cvars.set("fov", String(value)));
      await view.load(settings);
      const release = view.bindCvars(image.cvars);
      if (view.override !== null && !sharedArchive.some(entry => entry.name === "fov")) sharedArchive.push({ name: "fov", value: String(view.fieldOfView) });
      release();
    }
    const seats: PreparedSeatConfiguration[] = [];
    for (let index = 0; index < (options.dedicated ? 0 : options.seats); index++) {
      const client = options.dedicated ? null : session.createClient(index);
      const local = client === null ? null : session.createSeat(index, client);
      if (client !== null && local !== null) localSeats.set(client.id, local);
      const id = local?.id ?? identity.seat(index);
      const seatContext: CommandContext = local === null ? context : { session: session.session, origin: { kind: "local-seat", seat: id, client: local.client.id } };
      const cvars = new CvarRegistry({ dialect, context: seatContext, print: text => host.print(text), cheatsAllowed: () => source.variableValue("sv_cheats") === 1 });
      if (dialect === "q3") initializeQ3ClientCvars(cvars, { name: `Player ${index + 1}`, model: options.characterModel });
      const mouse = new MouseSettings(new CvarRegistry({ dialect, context: seatContext, print: text => host.print(text) }));
      seats.push({ context: seatContext, id, cvars, mouse,
        profile: options.dedicated ? null : await settings.loadSeat(`input/seat-${index + 1}.json`),
        archive: options.dedicated ? [] : await loadCvarArchive(configurationStore(options, content, content.selection.engineBehavior.content), ["client", content.selection.engineBehavior.content, content.selection.engineBehavior.provider, String(index)], dialect),
        mouseArchive: options.dedicated ? [] : await loadCvarArchive(settings, ["input", dialect, String(index)], dialect) });
    }
    const requests: ConfigurationCommandRequest[] = [];
    const prepared = new PreparedStartup(source, inputCvars, scripts, { startupCommands: options.startupCommands ?? [], ...(options.q3Product === undefined ? {} : { q3Policy: options.q3Product.policy }), dialect, movementDialect: movement, seats, shared: image?.cvars ?? null,
      sharedNames: source.snapshots().map(variable => variable.name), print: text => host.print(text),
      forward: (name, args, sourceContext) => {
        let origin = sourceContext.origin; while (origin.kind === "script") origin = origin.caller;
        requests.push({ target: "application", name, arguments_: args, seat: origin.kind === "local-seat" ? origin.seat : null, source: sourceContext });
        return undefined;
      } });
    const product = content.catalog.product(content.selection.engineBehavior.content);
    const base = product.expectation.baseProduct === null ? product : content.catalog.product(product.expectation.baseProduct);
    const teamArenaLaunch = options.teamArenaSkirmish === undefined ? null : new TeamArenaLaunchOverrides(options.teamArenaSkirmish);
    let resolved = { options, maxClients: defaultCapacity };
    onPrepared?.(prepared);
    await prepared.execute({ nextFrame, hasMod: product.expectation.contentDirectory !== base.expectation.contentDirectory,
      read: configurationScriptReader(content, options, scripts),
      sourceArchive, sharedArchive,
      movementArchive: options.dedicated ? [] : await loadCvarArchive(settings, ["movement", movement], movement),
      fallbackArchive: options.dedicated ? [] : await loadCvarArchive(settings, ["fallback", dialect], dialect),
      applyLaunchOptions: () => {
        teamArenaLaunch?.apply(prepared.source, prepared.seats);
        if (options.q3MapLaunch !== undefined) applyQ3MapLaunch(prepared.source, options.q3MapLaunch);
        resolved = resolveStartupRules(options, prepared.source, options.q3MapLaunch?.maxClients ?? options.teamArenaSkirmish?.maxClients ?? defaultCapacity,
          serverDefinitionsForSelection(content.selection), options.teamArenaSkirmish === undefined && options.q3MapLaunch === undefined);
        if (options.teamArenaSkirmish !== undefined) resolved = { ...resolved, options: { ...resolved.options, mode: options.mode } };
        if (options.renderWorker !== undefined) image?.cvars.set("r_smp", options.renderWorker ? "1" : "0", true);
        if (options.displayOverrides?.width !== undefined) image?.cvars.set("r_customwidth", String(options.displayOverrides.width), true);
        if (options.displayOverrides?.height !== undefined) image?.cvars.set("r_customheight", String(options.displayOverrides.height), true);
        if (options.displayOverrides?.gamma !== undefined) image?.cvars.set("r_gamma", String(options.displayOverrides.gamma), true);
      },
    });
    return { prepared, image, ...resolved, requests, scripts };
  } catch (error) {
    const errors: unknown[] = [error];
    try { await image?.close(); } catch (cleanup) { errors.push(cleanup); }
    try { await scripts.close(); } catch (cleanup) { errors.push(cleanup); }
    if (errors.length > 1) throw new AggregateError(errors, "Initial configuration and cleanup failed");
    throw error;
  }
}
