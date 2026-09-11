// SVC_RemoteCommand and SV_FlushRedirect, sv_main.c. GPL-2.0-or-later.
import { sourceCommandText } from "../../core/commands/text.ts";
import { encodeConnectionlessText } from "./connectionless.ts";
import type { ConnectionlessPacket } from "./connectionless.ts";
import type { Q3Address } from "./admission.ts";

export interface Q3RconBindings {
  password(): string;
  print(text: string): void;
  redirect(capacity: number, flush: (text: string) => void, execute: () => Promise<void>): Promise<void>;
  execute(command: string): Promise<void>;
  send(to: Q3Address, bytes: Uint8Array): void;
}
/** Kept by the process owner across server and map replacements, like source function statics. */
export class Q3RconState { lastTime = 0; }
export class Q3Rcon {
  constructor(readonly state: Q3RconState, readonly bindings: Q3RconBindings) {}
  async receive(from: Q3Address, packet: ConnectionlessPacket, milliseconds: number): Promise<void> {
    const time = milliseconds >>> 0;
    if (time < ((this.state.lastTime + 500) >>> 0)) return;
    this.state.lastTime = time;
    const password = sourceCommandText(this.bindings.password()), valid = password.length !== 0 && password === (packet.arguments[0] ?? "");
    await this.bindings.redirect(1008, text => this.bindings.send(from, encodeConnectionlessText(`print\n${text}`)), async () => {
      if (sourceCommandText(this.bindings.password()).length === 0) { this.bindings.print("No rconpassword set on the server.\n"); return; }
      if (!valid) { this.bindings.print("Bad rconpassword.\n"); return; }
      const line = sourceCommandText(packet.line);
      let cursor = 4;
      while (line[cursor] === " ") cursor++;
      while (cursor < line.length && line[cursor] !== " ") cursor++;
      while (line[cursor] === " ") cursor++;
      const command = line.slice(cursor, cursor + 1023);
      if (command.length !== 0) await this.bindings.execute(command);
    });
  }
}
export function encodeQ3Rcon(password: string, command: string): Uint8Array { return encodeConnectionlessText(`rcon ${sourceCommandText(password)} ${sourceCommandText(command)}`); }
