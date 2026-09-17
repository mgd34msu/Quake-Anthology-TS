import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseAas, clusterAas, optimizeAas, writeAas } from "../../src/bots/navigation/index.ts";
import type { AasAsset } from "../../src/bots/navigation/aas.ts";
import { blockChecksum } from "../../src/core/md4.ts";

async function regenerate(asset: AasAsset, args: readonly string[]): Promise<AasAsset> {
  const { parseApplicationCommand } = await import("../../src/app/bootstrap/options.ts");
  const { loadApplicationContent } = await import("../../src/app/bootstrap/content.ts");
  const { createSimulation } = await import("../../src/app/bootstrap/simulation/index.ts");
  const { createIdentityOwner } = await import("../../src/contracts/identity.ts");
  const { EngineSession } = await import("../../src/world/session/session.ts");
  const { botNavigationProfile } = await import("../../src/app/bootstrap/simulation/navigation.ts");
  const { predictApplicationBotMovement } = await import("../../src/app/bootstrap/simulation/bot-prediction.ts");
  const { buildAasReachability } = await import("../../src/bots/navigation/aas-reachability.ts");
  const command = parseApplicationCommand([...args, "--dedicated", "--mode", "deathmatch"]);
  if (command.kind !== "run") throw new Error("AAS regeneration requires an explicit map launch");
  const content = await loadApplicationContent(command.options);
  const identity = createIdentityOwner("aas-authoring"), session = new EngineSession(identity, { kind: "headless" });
  try {
    const mapBytes = await content.mounts.read(content.recipe.map.geometry);
    if (asset.bspChecksum !== (blockChecksum(mapBytes) | 0)) throw new Error("Input AAS belongs to a different BSP checksum");
    const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
      dedicated: true, mode: "deathmatch", skill: 1, seed: 1, maxClients: 1 });
    session.attachWorld(simulation);
    const client = session.createClient(0), admitted = simulation.admitPlayer(client.id), player = simulation.movementPlayer(admitted.actor);
    if (player === null) throw new Error("AAS authoring has no selected movement actor");
    return clusterAas(buildAasReachability({ asset, geometry: content.world, scene: simulation.scene,
      profile: botNavigationProfile(player), predictionClient: client.id.slot, force: true,
      predictClientMovement: query => predictApplicationBotMovement(simulation, player, query, asset) }));
  } finally { try { session.close(); } finally { await content.close(); } }
}

export async function authorAas(argv: readonly string[]): Promise<void> {
  const [input, output, ...operations] = argv;
  const usage = "Usage: aas input.aas output.aas [--cluster] [--optimize] [--reachability --game PRODUCT --map NAME --movement q1|q2|q3 [--content-root PATH]]";
  if (input === undefined || output === undefined) throw new Error(usage);
  const options = new Map<string, string>(), flags = new Set<string>();
  for (let index = 0; index < operations.length; index++) {
    const operation = operations[index];
    if (operation === "--cluster" || operation === "--optimize" || operation === "--reachability") flags.add(operation);
    else if (operation === "--game" || operation === "--map" || operation === "--movement" || operation === "--content-root") {
      const value = operations[++index];
      if (value === undefined || value.startsWith("--") || options.has(operation)) throw new Error(usage);
      options.set(operation, value);
    } else throw new Error(usage);
  }
  if (flags.has("--reachability") ? !["--game", "--map", "--movement"].every(flag => options.has(flag)) : options.size !== 0) throw new Error(usage);
  if (resolve(input) === resolve(output)) throw new Error("AAS authoring requires a distinct output file");
  let asset = parseAas(new Uint8Array(await readFile(input)), input);
  if (flags.has("--reachability")) asset = await regenerate(asset, [...options].flatMap(([key, value]) => [key, value]));
  else if (flags.has("--cluster")) asset = clusterAas(asset);
  if (flags.has("--optimize")) asset = optimizeAas(asset);
  const bytes = writeAas(asset);
  parseAas(bytes, output, asset.bspChecksum);
  await writeFile(output, bytes, { flag: "wx" });
}
if (import.meta.main) await authorAas(Bun.argv.slice(2));
