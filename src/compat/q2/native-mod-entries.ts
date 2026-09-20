import type { GuestAddress, GuestCallResult, GuestCallValue } from "../../contracts/execution.ts";
import type { CallbackId } from "../../contracts/identity.ts";
import type { GuestCallSignature } from "../../guest/core/contracts.ts";
import type { NativeModHost } from "../../app/bootstrap/simulation/native-mod-host.ts";

export interface NativeModEntryBinding {
  original(values: readonly GuestCallValue[]): GuestCallResult;
  close(): undefined;
}

/** Bypass only the exact original entry frame; recursive source calls still compose. */
export function bindNativeModEntry(host: NativeModHost, address: GuestAddress, id: CallbackId, signature: GuestCallSignature,
  execute: (values: readonly GuestCallValue[], original: NativeModEntryBinding["original"]) => GuestCallResult,
  accepts: () => boolean = () => true): NativeModEntryBinding {
  const { callbacks, cpu } = host.entries, frames: { stack: bigint | null }[] = [];
  const stack = () => cpu.state.registers.read("rsp", host.memory.pointerBytes === 4 ? 32 : 64);
  const original = (values: readonly GuestCallValue[]): GuestCallResult => {
    const frame = { stack: null }; frames.push(frame);
    try { return host.invoke(address, signature, values); } finally { frames.pop(); }
  };
  const observe = callbacks.observeEntry(address, () => { const frame = frames.at(-1); if (frame !== undefined && frame.stack === null) frame.stack = stack(); });
  let remove: () => void;
  try { remove = callbacks.bindEntry(address, { id, signature, invoke: (_context, values) => execute(values, original) }, () => frames.at(-1)?.stack !== stack() && accepts()); }
  catch (error) { observe(); throw error; }
  return { original, close: () => { remove(); observe(); return undefined; } };
}
