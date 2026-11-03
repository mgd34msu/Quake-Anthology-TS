// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { loadBotAssetFiles } from "../../../src/bots/behavior/assets.ts";
import type { OpenedResource } from "../../../src/content/mounts/index.ts";

const text = (value: string) => new TextEncoder().encode(value);

function digest(entries: readonly (readonly [string, Uint8Array])[]): string {
  const hash = createHash("sha256");
  for (const [path, bytes] of entries) {
    const name = text(path),
      size = new Uint8Array(8),
      view = new DataView(size.buffer);
    view.setUint32(0, name.length, true);
    view.setUint32(4, bytes.length, true);
    hash.update(size);
    hash.update(name);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

test("bot assets leave navigation graphs unread while version 1 saves can still be verified", async () => {
  const contents = new Map([
    ["bots/weapons.txt", text("weapons")],
    ["bots/navigation/q2dm1.nav", text("graph")],
    ["bots/items.txt", text("items")],
  ]);
  const opened: string[] = [];
  const resources = {
    open: async (path: string): Promise<OpenedResource | null> => {
      opened.push(path);
      const bytes = contents.get(path);
      return bytes === undefined ? null : ({ bytes } as OpenedResource);
    },
  };
  const files = await loadBotAssetFiles(resources, [...contents.keys()]);
  expect(opened).toEqual(["bots/weapons.txt", "bots/items.txt"]);
  expect(files.read("bots/navigation/q2dm1.nav")).toBeNull();
  expect(files.list("bots", ".txt")).toEqual(["weapons.txt", "items.txt"]);
  expect(files.provenance()).toBe(
    digest([
      ["bots/weapons.txt", text("weapons")],
      ["bots/items.txt", text("items")],
    ]),
  );
  expect(() => files.legacyProvenance()).toThrow("prepared");
  await files.prepareLegacyProvenance();
  expect(files.legacyProvenance()).toBe(digest([...contents]));
});
