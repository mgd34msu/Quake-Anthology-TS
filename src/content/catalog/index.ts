import { readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { createContentId, createMountId, createMountIdentity } from "../../contracts/content.ts";
import type { ArchiveFormat, ContentDigest, ContentId, ContentMount, MountPlanId, ResolvedMountPlan } from "../../contracts/content.ts";
import { openArchive } from "../archive/index.ts";
import { digestFile, openMountPlan } from "../mounts/index.ts";
import { findContentPath, normalizeResourcePath } from "../mounts/paths.ts";
import { userProductDirectory } from "../user-data.ts";
import { expectedProducts } from "./products.ts";
import type { ProductExpectation } from "./products.ts";
import { parseAuthoredStarts } from "./start-maps.ts";
import type { AuthoredStartCatalog } from "./start-maps.ts";

export { expectedProducts } from "./products.ts";
export type { ProductExpectation } from "./products.ts";
export { resolveLaunch, selectLaunch, presetChoice } from "./launch.ts";
export type { LaunchPreset, SelectedLaunch, ResolveLaunchOptions } from "./launch.ts";
export { EQUIPMENT_PROVIDERS, disabledEquipment, nativeEquipment } from "./equipment.ts";

export interface CatalogArchive {
  readonly path: string;
  readonly format: ArchiveFormat;
  readonly entries: readonly { readonly path: string; readonly ordinal: number; readonly byteLength: number }[];
}

export interface ContentMap {
  readonly path: string;
  readonly source: string;
  readonly memberIndex: number | null;
}

export type ProductAvailability =
  | { readonly kind: "installed" }
  | { readonly kind: "missing"; readonly requirements: readonly string[] }
  | { readonly kind: "unresolved"; readonly reason: string };

export interface CatalogProduct {
  readonly id: ContentId;
  readonly expectation: ProductExpectation;
  readonly availability: ProductAvailability;
  readonly archives: readonly CatalogArchive[];
  readonly looseRoot: string | null;
  readonly userContent: { readonly root: string; readonly archives: readonly CatalogArchive[] } | null;
  readonly maps: readonly ContentMap[];
  readonly diagnostics: readonly string[];
}

export interface DiscoverContentOptions {
  readonly corpusRoot: string;
  readonly userContentRoot?: string;
  readonly products?: readonly ProductExpectation[];
  readonly generation?: number;
  readonly discoverMods?: boolean;
}

export interface MountPlanSelection {
  readonly id: MountPlanId;
  readonly assets: ContentId;
  readonly geometry: ContentId;
  readonly rules?: ContentId;
  /** An explicit presentation choice wins over the rules preset's assets. */
  readonly explicitPresentation?: boolean;
  readonly additional?: readonly ContentId[];
}

function archiveFormat(name: string): ArchiveFormat | null {
  switch (extname(name).toLowerCase()) {
    case ".pak": return "pak";
    case ".pk3": return "pk3";
    case ".kpf": return "kpf";
    case ".zip": case ".pkz": return "zip";
    default: return null;
  }
}

function sourceCompare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

/** q2repro files.c pakcmp: numeric pak prefixes first, then case-insensitive names. */
function compareQ2Archives(left: CatalogArchive, right: CatalogArchive): number {
  const first = basename(left.path).toLowerCase(), second = basename(right.path).toLowerCase();
  const firstPak = first.startsWith("pak"), secondPak = second.startsWith("pak");
  if (!firstPak || !secondPak) return firstPak ? -1 : secondPak ? 1 : sourceCompare(first, second);
  const parse = (name: string): { readonly number: bigint; readonly suffix: string } => {
    const tail = name.slice(3), match = /^[ \t\n\r\f\v]*[+-]?\d+/.exec(tail);
    if (match === null) return { number: 0n, suffix: tail };
    const value = BigInt(match[0].trim()), magnitude = value < 0n ? -value : value;
    const maximum = 0xffffffffffffffffn;
    return { number: magnitude > maximum ? maximum : BigInt.asUintN(64, value), suffix: tail.slice(match[0].length) };
  };
  const a = parse(first), b = parse(second);
  return a.number < b.number ? -1 : a.number > b.number ? 1 : sourceCompare(a.suffix, b.suffix);
}

/** Highest priority first, matching each source engine's prepend order. */
export function orderGameArchives(product: ProductExpectation, archives: readonly CatalogArchive[]): readonly CatalogArchive[] {
  const sorted = [...archives].sort((left, right) => sourceCompare(basename(left.path), basename(right.path)));
  if (product.family === "q3") return sorted.filter(archive => archive.format === "pk3")
    .sort((left, right) => sourceCompare(basename(left.path).toLowerCase(), basename(right.path).toLowerCase())).reverse();
  if (product.family === "q2") return archives.filter(archive => archive.format === "pak" || archive.format === "zip" && /\.pkz$/i.test(archive.path))
    .sort(compareQ2Archives).reverse();
  const numbered: CatalogArchive[] = [];
  const limit = archives.length + 1;
  for (let index = 0; index < limit; index++) {
    const archive = sorted.find(candidate => basename(candidate.path).toLowerCase() === `pak${index}.pak`);
    if (archive !== undefined) numbered.push(archive);
    else break;
  }
  const extra = sorted.filter(archive => archive.format === "pk3" || archive.format === "kpf");
  return [...numbered, ...extra].reverse();
}

function productDirectories(product: CatalogProduct): readonly { readonly root: string | null; readonly archives: readonly CatalogArchive[] }[] {
  const user = product.userContent;
  if (user === null) return [{ root: product.looseRoot, archives: product.archives }];
  const userArchives = new Set(user.archives);
  return [user, { root: product.looseRoot, archives: product.archives.filter(archive => !userArchives.has(archive)) }];
}

async function discoverMods(root: string, products: readonly ProductExpectation[]): Promise<readonly ProductExpectation[]> {
  const roots = new Map<string, ProductExpectation>();
  const known = new Set(products.map(product => product.contentDirectory.toLowerCase()));
  for (const product of products) if (product.baseProduct === null) roots.set(dirname(product.contentDirectory), product);
  const found: ProductExpectation[] = [];
  for (const [directory, base] of roots) {
    const installed = await findContentPath(root, directory);
    if (installed === null) continue;
    for (const entry of await readdir(installed, { withFileTypes: true })) {
      const contentDirectory = `${directory}/${entry.name}`;
      if (!entry.isDirectory() || known.has(contentDirectory.toLowerCase()) || entry.name.toLowerCase() === "rerelease") continue;
      const members = await readdir(resolve(installed, entry.name), { withFileTypes: true });
      const archives = members.filter(member => member.isFile() && archiveFormat(member.name) !== null);
      const hasContent = archives.length > 0 || members.some(member => member.isDirectory() && ["maps", "models", "vm"].includes(member.name.toLowerCase())
        || member.isFile() && /^(?:qw?progs\.dat|progs\.dat|game.*\.(?:dll|so))$/i.test(member.name));
      if (!hasContent) continue;
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(entry.name)) throw new Error(`Mod directory needs a valid content identity: ${contentDirectory}`);
      found.push({ id: `${base.family}-${base.edition}-${entry.name}`, family: base.family, edition: base.edition, campaign: entry.name,
        title: entry.name, contentDirectory, baseProduct: base.id, requiredContentArchives: archives.map(archive => `${contentDirectory}/${archive.name}`),
        requiredPrograms: [], mapWitness: null, unresolvedReason: null });
    }
  }
  return found;
}

