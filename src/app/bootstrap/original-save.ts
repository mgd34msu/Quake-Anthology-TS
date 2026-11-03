// SPDX-License-Identifier: GPL-2.0-or-later
import type { InstalledCatalog } from "../../content/catalog/index.ts";
import { createIdentityOwner } from "../../contracts/identity.ts";
import type { SaveImage } from "../../contracts/session.ts";
import { decodeSaveSidecar, readSavedGame, SIDECAR_EXTENSION } from "../../persistence/saved-game.ts";
import { parseKexQ2SaveArchive } from "../../persistence/kex-q2-save.ts";
import { basename, dirname, join } from "node:path";
import { selectQ1SaveProduct } from "../../persistence/q1-selection.ts";
import { q2SavedSettings, selectQ2SaveProduct } from "../../persistence/q2-selection.ts";
import { q2FilesDigest, readQ2ClassicFolder, type Q2SaveFiles } from "../../persistence/q2-save-folder.ts";
import { Q2SaveStore } from "../../persistence/q2-save-store.ts";
import { loadServerLocalizationResources } from "../../text/localization-resources.ts";
import { loadApplicationContent, type LoadedApplicationContent } from "./content.ts";
import { q2LocalizedText } from "./q2-localization.ts";
import type { ApplicationOptions } from "./options.ts";
import { createSimulation, loadSimulation } from "./simulation/index.ts";
import { createApplicationBotNavigation } from "./simulation/navigation.ts";
import { readQ2RereleasePak } from "./simulation/native-q2-rerelease-pak.ts";
import type { NativeQ2Import } from "./simulation/source-strategy.ts";
import type { SimulationOptions } from "./simulation/types.ts";

export interface PreparedSave {
  readonly image: SaveImage;
  readonly options: ApplicationOptions;
  /** The original files of a Quake II save folder, which become the working `current` folder once the load succeeds. */
  readonly folder?: Q2SaveFiles;
}

/** What the engine writes beside the original files; the original's own wipe and copy never touch these. */
const ENGINE_FILES = /^qts\.(?:sav|qtsave)$/i;

export async function prepareApplicationSave(
  options: ApplicationOptions,
  catalog: InstalledCatalog,
  path: string,
  sourceProduct?: string,
  nextFrame: () => Promise<void> = async () => {
    await Bun.sleep(0);
  },
): Promise<PreparedSave> {
  const { authoredCampaignStart: consumedCampaignStart, ...loadOptions } = options;
  if (path.toLowerCase().endsWith(".pak.gz")) return prepareRereleasePak(catalog, path, loadOptions, sourceProduct, nextFrame);
  if (
    basename(path).toLowerCase() === "server.ssv" ||
    (basename(path).toLowerCase() === "qts.sav" && (await Bun.file(join(dirname(path), "server.ssv")).exists()))
  )
    return prepareClassicFolder(catalog, dirname(path), loadOptions, sourceProduct, nextFrame);
  const saved = await readSavedGame(path);
  if (saved.kind === "shared") return { image: saved.image, options: loadOptions };
  const product = selectQ1SaveProduct(catalog, saved.data, path, sourceProduct);
  const skill = saved.data.skill;
  if (skill !== 0 && skill !== 1 && skill !== 2 && skill !== 3) throw new Error("Original save skill must be 0..3");
  const {
    movementProduct: _movementProduct,
    mapProduct,
    q2GameLibrary,
    weaponBehavior,
    teamArenaSkirmish,
    q3MapLaunch,
    q3Product,
    botSkill,
    serverProfile,
    serverProfilePath,
    startupCommands,
    explicitRules,
    ...sourceOptions
  } = loadOptions;
  const restored: ApplicationOptions = {
    ...sourceOptions,
    product: product.expectation.id,
    map: `maps/${saved.data.map}.bsp`,
    skill,
    mode: "singleplayer",
    movement: "q1",
    character: "q1",
    characterModel: "player",
    seats: 1,
    rules: "standard",
    quakeCProgram: "progs.dat",
    network: { kind: "offline" },
  };
  const content = await loadApplicationContent(restored, undefined, undefined, catalog);
  try {
    if (content.preparedQuakeC === null) throw new Error("Original save requires its native QuakeC program");
    const identity = createIdentityOwner("original-save-import");
    const simulation = createSimulation({
      identity,
      recipe: content.recipe,
      world: content.world,
      mounts: content.mounts,
      preparedQuakeC: content.preparedQuakeC,
      originalSaveCandidate: true,
      initialSourceMilliseconds: saved.data.time * 1000,
      dedicated: true,
      skill,
      mode: "singleplayer",
      seed: restored.seed,
      maxClients: 1,
    });
    try {
      simulation.admitPlayer(identity.client(0, 0));
      simulation.restoreOriginalSave(saved.data);
      return { image: simulation.checkpoint(), options: restored };
    } finally {
      simulation.close();
    }
  } finally {
    await content.close();
  }
}

