// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createContentDigest } from "../../../../src/contracts/content.ts";
import type { GuestAddress, GuestCallContext, GuestCallValue, ModuleIdentity } from "../../../../src/contracts/execution.ts";
import { createGuestProcessorState, GuestCallbackTable, SparseGuestMemory } from "../../../../src/guest/core/index.ts";
import { GuestCallRunner } from "../../../../src/guest/abi/index.ts";
import { X64Cpu } from "../../../../src/guest/x64/index.ts";
import { mapPeImage } from "../../../../src/guest/pe/index.ts";
import { WindowsGuestRuntime } from "../../../../src/guest/runtime/windows/index.ts";

const path = join(homedir(), "Projects/qfiles/q2/rerelease/baseq2/game_x64.dll");
const p = (value: GuestAddress | null): GuestCallValue => ({ kind: "pointer", value });
test.skipIf(!existsSync(path))("retail MSVC stringstream grows, formats, seeks and destroys its raw guest buffer", async () => {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer()), digest = createContentDigest(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
  // Internal constructor and vftable addresses are evidence for this artifact only.
  expect(digest).toBe(createContentDigest("045d49c53722d9b922caf14f168dd28a97d4c514a6e443a3140560f8668baccd"));
  const module: ModuleIdentity = { id: "test:msvc-stream", artifactPath: path, revision: "installed", digest };
  const memory = new SparseGuestMemory({ module, pointerBytes: 8 }), image = mapPeImage({ bytes, memory, base: 0x280000000n });
  const callbacks = new GuestCallbackTable(memory), runtime = new WindowsGuestRuntime({ memory, callbacks, capabilities: { nowMilliseconds: () => 1700000000000 } });
  const stack = memory.allocate({ byteLength: 1048576 }), returnAddress = memory.allocate({ byteLength: 16, permissions: "read-execute" });
  const state = createGuestProcessorState({ architecture: "x86-64", instructionPointer: returnAddress.byteOffset, stackPointer: stack.byteOffset + 1048576n, flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
  runtime.attachRunner(new GuestCallRunner({ cpu: new X64Cpu({ memory, state, isHostCall: address => callbacks.resolve(address) !== null }), callbacks, returnAddress }));
  const context: GuestCallContext = { module, callback: { kind: "native-guest", module, address: image.base, abi: image.abi }, self: null, other: null, parent: null };
  runtime.initialize(image, { context, instructionBudget: 1000000 });
  const object = memory.allocate({ byteLength: 248 }), buffer = memory.offset(object, 24n), base = memory.offset(object, 152n), output = memory.offset(object, 16n);
  runtime.invoke(context, memory.offset(image.base, 0x8b070n), ["pointer", "int32"], "pointer", [p(object), { kind: "int32", value: 1 }]);
  expect(memory.readPointer(memory.offset(base, 72n))?.byteOffset).toBe(buffer.byteOffset);
  expect(memory.readInt32(memory.offset(base, 24n))).toBe(0x201);
  const call = (name: string, args: readonly GuestCallValue[]) => {
    const target = runtime.resolveAddress("msvcp140.dll", name); if (target === null) throw new Error(`MSVC service ${name} missing`); return callbacks.invoke(target, context, args);
  };
  const data = memory.allocate({ byteLength: 400 }), text = "guest-stream ".repeat(25); memory.write(data, new TextEncoder().encode(text));
  expect(call("?sputn@?$basic_streambuf@DU?$char_traits@D@std@@@std@@QEAA_JPEBD_J@Z", [p(buffer), p(data), { kind: "int64", value: BigInt(text.length) }])).toEqual({ kind: "int64", value: BigInt(text.length) });
  call("??6?$basic_ostream@DU?$char_traits@D@std@@@std@@QEAAAEAV01@H@Z", [p(output), { kind: "int32", value: -123 }]);
  memory.writeInt32(memory.offset(base, 24n), 0x800 | 8 | 4 | 0x100); memory.writeInt64(memory.offset(base, 40n), 8n); memory.writeUint8(memory.offset(base, 88n), 48);
  call("??6?$basic_ostream@DU?$char_traits@D@std@@@std@@QEAAAEAV01@_J@Z", [p(output), { kind: "int64", value: 42n }]);
  const expected = text + "-1230X00002A", putBaseSlot = memory.readPointer(memory.offset(buffer, 32n)); if (putBaseSlot === null) throw new Error("Missing put base slot");
  const putBase = memory.readPointer(putBaseSlot); if (putBase === null) throw new Error("Missing grown guest string buffer");
  expect(new TextDecoder().decode(memory.copy(putBase, expected.length))).toBe(expected);
  expect(memory.readInt64(memory.offset(base, 40n))).toBe(0n);
  const position = memory.allocate({ byteLength: 24 }); call("?tellp@?$basic_ostream@DU?$char_traits@D@std@@@std@@QEAA?AV?$fpos@U_Mbstatet@@@2@XZ", [p(output), p(position)]);
  expect(memory.readInt64(position) + memory.readInt64(memory.offset(position, 8n))).toBe(BigInt(expected.length));
  const read = memory.allocate({ byteLength: expected.length });
  expect(call("?xsgetn@?$basic_streambuf@DU?$char_traits@D@std@@@std@@MEAA_JPEAD_J@Z", [p(buffer), p(read), { kind: "int64", value: BigInt(expected.length) }])).toEqual({ kind: "int64", value: BigInt(expected.length) });
  expect(memory.copy(read, expected.length)).toEqual(memory.copy(putBase, expected.length));
  const sourceTable = memory.readPointer(buffer); if (sourceTable === null) throw new Error("Missing source vftable");
  const seek = memory.readPointer(memory.offset(sourceTable, 80n)); if (seek === null) throw new Error("Missing source seekoff");
  runtime.invoke(context, seek, ["pointer", "pointer", "int64", "int32", "int32"], "pointer", [p(buffer), p(position), { kind: "int64", value: 0n }, { kind: "int32", value: 0 }, { kind: "int32", value: 1 }]);
  const destination = memory.allocate({ byteLength: 232 }), destinationBuffer = memory.offset(destination, 8n);
  runtime.invoke(context, memory.offset(image.base, 0x1323a0n), ["pointer", "int32"], "pointer", [p(destination), { kind: "int32", value: 1 }]);
  call("??6?$basic_ostream@DU?$char_traits@D@std@@@std@@QEAAAEAV01@PEAV?$basic_streambuf@DU?$char_traits@D@std@@@1@@Z", [p(destination), p(buffer)]);
  const destinationBaseSlot = memory.readPointer(memory.offset(destinationBuffer, 32n)); if (destinationBaseSlot === null) throw new Error("Missing destination put base slot");
  const destinationBytes = memory.readPointer(destinationBaseSlot); if (destinationBytes === null) throw new Error("Missing destination bytes");
  expect(new TextDecoder().decode(memory.copy(destinationBytes, expected.length))).toBe(expected);
  expect(memory.readInt32(memory.offset(destination, 136n + 16n))).toBe(0);
  // Actual most-derived destructors run _Tidy and MSVC's adjusted base calls.
  for (const virtualBase of [base, memory.offset(destination, 136n)]) {
    const vtable = memory.readPointer(virtualBase); if (vtable === null) throw new Error("Missing actual stream vftable");
    const destructor = memory.readPointer(vtable); if (destructor === null) throw new Error("Missing actual stream destructor");
    runtime.invoke(context, destructor, ["pointer", "uint32"], "pointer", [p(virtualBase), { kind: "uint32", value: 0 }]);
  }
  expect(() => memory.readUint8(putBase)).toThrow();
  expect(() => memory.readUint8(destinationBytes)).toThrow();
  const localeName = memory.allocate({ byteLength: 2 }); memory.write(localeName, new TextEncoder().encode("C\0"));
  const info = memory.allocate({ byteLength: 104 }), cvt = memory.allocate({ byteLength: 44 });
  call("??0_Locinfo@std@@QEAA@PEBD@Z", [p(info), p(localeName)]);
  call("?_Getcvt@_Locinfo@std@@QEBA?AU_Cvtvec@@XZ", [p(info), p(cvt)]);
  expect(memory.readUint32(memory.offset(cvt, 4n))).toBe(1); expect(memory.readUint32(memory.offset(cvt, 8n))).toBe(1);
  const savedName = memory.readPointer(memory.offset(info, 88n)); if (savedName === null) throw new Error("Missing locale name yarn");
  expect(memory.copy(savedName, 2)).toEqual(new Uint8Array([67, 0]));
  call("??1_Locinfo@std@@QEAA@XZ", [p(info)]); expect(() => memory.readUint8(savedName)).toThrow();
  expect(runtime.coverage.filter(entry => entry.reached > 0 && entry.failed > 0)).toEqual([]);
  runtime.detach(image, { context, instructionBudget: 1000000 });
});