async function looseMaps(root: string): Promise<ContentMap[]> {
  const mapsRoot = await findContentPath(root, "maps");
  if (mapsRoot === null) return [];
  const result: ContentMap[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.bsp$/i.test(entry.name)) result.push({ path: relative(root, path).replaceAll("\\", "/"), source: path, memberIndex: null });
    }
  }
  await walk(mapsRoot);
  return result.sort((left, right) => sourceCompare(left.path, right.path));
}

export class InstalledCatalog {
  readonly #byId = new Map<string, CatalogProduct>();
  readonly #digests = new Map<string, Promise<ContentDigest>>();

  constructor(readonly corpusRoot: string, readonly products: readonly CatalogProduct[], readonly rootArchives: readonly CatalogArchive[], readonly generation: number, readonly userContentRoot: string | null = null) {
    for (const product of products) {
      if (this.#byId.has(product.id) || this.#byId.has(product.expectation.id)) throw new RangeError(`Duplicate catalog identity: ${product.id}`);
      this.#byId.set(product.id, product);
      this.#byId.set(product.expectation.id, product);
    }
  }

  product(id: ContentId | string): CatalogProduct {
    const product = this.#byId.get(id);
    if (product === undefined) throw new RangeError(`Unknown requested content or mod: ${id}`);
    return product;
  }

  require(id: ContentId | string): CatalogProduct {
    const product = this.product(id);
    if (product.availability.kind === "missing") throw new Error(`Content ${id} requires: ${product.availability.requirements.join(", ")}`);
    if (product.availability.kind === "unresolved") throw new Error(`Content ${id} is unresolved: ${product.availability.reason}`);
    return product;
  }

  /** Reachable map winners, including the campaign's base content. */
  mapsFor(id: ContentId | string): readonly ContentMap[] {
    const winners = new Map<string, ContentMap>();
    const visited = new Set<ContentId>();
    const visit = (product: CatalogProduct): void => {
      if (visited.has(product.id)) throw new Error(`Cyclic base content dependency: ${product.id}`);
      visited.add(product.id);
      const add = (map: ContentMap): void => { if (!winners.has(map.path.toLowerCase())) winners.set(map.path.toLowerCase(), map); };
      for (const directory of productDirectories(product)) {
        for (const archive of orderGameArchives(product.expectation, directory.archives)) {
          const maps = product.maps.filter(map => map.source === archive.path);
          for (const map of archive.format === "pak" ? maps : [...maps].reverse()) add(map);
        }
        for (const map of product.maps) if (map.memberIndex === null && directory.root !== null && resolve(directory.root, map.path) === map.source) add(map);
      }
      if (product.expectation.baseProduct !== null) visit(this.product(product.expectation.baseProduct));
    };
    visit(this.product(id));
    return [...winners.values()];
  }

  #digest(path: string): Promise<ContentDigest> {
    const previous = this.#digests.get(path);
    if (previous !== undefined) return previous;
    const pending = digestFile(path);
    this.#digests.set(path, pending);
    return pending;
  }

