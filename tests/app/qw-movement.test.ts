import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applicationPreset, resolveApplicationMovement } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { StartupSelectionModel } from "../../src/app/bootstrap/startup-selection.ts";
import { discoverInstalledContent } from "../../src/content/catalog/index.ts";

function pakWith(entries: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const dataLength = entries.reduce((sum, [, data]) => sum + data.length, 0), directoryOffset = 12 + dataLength;
  const bytes = new Uint8Array(directoryOffset + entries.length * 64), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("PACK"));
  view.setUint32(4, directoryOffset, true); view.setUint32(8, entries.length * 64, true);
  let position = 12;
  entries.forEach(([entry, data], index) => {
    bytes.set(data, position);
    const offset = directoryOffset + index * 64;
    bytes.set(new TextEncoder().encode(entry), offset);
    view.setUint32(offset + 56, position, true); view.setUint32(offset + 60, data.length, true);
    position += data.length;
  });
  return bytes;
}

function bspWithPlayerStart(): Uint8Array {
  const entities = new TextEncoder().encode('{ "classname" "worldspawn" }\n{ "classname" "info_player_start" "origin" "0 0 0" }\n');
  const header = 4 + 15 * 8, bytes = new Uint8Array(header + entities.length), view = new DataView(bytes.buffer);
  view.setUint32(0, 29, true); view.setUint32(4, header, true); view.setUint32(8, entities.length, true);
  bytes.set(entities, header);
  return bytes;
}

async function id1Corpus(root: string): Promise<void> {
  const program = new Uint8Array([6]);
  await mkdir(join(root, "Quake/Id1"), { recursive: true });
  await writeFile(join(root, "Quake/Id1/PAK0.PAK"), pakWith([["progs.dat", program], ["progs/player.mdl", program], ["maps/e1m1.bsp", bspWithPlayerStart()]]));
  await writeFile(join(root, "Quake/Id1/PAK1.PAK"), pakWith([["progs.dat", program]]));
}

test("QuakeWorld movement needs only base Quake, not the qw bundle", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "quake-qw-movement-"));
  try {
    await id1Corpus(root);
    const catalog = await discoverInstalledContent({ corpusRoot: root, discoverMods: false });
    expect(catalog.product("q1-quakeworld").availability.kind).toBe("missing");
    const parsed = parseApplicationCommand(["--content-root", root, "--menu"]);
    if (parsed.kind !== "menu") throw new Error("Expected startup options");
    const initial = { ...parsed.options, product: "q1-classic-id1", map: "maps/e1m1.bsp", movement: "q1", character: "q1" } as const;
    const selection = new StartupSelectionModel(catalog, initial);
    await selection.prepareMaps();
    const movementRow = selection.rows().find(row => row.id === "movement");
    const quakeworld = movementRow?.choices.find(choice => choice.id === "q1-quakeworld");
    expect(quakeworld?.unavailable).toBeNull();
    selection.select("product", "q1-classic-id1"); selection.select("map", "maps/e1m1.bsp");
    selection.select("movement", "q1-quakeworld"); selection.select("character", "q1-classic-id1");
    const launch = await selection.resolve();
    expect(launch.options.movementProduct).toBe("q1-quakeworld");
    expect(launch.recipe.movement.content).toBe(catalog.require("q1-classic-id1").id);
    expect(launch.recipe.timing.find(profile => profile.provider === "q1:movement")?.clock.kind).toBe("q1-quakeworld");

    const command = parseApplicationCommand(["--content-root", root, "--game", "q1-classic-id1", "--map", "e1m1",
      "--movement", "qw", "--character", "q1", "--dedicated"]);
    if (command.kind !== "run") throw new Error("Expected launch options");
    const resolved = resolveApplicationMovement(catalog, command.options);
    expect(resolved.movement).toBe("q1");
    expect(resolved.movementProduct).toBe("q1-quakeworld");
    const preset = applicationPreset(catalog, command.options);
    expect(preset.movement.content).toBe(catalog.require("q1-classic-id1").id);
    expect(preset.timing.find(profile => profile.provider === "q1:movement")?.clock.kind).toBe("q1-quakeworld");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("QuakeWorld movement stays unavailable without base Quake", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "quake-qw-movement-empty-"));
  try {
    const catalog = await discoverInstalledContent({ corpusRoot: root, discoverMods: false });
    const command = parseApplicationCommand(["--content-root", root, "--game", "q1-classic-id1", "--map", "e1m1",
      "--movement", "qw", "--character", "q1", "--dedicated"]);
    if (command.kind !== "run") throw new Error("Expected launch options");
    expect(() => resolveApplicationMovement(catalog, command.options)).toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
