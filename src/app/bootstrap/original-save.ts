import type { InstalledCatalog } from "../../content/catalog/index.ts";
import { createIdentityOwner } from "../../contracts/identity.ts";
import type { SaveImage } from "../../contracts/session.ts";
import { readSavedGame } from "../../persistence/saved-game.ts";
import { selectQ1SaveProduct } from "../../persistence/q1-selection.ts";
import { loadApplicationContent } from "./content.ts";
import type { ApplicationOptions } from "./options.ts";
import { createSimulation } from "./simulation/index.ts";

export async function prepareApplicationSave(options: ApplicationOptions, catalog: InstalledCatalog, path: string): Promise<{
  readonly image: SaveImage; readonly options: ApplicationOptions;
}> {
  const saved = await readSavedGame(path);
  const { authoredCampaignStart: consumedCampaignStart, ...loadOptions } = options;
  if (saved.kind === "shared") return { image: saved.image, options: loadOptions };
  const product = selectQ1SaveProduct(catalog, saved.data, path);
  const skill = saved.data.skill;
  if (skill !== 0 && skill !== 1 && skill !== 2 && skill !== 3) throw new Error("Original save skill must be 0..3");
  const restored: ApplicationOptions = { ...loadOptions, product: product.expectation.id, map: `maps/${saved.data.map}.bsp`,
    skill, mode: "singleplayer", movement: "q1", character: "q1", rules: "standard", quakeCProgram: "progs.dat", network: { kind: "offline" } };
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
