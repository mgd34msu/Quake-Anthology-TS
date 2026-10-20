import type { InstalledCatalog } from "../../content/catalog/index.ts";
import { createIdentityOwner } from "../../contracts/identity.ts";
import type { SaveImage } from "../../contracts/session.ts";
import { readSavedGame } from "../../persistence/saved-game.ts";
import { kexQ2SaveRestorable, readKexQ2SaveArchive } from "../../persistence/kex-q2-save.ts";
import { basename } from "node:path";
import { selectQ1SaveProduct } from "../../persistence/q1-selection.ts";
import { loadApplicationContent } from "./content.ts";
import type { ApplicationOptions } from "./options.ts";
import { createSimulation } from "./simulation/index.ts";

export async function prepareApplicationSave(options: ApplicationOptions, catalog: InstalledCatalog, path: string, sourceProduct?: string): Promise<{
  readonly image: SaveImage; readonly options: ApplicationOptions;
}> {
  const { authoredCampaignStart: consumedCampaignStart, ...loadOptions } = options;
  if (path.toLowerCase().endsWith(".pak.gz")) return prepareKexQ2Save(catalog, path, loadOptions);
  const saved = await readSavedGame(path);
  if (saved.kind === "shared") return { image: saved.image, options: loadOptions };
  const product = selectQ1SaveProduct(catalog, saved.data, path, sourceProduct);
  const skill = saved.data.skill;
  if (skill !== 0 && skill !== 1 && skill !== 2 && skill !== 3) throw new Error("Original save skill must be 0..3");
  const { movementProduct: _movementProduct, mapProduct, q2GameLibrary, weaponBehavior, teamArenaSkirmish, q3MapLaunch, q3Product, botSkill, serverProfile, serverProfilePath, startupCommands, explicitRules, ...sourceOptions } = loadOptions;
  const restored: ApplicationOptions = { ...sourceOptions, product: product.expectation.id, map: `maps/${saved.data.map}.bsp`,
    skill, mode: "singleplayer", movement: "q1", character: "q1", characterModel: "player", seats: 1, rules: "standard", quakeCProgram: "progs.dat", network: { kind: "offline" } };
  const content = await loadApplicationContent(restored, undefined, undefined, catalog);
  try {
    if (content.preparedQuakeC === null) throw new Error("Original save requires its native QuakeC program");
    const identity = createIdentityOwner("original-save-import");
    const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
      preparedQuakeC: content.preparedQuakeC, originalSaveCandidate: true, initialSourceMilliseconds: saved.data.time * 1000,
      dedicated: true, skill, mode: "singleplayer", seed: restored.seed, maxClients: 1 });
    try {
      simulation.admitPlayer(identity.client(0, 0));
      simulation.restoreOriginalSave(saved.data);
      return { image: simulation.checkpoint(), options: restored };
    } finally { simulation.close(); }
  } finally { await content.close(); }
}

/**
 * Retail KEX transition saves synthesize a fresh-spawn image on the recorded
 * map with the recorded server cvars. Saves carrying client or level state
 * are refused rather than partially restored.
 */
async function prepareKexQ2Save(catalog: InstalledCatalog, path: string, loadOptions: ApplicationOptions): Promise<{
  readonly image: SaveImage; readonly options: ApplicationOptions;
}> {
  const save = await readKexQ2SaveArchive(path);
  if (!kexQ2SaveRestorable(save)) throw new Error("Retail Quake II saves with recorded client or level state cannot be restored by this engine yet.");
  const product = catalog.products.find(candidate => candidate.expectation.family === "q2" && candidate.expectation.edition === "rerelease"
    && basename(candidate.expectation.contentDirectory).toLowerCase() === (save.info.gameDirectory ?? "").toLowerCase());
  if (product === undefined) throw new Error(`Retail Quake II save game directory ${save.info.gameDirectory ?? "(none)"} is not installed.`);
  const map = save.info.mapCommand.replace(/^\*/, "").replace(/^maps\//, "").replace(/\.bsp$/i, "");
  if (!/^[A-Za-z0-9_/-]+$/.test(map) || map.split("/").some(part => part === "" || part === "." || part === ".."))
    throw new Error("Retail Quake II save has an invalid map name.");
  const skillValue = Number(save.info.cvars.get("skill") ?? "1");
  const skill = skillValue === 0 || skillValue === 1 || skillValue === 2 || skillValue === 3 ? skillValue : 1;
  const mode = save.info.cvars.get("deathmatch") === "1" ? "deathmatch" : save.info.cvars.get("coop") === "1" ? "coop" : "singleplayer";
  const { movementProduct: _movementProduct, mapProduct: _mapProduct, q2GameLibrary: _q2GameLibrary, weaponBehavior: _weaponBehavior, teamArenaSkirmish: _teamArenaSkirmish, q3MapLaunch: _q3MapLaunch, q3Product: _q3Product, botSkill: _botSkill, serverProfile: _serverProfile, serverProfilePath: _serverProfilePath, startupCommands: _startupCommands, explicitRules: _explicitRules, ...sourceOptions } = loadOptions;
  const restored: ApplicationOptions = { ...sourceOptions, product: product.expectation.id, map: `maps/${map}.bsp`,
    skill, mode, movement: "q2", character: "q2", characterModel: "male", seats: 1, rules: "standard", network: { kind: "offline" } };
  const content = await loadApplicationContent(restored, undefined, undefined, catalog);
  try {
    const identity = createIdentityOwner("kex-q2-save-import");
    const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
      dedicated: true, skill, mode, seed: restored.seed, maxClients: 1, playerIdentity: () => ({ seat: 0, socialId: "" }) });
    try {
      simulation.admitPlayer(identity.client(0, 0));
      return { image: simulation.checkpoint(), options: restored };
    } finally { simulation.close(); }
  } finally { await content.close(); }
}
