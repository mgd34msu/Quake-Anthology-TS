import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandContext } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { InputCommandBuilder } from "../../src/input/user-command.ts";
import { bindRunCvar } from "../../src/app/bootstrap/shared-setting-cvars.ts";
import { ApplicationImageSettings } from "../../src/app/bootstrap/image-settings.ts";
import { StartupConfig } from "../../src/app/bootstrap/startup-config.ts";
import { q1ViewCamera, q1ViewRectangle, readQ1ViewSettings, registerQ1ClientSettings, registerQ1ViewCommands } from "../../src/app/bootstrap/q1-client-settings.ts";
import type { SceneCamera } from "../../src/contracts/render.ts";
import type { UiDrawContext } from "../../src/contracts/ui.ts";
import { anglesToAxis } from "../../src/core/math.ts";
import { perspectiveProjection } from "../../src/render/scene/view.ts";
import { drawCommonHud, emptyHudData, SeatHudMessages } from "../../src/ui/hud/index.ts";
import { defaultUiSkin } from "../../src/ui/common/skin.ts";
import { SeatUiPreferences } from "../../src/ui/settings/index.ts";

test("Q1 quake.rc consumes real client settings before archived and autoexec overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "q1-client-settings-"));
  const context: CommandContext = { session: createIdentityOwner("q1-client-settings").session, origin: { kind: "local-console" } };
  const output: string[] = [];
  try {
    const image = await ApplicationImageSettings.open({ dialect: "q1-netquake", context, userContentRoot: root, print: text => { output.push(text); } });
    const scripts = new Map([
      ["quake.rc", "exec default.cfg\nexec config.cfg\nexec autoexec.cfg\n"],
      ["default.cfg", "viewsize 100\ngamma 1\nvolume 0.7\nbgmvolume 1\n"],
      ["config.cfg", "gamma 0.8\nvolume 0.4\n"],
      ["autoexec.cfg", "gamma 0.5\nvolume 0.2\nsizeup\n"],
    ]);
    const startup = new StartupConfig({ dialect: "q1-netquake", context, hasMod: false, read: async name => scripts.get(name),
      applySelectedDefaults: () => {}, applyArchive: () => { image.cvars.applyArchive([{ name: "volume", value: "0.6" }]); }, applyLaunchOptions: () => {} });
    const commands = new CommandBuffer({ dialect: "q1-netquake", context, cvars: image.cvars, readScript: startup.readScript,
      onScriptComplete: startup.onScriptComplete, print: text => { output.push(text); } });
    registerQ1ViewCommands(commands);
    expect(await startup.executeFrame(commands, async () => {})).toBe(true);
    expect(image.gamma).toBe(2);
    expect(image.cvars.variableValue("volume")).toBeCloseTo(0.2);
    expect(image.cvars.variableValue("viewsize")).toBe(110);
    image.cvars.set("r_gamma", "1.25");
    expect(image.cvars.variableValue("gamma")).toBeCloseTo(0.8);
    await image.close();
    const saved = await Bun.file(join(root, "settings/images.cfg")).text();
    expect(saved).toContain("r_gamma"); expect(saved).not.toContain("volume");
    expect(output.some(text => text.includes("Unknown command") || text.includes("already") || text.includes("allready"))).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Q1 world rebinding preserves run preference and native reset without duplicate registration", () => {
  const context: CommandContext = { session: createIdentityOwner("q1-run-travel").session, origin: { kind: "local-console" } };
  const output: string[] = [], cvars = new CvarRegistry({ dialect: "q1-netquake", context, print: text => { output.push(text); } });
  cvars.applyArchive([{ name: "cl_run", value: "1" }]);
  const first = new InputCommandBuilder("q1-netquake"), release = bindRunCvar(cvars, first);
  expect(first.tuning.alwaysRun).toBe(true); expect(cvars.find("cl_run")?.resetValue).toBe("0");
  release();
  const next = new InputCommandBuilder("q1-netquake"); bindRunCvar(cvars, next);
  expect(next.tuning.alwaysRun).toBe(true);
  cvars.reset("cl_run"); expect(next.tuning.alwaysRun).toBe(false);
  expect(output).toEqual([]);
});

test("Q1 viewsize follows native scene dimensions and intermission fills the seat", () => {
  const area = { x: 10, y: 20, width: 640, height: 480 };
  expect(q1ViewRectangle(area, 100, false)).toEqual({ x: 10, y: 20, width: 640, height: 432 });
  expect(q1ViewRectangle(area, 110, false)).toEqual({ x: 10, y: 20, width: 640, height: 456 });
  expect(q1ViewRectangle(area, 120, false)).toEqual(area);
  expect(q1ViewRectangle(area, 50, false)).toEqual({ x: 170, y: 116, width: 320, height: 240 });
  expect(q1ViewRectangle(area, 50, true)).toEqual(area);
  expect(q1ViewRectangle(area, 100, false, true)).toEqual(area);
});

test("viewsize clamps at rendering and QuakeWorld honors its overlay-status default", () => {
  const context: CommandContext = { session: createIdentityOwner("qw-viewsize").session, origin: { kind: "local-console" } };
  const cvars = new CvarRegistry({ dialect: "q1-quakeworld", context });
  cvars.register("r_gamma", "1"); registerQ1ClientSettings(cvars);
  cvars.set("viewsize", "130"); expect(readQ1ViewSettings(cvars)).toEqual({ size: 120, overlayStatus: true });
  expect(cvars.variableValue("viewsize")).toBe(120);
  cvars.set("cl_sbar", "1"); expect(readQ1ViewSettings(cvars)?.overlayStatus).toBe(false);
});

test("foreign camera preserves horizontal projection and shared crosshair follows scene center", () => {
  const owner = createIdentityOwner("foreign-q1-view"), seat = owner.seat(0), area = { x: 0, y: 0, width: 640, height: 480 };
  const source: SceneCamera = { viewport: area, origin: { x: 0, y: 0, z: 0 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }),
    projection: perspectiveProjection(90, 73.74, 4096), clip: { kind: "none" } };
  const camera = q1ViewCamera(source, area, { size: 100, overlayStatus: false }, false);
  expect(camera.viewport.height).toBe(432); expect(camera.projection[0]).toBe(source.projection[0]);
  expect(camera.projection[5]).toBeCloseTo(source.projection[5] * 480 / 432);
  const provider = { provider: "q2:official", content: "q2:classic:baseq2:retail" } satisfies import("../../src/contracts/content.ts").ProviderReference;
  const context: UiDrawContext = { binding: { seat, client: owner.client(0, 0), viewport: area, safeArea: area, hudScale: 1,
    presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: provider.content, hud: provider, effects: provider, audio: provider } }, timeMilliseconds: 0 };
  const base = emptyHudData(seat);
  const commands = drawCommonHud(context, { ...base, crosshair: { ...base.crosshair, visible: true } }, {
    skin: defaultUiSkin("resource:test:font"), preferences: new SeatUiPreferences(seat).values,
    messages: new SeatHudMessages(seat), camera, localize: text => text });
  const rects = commands.flatMap(command => command.kind === "fill" ? [command.rect] : []);
  expect(rects).toHaveLength(2);
  for (const rect of rects) { expect(rect.x + rect.width / 2).toBe(320); expect(rect.y + rect.height / 2).toBe(216); }
});
