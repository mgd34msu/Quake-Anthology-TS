import { expect, test } from "bun:test";
import { QvmApplicationScalars } from "../../../src/app/bootstrap/q3-client/qvm-scalars.ts";
import { QvmCgameImport, QvmUiImport } from "../../../src/compat/qvm/abi.ts";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import type { QvmHostCall } from "../../../src/compat/qvm/syscalls.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { SoftwareRenderer } from "../../../src/render/cpu/index.ts";

function unavailable(): never { throw new Error("GL config accessed an unrelated service"); }

test("cgame and UI GL config use the seat viewport while preserving renderer capabilities", () => {
  const backend = new SoftwareRenderer(16, 8, { identity: Symbol("viewport"), session: createIdentityOwner("viewport").session, generation: 0 });
  let viewport = { width: 8, height: 8 };
  const scalar = new QvmApplicationScalars({ renderer: { backend }, viewport: () => viewport,
    get local() { return unavailable(); }, get input() { return unavailable(); }, get media() { return unavailable(); }, get services() { return unavailable(); },
    now: unavailable, keyCatcher: { get: unavailable, set: unavailable }, clientState: unavailable, lightForPoint: unavailable, assertCurrent() {},
  });
  const guest = new QvmMemory(new Uint8Array(16384));
  function call(role: "cgame" | "ui"): QvmHostCall {
    const target = role === "cgame" ? { role, code: QvmCgameImport.CG_GETGLCONFIG } : { role, code: QvmUiImport.UI_GETGLCONFIG };
    const words = new DataView(new ArrayBuffer(8)); words.setInt32(0, target.code, true); words.setInt32(4, 8, true);
    return { kind: "engine", ...target, words, guest, memory: guest.bytes, commandArguments: null, invoke: unavailable, invokeAsync: unavailable };
  }
  try {
    expect(scalar.dispatch(call("cgame"), unavailable)).toBe(0);
    const record = guest.view(8, 11332);
    expect(record.getInt32(11304, true)).toBe(8); expect(record.getInt32(11308, true)).toBe(8);
    expect(record.getFloat32(11312, true)).toBe(1);
    expect(record.getInt32(11280, true)).toBe(backend.stencilBits);
    expect(guest.readString(8)).toBe("Quake Anthology software renderer");
    viewport = { width: 16, height: 8 };
    expect(scalar.dispatch(call("ui"), unavailable)).toBe(0);
    expect(record.getInt32(11304, true)).toBe(16); expect(record.getInt32(11308, true)).toBe(8);
    expect(record.getFloat32(11312, true)).toBe(2);
    expect(record.getInt32(11280, true)).toBe(backend.stencilBits);
  } finally { backend.close(); }
});
