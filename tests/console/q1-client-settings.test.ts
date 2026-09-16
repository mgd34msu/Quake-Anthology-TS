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
import { ApplicationConsoleRouting } from "../../src/app/bootstrap/console.ts";
import { StartupConfig } from "../../src/app/bootstrap/startup-config.ts";
import { q1ChaseCamera, q1ViewCamera, q1ViewRectangle, readQ1ViewSettings, registerQ1ClientSettings, registerQ1ViewCommands } from "../../src/app/bootstrap/q1-client-settings.ts";
import { seatModelVisible } from "../../src/app/bootstrap/presentation-scene.ts";
import { createSceneQueries } from "../../src/world/collision/index.ts";
import type { Q1WorldGeometry, TraceQuery } from "../../src/contracts/scene.ts";
import { Q1_DONOR_PROFILE, Q3_BINARY32_PROFILE } from "../../src/core/numeric.ts";
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
  cvars.set("viewsize", "130"); expect(readQ1ViewSettings(cvars)).toEqual({ size: 120, overlayStatus: true, chase: null });
  expect(cvars.variableValue("viewsize")).toBe(120);
  cvars.set("cl_sbar", "1"); expect(readQ1ViewSettings(cvars)?.overlayStatus).toBe(false);
});

test("foreign camera preserves horizontal projection and shared crosshair follows scene center", () => {
  const owner = createIdentityOwner("foreign-q1-view"), seat = owner.seat(0), area = { x: 0, y: 0, width: 640, height: 480 };
  const source: SceneCamera = { viewport: area, origin: { x: 0, y: 0, z: 0 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }),
    projection: perspectiveProjection(90, 73.74, 4096), clip: { kind: "none" } };
  const camera = q1ViewCamera(source, area, { size: 100, overlayStatus: false, chase: null }, false);
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

function chaseWorld(): Q1WorldGeometry {
  const bounds = { min: { x: -8192, y: -8192, z: -8192 }, max: { x: 8192, y: 8192, z: 8192 } };
  return { kind: "q1-bsp", format: "bsp29", entities: "", planes: [{ normal: { x: 1, y: 0, z: 0 }, distance: 0, type: 0, signbits: 0 }],
    nodes: [{ plane: 0, children: [{ kind: "leaf", index: 1 }, { kind: "leaf", index: 0 }], bounds, faces: { first: 0, count: 0 } }],
    vertices: [], edges: [], surfaceEdges: [], leaves: [-2, -1].map(contents => ({ contents, bounds, faces: { first: 0, count: 0 }, visibilityOffset: null, ambientSound: [0, 0, 0, 0] })),
    leafFaces: [], textures: [], textureInfo: [], faces: [], models: [{ bounds, origin: { x: 0, y: 0, z: 0 }, headnodes: [0, -1, -1, -1], visibleLeaves: 1, faces: { first: 0, count: 0 } }],
    clipnodes: [], visibility: new Uint8Array(), lighting: { kind: "luminance8", samples: new Uint8Array() }, decoupledLightmaps: null, brushList: null, extensions: [] };
}

test("NetQuake chase settings toggle local presentation with source defaults and no QuakeWorld spectator override", () => {
  const context: CommandContext = { session: createIdentityOwner("q1-chase-settings").session, origin: { kind: "local-console" } };
  const cvars = new CvarRegistry({ dialect: "q1-netquake", context }); registerQ1ClientSettings(cvars);
  expect(readQ1ViewSettings(cvars)?.chase).toBeNull();
  cvars.set("chase_active", "1"); expect(readQ1ViewSettings(cvars)?.chase).toEqual({ back: 100, up: 16, right: 0 });
  cvars.set("chase_back", "72"); cvars.set("chase_up", "20"); cvars.set("chase_right", "12");
  expect(readQ1ViewSettings(cvars)?.chase).toEqual({ back: 72, up: 20, right: 12 });
  cvars.set("chase_back", "NaN"); expect(cvars.variableValue("chase_back")).toBe(72);
  cvars.set("chase_active", "0"); expect(readQ1ViewSettings(cvars)?.chase).toBeNull();
  const qw = new CvarRegistry({ dialect: "q1-quakeworld", context }); registerQ1ClientSettings(qw);
  expect(qw.find("chase_active")).toBeUndefined(); expect(readQ1ViewSettings(qw)?.chase).toBeNull();
});

test("chase uses real shared collision for rear clearance and forward aim without changing player or seat", () => {
  const identity = createIdentityOwner("q1-chase-view"), actor = identity.actor(1, 0), scene = createSceneQueries(chaseWorld());
  const camera: SceneCamera = { viewport: { x: 0, y: 0, width: 640, height: 240 }, origin: { x: 256, y: 128, z: 64 },
    axis: anglesToAxis({ x: 0, y: 0, z: 0 }), projection: perspectiveProjection(90, 60, 4096), clip: { kind: "none" } };
  const angles = { x: 0, y: 0, z: 0 }, settings = { back: 100, up: 16, right: 12 };
  const calls: TraceQuery[] = [], queries = { trace: (query: TraceQuery) => { calls.push(query); return scene.trace(query); } };
  for (const numeric of [Q1_DONOR_PROFILE, Q3_BINARY32_PROFILE]) {
    const open = q1ChaseCamera(camera, angles, settings, queries, numeric, actor);
    expect(open.origin).toEqual({ x: 156, y: 140, z: 80 });
    expect(open.axis[0].x).toBeGreaterThan(0.99); expect(open.axis[0].y).toBeLessThan(0); expect(open.axis[0].z).toBeLessThan(0);
    expect(open.viewport).toBe(camera.viewport); expect(open.projection).toBe(camera.projection);
    const wall = q1ChaseCamera({ ...camera, origin: { ...camera.origin, x: 32 } }, angles, settings, queries, numeric, actor);
    expect(wall.origin.x).toBeGreaterThanOrEqual(4); expect(wall.origin.x).toBeLessThan(5);
    const reverse = q1ChaseCamera(camera, { x: 0, y: 180, z: 0 }, settings, queries, numeric, actor);
    expect(reverse.origin.x).toBe(356); expect(reverse.axis[0].x).toBeLessThan(-0.99);
    expect(calls.at(-1)?.numeric).toBe(numeric);
  }
  expect(calls.every(query => query.passActor === actor && query.target.kind === "world" && query.policy.kind === "q1")).toBe(true);
  expect(calls[0]?.shape.kind).toBe("box"); expect(calls[1]?.shape.kind).toBe("point");
  expect(camera.origin).toEqual({ x: 256, y: 128, z: 64 }); expect(angles).toEqual({ x: 0, y: 0, z: 0 });
  const other = identity.actor(2, 0);
  expect(seatModelVisible(actor, { actor, viewWeapon: true })).toBe(true);
  expect(seatModelVisible(actor, { actor, viewWeapon: false })).toBe(false);
  expect(seatModelVisible(actor, { actor: other, viewWeapon: true })).toBe(false);
  expect(seatModelVisible(actor, { actor: other, viewWeapon: false })).toBe(true);
  expect(seatModelVisible(null, { actor, viewWeapon: true })).toBe(false);
  expect(seatModelVisible(null, { actor, viewWeapon: false })).toBe(true);
  expect(seatModelVisible(other, { actor: other, viewWeapon: true })).toBe(true);
});

test("retained Q2 image owner exposes Q1 settings before profile scripts and selects views by source", async () => {
  const root = await mkdtemp(join(tmpdir(), "q1-retained-view-"));
  const context: CommandContext = { session: createIdentityOwner("q1-retained-view").session, origin: { kind: "local-console" } };
  const output: string[] = [];
  try {
    const image = await ApplicationImageSettings.open({ dialect: "q2-classic", context, userContentRoot: root, print: text => { output.push(text); }, deferPersistence: true });
    const candidate = image.prepareClientSettings();
    const fallback = new CvarRegistry({ dialect: "q1-netquake", context });
    const routing = new ApplicationConsoleRouting({ fallback, sourceDialect: () => "q1-netquake", server: () => null, seat: () => fallback,
      shared: () => candidate.settings.cvars });
    const commands = new CommandBuffer({ dialect: "q1-netquake", context, cvars: fallback, cvarRouting: routing, print: text => { output.push(text); } });
    commands.executeNow("viewsize 110"); commands.executeNow("chase_active 1"); commands.executeNow("cl_sbar 0");
    expect(output).toEqual([]);
    expect(image.cvars.variableValue("viewsize")).toBe(100);
    candidate.publish();
    expect(image.cvars.dialect).toBe("q2-classic");
    expect(readQ1ViewSettings(image.cvars, "q1-netquake")).toEqual({ size: 110, overlayStatus: false, chase: { back: 100, up: 16, right: 0 } });
    expect(readQ1ViewSettings(image.cvars, "q1-quakeworld")).toEqual({ size: 110, overlayStatus: true, chase: null });
    expect(readQ1ViewSettings(image.cvars, "q2-classic")).toBeNull();
    await image.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});
