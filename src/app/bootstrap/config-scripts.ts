import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CommandContext } from "../../contracts/common.ts";
import type { SeatId } from "../../contracts/identity.ts";
import { findContentPath, normalizeResourcePath } from "../../content/mounts/paths.ts";
import { defaultUserContentRoot } from "../../content/user-data.ts";
import { ConfigStore } from "../../settings/config.ts";

export function consoleConfigRoot(userContentRoot: string | undefined): string {
  return join(userContentRoot ?? defaultUserContentRoot(), "console");
}

export function seatConsoleConfig(root: string, seat: SeatId): ConfigStore {
  return new ConfigStore(join(root, "settings", `seat-${seat.index}`));
}

/** Read the invoking seat's exported config, then its product's user files, then mounted content. */
export async function readConsoleScript(options: {
  readonly name: string;
  readonly source: CommandContext;
  readonly consoleRoot: string;
  readonly settings: ConfigStore;
  readonly mounted: ((name: string) => Promise<Uint8Array | undefined>) | undefined;
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
  const path = await findContentPath(options.settings.root, name);
  if (path !== null) return (await readFile(path)).toString("latin1");
  const bytes = await options.mounted?.(name);
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
  async read(name: string, source: CommandContext): Promise<string | undefined> {
    this.acquireRead();
    try {
      await this.writes;
      return await readConsoleScript({ ...this.options, name, source });
    } finally { this.releaseRead(); }
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
