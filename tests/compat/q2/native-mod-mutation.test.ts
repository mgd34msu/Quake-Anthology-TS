// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { readNativeModCallbacks } from "../../../src/content/mods/native-callbacks.ts";
import { validateNativeModDeclaration } from "../../../src/compat/q2/native-mod-provider.ts";
import { runJsonMutations } from "../../support/mutation.ts";

const call = (name: string, value: number) => ({
  entry: { kind: "export", name },
  arguments: [{ kind: "int32", value: { kind: "float", value } }],
  globals: [],
  returns: "void",
});

const declaration = {
  version: 1,
  runtime: "native",
  program: { path: "mods/fixture/gamex86_64.dll", digest: `sha256:${"ab".repeat(32)}` },
  target: { api: { kind: "q2-rerelease-game", version: 2023 }, abi: { kind: "windows-x86-64", image: "pe32+", pointerBytes: 8, call: "microsoft-x64" } },
  cvars: [{ name: "fixture_flag", value: "1" }],
  spawnEntities: null,
  actorRecords: [
    {
      id: "fixture:clients",
      base: { kind: "entities" },
      firstSlot: 1,
      capacity: 4,
      stride: 32,
      fields: [{ binding: "constant", offset: 0, encoding: "int32", value: 7 }],
    },
  ],
  entityRecord: null,
  initialize: [],
  project: [call("Fixture_Project", 1)],
  release: [call("Fixture_Release", 2)],
  callbacks: [],
};

function admit(bytes: Uint8Array): void {
  validateNativeModDeclaration(readNativeModCallbacks(bytes));
}

test("the fixture declaration is accepted before mutation", () => {
  admit(new TextEncoder().encode(JSON.stringify(declaration)));
});

test("seeded mutants of a native mod declaration are admitted or rejected with a typed error", () => {
  for (const seed of [71, 72, 73]) {
    const report = runJsonMutations(seed, 700, declaration, admit);
    expect(report.foreign).toEqual([]);
    expect(report.rejected).toBeGreaterThan(0);
  }
});
