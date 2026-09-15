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
  constructor(private readonly options: Omit<Parameters<typeof readConsoleScript>[0], "name" | "source">) {}
  async read(name: string, source: CommandContext): Promise<string | undefined> {
    await this.writes;
    return readConsoleScript({ ...this.options, name, source });
  }
  write(operation: () => Promise<void>): Promise<void> {
    const pending = this.writes.then(operation);
    this.writes = pending.catch(() => undefined);
    return pending;
  }
}
