import type { ContentMount } from "../../contracts/content.ts";
import type { InstalledCatalog } from "../../content/catalog/index.ts";
import type { MountedContent, OpenedResource } from "../../content/mounts/index.ts";
import type { SceneAsset, SceneAssetReader } from "../../render/scene/textures.ts";

/** Original dimensions belong to the winning product, including installed mods. */
export function mountedImageReader(catalog: InstalledCatalog, mounts: MountedContent): SceneAssetReader {
  const winners = new Map<string, ContentMount | null>();
  const userMount = (mount: ContentMount): boolean => {
    const user = catalog.product(mount.identity.content).userContent;
    return user !== null && (mount.kind === "loose" ? mount.rootPath === user.root : user.archives.some(archive => archive.path === mount.archivePath));
  };
  const image = (asset: OpenedResource | null): SceneAsset | null => asset === null ? null
    : { bytes: asset.bytes, source: { kind: "resource", resource: asset.reference } };
  return {
    read: async path => {
      const asset = await mounts.open(path);
      winners.set(path, asset?.reference.provenance.mount ?? null);
      return image(asset);
    },
    readOriginal: async path => {
      mounts.assertOpen();
      let winner = winners.get(path);
      if (winner === undefined) {
        winner = (await mounts.open(path))?.reference.provenance.mount ?? null;
        winners.set(path, winner);
      }
      if (winner === null || !userMount(winner)) return null;
      const content = winner.identity.content;
      return image(await mounts.open(path, mount => mount.identity.content === content && !userMount(mount)));
    },
  };
}
