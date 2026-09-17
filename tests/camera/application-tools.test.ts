import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApplicationTools } from "../../src/app/bootstrap/application-tools.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { createMountIdentity } from "../../src/contracts/content.ts";
import { openMountPlan } from "../../src/content/mounts/index.ts";
import { perspectiveProjection } from "../../src/render/scene/view.ts";
import type { SceneCamera } from "../../src/contracts/render.ts";

test("application tools share camera between actual command owners and retire pending state", async () => {
  const root = await mkdtemp(join(tmpdir(), "application-tools-"));
  try {
    const owner = createIdentityOwner("application-tools"), context = { session: owner.session, origin: { kind: "server-console" } } satisfies ConstructorParameters<typeof CommandBuffer>[0]["context"];
    const authority = new CommandBuffer({ dialect: "q3", context }), input = new CommandBuffer({ dialect: "q3", context });
    const cvars = new CvarRegistry({ dialect: "q3", context }); cvars.register("cl_avidemo", "30", 0); cvars.register("cl_forceavidemo", "0", 0); cvars.register("timescale", "1", 0);
    const mount = createMountIdentity("mount:tools:fixture", "q3:classic:base:fixture", 0);
    using mounts = await openMountPlan({ id: "mount-plan:tools:fixture", mounts: [{ kind: "loose", rootPath: root, identity: mount }], defaultOrder: [mount.id], prefixOrders: [] });
    await Bun.write(join(root, "view.camera"), 'cameraPathDef { time 1 camera_interpolated { startPos ( 0 0 0 ) endPos ( 10 0 0 ) } }');
    let time = 0;
    const tools = new ApplicationTools(authority, { mounts: () => mounts, outputRoot: () => join(root, "output"), milliseconds: () => time, cvars: () => cvars,
      renderer: () => ({ backend: "cpu", width: 640, height: 480, driver: null, displayModes: [], images: [] }), shaders: () => [], resources: () => null,
      frame: () => ({ frame: 0, milliseconds: time, renderer: "cpu", map: "fixture", clients: 1 }), print: () => {} });
    tools.bind([authority, input]); tools.bind([authority, input]);
    authority.append("loadcamera view.camera\n"); await authority.executeAsync(() => tools.drain());
    input.append("startcamera;timers on;timerstamp started;savecamera exported.camera\n"); await input.executeAsync(() => tools.drain());
    const camera: SceneCamera = { origin: { x: 50, y: 0, z: 0 }, axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], viewport: { x: 0, y: 0, width: 640, height: 480 }, projection: perspectiveProjection(90, 60, 1000), clip: { kind: "none" } };
    time = 500; expect(tools.applyCamera(camera).origin.x).toBe(5);
    expect(await Bun.file(join(root, "output/exported.camera")).exists()).toBe(true);
    expect(tools.frameTime(100, true)).toEqual({ milliseconds: 33, capture: true });
    expect(await tools.measureAsync("simulation", async () => 42)).toBe(42);
    expect(tools.timer.report().find(entry => entry.name === "simulation")?.calls).toBe(1);
    expect(tools.timer.stampList()[0]?.name).toBe("started");
    tools.beforeWorldChange(); expect(tools.applyCamera(camera)).toBe(camera); expect(input.exists("loadcamera")).toBe(false);
    tools.bind([authority]); expect(authority.exists("loadcamera")).toBe(true); expect(input.exists("loadcamera")).toBe(false);
    await tools.close(); expect(authority.exists("timers")).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
