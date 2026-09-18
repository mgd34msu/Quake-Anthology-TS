import { decodeLegacyQvmGameImport } from './legacy-bot-abi.ts';
import type { QvmAbiProfile } from "../../contracts/execution.ts";
import { decodeQvmGameImport, decodeQvmCgameImport, decodeQvmUiImport } from "./abi.ts";
import type { QvmGameImport, QvmCgameImport, QvmUiImport } from "./abi.ts";
import type { QvmSyscall, QvmSystemCall, QvmSystemCallResult } from "./interpreter.ts";
import { QvmMemory } from "./memory.ts";
import { qvmMathSyscall } from "./math-syscalls.ts";
import { qvmMemorySyscall } from "./memory-syscalls.ts";
import { qvmVectorSyscall } from "./vector-syscalls.ts";
import { qvmSnapVectorSyscall } from "./snap-vector-syscalls.ts";

export type QvmRole = "qagame" | "cgame" | "ui";
export type QvmHostCall = QvmSyscall & { readonly guest: QvmMemory; readonly abiProfile?: QvmAbiProfile; readonly commandArguments: readonly string[] | null } & (
  | { readonly kind: "engine"; readonly role: "qagame"; readonly code: QvmGameImport }
  | { readonly kind: "engine"; readonly role: "cgame"; readonly code: QvmCgameImport }
  | { readonly kind: "engine"; readonly role: "ui"; readonly code: QvmUiImport }
  | { readonly kind: "extension"; readonly role: QvmRole; readonly code: number }
);
export type QvmHostResult = QvmSystemCallResult;
export type QvmHost = (call: QvmHostCall) => QvmHostResult;

export class QvmUnboundSyscallError extends Error {
  constructor(readonly role: QvmRole, readonly code: number) {
    super(`Unbound ${role} QVM syscall ${code}`);
    this.name = "QvmUnboundSyscallError";
  }
}

export function rejectQvmSyscall(call: QvmHostCall): never {
  throw new QvmUnboundSyscallError(call.role, call.code);
}

function classify(role: QvmRole, call: QvmSyscall, guest: QvmMemory, commandArguments: readonly string[] | null, abiProfile: QvmAbiProfile): QvmHostCall {
  const word = call.words.getInt32(0, true);
  switch (role) {
    case "qagame": {
      const code = abiProfile === "q3-modern" ? decodeQvmGameImport(word) : decodeLegacyQvmGameImport(word);
      if (code !== null) return { ...call, kind: "engine", role, code, guest, abiProfile, commandArguments };
      break;
    }
    case "cgame": {
      const code = decodeQvmCgameImport(word);
      if (code !== null) return { ...call, kind: "engine", role, code, guest, abiProfile, commandArguments };
      break;
    }
    case "ui": {
      const code = abiProfile === "q3-modern" ? decodeQvmUiImport(word) : word >= 46 && word <= 49 ? null : decodeQvmUiImport(word >= 50 && word <= 58 ? word - 4 : word);
      if (code !== null) return { ...call, kind: "engine", role, code, guest, abiProfile, commandArguments };
      break;
    }
  }
  return { ...call, kind: "extension", role, code: word, guest, abiProfile, commandArguments };
}

/** Intrinsics execute here; every engine-owned operation reaches the explicit host. */
export function createQvmSystemCall(role: QvmRole, host: QvmHost = rejectQvmSyscall,
  commandArguments: () => readonly string[] | null = () => null,
  abiProfile: QvmAbiProfile = "q3-modern",
): QvmSystemCall {
  let current: QvmMemory | null = null;
  return call => {
    if (abiProfile !== "q3-modern") {
      const trap = call.words.getInt32(0, true);
      const supported = role === "qagame"
        ? trap >= 0 && trap <= 40 || trap >= 100 && trap <= 106 || trap === 110 || trap === 111 || decodeLegacyQvmGameImport(trap) !== null || trap >= 402 && trap <= 405
        : trap >= 0 && trap <= 58 || trap >= 100 && trap <= 106 || (role === "cgame" ? trap === 107 || trap === 108 : trap === 110 || trap === 111);
      if (!supported)
        throw new Error(`Legacy QVM ABI service ${role}/${trap} is not implemented`);
    }
    if (current === null || current.bytes !== call.memory) current = new QvmMemory(call.memory);
    const sourceRole = role === "qagame" ? "game" : role;
    const intrinsic = qvmMemorySyscall(sourceRole, call.words, current)
      ?? qvmMathSyscall(abiProfile !== "q3-modern" && role === "ui" ? "game" : sourceRole, call.words)
      ?? qvmVectorSyscall(sourceRole, call.words, current)
      ?? qvmSnapVectorSyscall(sourceRole, call.words, current);
    return intrinsic ?? host(classify(role, call, current, commandArguments(), abiProfile));
  };
}
