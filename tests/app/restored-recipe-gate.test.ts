import { expect, test } from "bun:test";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { corpusHasFile, testCorpusRoot } from "../support/corpus.ts";

const available = corpusHasFile("q1/id1/pak0.pak");

test.skipIf(!available)("a restored recipe mounts only what the installed catalog offers", async () => {
  const command = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q1-classic-id1", "--map", "e1m1", "--dedicated"]);
  if (command.kind !== "run") throw new Error("Expected launch options");
  const original = await loadApplicationContent(command.options);
  try {
    const recipe = original.recipe;
    const restored = await loadApplicationContent(command.options, recipe);
    await restored.close();
    const [first, ...rest] = recipe.mounts.mounts;
    if (first === undefined) throw new Error("Expected a mount");
    const moved = first.kind === "archive" ? { ...first, archivePath: `${first.archivePath}.elsewhere` } : { ...first, rootPath: `${first.rootPath}.elsewhere` };
    const forged = { ...recipe, mounts: { ...recipe.mounts, mounts: [moved, ...rest] } };
    await expect(loadApplicationContent(command.options, forged)).rejects.toThrow("not offered by the installed catalog");
  } finally { await original.close(); }
}, 120_000);

test.skipIf(!available)("a version 3 save written by the previous envelope loads through the application save path", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createSimulation } = await import("../../src/app/bootstrap/simulation/index.ts");
  const { prepareApplicationSave } = await import("../../src/app/bootstrap/original-save.ts");
  const { StartupSaves } = await import("../../src/app/bootstrap/startup-saves.ts");
  const { createIdentityOwner } = await import("../../src/contracts/identity.ts");
  const { encodeCheckpointValue } = await import("../../src/persistence/value.ts");
  const command = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q1-classic-id1", "--map", "e1m1", "--movement", "q1", "--character", "q1", "--dedicated"]);
  if (command.kind !== "run") throw new Error("Expected launch options");
  const directory = await mkdtemp(join(tmpdir(), "save-v3-"));
  const content = await loadApplicationContent(command.options);
  try {
    const options = { identity: createIdentityOwner("save-v3"), recipe: content.recipe, world: content.world, mounts: content.mounts, skill: command.options.skill, mode: command.options.mode, seed: 1, maxClients: 1 };
    const original = createSimulation(options);
    let image;
    try { image = original.checkpoint(); } finally { original.close(); }
    const payload = encodeCheckpointValue({ ...image, schemaVersion: 3 }), bytes = new Uint8Array(8 + payload.length);
    bytes.set(new TextEncoder().encode("QTSAVE3\n")); bytes.set(payload, 8);
    const path = join(directory, "old.sav");
    await Bun.write(path, bytes);
    const saves = new StartupSaves(content.catalog, directory);
    await saves.refresh();
    expect(saves.list.rows.map(row => [row.map, row.unavailable])).toEqual([["e1m1", null]]);
    const prepared = await prepareApplicationSave(command.options, content.catalog, saves.path("old.sav"));
    expect(prepared.image.recipe).toEqual(image.recipe);
    const restored = await loadApplicationContent(prepared.options, prepared.image.recipe);
    try {
      const simulation = createSimulation({ ...options, recipe: restored.recipe, world: restored.world, mounts: restored.mounts, restore: prepared.image });
      simulation.close();
    } finally { await restored.close(); }
  } finally { await content.close(); await rm(directory, { recursive: true, force: true }); }
}, 120_000);
