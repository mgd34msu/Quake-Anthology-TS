import { expect, test } from "bun:test";
import { ApplicationQ2NativeHud } from "../../src/app/bootstrap/q2-native-hud.ts";
import type { ContentId } from "../../src/contracts/content.ts";
import { partialStub } from "../support/stub.ts";
import type { UiDrawContext } from "../../src/contracts/ui.ts";
import type { NativeQ2HudFrame } from "../../src/ui/hud/q2-native.ts";

const content: ContentId = "q2:rerelease:baseq2:hud-test";
const image = (width: number, height: number) => ({ width, height });
function frame(statusbar: string, layout = ""): NativeQ2HudFrame {
  const stats = Array.from({ length: 32 }, () => 0);
  return { protocol: { kind: "q2-classic", version: 34 }, stats, configstrings: new Map([[5, statusbar]]), layout, inventory: [], playerNumber: 0, serverFrame: 1, timeMilliseconds: 0 };
}
function context(width = 640, height = 480): UiDrawContext {
  return partialStub<UiDrawContext>({ binding: { safeArea: { x: 10, y: 20, width, height } }, timeMilliseconds: 0 });
}
function stubAssets(missing: ReadonlySet<string> = new Set()) {
  type Assets = Parameters<ApplicationQ2NativeHud["prepare"]>[1];
  const warnings: string[] = [], loaded: string[] = [], fallback = image(1, 1);
  const assets = partialStub<Assets>({
    warnOnce: (key: string) => { warnings.push(key); },
    provider: async () => ({ textures: { missing: { image: fallback }, load: async (path: string) => { loaded.push(path); return missing.has(path) ? null : { image: image(path.includes("big") ? 32 : 16, 16) }; } } }),
  });
  return { assets, warnings, loaded, fallback };
}

// Each row: a layout the HUD is given, what it must draw, and what it must report.
const cases: readonly { readonly name: string; readonly statusbar: string; readonly layout?: string; readonly missing?: readonly string[];
  readonly images: number; readonly warnings: readonly string[]; readonly loadedIncludes?: readonly string[] }[] = [
  { name: "an empty layout draws only the clip pair", statusbar: "", images: 0, warnings: [] },
  { name: "a stat index outside the playerstate is reported once and draws nothing", statusbar: "pic 999", images: 0, warnings: ["q2-native-hud-layout"] },
  { name: "a named picture is loaded from pics/ and drawn", statusbar: "xv 0 yb -24 picn big_icon", images: 1, warnings: [], loadedIncludes: ["pics/big_icon.pcx"] },
  { name: "an absolute picture name drops its slash", statusbar: "picn /players/male/grunt_i.pcx", images: 1, warnings: [], loadedIncludes: ["players/male/grunt_i.pcx"] },
  { name: "a missing players/ picture falls back to the grunt icon", statusbar: "picn /players/none/x_i.pcx", missing: ["players/none/x_i.pcx"], images: 1, warnings: [],
    loadedIncludes: ["players/male/grunt_i.pcx"] },
  { name: "a missing ordinary picture draws the renderer's missing image", statusbar: "picn lost", missing: ["pics/lost.pcx"], images: 1, warnings: [] },
];
for (const row of cases) test(`Q2 native HUD: ${row.name}`, async () => {
  const hud = new ApplicationQ2NativeHud(), { assets, warnings, loaded } = stubAssets(new Set(row.missing ?? []));
  const source = frame(row.statusbar, row.layout), draw = context();
  await hud.prepare(content, assets, source, draw);
  expect(warnings).toEqual([...row.warnings]);
  for (const path of row.loadedIncludes ?? []) expect(loaded).toContain(path);
  const commands = hud.commands(source, draw);
  expect(commands[0]).toEqual({ kind: "clip", rect: { x: 10, y: 20, width: 640, height: 480 } });
  expect(commands.at(-1)).toEqual({ kind: "clip", rect: null });
  expect(commands.filter(command => command.kind === "image" && command.resource !== `resource:q2-native-hud:${content}/pics/conchars.pcx`)).toHaveLength(row.images);
});

test("Q2 native HUD: pictures past the cap are left undrawn and reported once", async () => {
  const hud = new ApplicationQ2NativeHud(), { assets, warnings, loaded } = stubAssets();
  const names = Array.from({ length: 600 }, (_, index) => `picn p${index}`).join(" ");
  const source = frame(names), draw = context();
  await hud.prepare(content, assets, source, draw);
  await hud.prepare(content, assets, source, draw);
  expect(warnings.filter(key => key === "q2-native-hud-cap")).toHaveLength(1);
  expect(loaded.filter(path => /^pics\/p\d+\.pcx$/.test(path)).length).toBeLessThanOrEqual(512);
  expect(hud.commands(source, draw).filter(command => command.kind === "image").length).toBeLessThanOrEqual(512);
});

test("Q2 native HUD: scale multiplies every rectangle and clear retires prepared pictures", async () => {
  const hud = new ApplicationQ2NativeHud(), { assets } = stubAssets();
  const source = frame("xv 8 yv 16 picn big_icon"), draw = context();
  await hud.prepare(content, assets, source, draw, 2);
  const [, picture] = hud.commands(source, draw, 2);
  expect(picture).toMatchObject({ kind: "image", rect: { x: 10 + 8 * 2, y: 20 + 16 * 2, width: 32 * 2, height: 16 * 2 } });
  hud.clear();
  expect(hud.commands(source, draw, 2)).toHaveLength(2);
});
