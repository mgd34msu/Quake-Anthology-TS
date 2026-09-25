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
import type { SceneEntity } from "../../src/contracts/scene.ts";
import { createMountIdentity } from "../../src/contracts/content.ts";
import type { ArchiveMount, ResolvedResourceReference } from "../../src/contracts/content.ts";
import { digestBytes, digestFile, MountedContent } from "../../src/content/mounts/index.ts";
import { loadApplicationModel } from "../../src/app/bootstrap/model-loader.ts";
import { q2WeaponAttachment } from "../../src/content/q2/foundation/weapon-attachments.ts";
import { NativeHeldWeapons } from "../../src/app/bootstrap/native-held-weapon.ts";
import { createModelGrip } from "../../src/render/scene/models/grip.ts";
import { alignModelAttachment } from "../../src/render/scene/models/attachment.ts";
import { composeModelTransform, modelWorldPoint } from "../../src/render/scene/models/transform.ts";
import { DEFAULT_MODEL_REPLACEMENT_POLICY, replacementEntity } from "../../src/render/scene/models/replacements.ts";
import { readModelAttachment } from "../../src/content/model-attachment.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { HeldWeaponDeclaration } from "../../src/contracts/held-weapon.ts";
import type { SimulationPresentation } from "../../src/app/bootstrap/simulation/types.ts";
import { readModel, wireActor } from "../../src/app/bootstrap/network/unified-frame-values.ts";
import { SaveReader } from "../../src/persistence/value.ts";
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


const unitTransform = { origin: { x: 0, y: 0, z: 0 }, axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], scale: { x: 1, y: 1, z: 1 } } satisfies SceneEntity["transform"];

