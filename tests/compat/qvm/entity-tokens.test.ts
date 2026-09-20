import { expect, test } from "bun:test";
import { QvmGameImport } from "../../../src/compat/qvm/abi.ts";
import { QvmEntityTokens, qvmEntityTokenSyscall } from "../../../src/compat/qvm/entity-tokens.ts";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import type { QvmHostCall } from "../../../src/compat/qvm/syscalls.ts";
import { parseGameplayModDeclaration } from "../../../src/content/mods/declaration.ts";

test("component tokens resume their exact declared stream and keep other instances independent", () => {
  const text = '// component additions\n{ "classname" "target_position" }\n/* next */ { "origin" "1 2 3" }';
  const first = new QvmEntityTokens(text), second = new QvmEntityTokens(text);
  expect(first.entityToken().token).toBe("{");
  expect(first.entityToken().token).toBe("classname");
  const saved = first.captureSaveState(), restored = new QvmEntityTokens(text);
  restored.restoreSaveState(saved);
  expect(restored.entityToken()).toEqual(first.entityToken());
  expect(restored.entityToken().token).toBe("}");
  expect(second.entityToken().token).toBe("{");
  expect(() => new QvmEntityTokens(text + " ").restoreSaveState(saved)).toThrow("source");
  expect(() => new QvmEntityTokens(text).restoreSaveState({ ...saved, cursor: text.length + 1 })).toThrow("cursor");
  const empty = new QvmEntityTokens("");
  empty.restoreSaveState(undefined);
  expect(empty.entityToken()).toEqual({ token: "", ended: true });
  expect(() => new QvmEntityTokens(text).restoreSaveState(undefined)).toThrow();
});

test("shared token trap consumes complete tokens even when the source output buffer truncates", () => {
  const guest = new QvmMemory(new Uint8Array(4096)), source = new QvmEntityTokens('"long token" final');
  const words = new DataView(new ArrayBuffer(12));
  words.setInt32(0, QvmGameImport.G_GET_ENTITY_TOKEN, true); words.setInt32(4, 128, true); words.setInt32(8, 5, true);
  const call: QvmHostCall = { kind: "engine", role: "qagame", code: QvmGameImport.G_GET_ENTITY_TOKEN,
    guest, words, memory: guest.bytes, commandArguments: null,
    invoke: () => { throw new Error("Unexpected source call"); }, invokeAsync: async () => { throw new Error("Unexpected source call"); } };
  guest.bytes.fill(0xcc, 128, 160);
  expect(qvmEntityTokenSyscall(call, source)).toBe(1);
  expect(guest.readString(128)).toBe("long"); expect(guest.bytes[133]).toBe(0xcc);
  words.setInt32(8, 32, true);
  expect(qvmEntityTokenSyscall(call, source)).toBe(1); expect(guest.readString(128)).toBe("final");
  const restored = new QvmEntityTokens('"long token" final'); restored.restoreSaveState(source.captureSaveState());
  expect(qvmEntityTokenSyscall(call, restored)).toBe(0); expect(guest.readString(128)).toBe("");
});

test("resolved QVM component declarations retain entity text with empty legacy defaults", () => {
  const declaration = { version: 1, runtime: "qvm", program: { path: "vm/qagame.qvm", digest: "sha256:" + "0".repeat(64) },
    abiProfile: "q3-modern", entityRecord: null, actorRecords: [], initialize: [], callbacks: [] };
  const parse = (value: unknown) => parseGameplayModDeclaration(new TextEncoder().encode(JSON.stringify(value)));
  for (const spawnEntities of [undefined, null, '{ "classname" "target_position" }']) {
    const resolved = parse({ ...declaration, ...(spawnEntities === undefined ? {} : { spawnEntities }) });
    if (resolved.runtime !== "qvm") throw new Error("Expected QVM component");
    expect(resolved.spawnEntities).toBe(spawnEntities ?? null);
  }
  expect(() => parse({ ...declaration, spawnEntities: 3 })).toThrow();
});
