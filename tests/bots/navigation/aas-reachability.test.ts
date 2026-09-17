import { expect, test } from "bun:test";
import type { AasAsset } from "../../../src/bots/navigation/aas.ts";
import { buildAasReachability } from "../../../src/bots/navigation/aas-reachability.ts";
import { vec3 } from "../../../src/core/math.ts";
import { decodeQ3World } from "../../../src/formats/q3-map/index.ts";
import { SharedSceneQueries } from "../../../src/world/collision/index.ts";
import { q3Fixture } from "../../formats/q3-map/fixture.ts";
import { profile } from "./prediction.ts";
const zero=vec3(0,0,0);
function fixture(height=0): AasAsset {
 const ladder=false, options:{readonly ladderBottom?:boolean;readonly ladderSolid?:boolean}={};
 const stored:AasAsset["reachability"]=[];
  const vertices = ladder
    ? [zero, vec3(0, -10, -20), vec3(0, -10, 0), vec3(0, 10, 0), vec3(0, 10, -20),
      vec3(0, -10, 0), vec3(0, -10, 20), vec3(0, 10, 20), vec3(0, 10, 0)]
    : [zero, vec3(-10, -10, 0), vec3(-10, 10, 0), vec3(0, 10, 0), vec3(0, -10, 0),
      vec3(0, -10, height), vec3(0, 10, height), vec3(10, 10, height), vec3(10, -10, height)];
  const worldInput: AasAsset = { kind: "aas", lumps: [],
    source: "source reachability rectangles", version: 5, bspChecksum: 0, vertices,
    planes: [{ normal: vec3(1, 0, 0), distance: 0, type: 0 }, { normal: vec3(-1, 0, 0), distance: 0, type: 0 },
      { normal: vec3(0, 0, 1), distance: 0, type: 2 }, { normal: vec3(0, 0, -1), distance: 0, type: 2 },
      { normal: vec3(0, 0, 1), distance: height, type: 2 }, { normal: vec3(0, 0, -1), distance: -height, type: 2 }],
    edges: [{ vertices: [0, 0] }, { vertices: [1, 2] }, { vertices: [2, 3] }, { vertices: [3, 4] }, { vertices: [4, 1] },
      { vertices: [5, 6] }, { vertices: [6, 7] }, { vertices: [7, 8] }, { vertices: [8, 5] }],
    edgeIndexes: ladder ? [1, 2, 3, 4, 5, 6, 7, -2] : [1, 2, 3, 4, height === 0 ? -3 : 5, 6, 7, 8],
    faces: [{ plane: 0, flags: 0, edgeCount: 0, firstEdge: 0, frontArea: 0, backArea: 0 },
      { plane: ladder ? 0 : 2, flags: ladder ? 2 : 4, edgeCount: 4, firstEdge: 0, frontArea: 1, backArea: 0 },
      { plane: ladder ? options.ladderBottom === true ? 2 : 0 : 4, flags: ladder ? 2 : 4, edgeCount: 4, firstEdge: 4, frontArea: 2, backArea: 0 }],
    faceIndexes: [1, 2],
    areas: [{ number: 0, faceCount: 0, firstFace: 0, bounds: { min: zero, max: zero }, center: zero },
      { number: 1, faceCount: 1, firstFace: 0, bounds: { min: vec3(-10, -10, 0), max: vec3(0, 10, 80) }, center: vec3(-5, 0, 40) },
      { number: 2, faceCount: 1, firstFace: 1, bounds: { min: vec3(0, -10, height), max: vec3(10, 10, height + 80) }, center: vec3(5, 0, height + 40) }],
    settings: Array.from({ length: 3 }, (_, area) => ({ contents: 0, flags: area === 0 ? 0 : ladder ? 2 : 1, presence: 2,
      cluster: 0, clusterArea: 0, reachCount: 0, firstReach: 0 })),
    reachability: stored,
    nodes: [{ plane: 0, children: [0, 0] }, { plane: 0, children: [options.ladderSolid === true ? 0 : -2, -1] }], portals: [], portalIndexes: [], clusters: [], bboxes: [],
  };
  return worldInput;
}

test('shared AAS generation preserves equal-floor edge ordering and input', () => {
  const asset = fixture();
  const original = structuredClone(asset);
  const geometry = decodeQ3World(q3Fixture());
  const options = { asset, geometry, scene: new SharedSceneQueries(geometry), profile, predictionClient: 0,
    predictClientMovement() { throw new Error('Equal-floor generation must not invent a movement projection'); } };
  const result = buildAasReachability(options);
  expect(result.reachability).toHaveLength(3);
  expect(result.settings.map(setting => [setting.firstReach, setting.reachCount])).toEqual([[1, 0], [1, 1], [2, 1]]);
  expect(result.reachability.slice(1).map(reach => [reach.area, reach.edge, reach.travelType, reach.travelTime, reach.padding])).toEqual([[2, 3, 2, 1, 0], [1, -3, 2, 1, 0]]);
  expect(result.reachability[1]?.start).toEqual(vec3(0.1, 0, 0));
  expect(asset).toEqual(original);
  expect(buildAasReachability({ ...options, asset: result })).toBe(result);
});