test("native held attachment follows original Classic and rerelease carriers, source interpolation, hiding and renderer LOD", async () => {
  const archive = await openArchive("/home/buzzkill/Projects/qfiles/q2/rerelease/baseq2/pak0.pak");
  const content = "q2:classic:baseq2:held-test", identity = createMountIdentity("mount:held:source", content, 0);
  const mount = { kind: "loose", identity, rootPath: "/home/buzzkill/Projects/qfiles/q2/baseq2" } satisfies Extract<ResolvedResourceReference["provenance"], { kind: "loose" }>["mount"];
  const classic = new MountedContent({ id: "mount-plan:held:classic", mounts: [mount], defaultOrder: [identity.id], prefixOrders: [] }, [{ kind: "loose", mount }]);
  const retailMount: ArchiveMount = { kind: "archive", format: "pak", archivePath: "/home/buzzkill/Projects/qfiles/q2/rerelease/baseq2/pak0.pak",
    archiveDigest: await digestFile("/home/buzzkill/Projects/qfiles/q2/rerelease/baseq2/pak0.pak"), identity: createMountIdentity("mount:held:retail", "q2:rerelease:baseq2:held-test", 0) };
  const retail = new MountedContent({ id: "mount-plan:held:retail", mounts: [retailMount], defaultOrder: [retailMount.identity.id], prefixOrders: [] }, [{ kind: "archive", mount: retailMount, archive }]);
  const entity = async (mounts: Pick<MountedContent, "open">, path: string): Promise<SceneEntity> => {
    const opened = await mounts.open(path); if (opened === null) throw new Error(`Missing original carrier ${path}`);
    const loaded = await loadApplicationModel({ family: "q2", mounts, textures: { load: async () => null } }, opened);
    return { actor: null, ...loaded, transform: unitTransform, previousOrigin: unitTransform.origin,
      pose: { kind: "frame", frame: 0, previousFrame: 0, backLerp: 0 }, skin: 0, color: { x: 1, y: 1, z: 1, w: 1 },
      opacity: 0.7, shaderTime: { kind: "seconds", value: 0 }, flags: { kind: "q2", bits: 1024 }, lightingOrigin: { x: 10, y: 20, z: 30 }, shadowPlane: 4, attachments: [] };
  };
  try {
    for (const [mounts, path] of [[classic, "players/male/weapon.md2"], [retail, "players/male/w_blaster.md2"], [retail, "players/female/w_blaster.md2"]] satisfies readonly (readonly [Pick<MountedContent, "open">, string])[]) {
      const reference = await entity(mounts, path), definition = q2WeaponAttachment(reference.resource.digest);
      if (definition === null || definition.kind !== "mesh") throw new Error("Missing qualified carrier");
      const sample = createModelGrip(reference, definition);
      closePoint(sample(reference)?.origin ?? { x: Infinity, y: Infinity, z: Infinity }, definition.grip.origin);
      const posed: SceneEntity = { ...reference, pose: { kind: "frame", frame: 42, previousFrame: 41, backLerp: 0.5 }, previousOrigin: { x: -8, y: 2, z: 0 } };
      const grip = sample(posed); if (grip === null) throw new Error("Native running carrier is hidden");
      expect(length3(sub3(grip.origin, definition.grip.origin))).toBeGreaterThan(1);
      const noTranslation = sample({ ...posed, previousOrigin: unitTransform.origin }); if (noTranslation === null) throw new Error("Missing running pose");
      closePoint(sub3(grip.origin, noTranslation.origin), { x: -4, y: 1, z: 0 });
      const attach = await new NativeHeldWeapons({ modelPolicy: DEFAULT_MODEL_REPLACEMENT_POLICY, provider: async () => ({ mounts }) }).attachment(reference.resource.provenance.mount.identity.content, posed);
      // The selected model stays in source-owned Q3 hand coordinates until the native attachment consumes it.
      const child: SceneEntity = { ...reference, transform: alignModelAttachment(definition.grip, Q3_WEAPON_HAND_GRIP), pose: { kind: "frame", frame: 0, previousFrame: 0, backLerp: 0 } };
      const resolve = attach(child), far = resolve({ x: 3000, y: 0, z: 0 }, "view"); if (far === null) throw new Error("Running held weapon hidden");
      closePoint(modelWorldPoint(far.transform, definition.grip.origin), grip.origin);
      expect(far.flags).toEqual(posed.flags); expect(far.opacity).toBe(0.7); expect(far.resource).toBe(child.resource);
      expect(far.previousOrigin).toEqual(far.transform.origin);
      const enhanced = replacementEntity(posed), near = resolve(unitTransform.origin, "view"); if (near === null) throw new Error("Missing near held weapon");
      if (mounts === classic) { expect(enhanced).toBeNull(); expect(near.transform).toEqual(far.transform); }
      else {
        if (enhanced === null) throw new Error("Missing original rerelease skeleton");
        const joint = q2WeaponAttachment(enhanced.resource.digest); if (joint === null) throw new Error("Missing authored joint");
        const expected = createModelGrip(enhanced, joint)(enhanced); if (expected === null) throw new Error("Missing animated native joint");
        closePoint(modelWorldPoint(near.transform, definition.grip.origin), composeModelTransform(enhanced.transform, expected).origin);
        expect(resolve({ x: 3000, y: 0, z: 0 }, "shadow")?.transform).toEqual(near.transform);
      }
      const external = readModelAttachment(new TextEncoder().encode(JSON.stringify({ version: 1, ...definition })));
      expect(external).toEqual(definition);
      expect(() => createModelGrip(reference, { ...external, digest: digestBytes(new Uint8Array()) })).toThrow("digest");
    }
    const hidden = await entity(retail, "players/male/w_grapple.md2"), definition = q2WeaponAttachment(hidden.resource.digest);
    if (definition === null) throw new Error("Missing native grapple carrier");
    expect(createModelGrip(hidden, definition)({ ...hidden, pose: { kind: "frame", frame: 112, previousFrame: 112, backLerp: 0 } })).toBeNull();
  } finally { await classic.close(); await retail.close(); }
});