const SIDECAR_NAME = `qts${SIDECAR_EXTENSION}`;

/**
 * A Quake II save folder written by the original game or by this engine. The engine's sidecar carries the state the
 * original files cannot (every seat, engine-only state) and is used while it still agrees with the files. Otherwise the
 * original files alone start the original game module on the recorded level, exactly as `load` does in id's engine.
 */
async function prepareClassicFolder(
  catalog: InstalledCatalog,
  folder: string,
  loadOptions: ApplicationOptions,
  sourceProduct: string | undefined,
  nextFrame: () => Promise<void>,
): Promise<PreparedSave> {
  const store = new Q2SaveStore(dirname(folder)),
    all = await store.read(basename(folder));
  const files = new Map([...all].filter(([name]) => !ENGINE_FILES.test(name)));
  const sidecar = [...all].find(([name]) => name.toLowerCase() === SIDECAR_NAME)?.[1];
  const agreed = sidecar === undefined ? null : decodeSaveSidecar(sidecar, q2FilesDigest(files));
  if (agreed !== null) return { image: agreed, options: loadOptions, folder: files };
  const imported = readQ2ClassicFolder(files);
  const product = selectQ2SaveProduct(catalog, "classic", basename(dirname(dirname(folder))), sourceProduct, loadOptions.product);
  const settings = q2SavedSettings(new Map(imported.server.latched.map(cvar => [cvar.name, cvar.value])));
  return { ...(await importNativeQ2(catalog, loadOptions, product.expectation.id, "gamex86.dll", imported, settings, nextFrame)), folder: files };
}

/**
 * A rerelease `saveN.pak.gz`. A pak records `gamename`; its sidecar `saveN.qtsave` holds engine-only state.
 */
async function prepareRereleasePak(
  catalog: InstalledCatalog,
  path: string,
  loadOptions: ApplicationOptions,
  sourceProduct: string | undefined,
  nextFrame: () => Promise<void>,
): Promise<PreparedSave> {
  const compressed = await Bun.file(path).bytes();
  const archive = parseKexQ2SaveArchive(compressed);
  const sidecarFile = Bun.file(path.replace(/\.pak\.gz$/i, SIDECAR_EXTENSION));
  if (await sidecarFile.exists()) {
    const agreed = decodeSaveSidecar(await sidecarFile.bytes(), q2FilesDigest(archive.entries));
    if (agreed !== null) return { image: agreed, options: loadOptions };
  }
  const imported = readQ2RereleasePak(archive);
  const product = selectQ2SaveProduct(catalog, "rerelease", archive.info.gameDirectory ?? basename(dirname(dirname(path))), sourceProduct, loadOptions.product);
  const settings = q2SavedSettings(new Map(imported.server.latched.map(cvar => [cvar.name, cvar.value])));
  return importNativeQ2(catalog, loadOptions, product.expectation.id, "game_x64.dll", imported, settings, nextFrame);
}

