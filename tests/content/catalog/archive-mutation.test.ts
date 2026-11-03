// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import { decodeArchive } from "../../../src/content/archive/index.ts";
import { runMutations } from "../../support/mutation.ts";

function zip(entries: readonly { readonly name: string; readonly data: Uint8Array; readonly deflate: boolean }[]): Uint8Array {
  const parts: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let offset = 0;
  for (const { name, data, deflate } of entries) {
    const raw = new TextEncoder().encode(name),
      body = deflate ? new Uint8Array(deflateRawSync(data)) : data,
      method = deflate ? 8 : 0,
      crc = Bun.hash.crc32(data);
    const local = new Uint8Array(30 + raw.length),
      view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, method, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, body.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, raw.length, true);
    local.set(raw, 30);
    const header = new Uint8Array(46 + raw.length),
      cv = new DataView(header.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, raw.length, true);
    cv.setUint32(42, offset, true);
    header.set(raw, 46);
    parts.push(local, body);
    central.push(header);
    offset += local.length + body.length;
  }
  const directory = Uint8Array.from(central.flatMap(part => [...part])),
    end = new Uint8Array(22),
    ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directory.length, true);
  ev.setUint32(16, offset, true);
  return Uint8Array.from([...parts.flatMap(part => [...part]), ...directory, ...end]);
}

function pak(entries: readonly { readonly name: string; readonly data: Uint8Array }[]): Uint8Array {
  const body = entries.flatMap(entry => [...entry.data]),
    directory = new Uint8Array(64 * entries.length),
    view = new DataView(directory.buffer);
  let offset = 12;
  entries.forEach((entry, index) => {
    directory.set(new TextEncoder().encode(entry.name), index * 64);
    view.setInt32(index * 64 + 56, offset, true);
    view.setInt32(index * 64 + 60, entry.data.length, true);
    offset += entry.data.length;
  });
  const header = new Uint8Array(12),
    hv = new DataView(header.buffer);
  header.set(new TextEncoder().encode("PACK"));
  hv.setInt32(4, 12 + body.length, true);
  hv.setInt32(8, directory.length, true);
  return Uint8Array.from([...header, ...body, ...directory]);
}

function readAll(bytes: Uint8Array): number {
  const archive = decodeArchive(bytes);
  try {
    let total = 0;
    for (const entry of archive.entries) total += archive.readEntrySync(entry.ordinal).length;
    return total;
  } finally {
    archive.close();
  }
}

const text = new TextEncoder().encode("a pk3 member with enough repeated text to deflate ".repeat(8));

test("valid fixture archives read back before any mutation", () => {
  expect(
    readAll(
      zip([
        { name: "maps/a.bsp", data: text, deflate: true },
        { name: "scripts/b.shader", data: text.subarray(0, 40), deflate: false },
      ]),
    ),
  ).toBe(text.length + 40);
  expect(
    readAll(
      pak([
        { name: "maps/a.bsp", data: text },
        { name: "progs.dat", data: text.subarray(0, 9) },
      ]),
    ),
  ).toBe(text.length + 9);
});

test("seeded mutants of a pk3 either read or fail with a typed error", () => {
  const valid = zip([
    { name: "maps/a.bsp", data: text, deflate: true },
    { name: "scripts/b.shader", data: text.subarray(0, 40), deflate: false },
  ]);
  for (const seed of [21, 22, 23]) {
    const report = runMutations(seed, 500, valid, readAll);
    expect(report.foreign).toEqual([]);
    expect(report.rejected).toBeGreaterThan(0);
  }
});

test("seeded mutants of a PAK either read or fail with a typed error", () => {
  const valid = pak([
    { name: "maps/a.bsp", data: text },
    { name: "progs.dat", data: text.subarray(0, 9) },
  ]);
  for (const seed of [31, 32]) {
    const report = runMutations(seed, 500, valid, readAll);
    expect(report.foreign).toEqual([]);
    expect(report.rejected).toBeGreaterThan(0);
  }
});
