import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { openArchive } from "../../../src/content/archive/index.ts";
import type { ArchiveHandle } from "../../../src/content/archive/index.ts";
import { createMd5Model, interpolateSurface, lerpTag, loadMd3Lods, md3AtLod, parseMd3, parseMd5Anim, parseMd5Mesh, parsePlayerAnimationConfig, parseSkin, q1ReplacementSkinSelection, sampleMd5Pose, skinMd5Mesh, toSceneMd3 } from "../../../src/formats/q3-model/index.ts";

const q3Archive = "/home/buzzkill/Projects/qfiles/q3a/baseq3/pak0.pk3";
const q2Archive = "/home/buzzkill/q2rets/rerelease/baseq2/pak0.pak";
const q1Archive = "/home/buzzkill/Projects/qfiles/q1/rerelease/id1/pak0.pak";

async function read(archive: ArchiveHandle, path: string): Promise<Uint8Array> {
  const entry = archive.findEntries(path)[0];
  if (entry === undefined) throw new Error(`Missing retail fixture ${path}`);
  return archive.readEntry(entry);
}

test.skipIf(!existsSync(q3Archive))("retail MD3 player preserves animated tags, independent LODs, skins and animation identities", async () => {
  const archive = await openArchive(q3Archive);
  try {
    const path = "models/players/sarge/lower.md3";
    const model = parseMd3(await read(archive, path), path);
    expect(model.frames).toHaveLength(191);
    expect(model.tags[0]?.[0]?.name).toBe("tag_torso");
    const surface = model.surfaces[0];
    if (surface === undefined) throw new Error("Retail surface missing");
    expect(interpolateSurface(surface, 1, 0, 0.5)).toHaveLength(surface.texCoords.length);
    expect(lerpTag(model, "tag_torso", 0, 1, 0.5)?.origin.x).toBeFinite();
    expect(toSceneMd3(model).sourceModel).toBe(model);
    const calls: string[] = [];
    const lods = await loadMd3Lods(path, { async read(filename) {
      calls.push(filename);
      const entry = archive.findEntries(filename)[0];
      return entry === undefined ? null : archive.readEntry(entry);
    } });
    expect(calls).toEqual(["models/players/sarge/lower_2.md3", "models/players/sarge/lower_1.md3", path]);
    if (lods === null) throw new Error("Retail LODs missing");
    expect(lods.slots.map(slot => slot.kind)).toEqual(["loaded", "loaded", "loaded"]);
    expect(md3AtLod(lods, 0)?.frames).toHaveLength(191);
    const config = parsePlayerAnimationConfig(new TextDecoder().decode(await read(archive, "models/players/sarge/animation.cfg")));
    expect(config.animations).toHaveLength(37);
    expect(config.animations[13]?.firstFrame).toBe(90);
    expect(config.animations[32]?.reversed).toBe(true);
    expect(parseSkin(new TextDecoder().decode(await read(archive, "models/players/sarge/lower_default.skin")))).toHaveLength(1);
  } finally { archive.close(); }
});

test.skipIf(!existsSync(q2Archive))("retail Q2 flag scale_positions and scalar vertex match the donor", async () => {
  const archive = await openArchive(q2Archive);
  try {
    const prefix = "players/male/md5/flag1";
    const text = async (extension: string): Promise<string> => new TextDecoder().decode(await read(archive, prefix + extension));
    const model = createMd5Model(parseMd5Mesh(await text(".md5mesh")), parseMd5Anim(await text(".md5anim"), prefix, { source: prefix + ".md5scale", text: await text(".md5scale") }));
    expect(model.joints).toHaveLength(8);
    expect(model.joints.every(joint => joint.scalePositions)).toBe(true);
    expect(model.animation.diagnostics).toEqual([]);
    expect(model.frames[173]?.joints[0]?.scale).toBe(1.5);
    const mesh = model.meshes[0];
    if (mesh === undefined) throw new Error("Retail mesh missing");
    const vertices = skinMd5Mesh(mesh, sampleMd5Pose(model, 173));
    expect(vertices).toHaveLength(158);
    // Direct quake-2-re-ts calcSkelVert output; binary32 weight storage differs by a few ULPs.
    expect(vertices[0]?.position.x).toBeCloseTo(-0.6274441480636597, 4);
    expect(vertices[0]?.position.y).toBeCloseTo(13.115943908691406, 4);
    expect(vertices[0]?.position.z).toBeCloseTo(46.33980178833008, 4);
  } finally { archive.close(); }
});

test.skipIf(!existsSync(q1Archive))("retail Q1 armor MD5 retains its two animation frames", async () => {
  const archive = await openArchive(q1Archive);
  try {
    const mesh = parseMd5Mesh(new TextDecoder().decode(await read(archive, "progs/armor.md5mesh")));
    const animation = parseMd5Anim(new TextDecoder().decode(await read(archive, "progs/armor.md5anim")));
    const model = createMd5Model(mesh, animation);
    expect(model.frames).toHaveLength(2);
    expect(model.joints).toHaveLength(1);
    const surface = model.meshes[0];
    if (surface === undefined) throw new Error("Retail mesh missing");
    expect(skinMd5Mesh(surface, sampleMd5Pose(model, 0)).every(vertex => Number.isFinite(vertex.position.x))).toBe(true);
    const selection = q1ReplacementSkinSelection(model, { skins: [{ kind: "group", frames: [{ intervalSeconds: 0.1, frame: new Uint8Array() }, { intervalSeconds: 0.3, frame: new Uint8Array() }] }], flags: 8, frames: [] });
    if (selection.kind !== "q1-mdl-replacement") throw new Error("Wrong skin selection");
    expect(selection.meshSkinGroups[0]?.[0]).toEqual({ kind: "group", frames: [{ intervalSeconds: 0.1, frame: `progs/${surface.shader}_00_00` }, { intervalSeconds: 0.3, frame: `progs/${surface.shader}_00_01` }] });
    expect(selection.flags).toBe(8);
    expect(selection.timing).toEqual({ kind: "elapsed-time", frameRate: 2 });
  } finally { archive.close(); }
});

test.skip("real MD4 fixture remains unavailable in the supplied corpus; synthetic layout is tested separately", () => {});