  async mountsFor(id: ContentId): Promise<readonly ContentMount[]> {
    const mounts: ContentMount[] = [];
    const paths = new Set<string>();
    const visited = new Set<ContentId>();
    const addArchive = async (product: CatalogProduct, archive: CatalogArchive): Promise<void> => {
      if (paths.has(archive.path)) return;
      paths.add(archive.path);
      const name = Buffer.from(relative(this.corpusRoot, archive.path)).toString("hex");
      mounts.push({ kind: "archive", identity: createMountIdentity(createMountId(product.expectation.id, name), product.id, this.generation),
        archivePath: archive.path, archiveDigest: await this.#digest(archive.path), format: archive.format });
    };
    const visit = async (content: ContentId): Promise<void> => {
      const product = this.require(content);
      if (visited.has(product.id)) throw new Error(`Cyclic base content dependency: ${content}`);
      visited.add(product.id);
      for (const directory of productDirectories(product)) {
        for (const archive of orderGameArchives(product.expectation, directory.archives)) await addArchive(product, archive);
        if (directory.root !== null && !paths.has(directory.root)) {
          paths.add(directory.root);
          const name = Buffer.from(relative(this.corpusRoot, directory.root)).toString("hex");
          mounts.push({ kind: "loose", identity: createMountIdentity(createMountId(product.expectation.id, `loose-${name}`), product.id, this.generation), rootPath: directory.root });
        }
      }
      if (product.expectation.baseProduct !== null) await visit(this.product(product.expectation.baseProduct).id);
      if (product.expectation.edition === "rerelease" && product.expectation.baseProduct === null) {
        const root = dirname(product.looseRoot ?? resolve(this.corpusRoot, product.expectation.contentDirectory));
        for (const archive of this.rootArchives.filter(candidate => dirname(candidate.path) === root)) await addArchive(product, archive);
      }
    };
    await visit(id);
    return mounts;
  }

  async createMountPlan(selection: MountPlanSelection): Promise<ResolvedMountPlan> {
    const geometry = this.require(selection.geometry);
    let assets = this.require(selection.assets);
    let requiredRulesAssets: ContentId | null = null;
    if (selection.rules !== undefined) {
      const rules = this.require(selection.rules);
      if (rules.expectation.family === "q2" && rules.expectation.edition === "rerelease") {
        requiredRulesAssets = rules.id;
        if (selection.explicitPresentation !== true) assets = rules;
      }
    }
    const assetMounts = await this.mountsFor(assets.id);
    const geometryMounts = await this.mountsFor(geometry.id);
    const additional: ContentMount[] = [];
    if (requiredRulesAssets !== null) additional.push(...await this.mountsFor(requiredRulesAssets));
    for (const id of selection.additional ?? []) additional.push(...await this.mountsFor(id));
    const mounts = new Map<string, ContentMount>();
    const physicalKey = (mount: ContentMount): string => mount.kind === "archive" ? mount.archivePath : mount.rootPath;
    for (const mount of [...assetMounts, ...geometryMounts, ...additional]) if (!mounts.has(physicalKey(mount))) mounts.set(physicalKey(mount), mount);
    const unique = [...mounts.values()];
    const order = (first: readonly ContentMount[]): readonly ContentMount["identity"]["id"][] => {
      const ids = new Set<ContentMount["identity"]["id"]>();
      for (const mount of [...first, ...unique]) {
        const canonical = mounts.get(physicalKey(mount));
        if (canonical !== undefined) ids.add(canonical.identity.id);
      }
      return [...ids];
    };
    return { id: selection.id, mounts: unique, defaultOrder: order(assetMounts),
      prefixOrders: assets.id === geometry.id ? [] : [{ prefix: "maps/", mounts: order(geometryMounts) }] };
  }

  async read(content: ContentId, path: string): Promise<Uint8Array> {
    const mounts = await this.mountsFor(content);
    const plan: ResolvedMountPlan = { id: `mount-plan:catalog:${this.generation}`, mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] };
    using opened = await openMountPlan(plan);
    return opened.read(path);
  }

  async authoredStartsFor(id: ContentId | string): Promise<AuthoredStartCatalog | null> {
    const product = this.require(id);
    if (product.expectation.family !== "q2" || product.expectation.edition !== "rerelease") return null;
    const mounts = await this.mountsFor(product.id);
    const plan: ResolvedMountPlan = { id: `mount-plan:catalog:${this.generation}`, mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] };
    using opened = await openMountPlan(plan);
    const resource = await opened.open("mapdb.json");
    if (resource === null) return null;
    return { resource: resource.reference, ...parseAuthoredStarts(resource.bytes, product.expectation.campaign) };
  }
}

