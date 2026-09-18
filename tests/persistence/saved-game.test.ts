import { parseSaveRequest, parseLoadRequest, saveCommandDocumentation } from "../../src/app/bootstrap/save-requests.ts";
import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { decodeSavedGame } from "../../src/persistence/saved-game.ts";
import { encodeQ1Save, type Q1SaveData } from "../../src/persistence/q1.ts";

function save(version: 5 | 6): Q1SaveData {
  return { format: version === 5 ? { version } : { version, gameDirectories: "id1;hipnotic" }, comment: "native_save",
    spawnParameters: Array.from({ length: 16 }, (_, index) => index), skill: 2, map: "e1m1", time: 42.5,
    lightStyles: Array.from({ length: 64 }, () => "m"), globals: [{ key: "serverflags", value: "1" }],
    entities: [[{ key: "classname", value: "worldspawn" }], [{ key: "health", value: "73" }]], extensionText: "// source extension\n" };
}
for (const version of [5, 6] satisfies readonly (5 | 6)[]) test(`detects original Quake v${version} without losing source records`, () => {
  const data = save(version);
  expect(decodeSavedGame(encodeQ1Save(data))).toEqual({ kind: "q1-source", data });
});
test("malformed shared headers do not fall back to native formats", () => {
  expect(() => decodeSavedGame(new TextEncoder().encode("QTSAVE9\n"))).toThrow("signature/version");
  expect(() => decodeSavedGame(encodeQ1Save({ ...save(5), map: "../e1m1" }))).toThrow("map");
  expect(() => decodeSavedGame(encodeQ1Save({ ...save(5), entities: [] }))).toThrow("world");
});

test("actual installed Quake source saves identify format and preserve extensions", async () => {
  const path = join(process.env["QUAKE_DATA_PATH"] ?? join(homedir(), "Projects/qfiles"), "q1/id1/autosave/start.sav");
  if (!await Bun.file(path).exists()) throw new Error("Missing installed Quake save fixture");
  const first = decodeSavedGame(await Bun.file(path).bytes());
  if (first.kind !== "q1-source") throw new Error("Expected source save");
  const second = decodeSavedGame(encodeQ1Save(first.data));
  expect(second).toEqual(first);
  expect(first.data.entities.length).toBeGreaterThan(2);
});

test("explicit native save content selection wins over a directory label", async () => {
  const { discoverInstalledContent } = await import("../../src/content/catalog/index.ts");
  const { selectQ1SaveProduct } = await import("../../src/persistence/q1-selection.ts");
  const catalog = await discoverInstalledContent({ corpusRoot: process.env["QUAKE_DATA_PATH"] ?? join(homedir(), "Projects/qfiles") });
  const product = selectQ1SaveProduct(catalog, save(5), "q1-rerelease-id1/manual.sav", "q1-classic-id1");
  expect(product.expectation.id).toBe("q1-classic-id1");
  expect(() => selectQ1SaveProduct(catalog, save(5), "manual.sav", "q2-classic-baseq2")).toThrow("match");
});

test("public save commands select original versions and explicit recovery content", () => {
  expect(parseSaveRequest(["manual"])).toEqual({ name: "manual", format: "shared" });
  expect(parseSaveRequest(["original", "v5"]).format).toBe("v5");
  expect(parseSaveRequest(["original", "v6"]).format).toBe("v6");
  expect(parseLoadRequest(["original", "q1-classic-id1"])).toEqual({ name: "original", sourceProduct: "q1-classic-id1" });
  expect(parseLoadRequest(["shared"])).toEqual({ name: "shared" });
  expect(() => parseSaveRequest(["original", "v7"])).toThrow("Usage");
  expect(() => parseLoadRequest(["original", ""])).toThrow("Usage");
  expect(saveCommandDocumentation("save")?.usage).toContain("v5|v6");
  expect(saveCommandDocumentation("load")?.usage).toContain("source-product");
});
