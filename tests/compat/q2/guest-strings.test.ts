// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { ModuleIdentity } from "../../../src/contracts/execution.ts";
import { SparseGuestMemory } from "../../../src/guest/core/index.ts";
import { CommandGuestStrings, latin1Bytes, ReusableGuestString } from "../../../src/compat/q2/guest-strings.ts";

const identity: ModuleIdentity = { id: "test:guest-strings", artifactPath: "authored", revision: "1", digest: createContentDigest("6a".repeat(32)) };
const mappedBytes = (memory: SparseGuestMemory): number => memory.mappings().reduce((total, mapping) => total + mapping.byteLength, 0);

test("command strings share storage within a command and are released when another command is read", () => {
  const memory = new SparseGuestMemory({ module: identity, pointerBytes: 4 });
  const strings = new CommandGuestStrings(memory, "test command", latin1Bytes);
  const first = strings.get("say hello", "hello");
  expect(strings.get("say hello", "hello").byteOffset).toBe(first.byteOffset);
  expect(memory.copy(first, 5)).toEqual(latin1Bytes("hello"));
  const before = mappedBytes(memory);
  for (let index = 0; index < 500; index++) strings.get(`say line ${index}`, `line ${index}`);
  expect(mappedBytes(memory)).toBeLessThanOrEqual(before + 4096);
});

test("a reusable string is rewritten in place until a value outgrows its pages", () => {
  const memory = new SparseGuestMemory({ module: identity, pointerBytes: 4 });
  const string = new ReusableGuestString(memory, "test value");
  const first = string.setText("short", latin1Bytes);
  for (let index = 0; index < 200; index++) expect(string.setText(`value ${index}`, latin1Bytes).byteOffset).toBe(first.byteOffset);
  // A small string takes one page of a shared slab, so the mapped total is one slab and does not grow while it is rewritten.
  expect(mappedBytes(memory)).toBe(64 * 4096);
  const grown = string.setText("x".repeat(5000), latin1Bytes);
  expect(grown.byteOffset).not.toBe(first.byteOffset);
  expect(memory.copy(grown, 5001)[5000]).toBe(0);
});