export async function discoverInstalledContent(options: DiscoverContentOptions): Promise<InstalledCatalog> {
  const corpusRoot = resolve(options.corpusRoot);
  const userContentRoot = options.userContentRoot === undefined ? null : resolve(options.userContentRoot);
  const generation = options.generation ?? 0;
  if (!Number.isSafeInteger(generation) || generation < 0) throw new RangeError("Catalog generation must be a nonnegative integer");
  const expected = options.products ?? expectedProducts;
  const corpusMods = options.discoverMods === false ? [] : await discoverMods(corpusRoot, expected);
  const userMods = options.discoverMods === false || userContentRoot === null ? [] : await discoverMods(userContentRoot, [...expected, ...corpusMods]);
  const userModIds = new Set(userMods.map(product => product.id));
  const expectations = [...expected, ...corpusMods, ...userMods];
  const archives = new Map<string, Promise<CatalogArchive>>();
  const inspect = (path: string, format: ArchiveFormat): Promise<CatalogArchive> => {
    const existing = archives.get(path);
    if (existing !== undefined) return existing;
    const pending = (async (): Promise<CatalogArchive> => {
      const archive = await openArchive(path, format);
      try { return { path, format, entries: archive.entries.filter(entry => !entry.isDirectory).map(entry => ({ path: entry.path, ordinal: entry.ordinal, byteLength: entry.byteLength })) }; }
      finally { archive.close(); }
    })();
    archives.set(path, pending);
    return pending;
  };
  const products: CatalogProduct[] = [];
  const rootArchives = new Map<string, CatalogArchive>();
  for (const expectation of expectations) {
    normalizeResourcePath(expectation.contentDirectory);
    const id = createContentId({ family: expectation.family, edition: expectation.edition, package: expectation.campaign, revision: "installed" });
    const rootPath = await findContentPath(corpusRoot, expectation.contentDirectory);
    const looseRoot = rootPath !== null && (await stat(rootPath)).isDirectory() ? rootPath : null;
    const found: CatalogArchive[] = [];
    const diagnostics: string[] = [];
    if (looseRoot !== null) {
      for (const entry of await readdir(looseRoot, { withFileTypes: true })) {
        const format = archiveFormat(entry.name);
        if (!entry.isFile() || format === null) continue;
        try { found.push(await inspect(resolve(looseRoot, entry.name), format)); }
        catch (error) { diagnostics.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      if (expectation.edition === "rerelease") {
        const kpf = expectation.family === "q1" ? "QuakeEX.kpf" : "Q2Game.kpf";
        const path = await findContentPath(dirname(looseRoot), kpf);
        if (path !== null && !rootArchives.has(path)) {
          try { rootArchives.set(path, await inspect(path, "kpf")); }
          catch (error) { diagnostics.push(`${kpf}: ${error instanceof Error ? error.message : String(error)}`); }
        }
      }
    }
    const userRoot = userContentRoot === null || userContentRoot === corpusRoot ? null
      : await findContentPath(userContentRoot, expectation.contentDirectory) ?? userProductDirectory(userContentRoot, expectation.contentDirectory);
    const userArchives: CatalogArchive[] = [];
    const userDiagnostics: string[] = [];
    if (userRoot !== null) {
      const entries = await readdir(userRoot, { withFileTypes: true }).catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
        throw error;
      });
      for (const entry of entries) {
        const format = archiveFormat(entry.name);
        if (!entry.isFile() || format === null) continue;
        try { userArchives.push(await inspect(resolve(userRoot, entry.name), format)); }
        catch (error: unknown) { userDiagnostics.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`); }
      }
    }
    const maps = found.flatMap(archive => archive.entries.filter(entry => /^maps\/.*\.bsp$/i.test(entry.path)).map(entry => ({ path: entry.path, source: archive.path, memberIndex: entry.ordinal })));
    const corpusMaps: ContentMap[] = [...maps, ...looseRoot === null ? [] : await looseMaps(looseRoot)];
    const userMaps = userArchives.flatMap(archive => archive.entries.filter(entry => /^maps\/.*\.bsp$/i.test(entry.path)).map(entry => ({ path: entry.path, source: archive.path, memberIndex: entry.ordinal })));
    const allMaps: ContentMap[] = [...userMaps, ...userRoot === null ? [] : await looseMaps(userRoot), ...corpusMaps];
    const requirements: string[] = [...diagnostics, ...userModIds.has(expectation.id) ? userDiagnostics : []];
    for (const archive of expectation.requiredContentArchives) {
      const path = await findContentPath(corpusRoot, archive) ?? (userModIds.has(expectation.id) && userContentRoot !== null ? await findContentPath(userContentRoot, archive) : null);
      if (path === null || !(await stat(path)).isFile()) requirements.push(archive);
    }
    if (looseRoot === null && !userModIds.has(expectation.id)) requirements.push(expectation.contentDirectory);
    if (expectation.mapWitness !== null && !(userModIds.has(expectation.id) ? allMaps : corpusMaps).some(map => map.path.toLowerCase() === expectation.mapWitness?.toLowerCase())) requirements.push(expectation.mapWitness);
    const availability: ProductAvailability = expectation.unresolvedReason !== null ? { kind: "unresolved", reason: expectation.unresolvedReason }
      : requirements.length > 0 ? { kind: "missing", requirements } : { kind: "installed" };
    products.push({ id, expectation, availability, archives: [...userArchives, ...found], looseRoot, userContent: userRoot === null ? null : { root: userRoot, archives: userArchives }, maps: allMaps, diagnostics: [...diagnostics, ...userDiagnostics] });
  }
  // An unreadable base remains a requirement even when its filenames are present.
  const byProduct = new Map(products.map(product => [product.expectation.id, product]));
  const checked = products.map((product): CatalogProduct => {
    if (product.availability.kind !== "installed" || product.expectation.baseProduct === null) return product;
    const base = byProduct.get(product.expectation.baseProduct);
    if (base === undefined || base.availability.kind !== "installed") return { ...product, availability: { kind: "missing", requirements: [`base product ${product.expectation.baseProduct}`] } };
    return product;
  });
  return new InstalledCatalog(corpusRoot, checked, [...rootArchives.values()], generation, userContentRoot);
}
