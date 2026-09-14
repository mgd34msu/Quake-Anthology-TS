import { createHash } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import { relative } from "node:path";
import { createContentDigest, createResourceId } from "../../contracts/content.ts";
import type { ArchiveMount, ContentDigest, ContentMount, LooseMount, MountId, ResolvedMountPlan, ResolvedResourceReference, ResourceProvenance, ResourceResolution } from "../../contracts/content.ts";
import { openArchive, readLooseEntry } from "../archive/index.ts";
import type { ArchiveHandle } from "../archive/index.ts";
import { findContentPath, isMissingFile, normalizeResourcePath } from "./paths.ts";

export { findContentPath, normalizeResourcePath } from "./paths.ts";

export function digestBytes(bytes: Uint8Array): ContentDigest {
  return createContentDigest(createHash("sha256").update(bytes).digest("hex"));
}

export async function digestFile(path: string): Promise<ContentDigest> {
  const hash = createHash("sha256");
  const file = await open(path, "r");
  try {
    const bytes = new Uint8Array(1024 * 1024);
    while (true) {
      const read = await file.read(bytes);
      if (read.bytesRead === 0) break;
      hash.update(bytes.subarray(0, read.bytesRead));
    }
    return createContentDigest(hash.digest("hex"));
  } finally {
    await file.close();
  }
}

export interface ResourceLink {
  readonly sourcePrefix: string;
  readonly mount: MountId;
  readonly targetPrefix: string;
}

/** The network adapter resolves native pure checksums to verified archive digests. */
export interface PureMountPolicy {
  readonly archives: readonly ContentDigest[];
}

export interface OpenMountOptions {
  readonly pure?: PureMountPolicy;
  readonly links?: readonly ResourceLink[];
  readonly looseComparison?: "exact" | "case-insensitive";
}

export interface OpenedResource {
  readonly reference: ResolvedResourceReference;
  readonly bytes: Uint8Array;
}

interface ArchiveSource { readonly kind: "archive"; readonly mount: ArchiveMount; readonly archive: ArchiveHandle; }
interface LooseSource { readonly kind: "loose"; readonly mount: LooseMount; }
type MountedSource = ArchiveSource | LooseSource;

function validateOrder(order: readonly MountId[], mounts: ReadonlyMap<MountId, ContentMount>): void {
  const seen = new Set<MountId>();
  for (const id of order) {
    if (!mounts.has(id)) throw new RangeError(`Mount order refers to unknown mount: ${id}`);
    if (seen.has(id)) throw new RangeError(`Mount order repeats mount: ${id}`);
    seen.add(id);
  }
  if (seen.size !== mounts.size) throw new RangeError("Mount order must include every fallback mount");
}

function pureOrder(order: readonly MountId[], mounts: ReadonlyMap<MountId, ContentMount>, pure: PureMountPolicy | undefined): readonly MountId[] {
  if (pure === undefined || pure.archives.length === 0) return order;
  const remaining = [...order];
  const first: MountId[] = [];
  for (const digest of pure.archives) {
    const position = remaining.findIndex(id => {
      const mount = mounts.get(id);
      return mount?.kind === "archive" && mount.archiveDigest === digest;
    });
    if (position < 0) continue;
    const selected = remaining.splice(position, 1)[0];
    if (selected !== undefined) first.push(selected);
  }
  return [...first, ...remaining];
}

function pureLoosePath(path: string): boolean {
  return /\.(?:cfg|menu|game|dm_68|dat)$/i.test(path);
}

export type MountedContentReader = Readonly<Pick<MountedContent, "plan" | "open" | "resolve" | "read">>;

function resolveOrder(plan: ResolvedMountPlan, mounts: ReadonlyMap<MountId, ContentMount>, pure: PureMountPolicy | undefined): ResolvedMountPlan {
  validateOrder(plan.defaultOrder, mounts);
  for (const order of plan.prefixOrders) {
    normalizeResourcePath(order.prefix.replace(/\/$/, ""));
    validateOrder(order.mounts, mounts);
  }
  return { ...plan, defaultOrder: [...pureOrder(plan.defaultOrder, mounts, pure)],
    prefixOrders: plan.prefixOrders.map(order => ({ ...order, mounts: [...pureOrder(order.mounts, mounts, pure)] })) };
}

