import type { ApplicationHost } from "./application.ts";
import type { ApplicationOptions } from "./options.ts";
import type { ApplicationConfigurationContent } from "./content.ts";
import { applicationConfigurationPreset, openApplicationConfigurationContent } from "./content.ts";
import { discoverInstalledContent, presetChoice } from "../../content/catalog/index.ts";
import type { ExecutableRecipe } from "../../contracts/content.ts";
import type { ContentId } from "../../contracts/content.ts";
import type { ClientId, IdentityOwner, SeatId } from "../../contracts/identity.ts";
import type { CommandContext, CommandDialect } from "../../contracts/common.ts";
import type { EngineSession, SessionSeat } from "../../world/session/index.ts";
import { CvarRegistry, type CvarArchiveEntry } from "../../core/cvars/index.ts";
import { ConfigStore } from "../../settings/config.ts";
import { defaultUserContentRoot, userProductDirectory } from "../../content/user-data.ts";
import { serverDefinitionsForSelection } from "../../settings/server/index.ts";
import { PreparedStartup, type PreparedSeatConfiguration } from "./prepared-startup.ts";
import { createStartupSource, resolveStartupRules } from "./startup-source.ts";
import { ApplicationImageSettings } from "./image-settings.ts";
import { ApplicationViewSettings } from "./view-settings.ts";
import { loadAudioSettings } from "./audio-settings.ts";
import { loadCvarArchive } from "./cvar-archives.ts";
import { initializeQ3ClientCvars } from "./q3-client/userinfo.ts";
import { MouseSettings } from "../../input/mouse-settings.ts";
import { ConsoleScriptFiles, consoleConfigRoot } from "./config-scripts.ts";
import { createStartupScriptReader } from "./startup-config.ts";
import { TeamArenaLaunchOverrides } from "./team-arena-skirmish.ts";

interface ConfigurationCommandRequest { readonly target: "application"; readonly name: string; readonly arguments_: readonly string[]; readonly seat: SeatId | null; readonly source: CommandContext; }

export async function openInitialConfigurationContent(options: ApplicationOptions, recipe?: ExecutableRecipe): Promise<ApplicationConfigurationContent> {
  const catalog = await discoverInstalledContent({ corpusRoot: options.corpusRoot, userContentRoot: options.userContentRoot ?? defaultUserContentRoot(),
    discoverMods: options.dedicated || options.network.kind === "offline" && (options.movement === "q3" && options.character === "q3"
      || recipe?.execution.some(module => module.kind === "qvm" && module.role === "server-game") === true) });
  if (recipe !== undefined) return openApplicationConfigurationContent(catalog, { kind: "recipe", recipe });
  const preset = applicationConfigurationPreset(catalog, options);
  return openApplicationConfigurationContent(catalog, { kind: "launch", preset, choice: presetChoice(preset.id) });
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

export function configurationStore(options: ApplicationOptions, content: ApplicationConfigurationContent, reference: ContentId): ConfigStore {
  const product = content.catalog.product(reference);
  return new ConfigStore(product.userContent?.root ?? userProductDirectory(options.userContentRoot ?? defaultUserContentRoot(), product.expectation.contentDirectory));
}

function configurationScriptReader(content: ApplicationConfigurationContent, options: ApplicationOptions, scripts: ConsoleScriptFiles): ReturnType<typeof createStartupScriptReader> {
  const product = content.catalog.product(content.selection.engineBehavior.content);
  const base = product.expectation.baseProduct === null ? product : content.catalog.product(product.expectation.baseProduct);
  const roots = (selected: typeof product): readonly string[] => [selected.userContent?.root, selected.looseRoot].filter((root): root is string => root !== undefined && root !== null);
  return createStartupScriptReader({ mounted: name => scripts.readMounted(name), user: (name, source) => scripts.read(name, source),
    baseLooseRoots: roots(base), gameLooseRoots: roots(product), seatRoot: consoleConfigRoot(options.userContentRoot) });
}

export async function prepareInitialConfiguration(options: ApplicationOptions, content: ApplicationConfigurationContent,
  session: EngineSession, identity: IdentityOwner, localSeats: Map<ClientId, SessionSeat>, settings: ConfigStore,
  host: Pick<ApplicationHost, "print">, sourceArchive: readonly CvarArchiveEntry[], defaultCapacity: number, nextFrame: () => Promise<void>): Promise<{
    readonly prepared: PreparedStartup; readonly image: ApplicationImageSettings | null; readonly options: ApplicationOptions;
    readonly maxClients: number; readonly requests: readonly ConfigurationCommandRequest[]; readonly scripts: ConsoleScriptFiles;
  }> {
  const dialect = configurationDialect(content), movement = configurationMovementDialect(content);
  const context: CommandContext = { session: session.session, origin: { kind: "server-console" } };
  const source = createStartupSource(options, { source: content.selection.source, match: content.selection.match }, dialect, context, defaultCapacity, text => host.print(text));
  const inputCvars = new CvarRegistry({ dialect: movement, context, print: text => host.print(text) });
  const image = options.dedicated ? null : await ApplicationImageSettings.open({ deferPersistence: true, context, dialect,
    ...(options.userContentRoot === undefined ? {} : { userContentRoot: options.userContentRoot }), print: text => host.print(text) });
  const scripts = new ConsoleScriptFiles({ consoleRoot: consoleConfigRoot(options.userContentRoot), settings,
    mounted: name => content.mounts.open(name).then(resource => resource?.bytes) }, () => content.close());
  try {
    const sharedArchive = [...image?.persistedEntries ?? []];
    if (image?.cvars.find("volume") !== undefined) {
      const audio = await loadAudioSettings(settings);
      if (audio.effectsVolume !== undefined) sharedArchive.push({ name: "volume", value: String(audio.effectsVolume) });
      if (audio.musicVolume !== undefined) sharedArchive.push({ name: "bgmvolume", value: String(audio.musicVolume) });
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
    const prepared = new PreparedStartup(source, inputCvars, scripts, { startupCommands: options.startupCommands ?? [], dialect, movementDialect: movement, seats, shared: image?.cvars ?? null,
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
    await prepared.execute({ nextFrame, hasMod: product.expectation.contentDirectory !== base.expectation.contentDirectory,
      read: configurationScriptReader(content, options, scripts),
      sourceArchive, sharedArchive,
      movementArchive: options.dedicated ? [] : await loadCvarArchive(settings, ["movement", movement], movement),
      fallbackArchive: options.dedicated ? [] : await loadCvarArchive(settings, ["fallback", dialect], dialect),
      applyLaunchOptions: () => {
        teamArenaLaunch?.apply(prepared.source, prepared.seats);
        resolved = resolveStartupRules(options, prepared.source, options.teamArenaSkirmish?.maxClients ?? defaultCapacity,
          serverDefinitionsForSelection(content.selection), options.teamArenaSkirmish === undefined);
        if (options.teamArenaSkirmish !== undefined) resolved = { ...resolved, options: { ...resolved.options, mode: options.mode } };
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
