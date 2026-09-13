import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openArchive } from "../../src/content/archive/index.ts";
import { parseMd5Anim } from "../../src/formats/q3-model/md5.ts";
import { parseQ12Model } from "../../src/formats/q12-model/index.ts";
import { jointAttachmentTag } from "../../src/formats/q3-model/scene.ts";
import { parseMd3 } from "../../src/formats/q3-model/md3.ts";
import { dot3, length3, sub3 } from "../../src/core/math.ts";
import type { Vec3 } from "../../src/contracts/math.ts";
import { q2HeldWeapon } from "../../src/content/q2/foundation/held-weapons.ts";
import { Q3_WEAPON_HAND_GRIP } from "../../src/content/q3/foundation/held-weapons.ts";
import { Application } from "../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { ForeignHeldWeapons } from "../../src/app/bootstrap/held-weapon.ts";
import { encodePng } from "../../src/formats/images/png.ts";

type Archive = Awaited<ReturnType<typeof openArchive>>;
async function bytes(archive: Archive, path: string): Promise<Uint8Array> {
  const entry = archive.findEntries(path)[0]; if (entry === undefined) throw new Error(`Missing retail reference ${path}`);
  return archive.readEntry(entry);
}
function centroid(points: readonly Vec3[]): Vec3 {
  const unique = [...new Map(points.map(point => [JSON.stringify(point), point])).values()];
  if (unique.length === 0) throw new Error("Missing reference hand vertices");
  return { x: unique.reduce((sum, p) => sum + p.x, 0) / unique.length,
    y: unique.reduce((sum, p) => sum + p.y, 0) / unique.length, z: unique.reduce((sum, p) => sum + p.z, 0) / unique.length };
}
function closePoint(actual: Vec3, expected: Vec3): void {
  expect(actual.x).toBeCloseTo(expected.x, 5); expect(actual.y).toBeCloseTo(expected.y, 5); expect(actual.z).toBeCloseTo(expected.z, 5);
}

test("held-weapon grip metadata is reproducible from retail reference hand geometry", async () => {
  const q2 = await openArchive("/home/buzzkill/Projects/qfiles/q2/rerelease/baseq2/pak0.pak");
  const q3 = await openArchive("/home/buzzkill/Projects/qfiles/q3a/baseq3/pak0.pk3");
  try {
    const decoder = new TextDecoder();
    const gun = parseQ12Model(await bytes(q2, "players/male/w_blaster.md2"));
    if (gun.kind !== "q2-md2") throw new Error("Missing native held blaster");
    const pose = gun.frames[0]; if (pose === undefined) throw new Error("Missing native stand01");
    expect(pose.name).toBe("stand01");
    const held = q2HeldWeapon("models/weapons/v_blast/tris.md2"); if (held === null) throw new Error("Missing blaster");
    closePoint(centroid(pose.vertices.slice(36, 48).map(vertex => vertex.position)), held.grip.origin);
    const animation = parseMd5Anim(decoder.decode(await bytes(q2, "players/male/md5/w_blaster.md5anim")));
    const joint = animation.frames[0]?.joints[animation.hierarchy.findIndex(joint => joint.name === "Weapon")];
    if (joint === undefined) throw new Error("Missing authored Weapon joint");
    const basis = jointAttachmentTag("Weapon", joint).axis;
    closePoint(held.grip.axis[0], basis[1]);
    closePoint(held.grip.axis[1], { x: -basis[2].x, y: -basis[2].y, z: -basis[2].z });
    closePoint(held.grip.axis[2], { x: -basis[0].x, y: -basis[0].y, z: -basis[0].z });
    const muzzle = centroid(pose.vertices.slice(20, 28).map(vertex => vertex.position));
    expect(dot3(sub3(muzzle, held.grip.origin), held.grip.axis[0])).toBeGreaterThan(8);
    const body = parseMd5Anim(decoder.decode(await bytes(q2, "players/male/md5/tris.md5anim")));
    const hand = body.frames[0]?.joints[body.hierarchy.findIndex(joint => joint.name === "R_Hand")];
    if (hand === undefined) throw new Error("Missing native right-hand reference");
    const undersideBox = centroid(pose.vertices.slice(0, 8).map(vertex => vertex.position));
    expect(length3(sub3(held.grip.origin, hand.position))).toBeLessThan(length3(sub3(undersideBox, hand.position)));
    const sarge = parseMd3(await bytes(q3, "models/players/sarge/upper.md3"));
    const tag = sarge.tags[151]?.find(tag => tag.name === "tag_weapon");
    const torso = sarge.surfaces.find(surface => surface.name === "u_torso")?.frames[151];
    if (tag === undefined || torso === undefined) throw new Error("Missing native Sarge gun-holding pose");
    const grip = centroid(torso.slice(65, 97).map(vertex => { const delta = sub3(vertex.position, tag.origin);
      return { x: dot3(delta, tag.axes[0]), y: dot3(delta, tag.axes[1]), z: dot3(delta, tag.axes[2]) }; }));
    closePoint(grip, Q3_WEAPON_HAND_GRIP.origin);
  } finally { q2.close(); q3.close(); }
});

