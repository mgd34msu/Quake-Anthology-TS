// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverInstalledContent, expectedProducts } from "../../../src/content/catalog/index.ts";

function pakWith(entries: readonly string[]): Uint8Array {
  const directoryOffset = 12 + entries.length;
  const bytes = new Uint8Array(directoryOffset + entries.length * 64),
    view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("PACK"));
  view.setUint32(4, directoryOffset, true);
  view.setUint32(8, entries.length * 64, true);
  entries.forEach((entry, index) => {
    bytes[12 + index] = 6;
    const offset = directoryOffset + index * 64;
    bytes.set(new TextEncoder().encode(entry), offset);
    view.setUint32(offset + 56, 12 + index, true);
    view.setUint32(offset + 60, 1, true);
  });
  return bytes;
}

test("requiredPrograms are enforced through the base chain during availability", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "quake-required-programs-"));
  try {
    await mkdir(join(root, "id1"), { recursive: true });
    await mkdir(join(root, "qw"), { recursive: true });
    await mkdir(join(root, "hipnotic"), { recursive: true });
    await writeFile(join(root, "id1/pak0.pak"), pakWith(["progs.dat"]));
    await writeFile(join(root, "id1/pak1.pak"), pakWith(["maps/e1m1.bsp"]));
    await writeFile(join(root, "hipnotic/pak0.pak"), pakWith(["progs.dat"]));
    const products = expectedProducts.filter(product => ["q1-classic-id1", "q1-quakeworld", "q1-quakeworld-hipnotic"].includes(product.id));
    const without = await discoverInstalledContent({ corpusRoot: root, products });
    expect(without.product("q1-classic-id1").availability.kind).toBe("installed");
    expect(without.product("q1-quakeworld").availability).toEqual({ kind: "missing", requirements: ["qwprogs.dat"] });
    expect(without.product("q1-quakeworld-hipnotic").availability.kind).toBe("missing");
    await writeFile(join(root, "qw/qwprogs.dat"), new Uint8Array([6]));
    const withProgram = await discoverInstalledContent({ corpusRoot: root, products });
    expect(withProgram.product("q1-quakeworld").availability.kind).toBe("installed");
    expect(withProgram.product("q1-quakeworld-hipnotic").availability.kind).toBe("installed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