test("authored mod held declarations resolve source assets and survive invisible metadata transport without inferring a viewmodel", async () => {
  const root = await mkdtemp(join(tmpdir(), "mod-held-")), identity = createIdentityOwner("mod-held");
  const content = "q2:classic:custom:held", mount = { kind: "loose", identity: createMountIdentity("mount:held:mod", content, 0), rootPath: root } satisfies Extract<ResolvedResourceReference["provenance"], { kind: "loose" }>["mount"];
  const mounts = new MountedContent({ id: "mount-plan:held:mod", mounts: [mount], defaultOrder: [mount.identity.id], prefixOrders: [] }, [{ kind: "loose", mount }]);
  try {
    await mkdir(join(root, "models"));
    const bytes = new Uint8Array(await readFile("/home/buzzkill/Projects/qfiles/q2/baseq2/players/male/weapon.md2"));
    await writeFile(join(root, "models/authored.md2"), bytes);
    const attachment = q2WeaponAttachment(digestBytes(bytes)); if (attachment === null) throw new Error("Missing actual reference grip");
    const declaration: HeldWeaponDeclaration = { kind: "model", model: { path: "models/authored.md2", digest: digestBytes(bytes), referenceFrame: 0, grip: attachment.grip } };
    await writeFile(join(root, "models/view.md2.held.json"), JSON.stringify({ version: 1, ...declaration }));
    const resolver = new ForeignHeldWeapons({ provider: async source => { expect(source).toBe(content); return { mounts }; }, model: async (source, path) => {
      expect(source).toBe(content); const asset = await mounts.open(path); if (asset === null) throw new Error("Missing source model");
      return loadApplicationModel({ family: "q2", mounts, textures: { load: async () => null } }, asset, { enhancedModels: false });
    } });
    const source: SimulationPresentation = { actor: identity.actor(0, 0), content, family: "q2", path: "models/view.md2", weaponItem: "mod:custom", frame: 9, oldFrame: 8,
      skin: 0, effects: 0, renderFlags: 0, origin: unitTransform.origin, angles: unitTransform.origin, scale: 1, visible: false, viewWeapon: true };
    const character = { origin: unitTransform.origin, color: { x: 1, y: 1, z: 1, w: 1 } };
    expect(await mounts.open(source.path)).toBeNull();
    const passes = await resolver.frame(source, character), pass = passes[0]; if (pass === undefined) throw new Error("Authored model was not admitted");
    expect(pass.entity.resource.provenance.mount.identity.content).toBe(content);
    expect(pass.entity.resource.requestedPath).toBe("models/authored.md2");
    expect(pass.entity.pose).toEqual({ kind: "frame", frame: 0, previousFrame: 0, backLerp: 0 });
    closePoint(modelWorldPoint(pass.entity.transform, declaration.model.grip.origin), Q3_WEAPON_HAND_GRIP.origin);
    const explicit: SimulationPresentation = { ...source, path: "", heldWeapon: declaration, nativeHeldWeapon: true };
    const decoded = readModel(new SaveReader({ ...explicit, actor: wireActor(explicit.actor) }), { ...identity, resourceId: id => id });
    expect(decoded.heldWeapon).toEqual(declaration); expect(decoded.nativeHeldWeapon).toBe(true); expect(decoded.weaponItem).toBe("mod:custom");
    expect(decoded.visible).toBe(false); expect(decoded.path).toBe("");
    expect((await resolver.frame(decoded, character))[0]?.entity.resource.id).toBe(pass.entity.resource.id);
    expect(await resolver.frame({ ...explicit, heldWeapon: { kind: "none" } }, character)).toEqual([]);
    await expect(resolver.frame({ ...source, path: "models/unknown.md2" }, character)).rejects.toThrow("no authored held model");
    await expect(resolver.frame({ ...explicit, heldWeapon: { kind: "model", model: { ...declaration.model, digest: digestBytes(new Uint8Array()) } } }, character)).rejects.toThrow("digest");
  } finally { await mounts.close(); await rm(root, { recursive: true, force: true }); }
});
