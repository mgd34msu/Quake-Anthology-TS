// SV_SetConfigstring, SV_GetConfigstring and SV_AddServerCommand. GPL-2.0-or-later.
import { CommonError } from "../../core/common-error.ts";
import { sourceCommandText } from "../../core/commands/text.ts";
import type { Q3ServerConnection } from "./server.ts";

export function q3ConfigstringCommands(index: number, value: string): readonly string[] {
  const chunks = value.match(/[\s\S]{1,999}/g) ?? [""];
  return chunks.map((chunk, part) => `${chunks.length === 1 ? "cs" : part === 0 ? "bcs0" : part === chunks.length - 1 ? "bcs2" : "bcs1"} ${index} "${chunk}"`);
}

export interface Q3ConfigStringClient { readonly connection: Q3ServerConnection; readonly noServerInfo: boolean; }
export interface Q3ConfigStringBindings {
  readonly running: () => boolean;
  readonly restarting: () => boolean;
  readonly clients: () => readonly Q3ConfigStringClient[];
}
/** Selected gamecode uses this same storage for initial gamestate and live updates. */
export class Q3ServerConfigStrings {
  private readonly values = Array.from({ length: 1024 }, () => "");
  constructor(readonly bindings: Q3ConfigStringBindings) {}
  get(index: number): string {
    const value = this.values[index];
    if (!Number.isInteger(index) || value === undefined) throw new CommonError("drop", `SV_GetConfigstring: bad index ${index}\n`);
    return value;
  }
  getBuffer(index: number, bufferSize: number): string {
    if (!Number.isInteger(bufferSize) || bufferSize < 1) throw new CommonError("drop", `SV_GetConfigstring: bufferSize == ${bufferSize}`);
    return this.get(index).slice(0, bufferSize - 1);
  }
  private async command(client: Q3ServerConnection, command: string): Promise<boolean> {
    const result = client.reliable.add(command);
    if (result.kind === "queued") return true;
    client.bindings.print("===== pending server commands =====\n");
    let sequence = client.reliable.acknowledge + 1;
    for (; sequence <= client.reliable.sequence; sequence++) client.bindings.print(`cmd ${String(sequence).padStart(5)}: ${client.reliable.lookupMasked(sequence)}\n`);
    client.bindings.print(`cmd ${String(sequence).padStart(5)}: ${command}\n`);
    await client.bindings.drop("Server command overflow");
    return false;
  }
  async set(index: number, value: string | null): Promise<void> {
    if (!Number.isInteger(index) || index < 0 || index >= 1024) throw new CommonError("drop", `SV_SetConfigstring: bad index ${index}\n`);
    const text = sourceCommandText(value ?? "");
    for (let cursor = 0; cursor < text.length; cursor++) if (text.charCodeAt(cursor) > 255) throw new RangeError("Server configstrings require source byte characters");
    if (this.values[index] === text) return;
    this.values[index] = text;
    if (!this.bindings.running() && !this.bindings.restarting()) return;
    for (const { connection, noServerInfo } of this.bindings.clients()) {
      if (connection.phase !== "primed" && connection.phase !== "active") continue;
      if (index === 0 && noServerInfo) continue;
      for (const command of q3ConfigstringCommands(index, text)) {
        if (!await this.command(connection, `${command}\n`)) break;
        if (text.length >= 1000) connection.bindings.assertCurrent();
      }
    }
  }
}
