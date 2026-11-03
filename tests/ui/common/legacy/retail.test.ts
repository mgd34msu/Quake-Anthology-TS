import { expect, test } from "bun:test";
import { corpusFile } from "../../../support/corpus.ts";

import { existsSync } from "node:fs";
import {posix } from "node:path";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { defaultHudMenuPlan, loadMenuDefinitions, type UiMenuResolver } from "../../../../src/ui/common/legacy/menu.ts";
import { TeamArenaUiMemory } from "../../../../src/ui/common/legacy/team-arena/memory.ts";

const archivePath = corpusFile("q3a/missionpack/pak0.pk3");

test.skipIf(!existsSync(archivePath))("retail Team Arena HUD menu set loads through the HUD plan without diagnostics", async () => {
  const archive = await openArchive(archivePath);
  const sources = new Map<string, string>();
  const fail = (): never => { throw new Error("Retail HUD load unexpectedly requested a host operation"); };
  try {
    for (const entry of archive.entries) {
      if (entry.path.startsWith("ui/") && /\.(menu|h|txt)$/.test(entry.path)) {
        const bytes = await archive.readEntry(entry);
        sources.set(entry.path, Array.from(bytes, byte => String.fromCharCode(byte)).join(""));
      }
    }
    const source = (path: string) => {
      const text = sources.get(path);
      return text === undefined ? undefined : { path, text };
    };
    const resolver: UiMenuResolver = {
      resolveRoot: source,
      resolve: request => source(posix.join(posix.dirname(request.fromPath), request.requestedPath)) ?? source(request.requestedPath),
    };
    const definitions = await loadMenuDefinitions({ resolver, random: { nextInt: () => 7 } }, defaultHudMenuPlan(), {}, {
      memory: { kind: "qvm32", memory: new TeamArenaUiMemory("qvm32", fail) },
    });
    expect(definitions.diagnostics).toEqual([]);
    expect(definitions.menus).toHaveLength(13);
    expect(definitions.menus.reduce((total, menu) => total + menu.items.length, 0)).toBe(130);
    expect(definitions.registration.events).toHaveLength(41);
  } finally {
    archive.close();
  }
});
