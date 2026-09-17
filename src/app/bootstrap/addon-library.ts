import { containedFileParts } from "../../platform/files/contained.ts";
import { pathToFileURL } from "node:url";
import { createContentDigest } from "../../contracts/content.ts";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { openArchive } from "../../content/archive/index.ts";
import { managedAddonHidden, addonInstallPath, parseAddonCatalog, quaddictedCatalogUrl, resolveAddonPackages, type AddonPackage } from "../../content/catalog/addons.ts";
import type { HttpDownloadResult } from "../../network/services/http-downloads.ts";
import { HttpDownloadQueue } from "../../network/services/http-downloads.ts";
import { UserFileStore } from "../../platform/files/writable.ts";
import { isRecord } from "../../network/common/value.ts";
import type { LibraryEntry, LibraryMenuService } from "../../ui/library/menu.ts";

interface InstalledAddon { readonly directory: string; readonly group: string; readonly sha256: string; readonly title: string; readonly start: string | null; }
export interface AddonLibraryOptions {
  readonly root: string;
  readonly edition?: "classic" | "rerelease";
  changed(): Promise<void>;
  launch(product: string, map: string | null): void;
}
/** Managed packages have isolated product directories; the original game files are never changed. */
export class AddonLibrary implements LibraryMenuService {
  private catalog: readonly AddonPackage[] = [];
  private installed: readonly InstalledAddon[] = [];
  private selected: AddonPackage | null = null;
  private selectedLocal: InstalledAddon | null = null;
  private message = "Quaddicted — community Quake add-ons";
  private pending: Promise<void> | null = null;
  private queue: HttpDownloadQueue | null = null;
  private closed = false;
  private cancelled = false;
  private readonly abort = new AbortController();
  constructor(private readonly options: AddonLibraryOptions) {}
  private get contentParent(): string { return this.options.edition === "rerelease" ? "q1/rerelease" : "q1"; }
  private product(directory: string): string { return `q1-${this.options.edition ?? "classic"}-${directory}`; }
  scope(): string { return this.selectedLocal === null ? this.selected === null ? "catalog" : `package:${this.selected.sha256}` : `installed:${this.selectedLocal.directory}`; }
  status(): string { return this.message; }
  entries(): readonly LibraryEntry[] {
    const local = this.selectedLocal;
    if (local !== null) return [{ id: "local-play", label: "Play", detail: local.title }, { id: "local-remove", label: "Remove installed add-on", detail: local.title }, { id: "back", label: "Back to add-ons" }];
    const selected = this.selected;
    if (selected !== null) {
      const installed = this.installed.find(item => item.group === selected.group);
      return [
        ...(installed === undefined ? [] : [{ id: "play", label: "Play", detail: installed.title }, { id: "remove", label: "Remove installed add-on", detail: "Only this managed copy" }]),
        ...(installed?.sha256 === selected.sha256 ? [] : [{ id: "install", label: installed === undefined ? "Install" : "Update", detail: `${selected.title} — ${Math.ceil(selected.bytes / 1024)} KiB`, ...(selected.unavailable === null ? {} : { unavailable: selected.unavailable }) }]),
        { id: "back", label: "Back to add-ons" },
      ];
    }
    const rows: LibraryEntry[] = this.catalog.map(item => ({ id: item.sha256, label: item.title,
      detail: this.installed.some(saved => saved.group === item.group) ? "Installed" : "Quaddicted" }));
    for (const item of this.installed) if (!rows.some(row => row.id === item.sha256)) rows.unshift({ id: `local:${item.directory}`, label: item.title, detail: "Installed — play" });
    return rows;
  }
  readonly stop = { label: "Cancel download", activate: (): void => { this.cancelled = true; this.queue?.cancel(); } };
  refresh(): void { this.run(async () => {
    await this.readInstalled();
    this.message = "Reading Quaddicted catalog…";
    try {
      const response = await fetch(quaddictedCatalogUrl, { signal: this.abort.signal });
      if (!response.ok) throw new Error(`Quaddicted returned HTTP ${response.status}`);
      const text = await response.text();
      const data: unknown = JSON.parse(text);
      const catalog = parseAddonCatalog(data);
      await this.ensureDirectory(".addons");
      const cached = new UserFileStore(this.options.root).open(".addons/quaddicted.json", "write");
      if (cached === null) throw new Error("Cannot save add-on catalog");
      try { cached.write(new TextEncoder().encode(text)); } finally { cached.close(); }
      this.catalog = catalog;
    } catch (error) {
      if (this.closed) return;
      try { const data: unknown = JSON.parse(await readFile(join(this.options.root, ".addons", "quaddicted.json"), "utf8")); this.catalog = parseAddonCatalog(data); }
      catch { throw error; }
      this.message = "Quaddicted unavailable — showing cached catalog"; return;
    }
    this.message = `Quaddicted — ${this.catalog.length} community packages`;
  }); }
  activate(id: string): void {
    if (this.pending !== null) return;
    if (id === "back") { this.selected = null; this.selectedLocal = null; return; }
    if (id === "local-play" && this.selectedLocal !== null) { const local = this.selectedLocal; this.run(async () => this.options.launch(this.product(local.directory), local.start)); return; }
    if (id === "local-remove" && this.selectedLocal !== null) { const local = this.selectedLocal; this.run(async () => { await this.removeInstalled(local); this.selectedLocal = null; this.message = `Removed ${local.title}`; }); return; }
    const local = this.installed.find(item => `local:${item.directory}` === id);
    if (local !== undefined) { this.selectedLocal = local; return; }
    const selected = this.selected;
    if (selected === null) { this.selected = this.catalog.find(item => item.sha256 === id) ?? null; return; }
    const installed = this.installed.find(item => item.group === selected.group);
    if (id === "play" && installed !== undefined) this.run(async () => this.options.launch(this.product(installed.directory), installed.start));
    else if (id === "install") this.run(() => this.install(selected));
    else if (id === "remove" && installed !== undefined) this.run(async () => {
      await this.removeInstalled(installed); this.message = `Removed ${installed.title}`;
    });
  }
  readonly create = { label: "Import Quake ZIP", submit: (path: string): void => { this.run(() => this.importLocal(path)); } };
  private async importLocal(path: string): Promise<void> {
    const bytes = await readFile(path), sha256 = createHash("sha256").update(bytes).digest("hex");
    const archive = await openArchive(path);
    let gameDirectory = "id1";
    try {
      if (archive.format !== "zip") throw new Error("Select a Quake ZIP package");
      const roots = new Set(archive.entries.filter(entry => !entry.isDirectory).map(entry => entry.path.split("/")[0]));
      const only = [...roots][0];
      if (roots.size === 1 && only !== undefined && !["maps", "progs", "gfx", "sound", "music", "textures"].includes(only) && /^[a-zA-Z0-9_+-]+$/.test(only)) gameDirectory = only;
    } finally { archive.close(); }
    const filename = basename(path), item: AddonPackage = { digest: createContentDigest(sha256), sha256, title: filename.replace(/\.zip$/i, ""), filename,
      group: "local:" + filename.toLowerCase(), bytes: bytes.byteLength, url: pathToFileURL(path), tags: [], starts: [], gameDirectory,
      mappings: [{ from: "", to: "" }], unavailable: null };
    const cache = await this.ensureDirectory(".addons");
    const file = new UserFileStore(cache).open(sha256 + ".zip", "write");
    if (file === null) throw new Error("Cannot cache local add-on");
    try { if (file.write(bytes) !== bytes.byteLength) throw new Error("Incomplete local add-on copy"); } finally { file.close(); }
    await this.install(item);
  }
  private directory(item: AddonPackage): string { return `qd_${createHash("sha256").update(item.group).digest("hex").slice(0, 20)}_${item.sha256.slice(0, 20)}`; }
  private run(operation: () => Promise<void>): void {
    if (this.closed || this.pending !== null) return;
    this.cancelled = false;
    const pending = operation().catch((error: unknown) => { if (!this.closed) this.message = error instanceof Error ? error.message : String(error); }).finally(() => { if (this.pending === pending) this.pending = null; });
    this.pending = pending;
  }
  private async readInstalled(): Promise<void> {
    const root = join(this.options.root, this.contentParent);
    await this.ensureDirectory(this.contentParent);
    const installed: InstalledAddon[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^qd_[a-f0-9]{20}_[a-f0-9]{20}$/.test(entry.name)) continue;
      if (await managedAddonHidden(this.options.root, this.contentParent + "/" + entry.name)) continue;
      try {
        const value: unknown = JSON.parse(await readFile(join(root, entry.name, ".quaddicted.json"), "utf8"));
        if (isRecord(value) && typeof value["sha256"] === "string" && /^[a-f0-9]{64}$/.test(value["sha256"]) && typeof value["title"] === "string" && typeof value["group"] === "string"
          && (value["start"] === null || typeof value["start"] === "string")) installed.push({ directory: entry.name, group: value["group"], sha256: value["sha256"], title: value["title"], start: value["start"] });
      } catch { /* Unmanaged directories are not offered for removal. */ }
    }
    this.installed = installed;
  }
  private async install(selected: AddonPackage): Promise<void> {
    await this.readInstalled();
    const packages = resolveAddonPackages(this.catalog, selected);
    const cache = await this.ensureDirectory(".addons");
    const stage = await mkdtemp(join(cache, "install-"));
    const files = new UserFileStore(stage);
    const queue = new HttpDownloadQueue({ root: cache, concurrency: 1,
      assertCurrent: () => { if (this.closed || this.cancelled) throw new Error("Add-on browser closed or cancelled"); },
      resolved: async path => { try { const bytes = await readFile(join(cache, path)); return createHash("sha256").update(bytes).digest("hex") === path.slice(0, 64); } catch { return false; } },
      refreshPackage: async () => {}, progress: (_path, received, total) => { this.message = `Downloading ${selected.title}: ${received}/${total ?? "?"} bytes`; },
    });
    this.queue = queue;
    try {
      for (const item of packages) {
        const path = `${item.sha256}.zip`;
        const result: HttpDownloadResult = item.url.protocol === "file:" ? { kind: "resolved" } : await queue.enqueue({ path, url: item.url, kind: "asset", expected: { digest: item.digest, byteLength: item.bytes } });
        if (result.kind === "failed" || result.kind === "fallback") throw result.reason;
        if (result.kind === "cancelled" || this.closed || this.cancelled) throw new Error("Add-on installation cancelled");
        const archive = await openArchive(join(cache, path));
        try {
          for (const entry of archive.entries) {
            if (this.closed || this.cancelled) throw new Error("Add-on installation cancelled");
            if (entry.isDirectory) continue;
            const target = addonInstallPath(item, entry.path);
            if (target === null) continue;
            const bytes = await archive.readEntry(entry), file = files.open(target, "write");
            if (file === null) throw new Error(`Cannot stage ${entry.path}`);
            try { if (file.write(bytes) !== bytes.byteLength) throw new Error(`Incomplete add-on write: ${entry.path}`); } finally { file.close(); }
          }
        } finally { archive.close(); }
      }
      const gameRoot = join(stage, selected.gameDirectory);
      const directory = this.directory(selected), destination = join(this.options.root, this.contentParent, directory);
      const start = selected.starts[0] ?? null;
      await writeFile(join(gameRoot, ".quaddicted.json"), JSON.stringify({ sha256: selected.sha256, title: selected.title, group: selected.group, start }));
      if (this.closed || this.cancelled) throw new Error("Add-on installation cancelled");
      const previous = this.installed.filter(item => item.group === selected.group && item.directory !== directory);
      try { await rename(gameRoot, destination); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && (error.code === "EEXIST" || error.code === "ENOTEMPTY"))) throw error;
        const saved: unknown = JSON.parse(await readFile(join(destination, ".quaddicted.json"), "utf8"));
        if (!isRecord(saved) || saved["sha256"] !== selected.sha256) throw new Error("Managed add-on destination conflicts with existing content");
      }
      await rm(join(cache, "removed", this.contentParent, directory), { force: true });
      for (const old of previous) await this.hide(old.directory);
      try { await this.options.changed(); }
      catch (error) {
        await this.hide(directory);
        for (const old of previous) await rm(join(cache, "removed", this.contentParent, old.directory), { force: true });
        throw error;
      }
      await this.readInstalled();
      this.message = `Installed ${selected.title} — ready to play`;
    } finally { await queue.cancel(); this.queue = null; await rm(stage, { recursive: true, force: true }); }
  }
  private async removeInstalled(item: InstalledAddon): Promise<void> {
    await this.hide(item.directory);
    try { await this.options.changed(); }
    catch (error) { await rm(join(this.options.root, ".addons", "removed", this.contentParent, item.directory), { force: true }); throw error; }
    await this.readInstalled();
  }
  private async ensureDirectory(name: string): Promise<string> {
    await mkdir(this.options.root, { recursive: true });
    let path = this.options.root;
    if (!(await lstat(path)).isDirectory()) throw new Error("Add-on root must not be a symlink");
    for (const part of containedFileParts(name)) {
      path = join(path, part);
      try { await mkdir(path); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
      if (!(await lstat(path)).isDirectory()) throw new Error("Add-on storage directory must not be a symlink");
    }
    return path;
  }
  private async hide(directory: string): Promise<void> {
    const store = new UserFileStore(this.options.root);
    const file = store.open(`.addons/removed/${this.contentParent}/${directory}`, "write");
    if (file === null) throw new Error("Cannot update installed add-on catalog");
    file.close();
  }
  async settle(): Promise<void> { await this.pending; }
  async suspend(): Promise<void> { this.cancelled = true; this.queue?.cancel(); await this.pending; }
  async close(): Promise<void> { this.closed = true; this.abort.abort(); await this.queue?.cancel(); await this.pending; }
}
