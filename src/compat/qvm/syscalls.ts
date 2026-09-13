import { decodeQvmGameImport, decodeQvmCgameImport, decodeQvmUiImport } from "./abi.ts";
import type { QvmGameImport, QvmCgameImport, QvmUiImport } from "./abi.ts";
import type { QvmSyscall, QvmSystemCall, QvmSystemCallResult } from "./interpreter.ts";
import { QvmMemory } from "./memory.ts";
import { qvmMathSyscall } from "./math-syscalls.ts";
import { qvmMemorySyscall } from "./memory-syscalls.ts";
import { qvmVectorSyscall } from "./vector-syscalls.ts";
import { qvmSnapVectorSyscall } from "./snap-vector-syscalls.ts";

export type QvmRole = "qagame" | "cgame" | "ui";
export type QvmHostCall = QvmSyscall & { readonly guest: QvmMemory; readonly commandArguments: readonly string[] | null } & (
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

function classify(role: QvmRole, call: QvmSyscall, guest: QvmMemory, commandArguments: readonly string[] | null): QvmHostCall {
  const word = call.words.getInt32(0, true);
  switch (role) {
    case "qagame": {
      const code = decodeQvmGameImport(word);
      if (code !== null) return { ...call, kind: "engine", role, code, guest, commandArguments };
      break;
    }
    case "cgame": {
      const code = decodeQvmCgameImport(word);
      if (code !== null) return { ...call, kind: "engine", role, code, guest, commandArguments };
      break;
    }
    case "ui": {
      const code = decodeQvmUiImport(word);
      if (code !== null) return { ...call, kind: "engine", role, code, guest, commandArguments };
      break;
    }
  }
  return { ...call, kind: "extension", role, code: word, guest, commandArguments };
}

/** Intrinsics execute here; every engine-owned operation reaches the explicit host. */
export function createQvmSystemCall(role: QvmRole, host: QvmHost = rejectQvmSyscall,
  commandArguments: () => readonly string[] | null = () => null,
): QvmSystemCall {
  let current: QvmMemory | null = null;
  return call => {
    if (current === null || current.bytes !== call.memory) current = new QvmMemory(call.memory);
    const sourceRole = role === "qagame" ? "game" : role;
    const intrinsic = qvmMemorySyscall(sourceRole, call.words, current)
      ?? qvmMathSyscall(sourceRole, call.words)
      ?? qvmVectorSyscall(sourceRole, call.words, current)
      ?? qvmSnapVectorSyscall(sourceRole, call.words, current);
    return intrinsic ?? host(classify(role, call, current, commandArguments()));
  };
}
