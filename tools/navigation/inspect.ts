// Usage: bun tools/navigation/inspect.ts <archive> <navigation-member> [bsp-member]
import { openArchive } from "../../src/content/archive/index.ts";
import { blockChecksum } from "../../src/core/md4.ts";
import { aasTravelMode, kexTravelMode, parseAas, parseKexNavigation } from "../../src/bots/navigation/index.ts";

async function main(): Promise<void> {
  const archivePath = process.argv[2], path = process.argv[3], mapPath = process.argv[4];
  if (archivePath === undefined || path === undefined) throw new Error("Usage: bun tools/navigation/inspect.ts <archive> <navigation-member> [bsp-member]");
  const archive = await openArchive(archivePath);
  try {
    const entry = archive.findEntries(path)[0];
    if (entry === undefined) throw new Error(`Navigation member missing: ${path}`);
    let checksum: number | undefined;
    if (mapPath !== undefined) {
      const mapEntry = archive.findEntries(mapPath)[0];
      if (mapEntry === undefined) throw new Error(`Map member missing: ${mapPath}`);
      checksum = blockChecksum(await archive.readEntry(mapEntry));
    }
    const bytes = await archive.readEntry(entry), asset = path.endsWith(".aas") ? parseAas(bytes, path, checksum) : parseKexNavigation(bytes, path);
    const modes = new Map<string, number>();
    const types = asset.kind === "aas" ? asset.reachability.map(reach => aasTravelMode(reach.travelType)) : asset.links.map(link => kexTravelMode(link.type));
    for (const mode of types) modes.set(mode, (modes.get(mode) ?? 0) + 1);
    console.log(JSON.stringify({ archive: archivePath, member: path, ordinal: entry.ordinal, bytes: bytes.length,
      kind: asset.kind, version: asset.version, nodes: asset.kind === "aas" ? asset.areas.length - 1 : asset.nodes.length,
      reachabilities: types.length, travelModes: Object.fromEntries(modes),
      source: asset.kind === "aas" ? { bspChecksum: asset.bspChecksum, checkedMap: mapPath ?? null,
        clusters: asset.clusters.length, portals: asset.portals.length } : { traversals: asset.traversals.length, entities: asset.entities.length, heuristic: asset.heuristic },
      admission: "Asset inspection only; route admission requires selected movement and live shared collision." }, null, 2));
  } finally { archive.close(); }
}
await main();
