// g_session.c cvar payload and bg_lib.c integer scanning from the Quake III TS donor.
import { SaveFormatError } from "./value.ts";

export interface Q3ClientSession {
  readonly team: number; readonly spectatorTime: number; readonly spectatorState: number; readonly spectatorClient: number;
  readonly wins: number; readonly losses: number; readonly teamLeader: number;
}

function sourceBuffer(value: string): string {
  const nul = value.indexOf("\0"); const buffer = (nul < 0 ? value : value.slice(0, nul)).slice(0, 1023);
  for (let index = 0; index < buffer.length; index++) if (buffer.charCodeAt(index) > 255) throw new SaveFormatError("q3-session", "expected byte characters");
  return buffer;
}
function scanInteger(buffer: string, start: number): { readonly value: number; readonly next: number } {
  if (start > buffer.length) throw new SaveFormatError("q3-session", "source integer scan passed its terminating NUL");
  let cursor = start;
  while (cursor < buffer.length) { const byte = buffer.charCodeAt(cursor); if ((byte < 128 ? byte : byte - 256) > 32) break; cursor++; }
  if (cursor === buffer.length) return { value: 0, next: cursor };
  const sign = buffer.charAt(cursor) === "-" ? -1 : 1;
  if (buffer.charAt(cursor) === "+" || buffer.charAt(cursor) === "-") cursor++;
  let value = 0;
  for (;;) {
    if (cursor === buffer.length) return { value: Math.imul(value, sign), next: cursor + 1 };
    const byte = buffer.charCodeAt(cursor++);
    if (byte < 48 || byte > 57) return { value: Math.imul(value, sign), next: cursor };
    value = (Math.imul(value, 10) + byte - 48) | 0;
  }
}
export function decodeQ3ClientSession(value: string): Q3ClientSession {
  const buffer = sourceBuffer(value); let offset = 0;
  const integer = (): number => { const result = scanInteger(buffer, offset); offset = result.next; return result.value; };
  return { team: integer(), spectatorTime: integer(), spectatorState: integer(), spectatorClient: integer(), wins: integer(), losses: integer(), teamLeader: integer() };
}
export function encodeQ3ClientSession(session: Q3ClientSession): string {
  return [session.team, session.spectatorTime, session.spectatorState, session.spectatorClient, session.wins, session.losses, session.teamLeader].map(value => String(value | 0)).join(" ");
}
export interface Q3SessionCvars { get(name: "session" | `session${number}`): string; set(name: "session" | `session${number}`, value: string): undefined; }
export interface Q3SessionSave { readonly gameType: number; readonly clients: readonly { readonly slot: number; readonly session: Q3ClientSession }[]; }
export function readQ3Sessions(cvars: Q3SessionCvars, clientSlots: readonly number[]): Q3SessionSave {
  return { gameType: scanInteger(sourceBuffer(cvars.get("session")), 0).value, clients: clientSlots.map(slot => ({ slot, session: decodeQ3ClientSession(cvars.get(`session${slot}`)) })) };
}
export function writeQ3Sessions(cvars: Q3SessionCvars, save: Q3SessionSave): undefined {
  cvars.set("session", String(save.gameType | 0));
  for (const client of save.clients) cvars.set(`session${client.slot}`, encodeQ3ClientSession(client.session));
  return undefined;
}