for (const backend of ["cpu", "gl"]) test.skipIf(process.env["QUAKE_HELD_WEAPON_APP"] !== "1")(`Q2 blaster reaches Sarge and Visor through shared ${backend} attachments without changing first-person pixels`, async () => {
  const root = await mkdtemp(join(tmpdir(), "held-weapon-app-"));
  try {
    for (const model of ["sarge", "visor"]) {
      const command = parseApplicationCommand(["--game", "q2-rerelease-baseq2", "--map", "base1", "--model", model,
        "--renderer", backend, "--hidden", "--width", "960", "--height", "600", "--seats", "2", "--gamma", "1", "--user-content-root", join(root, model)]);
      if (command.kind !== "run") throw new Error("Expected application");
      const app = await Application.open(command.options, { print: () => undefined });
      const original = ForeignHeldWeapons.prototype.frame;
      let hidden = false, attached = 0;
      const observed = spyOn(ForeignHeldWeapons.prototype, "frame").mockImplementation(async function(this: ForeignHeldWeapons, source, character) {
        const passes = await original.call(this, source, character);
        for (const pass of passes) {
          expect(pass.content).toBe(source.content); expect(pass.entity.resource.requestedPath).toBe("players/male/w_blaster.md2");
          expect(pass.entity.pose).toEqual({ kind: "frame", frame: 0, previousFrame: 0, backLerp: 0 });
          expect(pass.entity.model.kind).toBe("q2-md2"); attached++;
        }
        return hidden ? [] : passes;
      });
      try {
        for (let step = 0; step < 24; step++) await app.step(25);
        expect(attached).toBeGreaterThan(0);
        // This positive increment is below the 600ms clock precision, so both renders use the same pose.
        const capture = async (): Promise<Uint8Array> => { const image = app.captureNextFrame(); await app.step(Number.EPSILON); return image; };
        const visible = await capture(); hidden = true; const absent = await capture();
        expect(visible).not.toEqual(absent);
        // The second seat cannot see the other actor. Its first-person gun and entire view stay identical.
        expect(visible.slice(960 * 300 * 4)).toEqual(absent.slice(960 * 300 * 4));
        // The first seat's view weapon is on the right, clear of the remote actor's held blaster.
        for (let y = 180; y < 300; y++) expect(visible.slice((y * 960 + 580) * 4, (y + 1) * 960 * 4))
          .toEqual(absent.slice((y * 960 + 580) * 4, (y + 1) * 960 * 4));
        await Bun.write(join(root, `${backend}-${model}-held.png`), encodePng(960, 600, visible));
        await Bun.write(join(root, `${backend}-${model}-without-held.png`), encodePng(960, 600, absent));
        console.log(`Held-weapon evidence: ${join(root, `${backend}-${model}-held.png`)}`);
      } finally { observed.mockRestore(); await app.close(); }
    }
  } finally {
    // Captures remain reviewable; only settings created by this test are removed.
    for (const model of ["sarge", "visor"]) await rm(join(root, model), { recursive: true, force: true });
  }
}, 180000);