/**
 * Starts the product's original game module on the recorded files in a throwaway world and takes its checkpoint. The
 * application then restores that checkpoint like any other save, so a load from original files and a load from the
 * engine's own image run the same restore.
 */
async function importNativeQ2(
  catalog: InstalledCatalog,
  loadOptions: ApplicationOptions,
  product: string,
  library: "gamex86.dll" | "game_x64.dll",
  imported: NativeQ2Import,
  settings: ReturnType<typeof q2SavedSettings>,
  nextFrame: () => Promise<void>,
): Promise<PreparedSave> {
  const {
    movementProduct: _movementProduct,
    mapProduct: _mapProduct,
    q2GameLibrary: _q2GameLibrary,
    weaponBehavior: _weaponBehavior,
    teamArenaSkirmish: _teamArenaSkirmish,
    q3MapLaunch: _q3MapLaunch,
    q3Product: _q3Product,
    botSkill: _botSkill,
    serverProfile: _serverProfile,
    serverProfilePath: _serverProfilePath,
    startupCommands: _startupCommands,
    explicitRules: _explicitRules,
    ...sourceOptions
  } = loadOptions;
  const restored: ApplicationOptions = {
    ...sourceOptions,
    product,
    q2GameLibrary: library,
    map: imported.map.endsWith(".bsp") ? imported.map : `maps/${imported.map}.bsp`,
    skill: settings.skill,
    mode: settings.mode,
    movement: "q2",
    character: "q2",
    characterModel: "male",
    seats: 1,
    rules: "standard",
    network: { kind: "offline" },
  };
  const content = await loadApplicationContent(restored, undefined, undefined, catalog);
  try {
    const guest = await importGuest(content);
    const identity = createIdentityOwner("q2-original-save-import");
    const simulation = await loadSimulation(
      {
        identity,
        recipe: content.recipe,
        world: content.world,
        mounts: content.mounts,
        dedicated: true,
        ...guest,
        prepareRereleaseNavigation: simulation => createApplicationBotNavigation({ content, simulation }),
        nativeImport: imported,
        initialSpawnPoint: imported.spawnPoint,
        skill: settings.skill,
        mode: settings.mode,
        seed: restored.seed,
        maxClients: settings.maxClients,
        playerIdentity: () => ({ seat: 0, socialId: "" }),
      },
      nextFrame,
    );
    try {
      simulation.admitPlayer(identity.client(0, 0));
      return { image: await simulation.checkpointLoading(nextFrame), options: restored };
    } finally {
      simulation.close();
    }
  } finally {
    await content.close();
  }
}

/** The headless world has no console, files or clipboard of its own; the module's output is discarded. */
async function importGuest(content: LoadedApplicationContent): Promise<Pick<SimulationOptions, "q2Guest">> {
  const prepared = content.preparedQ2Game;
  if (prepared === null) throw new Error("This save needs the original game module, which the game does not provide.");
  const callbacks = {
    capabilities: {
      nowMilliseconds: () => Math.trunc(performance.now()),
      performanceCounter: () => BigInt(Math.trunc(performance.now() * 1000)),
      performanceFrequency: 1_000_000n,
      openFile: () => null,
      standardOutput: () => undefined,
    },
    print: () => undefined,
    addCommand: () => undefined,
    debugGraph: () => undefined,
  };
  if (prepared.edition === "classic") return { q2Guest: { ...callbacks, edition: "classic", prepared } };
  const mounts = await content.forContent(prepared.execution.owner.content);
  const localization = await loadServerLocalizationResources("english", async path => (await mounts.open(path))?.bytes ?? null, "q2-rerelease");
  return {
    q2Guest: {
      ...callbacks,
      edition: "rerelease",
      prepared,
      localize: (text, arguments_) => q2LocalizedText(localization, text, arguments_),
      clipboard: { kind: "dedicated" },
    },
  };
}
