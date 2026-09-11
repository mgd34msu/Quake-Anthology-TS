// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { GuestAddress, ModuleIdentity } from "../../../src/contracts/execution.ts";
import { createGuestProcessorState, SparseGuestMemory } from "../../../src/guest/core/index.ts";
import { mapPeImage } from "../../../src/guest/pe/index.ts";
import { I386Cpu } from "../../../src/guest/x86/index.ts";
import { encodeBinary } from "../../../src/guest/floating-point/binary.ts";
import { readX87Register } from "../../../src/guest/floating-point/index.ts";

const path = new URL("../../../../qfiles/q2/lmctf/gamex86.dll", import.meta.url);
function address(memory: SparseGuestMemory, value: bigint): GuestAddress {
  const result = memory.pointer(value);
  if (result === null) throw new Error("The instruction fixture uses nonzero addresses");
  return result;
}

test.skipIf(!await Bun.file(path).exists())("actual LMCTF VectorLength retains extended accumulation and square root", async () => {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  expect(digest).toBe("31cbb29f90429706986dbd855d0a3a2529b7fbd4340694901af5c5052cbdcbe6");
  const identity: ModuleIdentity = { id: "test:lmctf-math", artifactPath: path.pathname, revision: "source-vector-length", digest: createContentDigest(digest) };
  for (const [x, y, z, expected] of [
    [3n, 4n, 12n, 0x4002d000000000000000n],
    [1n << 30n, 1n, 1n, 0x401d8000000000000008n],
  ]) {
    if (x === undefined || y === undefined || z === undefined || expected === undefined) throw new Error("Incomplete vector fixture");
    const memory = new SparseGuestMemory({ module: identity, pointerBytes: 4 });
    mapPeImage({ bytes, memory });
    memory.map({ base: 0x10000n, byteLength: 0x2000, permissions: "read-write" });
    const vector = address(memory, 0x11000n);
    memory.writeFloat32(vector, Number(x)); memory.writeFloat32(memory.offset(vector, 4n), Number(y)); memory.writeFloat32(memory.offset(vector, 8n), Number(z));
    const returned = address(memory, 0x7000n);
    memory.writeUint32(address(memory, 0x10800n), Number(returned.byteOffset));
    memory.writeUint32(address(memory, 0x10804n), Number(vector.byteOffset));
    expect(memory.readUint32(address(memory, 0x2005b070n))).toBe(0);
    const state = createGuestProcessorState({ architecture: "i386", instructionPointer: 0x2004a160n, stackPointer: 0x10800n,
      flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
    const stop = new I386Cpu({ state, memory }).run({ instructionBudget: 100, returnAddress: returned });
    expect(stop.kind).toBe("return");
    expect(encodeBinary(readX87Register(state.x87), 80)).toBe(expected);
    expect(state.x87.tagWord).toBe(0x3fff);
  }
});
