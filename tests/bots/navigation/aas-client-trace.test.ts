// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { testCorpusRoot } from "../../support/corpus.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { aasPointArea, aasTraceClientBBox, parseAas } from "../../../src/bots/navigation/aas.ts";

const archivePath = resolve(testCorpusRoot(), "q3a/baseq3/pak0.pk3");

test.skipIf(!existsSync(archivePath))("AAS_TraceClientBBox on the retail q3dm1 area tree stops only at leaves that refuse the presence type", async () => {
  const archive = await openArchive(archivePath);
  let bytes: Uint8Array;
  try {
    const entry = archive.findEntries("maps/q3dm1.aas")[0];
    if (entry === undefined) throw new Error("Required supplied q3dm1.aas missing");
    bytes = await archive.readEntry(entry);
  } finally {
    archive.close();
  }
  const asset = parseAas(bytes, "maps/q3dm1.aas");
  let checked = 0,
    stopped = 0;
  for (const [number, area] of asset.areas.entries()) {
    if (number === 0 || ((asset.settings[number]?.presence ?? 0) & 4) === 0 || checked >= 200) continue;
    checked++;
    const start = { ...area.center, z: area.center.z + 0.25 },
      end = { ...start, z: start.z - 50 };
    const trace = aasTraceClientBBox(asset, start, end, 4);
    expect(trace.startSolid).toBe(aasPointArea(asset, start) === 0 || ((asset.settings[aasPointArea(asset, start)]?.presence ?? 0) & 4) === 0);
    expect(trace.fraction).toBeGreaterThanOrEqual(0);
    expect(trace.fraction).toBeLessThanOrEqual(1);
    if (trace.fraction === 1) expect(trace.end).toEqual(end);
    else if (!trace.startSolid) {
      stopped++;
      const hit = aasPointArea(asset, { ...trace.end, z: trace.end.z - 0.5 });
      expect(hit === 0 || ((asset.settings[hit]?.presence ?? 0) & 4) === 0).toBe(true);
    }
  }
  expect(checked).toBeGreaterThan(50);
  expect(stopped).toBeGreaterThan(0);
  expect(() => aasTraceClientBBox(asset, { x: NaN, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 4)).toThrow("Non-finite");
});
