import type { ArchiveMount, ContentDigest, MountId, ResolvedResourceReference } from "../../contracts/content.ts";
import type { ArchiveHandle } from "../../content/archive/index.ts";
import type { PureMountPolicy } from "../../content/mounts/index.ts";
import { PakReferences, reorderPurePaks } from "./pak-references.ts";
import type { PakCatalogEntry, PureSearchPath } from "./pak-references.ts";
import { q3ArchiveChecksums } from "./pure.ts";

export interface Q3MountedPak { readonly mount: ArchiveMount; readonly pack: PakCatalogEntry; }
/** Archive ownership and strong content identity stay with the mounted content provider. */
export function registerQ3Pak(mount: ArchiveMount, archive: ArchiveHandle, game: string, basename: string, checksumFeed: number): Q3MountedPak {
  const checksums = q3ArchiveChecksums(archive, checksumFeed);
  return { mount, pack: { game, basename, archivePath: mount.archivePath, ...checksums } };
}
/** Called on actual resolved opens, so source pak flags follow provenance rather than guessed filenames. */
export class Q3ContentReferences {
  readonly references: PakReferences;
  private readonly byMount = new Map<MountId, Q3MountedPak>();
  constructor(readonly packs: readonly Q3MountedPak[], checksumFeed: number, random: () => number) {
    for (const pak of packs) {
      if (this.byMount.has(pak.mount.identity.id)) throw new RangeError("Duplicate Q3 mounted pak identity");
      this.byMount.set(pak.mount.identity.id, pak);
    }
    this.references = new PakReferences({ packs: packs.map(pak => pak.pack), checksumFeed, random });
  }
  opened(reference: ResolvedResourceReference): void {
    const provenance = reference.provenance;
    if (provenance.kind === "loose") { this.references.recordLooseOpen(reference.requestedPath); return; }
    const pak = this.byMount.get(provenance.mount.identity.id);
    if (pak === undefined || pak.mount.archiveDigest !== provenance.mount.archiveDigest || pak.mount.identity.generation !== provenance.mount.identity.generation) {
      throw new Error("Opened source resource does not belong to this Q3 pak catalog");
    }
    this.references.recordPackedOpen(pak.pack, reference.requestedPath);
  }
  /** Maps Q3 source checksums to the already identified archive bytes consumed by openMountPlan. */
  pureMountPolicy(serverChecksums: readonly number[]): PureMountPolicy {
    if (serverChecksums.length === 0) return { archives: [] };
    const paths: PureSearchPath<Q3MountedPak>[] = this.packs.map(value => ({ kind: "pak", checksum: value.pack.checksum, value }));
    const accepted = new Set(serverChecksums.map(value => value >>> 0)), archives: ContentDigest[] = [];
    for (const path of reorderPurePaks(paths, serverChecksums)) {
      if (path.kind === "pak" && accepted.has(path.checksum >>> 0)) archives.push(path.value.mount.archiveDigest);
    }
    if (archives.length === 0) throw new Error("No installed Q3 archives match the server pure list");
    return { archives };
  }
  referencedPureCommand(serverId: number): string { return `cp ${serverId} ${this.references.referencedPakPureChecksums()}`; }
}
