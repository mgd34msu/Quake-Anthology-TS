import type { Vec3, Vec4 } from "../../../src/contracts/math.ts";
import type { Md5Model, ModelVertex, SkeletonJointPose } from "../../../src/contracts/scene.ts";
import { quaternionRotationRows, rotateQuaternionRows, rotateQuaternionAxis } from "../../../src/formats/q3-model/quaternion.ts";
import { at } from "../../../src/formats/q3-model/text.ts";
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
  expect(md2ReplacementSkinSelection({ skins: ["players/male/grunt.pcx"], frames: [] }, "scale.md5scale", [])).toEqual({ kind: "q2-md2-replacement", skins: ["players/male/md5/grunt.pcx"], sourceFrameCount: 0, scaleSource: "scale.md5scale", diagnostics: [] });
  expect(md5ReplacementAllowed(0, 1)).toBe(false);
  expect(md5ReplacementAllowed(2, 1)).toBe(true);
});

test("MD5 rejects invalid weight ranges and duplicate frame IDs", () => {
  expect(() => parseMd5Mesh(mesh.replace("0 1\n vert 1", "9 1\n vert 1"))).toThrow();
  expect(() => parseMd5Anim(animation.replace("frame 0", "frame 1"))).toThrow();
});

test("MD5 prepared joint rows retain exact standalone rotation including signed zeros", () => {
  const orientations: readonly Vec4[] = [
    {x:0,y:0,z:0,w:-1}, {x:-0,y:0,z:-0,w:1}, {x:.25,y:-.5,z:.125,w:-.75},
    {x:1,y:2,z:3,w:4}, {x:0,y:0,z:0,w:0},
  ];
  const vectors: readonly Vec3[] = [{x:0,y:-0,z:0},{x:1,y:0,z:-0},{x:-2.5,y:17,z:.125}];
  for(const orientation of orientations)for(const vector of vectors)
    expect(rotateQuaternionRows(quaternionRotationRows(orientation),vector)).toEqual(rotateQuaternionAxis(orientation,vector));
});

test("MD5 joint rows stay per call and retain multi-weight accumulation and validation", () => {
  const model=createMd5Model(parseMd5Mesh(mesh),parseMd5Anim(animation));
  const source=model.meshes[0];if(source===undefined)throw Error("Missing mesh");
  const surface: Md5Model["meshes"][number]={...source,vertices:source.vertices.map(vertex=>({...vertex,weights:{first:0,count:3}}))};
  function reference(joints:readonly SkeletonJointPose[]):readonly ModelVertex[]{
    return surface.vertices.map(vertex=>{
      let position={x:0,y:0,z:0},normal={x:0,y:0,z:0};
      for(let i=0;i<vertex.weights.count;i++){
        const weight=at(surface.weights,vertex.weights.first+i,"weight"),joint=at(joints,weight.joint,"joint");
        const rotated=rotateQuaternionAxis(joint.orientation,weight.position);
        const point={x:joint.position.x+joint.scale*rotated.x,y:joint.position.y+joint.scale*rotated.y,z:joint.position.z+joint.scale*rotated.z};
        const direction=rotateQuaternionAxis(joint.orientation,vertex.normal);
        position={x:position.x+weight.bias*point.x,y:position.y+weight.bias*point.y,z:position.z+weight.bias*point.z};
        normal={x:normal.x+weight.bias*direction.x,y:normal.y+weight.bias*direction.y,z:normal.z+weight.bias*direction.z};
      }
      return{position,normal};
    });
  }
  const first=sampleMd5Pose(model,0),next=sampleMd5Pose(model,1,0,.375);
  expect(skinMd5Mesh(surface,first)).toEqual(reference(first));
  expect(skinMd5Mesh(surface,next)).toEqual(reference(next));
  expect(skinMd5Mesh(surface,next)).not.toEqual(skinMd5Mesh(surface,first));
  expect(()=>skinMd5Mesh(surface,[])).toThrow("joint");
  expect(()=>skinMd5Mesh({...surface,weights:[]},[])).toThrow("weight");
});
