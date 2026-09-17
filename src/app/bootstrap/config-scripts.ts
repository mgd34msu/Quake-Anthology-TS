import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CommandContext } from "../../contracts/common.ts";
import type { SeatId } from "../../contracts/identity.ts";
import type { ContentId } from "../../contracts/content.ts";
import { createMountPlanId } from "../../contracts/content.ts";
import type { InstalledCatalog } from "../../content/catalog/index.ts";
import type { MountedContent } from "../../content/mounts/index.ts";
import { findContentPath, normalizeResourcePath } from "../../content/mounts/paths.ts";
import { defaultUserContentRoot } from "../../content/user-data.ts";
import { ConfigStore } from "../../settings/config.ts";

/** Configuration follows the selected source and its bases, independently of mixed assets. */
export function sourceScriptReader(catalog: InstalledCatalog, mounts: MountedContent, source: ContentId): (name: string) => Promise<Uint8Array | undefined> {
  const owners: ContentId[] = [];
  let product = catalog.product(source);
  for (;;) {
    if (owners.includes(product.id)) throw new Error(`Cyclic configuration source dependency: ${source}`);
    owners.push(product.id);
    if (product.expectation.baseProduct === null) break;
    product = catalog.product(product.expectation.baseProduct);
  }
  const allowed = new Set(owners), byMount = new Map(mounts.plan.mounts.map(mount => [mount.identity.id, mount]));
  const primary = owners.flatMap(owner => mounts.plan.defaultOrder.filter(id => byMount.get(id)?.identity.content === owner));
  const ordered = new Set(primary);
  const reader = mounts.borrowOrderedReader({ id: createMountPlanId("configuration", Buffer.from(`${mounts.plan.id}/${source}`).toString("hex")),
    defaultOrder: [...primary, ...mounts.plan.defaultOrder.filter(id => !ordered.has(id))], prefixOrders: [] });
  return async name => (await reader.open(name, mount => allowed.has(mount.identity.content)))?.bytes;
}

export function consoleConfigRoot(userContentRoot: string | undefined): string {
  return join(userContentRoot ?? defaultUserContentRoot(), "console");
}

export function seatConsoleConfig(root: string, seat: SeatId): ConfigStore {
  return new ConfigStore(join(root, "settings", `seat-${seat.index}`));
}

export interface LegacyConsoleConfigSources {
  readonly sharedRoot: string;
  readonly gameRoots: readonly string[];
}

export interface ConsoleScriptEntry {
  readonly name: string;
  readonly kind: "seat" | "product";
}

async function configNames(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true }).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  });
  const names: string[] = [];
  for (const entry of entries) {
    const name = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) names.push(...await configNames(root, name));
    else if (entry.isFile() && name.toLowerCase().endsWith(".cfg")) names.push(name);
  }
  return names;
}

async function legacyConfigPath(sources: LegacyConsoleConfigSources): Promise<string | null> {
  const shared = await findContentPath(sources.sharedRoot, "config.cfg");
  if (shared !== null && (await stat(shared)).isFile()) return shared;
  let newest: { readonly path: string; readonly modified: number } | null = null;
  for (const root of sources.gameRoots) {
    const path = await findContentPath(root, "config.cfg");
    if (path === null) continue;
    const entry = await stat(path);
    if (entry.isFile() && (newest === null || entry.mtimeMs > newest.modified)) newest = { path, modified: entry.mtimeMs };
  }
  return newest?.path ?? null;
}

/** Read the invoking seat's exported config, then its product's user files, then mounted content. */
export async function readConsoleScript(options: {
  readonly name: string;
  readonly source: CommandContext;
  readonly consoleRoot: string;
  readonly settings: ConfigStore;
  readonly mounted: ((name: string) => Promise<Uint8Array | undefined>) | undefined;
  readonly mountedScript?: (name: string) => Promise<Uint8Array | undefined>;
  readonly legacyConfig?: LegacyConsoleConfigSources;
}): Promise<string | undefined> {
  const name = normalizeResourcePath(options.name);
  let origin = options.source.origin;
  while (origin.kind === "script") origin = origin.caller;
  if (origin.kind === "remote-client") throw new Error("Remote clients cannot read local configuration scripts");
  const seat = origin.kind === "local-seat" ? origin.seat : null;
  if (seat !== null) {
    const path = await findContentPath(options.consoleRoot, `settings/seat-${seat.index}/${name}`);
    if (path !== null) return (await readFile(path)).toString("latin1");
  }
  if (options.legacyConfig !== undefined && name.toLowerCase() === "config.cfg") {
    const legacy = await legacyConfigPath(options.legacyConfig);
    if (legacy !== null) return (await readFile(legacy)).toString("latin1");
  }
  const path = await findContentPath(options.settings.root, name);
  if (path !== null) return (await readFile(path)).toString("latin1");
  const bytes = await (options.mountedScript ?? options.mounted)?.(name);
  return bytes === undefined ? undefined : Buffer.from(bytes).toString("latin1");
}

export class ConsoleScriptFiles {
  private writes: Promise<void> = Promise.resolve();
  private reads = 0;
  private retiring = false;
  private retirement: Promise<void> | null = null;
  private readsSettled: (() => void) | null = null;
  constructor(private readonly options: Omit<Parameters<typeof readConsoleScript>[0], "name" | "source">,
    private readonly retireMounted?: () => Promise<void>) {}
  async list(source: CommandContext): Promise<readonly ConsoleScriptEntry[]> {
    this.acquireRead();
    try {
      let origin = source.origin;
      while (origin.kind === "script") origin = origin.caller;
      if (origin.kind === "remote-client") throw new Error("Remote clients cannot list local configuration scripts");
      await this.writes;
      const entries = new Map<string, ConsoleScriptEntry>();
      for (const name of await configNames(this.options.settings.root)) entries.set(name.toLowerCase(), { name, kind: "product" });
      if (origin.kind === "local-seat") {
        for (const name of await configNames(seatConsoleConfig(this.options.consoleRoot, origin.seat).root)) {
          entries.set(name.toLowerCase(), { name, kind: "seat" });
        }
      }
      return [...entries.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    } finally { this.releaseRead(); }
  }
  async read(name: string, source: CommandContext): Promise<string | undefined> {
    this.acquireRead();
    try {
      await this.writes;
      return await readConsoleScript({ ...this.options, name, source });
    } finally { this.releaseRead(); }
  }
  async readMountedScript(name: string): Promise<Uint8Array | undefined> {
    this.acquireRead();
    try { return await (this.options.mountedScript ?? this.options.mounted)?.(name); }
    finally { this.releaseRead(); }
  }
  async readMounted(name: string): Promise<Uint8Array | undefined> {
    this.acquireRead();
    try { return await this.options.mounted?.(name); }
    finally { this.releaseRead(); }
  }
  close(): Promise<void> {
    if (this.retirement !== null) return this.retirement;
    this.retiring = true;
    const settled = this.reads === 0 ? Promise.resolve() : new Promise<void>(resolve => { this.readsSettled = resolve; });
    this.retirement = settled.then(() => this.retireMounted?.());
    return this.retirement;
  }
  private acquireRead(): void {
    if (this.retiring) throw new Error("Configuration reader is retired");
    this.reads++;
  }
  private releaseRead(): void {
    this.reads--;
    if (this.reads === 0) { this.readsSettled?.(); this.readsSettled = null; }
  }
  write(operation: () => Promise<void>): Promise<void> {
    const pending = this.writes.then(operation);
    this.writes = pending.catch(() => undefined);
    return pending;
  }
}
