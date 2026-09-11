import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { createContentDigest } from '../../../contracts/content.ts';
import type { MountId, ResourceId } from '../../../contracts/content.ts';
import { openArchive } from '../../../content/archive/index.ts';
import { registerQ3Pak, Q3ContentReferences } from '../../../network/q3/content.ts';
import type { Q3MountedPak } from '../../../network/q3/content.ts';
import { checkQ3DownloadName } from '../../../network/q3/pure.ts';
import type { Q3DownloadReadFile } from '../../../network/q3/download.ts';
import type { LoadedApplicationContent } from '../content.ts';

/** Native checksums and download paths refer only to the application's selected mounts. */
export class Q3ApplicationPackages {
  private readonly processed = new Set<ResourceId>();
  private constructor(readonly content: LoadedApplicationContent, readonly packs: readonly Q3MountedPak[], readonly references: Q3ContentReferences,
    private readonly members: ReadonlyMap<MountId, ReadonlySet<string>>) {}
  static async open(content: LoadedApplicationContent, checksumFeed: number): Promise<Q3ApplicationPackages> {
    const plan = content.mounts.plan, mounts = new Map(plan.mounts.map(mount => [mount.identity.id, mount]));
    const packs: Q3MountedPak[] = [], members = new Map<MountId, ReadonlySet<string>>();
    for (const id of plan.defaultOrder) {
      const mount = mounts.get(id);
      if (mount?.kind !== 'archive' || mount.format !== 'pk3') continue;
      const product = content.catalog.product(mount.identity.content);
      if (product.expectation.family !== 'q3') continue;
      const archive = await openArchive(mount.archivePath, mount.format);
      try {
        const game = product.expectation.contentDirectory.split('/').at(-1);
        if (game === undefined || game === '') throw new Error('Q3 archive has no game directory');
        packs.push(registerQ3Pak(mount, archive, game, basename(mount.archivePath).replace(/\.pk3$/i, ''), checksumFeed));
        members.set(id, new Set(archive.entries.filter(entry => !entry.isDirectory).map(entry => entry.path.toLowerCase())));
      } finally { archive.close(); }
    }
    return new Q3ApplicationPackages(content, packs, new Q3ContentReferences(packs, checksumFeed, () => 1), members);
  }
  collect(): void {
    for (const mounts of this.content.openedMounts()) for (const reference of mounts.openedResources) {
      if (this.processed.has(reference.id) || this.content.catalog.product(reference.provenance.mount.identity.content).expectation.family !== 'q3') continue;
      this.references.opened(reference); this.processed.add(reference.id);
    }
  }
  pureChecksum(path: string): number | undefined {
    return this.packs.find(pack => this.members.get(pack.mount.identity.id)?.has(path.toLowerCase()))?.pack.pureChecksum;
  }
  openDownload(name: string): Q3DownloadReadFile | null {
    checkQ3DownloadName(name);
    const mounted = this.packs.find(pack => `${pack.pack.game}/${pack.pack.basename}.pk3`.toLowerCase() === name.toLowerCase());
    if (mounted === undefined) return null;
    const descriptor = openSync(mounted.mount.archivePath, 'r');
    try {
      const original = fstatSync(descriptor, { bigint: true }), size = Number(original.size);
      if (!original.isFile() || !Number.isSafeInteger(size) || size <= 0 || size > 0x7fffffff) { closeSync(descriptor); return null; }
      const unchanged = (): void => { const current = fstatSync(descriptor, { bigint: true }); if (current.size !== original.size || current.mtimeNs !== original.mtimeNs || current.ctimeNs !== original.ctimeNs) throw new Error('Download archive changed after opening'); };
      // Mount identity guards the retained bytes; native pak fields use CRC-directory MD4 above.
      const hash = createHash('sha256'), buffer = new Uint8Array(65536);
      let offset = 0;
      while (offset < size) { const count = readSync(descriptor, buffer, 0, Math.min(buffer.length, size - offset), offset); if (count === 0) throw new Error('Truncated mounted download'); hash.update(buffer.subarray(0, count)); offset += count; }
      unchanged();
      if (createContentDigest(hash.digest('hex')) !== mounted.mount.archiveDigest) throw new Error('Download archive changed after mount');
      let position = 0, closed = false;
      return { size, read: target => { if (closed) throw new Error('Q3 download is closed'); unchanged(); const count = readSync(descriptor, target, 0, Math.min(target.length, size - position), position); position += count; return count; },
        close: () => { if (!closed) { closed = true; closeSync(descriptor); } } };
    } catch (error) { closeSync(descriptor); throw error; }
  }
}
