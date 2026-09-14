// CL_InitDownloads/CL_DownloadsComplete over the shared staged filesystem. GPL-2.0-or-later.
import { openArchive } from '../../../content/archive/index.ts';
import { Q3ClientDownload } from '../../../network/q3/download.ts';
import type { Download } from '../../../network/q3/server-message.ts';
import type { ServerPak } from '../../../network/q3/pak-references.ts';
import { checkQ3DownloadName, compareQ3Packages, q3ArchiveChecksums } from '../../../network/q3/pure.ts';
import { DownloadSink } from '../../../network/services/downloads.ts';
import { basename, dirname, resolve } from 'node:path';
import type { RemoteContentMounts } from '../content.ts';

type DownloadMounts = Pick<RemoteContentMounts, 'selection' | 'writeRoot' | 'baseWriteRoot'>;

/** Translate selected/base wire directories to their mounted filesystem spelling. */
export function q3DownloadPath(path: string, owner: DownloadMounts): string {
  checkQ3DownloadName(path);
  if (owner.selection.base !== 'q3-baseq3' || dirname(resolve(owner.writeRoot)) !== dirname(resolve(owner.baseWriteRoot)))
    throw new Error('Q3 download roots must belong to the selected Q3 family');
  const separator = path.indexOf('/');
  if (separator < 0) return path;
  const directory = path.slice(0, separator).toLowerCase();
  const physical = directory === owner.selection.directory ? basename(owner.writeRoot)
    : directory === 'baseq3' ? basename(owner.baseWriteRoot) : null;
  if (physical === null) return path;
  const mapped = physical + path.slice(separator);
  checkQ3DownloadName(mapped);
  return mapped;
}

export interface Q3ApplicationDownloadBindings {
  assertCurrent(): void;
  reliable(text: string): void;
  sendPacket(): void;
  progress(name: string, count: number, size: number): void;
  /** Refresh the mounted package catalog; the next gamestate owns map/pure/module initialization. */
  reloadPackages(): Promise<void>;
}
interface PackageRequest { readonly remote: string; readonly local: string; readonly checksum: number; }

export class Q3ApplicationClientDownloads {
  private readonly source: Q3ClientDownload;
  private queue: PackageRequest[] = [];
  private current: PackageRequest | null = null;
  private sink: DownloadSink | null = null;
  private size = 0;
  private generation = 0;
  private receiving = false;
  constructor(private readonly root: string, private readonly bindings: Q3ApplicationDownloadBindings, private readonly owner?: DownloadMounts) {
    if (owner !== undefined && resolve(root) !== dirname(resolve(owner.writeRoot)))
      throw new Error('Q3 download root differs from the selected mount family');
    this.source = new Q3ClientDownload({
      assertCurrent: () => bindings.assertCurrent(),
      reliable: text => bindings.reliable(text), sendPacket: () => bindings.sendPacket(),
      progress: (name, count, size) => bindings.progress(name, count, size),
      openTemporary: path => {
        const request = this.current;
        if (request === null || path !== `${request.local}.tmp` || this.size <= 0) throw new Error('Unexpected Q3 download temporary request');
        const sink = DownloadSink.create(this.root, this.destination(request.local), { kind: 'protocol-completion', maximumBytes: this.size });
        this.sink = sink;
        // The source closes its writer before publish; the shared sink retains its inode through validation.
        return { writeBytes: bytes => sink.append(bytes), close() {} };
      },
      publishTemporary: async (temporary, destination) => {
        const request = this.current, sink = this.sink, generation = this.generation;
        if (request === null || sink === null || temporary !== `${request.local}.tmp` || destination !== request.local)
          throw new Error('Q3 download publication does not match the current package');
        if (sink.byteLength !== this.size) throw new Error('Q3 download ended before its advertised size');
        await sink.inspectStaged(async path => {
          const archive = await openArchive(path, 'pk3');
          try {
            if ((q3ArchiveChecksums(archive, 0).checksum >>> 0) !== (request.checksum >>> 0))
              throw new Error('Downloaded Q3 package checksum differs from server references');
          } finally { archive.close(); }
        });
        bindings.assertCurrent();
        if (generation !== this.generation || sink !== this.sink) throw new Error('Q3 download was retired during validation');
        sink.finish(); this.sink = null;
      },
      completed: async () => {
        this.current = null;
        if (this.startNext()) return;
        const generation = this.generation;
        await bindings.reloadPackages(); bindings.assertCurrent();
        if (generation !== this.generation) throw new Error('Q3 downloads retired during filesystem refresh');
        bindings.reliable('donedl');
      },
    });
  }
  /** True suspends game initialization until donedl produces a new gamestate. */
  begin(referenced: readonly ServerPak[], loadedChecksums: readonly number[], exists: (path: string) => boolean): boolean {
    this.bindings.assertCurrent();
    if (this.receiving) throw new Error('Cannot replace Q3 downloads during block processing');
    this.close();
    const list = compareQ3Packages(referenced, loadedChecksums, path => exists(this.destination(path)), true);
    const loaded = new Set(loadedChecksums.map(checksum => checksum >>> 0));
    const fields = list.split('@');
    if (fields[0] !== '' || fields.length % 2 !== 1) throw new Error('Incomplete Q3 package download list');
    for (let index = 1; index < fields.length; index += 2) {
      const remote = fields[index], local = fields[index + 1];
      if (remote === undefined || local === undefined) throw new Error('Incomplete Q3 package pair');
      checkQ3DownloadName(remote); checkQ3DownloadName(local);
      // The source server retains MAX_QPATH-1 bytes; never request a silently truncated path.
      if (remote.length >= 64) throw new RangeError('Q3 download name exceeds source server MAX_QPATH');
      const matching = referenced.filter(value => value.name !== null && `${value.name}.pk3` === remote && !loaded.has(value.checksum >>> 0));
      const pack = matching[0];
      if (pack === undefined) throw new Error('Q3 download pair has no server reference');
      if (matching.some(value => (value.checksum >>> 0) !== (pack.checksum >>> 0)))
        throw new Error('Q3 server references conflicting checksums for one download name');
      this.queue.push({ remote, local, checksum: pack.checksum });
    }
    return this.startNext();
  }
  private destination(path: string): string {
    return this.owner === undefined ? path : q3DownloadPath(path, this.owner);
  }
  private startNext(): boolean {
    const request = this.queue.shift(); this.current = request ?? null; this.size = 0;
    if (request === undefined) return false;
    this.source.begin(request.remote, request.local); return true;
  }
  publishSize(size: number): number {
    this.bindings.assertCurrent();
    if (this.sink !== null && size !== this.size) throw new Error('Q3 download size changed during transfer');
    this.size = size;
    return this.source.publishSize(size);
  }
  async receive(download: Download): Promise<void> {
    if (this.receiving) throw new Error('Q3 download block processing is already active');
    this.receiving = true;
    try { await this.source.receive(download); }
    catch (error) { this.close(); throw error; }
    finally { this.receiving = false; }
  }
  close(): void {
    this.generation++; this.source.close(); this.sink?.close(); this.sink = null; this.current = null; this.queue = []; this.size = 0;
  }
}
