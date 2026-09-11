import { test, expect } from "bun:test";
import { createMd5Model, md2ReplacementSkinSelection, md5PathsFor, md5ReplacementAllowed, parseMd5Anim, parseMd5Mesh, sampleMd5Pose, skinMd5Mesh } from "../../../src/formats/q3-model/index.ts";

const mesh = `MD5Version 10
commandline ""
numJoints 2
numMeshes 1
joints {
 "Root" -1 ( 1 0 0 ) ( 0 0 0 )
 "Child" 0 ( 1 1 0 ) ( 0 0 0 )
}
mesh {
 shader "not-the-replacement-skin"
 numverts 3
 vert 0 ( 0 0 ) 0 1
 vert 1 ( 1 0 ) 1 1
 vert 2 ( 0 1 ) 2 1
 numtris 1
 tri 0 0 1 2
 numweights 3
 weight 0 1 1 ( 1 0 0 )
 weight 1 1 1 ( 0 1 0 )
 weight 2 1 1 ( 0 0 0 )
}`;
const animation = `MD5Version 10
commandline "test"
numFrames 2
numJoints 2
frameRate 20
numAnimatedComponents 1
hierarchy {
 "Root" -1 1 0
 "Child" 0 0 1
}
bounds { ( 0 0 0 ) ( 4 4 4 ) ( 0 0 0 ) ( 8 8 8 ) }
baseframe { ( 1 0 0 ) ( 0 0 0 ) ( 0 1 0 ) ( 0 0 0 ) }
frame 1 { 2 }
frame 0 { 1 }
`;

test("MD5 preserves frame identity, per-joint position scale and new-frame skin scale", () => {
  const scale = { source: "test.md5scale", text: '{"Root":{"scale_positions":true,"1":2},"Child":{"1":3}}' };
  const model = createMd5Model(parseMd5Mesh(mesh), parseMd5Anim(animation, "test.md5anim", scale));
  expect(model.frames[0]?.joints[0]?.position.x).toBe(1);
  expect(model.frames[1]?.joints[0]?.position.x).toBe(4);
  expect(model.frames[1]?.joints[1]?.position).toEqual({ x: 4, y: 1, z: 0 });
  expect(model.animation.frames[1]?.localJoints[0]?.position.x).toBe(2);
  const surface = model.meshes[0];
  if (surface === undefined) throw new Error("Missing test mesh");
  const pose = sampleMd5Pose(model, 1, 0, 0.5);
  expect(pose[1]?.scale).toBe(3);
  expect(skinMd5Mesh(surface, pose)[0]?.position).toEqual({ x: 5.5, y: 1, z: 0 });
  expect(model.joints.map(joint => joint.scalePositions)).toEqual([true, false]);
});

test("replacement conventions preserve independent MD2 skins and source ranks", () => {
  expect(md5PathsFor("models/monster/tris.md2", "q2").meshPath).toBe("models/monster/md5/tris.md5mesh");
  expect(md5PathsFor("progs/player.mdl", "q1").meshPath).toBe("progs/player.md5mesh");
  expect(md2ReplacementSkinSelection(["players/male/grunt.pcx"], "scale.md5scale")).toEqual({ kind: "q2-md2-replacement", skins: ["players/male/md5/grunt.pcx"], scaleSource: "scale.md5scale" });
  expect(md5ReplacementAllowed(0, 1)).toBe(false);
  expect(md5ReplacementAllowed(2, 1)).toBe(true);
});

test("MD5 rejects invalid weight ranges and duplicate frame IDs", () => {
  expect(() => parseMd5Mesh(mesh.replace("0 1\n vert 1", "9 1\n vert 1"))).toThrow();
  expect(() => parseMd5Anim(animation.replace("frame 0", "frame 1"))).toThrow();
});