/** A selected plan owns its open archives; no process-global search path is mutated. */
export class MountedContent {
  readonly #sources = new Map<MountId, MountedSource>();
  readonly #referenced = new Map<MountId, ArchiveMount>();
  readonly #openedResources = new Map<string, ResolvedResourceReference>();
  #closed = false;

  constructor(readonly plan: ResolvedMountPlan, sources: readonly MountedSource[], readonly options: OpenMountOptions = {}) {
    for (const source of sources) this.#sources.set(source.mount.identity.id, source);
  }

  get openedResources(): readonly ResolvedResourceReference[] { return [...this.#openedResources.values()]; }

  get referencedArchives(): readonly ArchiveMount[] { return [...this.#referenced.values()]; }

  assertOpen(): void { if (this.#closed) throw new Error("Content mount plan is closed"); }

  /** Borrows verified sources until this owner closes; the reader cannot close them. */
  borrowOrderedReader(order: Pick<ResolvedMountPlan, "id" | "defaultOrder" | "prefixOrders">): MountedContentReader {
    this.assertOpen();
    const mounts = new Map(this.plan.mounts.map(mount => [mount.identity.id, mount]));
    const plan = resolveOrder({ ...order, mounts: this.plan.mounts }, mounts, this.options.pure);
    const openedResources = new Map<string, ResolvedResourceReference>();
    const open: MountedContentReader["open"] = (path, acceptMount = () => true) => this.#open(plan, path, acceptMount, openedResources);
    return { plan, open, resolve: async path => (await open(path))?.reference ?? null,
      read: async resource => {
        if (typeof resource !== "string") return this.#read(resource, openedResources);
        const opened = await open(resource);
        if (opened === null) throw new Error(`Resource not found: ${resource}`);
        return opened.bytes;
      } };
  }

  #allowed(source: MountedSource, path: string): boolean {
    const pure = this.options.pure;
    if (pure === undefined || pure.archives.length === 0) return true;
    return source.kind === "archive" ? pure.archives.includes(source.mount.archiveDigest) : pureLoosePath(path);
  }

  async #readSource(source: MountedSource, memberPath: string): Promise<{ readonly bytes: Uint8Array; readonly provenance: ResourceProvenance } | null> {
    if (!this.#allowed(source, memberPath)) return null;
    if (source.kind === "archive") {
      const entries = source.archive.entries.filter(entry => !entry.isDirectory && entry.path.toLowerCase() === memberPath.toLowerCase());
      // PACK walks directory records forward; the Q3 ZIP index replaces duplicate names.
      const entry = source.mount.format === "pak" ? entries[0] : entries.at(-1);
      if (entry === undefined) return null;
      const bytes = await source.archive.readEntry(entry);
      return { bytes, provenance: { kind: "archive", mount: source.mount, memberPath: entry.path, memberIndex: entry.ordinal } };
    }
    const path = await findContentPath(source.mount.rootPath, memberPath, this.options.looseComparison);
    if (path === null || !(await stat(path)).isFile()) return null;
    const actualPath = relative(source.mount.rootPath, path).replaceAll("\\", "/");
    return { bytes: await readLooseEntry(source.mount.rootPath, actualPath), provenance: { kind: "loose", mount: source.mount, memberPath: actualPath } };
  }

  #opened(requestedPath: string, read: { readonly bytes: Uint8Array; readonly provenance: ResourceProvenance }, resolution: ResourceResolution, openedResources: Map<string, ResolvedResourceReference>): OpenedResource {
    const resource = { requestedPath, provenance: read.provenance, digest: digestBytes(read.bytes), byteLength: read.bytes.length, resolution };
    if (read.provenance.kind === "archive") this.#referenced.set(read.provenance.mount.identity.id, read.provenance.mount);
    const reference = { ...resource, id: createResourceId(resource) };
    openedResources.set(`${reference.provenance.mount.identity.id}:${requestedPath}`, reference);
    return { reference, bytes: read.bytes };
  }

  async open(path: string, acceptMount: (mount: ContentMount) => boolean = () => true): Promise<OpenedResource | null> {
    return this.#open(this.plan, path, acceptMount, this.#openedResources);
  }

  async #open(plan: ResolvedMountPlan, path: string, acceptMount: (mount: ContentMount) => boolean,
    openedResources: Map<string, ResolvedResourceReference>): Promise<OpenedResource | null> {
    this.assertOpen();
    const requestedPath = normalizeResourcePath(path);
    for (const link of this.options.links ?? []) {
      if (!requestedPath.startsWith(link.sourcePrefix)) continue;
      const source = this.#sources.get(link.mount);
      if (source === undefined) throw new Error(`Unknown link mount: ${link.mount}`);
      if (!acceptMount(source.mount)) return null;
      const targetPath = normalizeResourcePath(link.targetPrefix + requestedPath.slice(link.sourcePrefix.length));
      const read = await this.#readSource(source, targetPath);
      this.assertOpen();
      return read === null ? null : this.#opened(requestedPath, read, { kind: "link", plan: plan.id, sourcePrefix: link.sourcePrefix, targetPath }, openedResources);
    }
    const prefix = plan.prefixOrders.find(order => requestedPath.toLowerCase().startsWith(order.prefix.toLowerCase()));
    const order = prefix?.mounts ?? plan.defaultOrder;
    for (const [rank, id] of order.entries()) {
      const source = this.#sources.get(id);
      if (source === undefined) throw new Error(`Unknown mounted source: ${id}`);
      if (!acceptMount(source.mount)) continue;
      const read = await this.#readSource(source, requestedPath);
      this.assertOpen();
      if (read !== null) {
        const resolution: ResourceResolution = prefix === undefined
          ? { kind: "default-order", plan: plan.id, rank }
          : { kind: "prefix-order", plan: plan.id, prefix: prefix.prefix, rank };
        return this.#opened(requestedPath, read, resolution, openedResources);
      }
    }
    return null;
  }

  async resolve(path: string): Promise<ResolvedResourceReference | null> { return (await this.open(path))?.reference ?? null; }

  /** Q3 FS_ListFilteredFiles without a filter, in selected mount and archive-directory order. */
  async listFiles(path: string, extension: string): Promise<readonly string[]> {
    this.assertOpen();
    if (path.length >= 256 || [...path, ...extension].some(character => character.charCodeAt(0) > 255 || character === "\0")) {
      throw new RangeError("Q3 file listing exceeds source path representation");
    }
    const directory = path.replace(/[\\/]$/, "");
    if (directory !== "") normalizeResourcePath(directory);
    const prefix = this.plan.prefixOrders.find(order => `${directory}/`.toLowerCase().startsWith(order.prefix.toLowerCase()));
    const names: string[] = [], seen = new Set<string>();
    const add = (name: string): void => {
      if (names.length < 4095 && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); names.push(name); }
    };
    const depth = (value: string): number => [...value].filter(character => character === "/" || character === "\\").length;
    const suffix = (name: string): boolean => name.toLowerCase().endsWith(extension.toLowerCase());
    for (const id of prefix?.mounts ?? this.plan.defaultOrder) {
      const source = this.#sources.get(id);
      if (source === undefined) throw new Error(`Unknown mounted source: ${id}`);
      if (source.kind === "archive") {
        for (const entry of source.archive.entries) {
          const name = entry.path, lastSeparator = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
          if (!this.#allowed(source, name) || depth(name) - depth(path) > 2 || directory.length > Math.max(0, lastSeparator)
            || name.slice(0, directory.length).toLowerCase() !== directory.toLowerCase() || !suffix(name)) continue;
          add(name.slice(directory.length === 0 ? 0 : directory.length + 1));
        }
      } else {
        if ((this.options.pure?.archives.length ?? 0) !== 0) continue;
        const location = directory === "" ? source.mount.rootPath
          : await findContentPath(source.mount.rootPath, directory, this.options.looseComparison);
        if (location === null) continue;
        const entries = await readdir(location, { withFileTypes: true }).catch((error: unknown) => {
          if (isMissingFile(error)) return [];
          throw error;
        });
        this.assertOpen();
        for (const entry of entries) {
          if (entry.isSymbolicLink()) continue;
          if ((extension === "/") !== entry.isDirectory() || extension !== "/" && !suffix(entry.name)) continue;
          add(entry.name);
        }
      }
    }
    this.assertOpen();
    return names;
  }

  async read(resource: string | ResolvedResourceReference): Promise<Uint8Array> {
    return this.#read(resource, this.#openedResources);
  }

  async #read(resource: string | ResolvedResourceReference, openedResources: Map<string, ResolvedResourceReference>): Promise<Uint8Array> {
    this.assertOpen();
    if (typeof resource === "string") {
      const opened = await this.open(resource);
      if (opened === null) throw new Error(`Resource not found: ${resource}`);
      return opened.bytes;
    }
    const source = this.#sources.get(resource.provenance.mount.identity.id);
    if (source === undefined || source.mount.identity.content !== resource.provenance.mount.identity.content
      || source.mount.identity.generation !== resource.provenance.mount.identity.generation) throw new Error(`Stale resource mount: ${resource.id}`);
    let bytes: Uint8Array;
    if (resource.provenance.kind === "archive") {
      if (source.kind !== "archive" || source.mount.archiveDigest !== resource.provenance.mount.archiveDigest) throw new Error(`Archive identity changed: ${resource.id}`);
      const memberIndex = resource.provenance.memberIndex;
      const entry = source.archive.entries.find(candidate => candidate.ordinal === memberIndex);
      if (entry === undefined || entry.path !== resource.provenance.memberPath) throw new Error(`Archive member identity changed: ${resource.id}`);
      if (!this.#allowed(source, entry.path)) throw new Error(`Resource excluded by pure policy: ${resource.requestedPath}`);
      bytes = await source.archive.readEntry(entry);
      this.#referenced.set(source.mount.identity.id, source.mount);
    } else {
      if (source.kind !== "loose" || source.mount.rootPath !== resource.provenance.mount.rootPath) throw new Error(`Loose root identity changed: ${resource.id}`);
      const read = await this.#readSource(source, resource.provenance.memberPath);
      if (read === null) throw new Error(`Resource is no longer available: ${resource.requestedPath}`);
      bytes = read.bytes;
    }
    this.assertOpen();
    if (bytes.length !== resource.byteLength || digestBytes(bytes) !== resource.digest) throw new Error(`Resource bytes changed since resolution: ${resource.requestedPath}`);
    openedResources.set(`${resource.provenance.mount.identity.id}:${resource.requestedPath}`, resource);
    return bytes;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#openedResources.clear();
    for (const source of this.#sources.values()) if (source.kind === "archive") source.archive.close();
  }

  [Symbol.dispose](): void { this.close(); }
}

export async function openMountPlan(plan: ResolvedMountPlan, options: OpenMountOptions = {}): Promise<MountedContent> {
  const mounts = new Map<MountId, ContentMount>();
  for (const mount of plan.mounts) {
    if (mounts.has(mount.identity.id)) throw new RangeError(`Repeated mount identity: ${mount.identity.id}`);
    mounts.set(mount.identity.id, mount);
  }
  const resolvedPlan = resolveOrder(plan, mounts, options.pure);
  for (const link of options.links ?? []) {
    if (mounts.get(link.mount)?.kind !== "loose") throw new RangeError(`Link must target a mounted loose root: ${link.mount}`);
    normalizeResourcePath(link.sourcePrefix.replace(/\/$/, ""));
    if (link.targetPrefix) normalizeResourcePath(link.targetPrefix.replace(/\/$/, ""));
  }
  const available = new Set(plan.mounts.flatMap(mount => mount.kind === "archive" ? [mount.archiveDigest] : []));
  for (const digest of options.pure?.archives ?? []) if (!available.has(digest)) throw new Error(`Required pure archive is missing: ${digest}`);
  const sources: MountedSource[] = [];
  try {
    for (const mount of plan.mounts) {
      if (mount.kind === "loose") sources.push({ kind: "loose", mount });
      else {
        if (await digestFile(mount.archivePath) !== mount.archiveDigest) throw new Error(`Archive bytes changed before mount: ${mount.archivePath}`);
        sources.push({ kind: "archive", mount, archive: await openArchive(mount.archivePath, mount.format) });
      }
    }
    return new MountedContent(resolvedPlan, sources, options);
  } catch (error) {
    for (const source of sources) if (source.kind === "archive") source.archive.close();
    throw error;
  }
}

export function canDownloadResource(resource: ResolvedResourceReference): boolean {
  return !(resource.provenance.mount.identity.content.startsWith("q2:") && resource.provenance.kind === "archive"
    && resource.requestedPath.toLowerCase().startsWith("maps/"));
}
