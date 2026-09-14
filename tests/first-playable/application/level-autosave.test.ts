import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { readSaveImage } from "../../../src/persistence/save-image.ts";

test("level autosave captures initial and next playable worlds and preserves saves on failed travel and restore", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-level-autosave-"));
  const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing options");
  const app = await Application.open(parsed.options, { print: () => undefined, saveDirectory: join(root, "saves") });
  try {
    const path = join(root, "saves", "q2-classic-baseq2", "autosave.sav");
    const initial = await readSaveImage(path);
    expect(initial.recipe).toEqual(app.content.recipe);
    expect(initial.configurations).toHaveLength(1);
    const manual = join(root, "saves", "manual.sav"), quick = join(root, "saves", "quicksave.sav");
    await app.saveGame(manual); await app.saveGame(quick);
    const manualBytes = await Bun.file(manual).bytes(), quickBytes = await Bun.file(quick).bytes();
    await app.changeLevel("base2");
    const next = await readSaveImage(path);
    expect(next.recipe.map.geometry.requestedPath).toBe("maps/base2.bsp");
    expect(next.configurations).toHaveLength(1);
    const nextBytes = await Bun.file(path).bytes();
    await expect(app.changeLevel("nonexistent-autosave-test-map")).rejects.toThrow();
    expect(await Bun.file(path).bytes()).toEqual(nextBytes);
    await app.loadGame(manual);
    expect(app.content.recipe).toEqual(initial.recipe);
    expect(await Bun.file(path).bytes()).toEqual(nextBytes);
    expect(await Bun.file(manual).bytes()).toEqual(manualBytes);
    expect(await Bun.file(quick).bytes()).toEqual(quickBytes);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);

test("autosave write failure does not abort a playable level", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-autosave-failure-"));
  const saveDirectory = join(root, "not-a-directory"); await Bun.write(saveDirectory, "file");
  const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing options");
  const messages: string[] = [];
  const app = await Application.open(parsed.options, { print: message => { messages.push(message); }, saveDirectory });
  try {
    expect(app.localPlayers).toHaveLength(1);
    expect(messages.some(message => message.startsWith("Autosave failed:"))).toBe(true);
    await app.changeLevel("base2");
    expect(app.content.recipe.map.geometry.requestedPath).toBe("maps/base2.bsp");
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);
