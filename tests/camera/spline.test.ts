import { expect, test } from "bun:test";
import { CameraPlayback, parseCamera, serializeCamera } from "../../src/camera/spline.ts";
import { ApplicationSplineCamera } from "../../src/camera/application.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { perspectiveProjection } from "../../src/render/scene/view.ts";
import type { SceneCamera } from "../../src/contracts/render.ts";
const file = `cameraPathDef { time 2
camera_interpolated { name "dolly" startPos ( 0 0 0 ) endPos ( 20 0 0 ) }
target_fixed { name "look" pos ( 20 20 0 ) }
event { type 4 param "look" time 0 }
event { type 1 param "1" time 500 }
event { type 9 param "" time 2500 }
fov { fov 90 startFOV 90 endFOV 60 time 2000 }
}`;
test("source camera serialization retains paths, velocity entries, timed targets and events", () => {
  const camera = parseCamera(file); expect(parseCamera(serializeCamera(camera))).toEqual(camera);
  const playback = new CameraPlayback(camera, 100);
  expect(playback.sample(100)?.origin.x).toBe(0);
  expect(playback.sample(350)?.origin.x).toBe(2.5);
  expect(playback.sample(600)?.origin.x).toBe(2.5);
  expect(playback.sample(1100)?.origin.x).toBe(2.5);
  expect(playback.sample(1100)?.events).toEqual([]);
  expect(playback.sample(1850)?.origin.x).toBe(10);
  expect(playback.sample(2100)?.fov).toBe(60);
  expect(playback.sample(2600)).toBeNull();
  expect(playback.sample(2700)).toBeNull();
});
test("source cubic basis and neighbor interpolation produce expected line positions", () => {
  const definition = parseCamera(`cameraPathDef { time 1 camera_spline { name path target { granularity 0.5 ( 0 0 0 ) ( 6 0 0 ) ( 12 0 0 ) ( 18 0 0 ) } } }`);
  expect(parseCamera(serializeCamera(definition))).toEqual(definition);
  const playback = new CameraPlayback(definition, 0);
  expect(playback.sample(0)?.origin.x).toBeCloseTo(6, 5);
  expect(playback.sample(500)?.origin.x).toBeCloseTo(9, 5);
  expect(playback.sample(1000)?.origin.x).toBeCloseTo(12, 5);
  expect(() => playback.sample(900)).toThrow("monotonic");
});
test("bad camera files fail at admission without unbounded spline sampling", () => {
  expect(() => parseCamera(file.replace('param "look"', 'param "missing"'))).toThrow("Unknown camera target");
  expect(() => parseCamera(file.replace("time 2", "time NaN"))).toThrow("number");
  expect(() => parseCamera(`cameraPathDef { time 1 camera_spline { target { granularity 0 ( 0 0 0 ) ( 0 0 0 ) ( 0 0 0 ) ( 0 0 0 ) } } }`)).toThrow("granularity");
});
test("actual command dispatch loads, starts, applies and saves a source camera", async () => {
  const owner = createIdentityOwner("camera-tools"); let time = 100, saved = "";
  const commands = new CommandBuffer({ dialect: "q3", context: { session: owner.session, origin: { kind: "server-console" } } });
  const camera = new ApplicationSplineCamera({ commands, read: async () => file, write: async (_path, text) => { saved = text; }, milliseconds: () => time, print: () => {} });
  camera.activate(); commands.append("loadcamera fixture.camera;startcamera\n");
  await commands.executeAsync(() => camera.drain());
  const source: SceneCamera = { origin: { x: 99, y: 0, z: 0 }, axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], projection: perspectiveProjection(90, 60, 1000), viewport: { x: 0, y: 0, width: 640, height: 480 }, clip: { kind: "none" } };
  expect(camera.apply(source).origin.x).toBe(0); time = 350;
  expect(camera.apply(source).origin.x).toBe(2.5);
  commands.executeNow("savecamera exported.camera"); await camera.drain(); expect(parseCamera(saved)).toEqual(parseCamera(file));
  commands.executeNow("stopcamera"); expect(camera.apply(source)).toBe(source);
  await camera.close(); expect(commands.exists("loadcamera")).toBe(false);
});