test('source step and barrier heights retain distinct travel types', () => {
  const geometry = decodeQ3World(q3Fixture());
  for (const height of [18, 32]) {
    const result = buildAasReachability({ asset: fixture(height), geometry, scene: new SharedSceneQueries(geometry), profile,
      predictionClient: 0, predictClientMovement() { throw new Error('Adjacent step does not require selected movement'); } });
    expect(result.reachability.slice(1).map(reach => [reach.area, reach.travelType])).toEqual([[2, height === 18 ? 2 : 4], [1, height === 18 ? 2 : 7]]);
  }
});

test('BSP teleporter targets use the selected prediction client and retain team restriction', () => {
  const original = fixture();
  const asset: AasAsset = { ...original, bboxes: [{ presence: 4, flags: 0, bounds: { min: zero, max: zero } }],
    settings: original.settings.map((setting, area) => ({ ...setting, presence: 6, contents: area === 1 ? 64 : 0 })) };
  const decoded = decodeQ3World(q3Fixture());
  const model = decoded.models[0];
  if (model === undefined) throw new Error('Missing fixture model');
  const geometry = { ...decoded, entities: '{ "classname" "worldspawn" }\n{ "classname" "trigger_teleport" "model" "*0" "target" "exit" "bot_notteam" "2" }\n{ "classname" "misc_teleporter_dest" "targetname" "exit" "origin" "5 0 10" }',
    models: [{ ...model, bounds: { min: vec3(-8, -2, 0), max: vec3(-7, 2, 1) } }] };
  let calls = 0;
  const result = buildAasReachability({ asset, geometry, scene: new SharedSceneQueries(geometry), profile,
    predictionClient: 7, predictClientMovement(query) {
      calls++;
      expect(query.entityNum).toBe(7);
      expect(query.origin).toEqual(vec3(5, 0, 10));
      return { end: vec3(5, 0, 1), endArea: 2, velocity: zero, frames: 3, stopEvent: 1,
        trajectory: [], seconds: 0.3, grounded: true, waterLevel: 0 };
    } });
  expect(calls).toBe(1);
  expect(result.reachability.filter(reach => (reach.travelType & 0xffffff) === 10).map(reach => [reach.area, reach.travelType, reach.end])).toEqual([[2, 10 | (1 << 25), vec3(5, 0, 1)]]);
});

test('selected prediction preserves explicit crossing area and source stopped-frame numbering', async () => {
  const { AasReachabilitySpatial, AasReachabilityEntities } = await import('../../../src/bots/navigation/aas-reachability-spatial.ts');
  const { DEFAULT_AAS_MOVEMENT_SETTINGS } = await import('../../../src/bots/navigation/aas-reachability-types.ts');
  const { aasPointArea } = await import('../../../src/bots/navigation/aas.ts');
  const asset = fixture(), settings = asset.settings.map(setting => ({ ...setting }));
  const world = { ...asset, settings, pointArea: (point: typeof zero) => aasPointArea(asset, point), setting(area: number) {
    const setting = settings[area]; if (setting === undefined) throw new Error('Invalid fixture area'); return setting;
  } };
  const geometry = decodeQ3World(q3Fixture());
  let stopped = true;
  const spatial = new AasReachabilitySpatial({ asset, geometry, scene: new SharedSceneQueries(geometry), profile, predictionClient: 5,
    predictClientMovement(query) {
      expect(query.entityNum).toBe(5);
      return { end: zero, endArea: 2, velocity: zero, frames: 3, stopEvent: stopped ? 512 : 0,
        trajectory: [], seconds: 0.3, grounded: false, waterLevel: 0 };
    } }, world, new AasReachabilityEntities(geometry.entities), DEFAULT_AAS_MOVEMENT_SETTINGS);
  const request = { entityNum: -1, origin: zero, presence: 2, onGround: false, velocity: zero, commandMove: zero,
    commandFrames: 0, maxFrames: 3, frameTime: Math.fround(0.1), stopEvents: 512, stopArea: 1, visualize: false } satisfies import('../../../src/bots/behavior/q3/navigation-types.ts').BotMovementPrediction;
  expect(world.pointArea(zero)).toBe(1);
  const stoppedMove = spatial.movement.predictClientMovement(request).move;
  expect([stoppedMove.endArea, stoppedMove.frames, stoppedMove.time]).toEqual([2, 2, Math.fround(2 * request.frameTime)]);
  stopped = false;
  expect(spatial.movement.predictClientMovement(request).move.frames).toBe(3);
});
