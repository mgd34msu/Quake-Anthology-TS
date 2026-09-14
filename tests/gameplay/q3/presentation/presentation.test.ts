import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createContentId, createMountId, createMountIdentity, createMountPlanId } from "../../../../src/contracts/content.ts";
import type { ArchiveMount } from "../../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { MaterialVertex } from "../../../../src/materials/geometry.ts";
import type { PlaySound } from "../../../../src/audio/types.ts";
import { SoundBank } from "../../../../src/audio/bank.ts";
import { digestFile, openMountPlan } from "../../../../src/content/mounts/index.ts";
import { loadQ3Character } from "../../../../src/content/q3/foundation/assets.ts";
import { EntityState } from "../../../../src/network/q3/state/entity.ts";
import { PlayerStateRecord } from "../../../../src/network/q3/state/player.ts";
import type { Snapshot } from "../../../../src/network/q3/server-message.ts";
import { EntityType } from "../../../../src/content/q3/base/shared/definitions.ts";
import { TrajectoryType } from "../../../../src/content/q3/base/shared/trajectory.ts";
import { ClientGameState } from "../../../../src/content/q3/presentation/state.ts";
import { retailSnapshot } from "../../../../src/content/q3/presentation/retail-snapshot.ts";
import { adjustPositionForMover, positionEntityOnTag } from "../../../../src/content/q3/presentation/entities.ts";
import { BspMarkProjector } from "../../../../src/content/q3/presentation/mark-projector.ts";
import { ImpactMarkSystem } from "../../../../src/content/q3/presentation/marks.ts";
import { createModelEntity, createPortalEntity, createBeamEntity, createSpriteEntity } from "../../../../src/content/q3/presentation/ref-entity.ts";
import type { SceneLoadedModel } from "../../../../src/content/q3/presentation/ref-entity.ts";
import { createRefdef } from "../../../../src/content/q3/presentation/refdef.ts";
import { Q3SceneRecorder } from "../../../../src/content/q3/presentation/scene.ts";
import type { Q3PresentedScene } from "../../../../src/content/q3/presentation/scene.ts";
import { lerpModelTag } from "../../../../src/content/q3/presentation/model-access.ts";
import { Q3PresentationAudio, Q3PresentationSoundBank } from "../../../../src/content/q3/presentation/audio.ts";
import { DEFAULT_RAIL_SETTINGS } from "../../../../src/render/scene/particles/primitives.ts";
import { qvmAnglesToAxis } from "../../../../src/core/qvm-math.ts";

const archivePath = resolve(import.meta.dir, "../../../../../qfiles/q3a/baseq3/pak0.pk3");

describe("Q3 cgame presentation", () => {
  test("snapshot copies retain mission fields and own transport storage", () => {
    const playerState = new PlayerStateRecord<number, number, number>("missionpack", 0, 13, 3);
    playerState.stats.set(7, 17); playerState.ammo.set(13, 6); playerState.events.set(1, 68);
    playerState.eventParms.set(1, 40); playerState.powerups.set(14, 3000); playerState.persistant.set(8, 11);
    playerState.origin = { x: 1, y: 2, z: 3 }; playerState.jumppadFrame = 50; playerState.entityEventSequence = 9;
    const entity = new EntityState(); entity.number = 37; entity.generic1 = 14; entity.origin = { x: 4, y: 5, z: 6 };
    const input: Snapshot = { messageNumber: 5, serverTime: 1500, deltaNumber: 4, flags: 0, serverCommandNumber: 3,
      parseEntitiesNumber: 12, areaMask: new Uint8Array(32), playerState, entities: [entity] };
    const output = retailSnapshot(input);
    playerState.stats.set(7, 0); playerState.events.set(1, 0); playerState.origin = { x: 0, y: 0, z: 0 };
    entity.origin = { x: 0, y: 0, z: 0 }; input.areaMask[0] = 255;
    expect(output.playerState.product).toBe("missionpack");
    expect(output.playerState.stats.get(7)).toBe(17); expect(output.playerState.ammo.get(13)).toBe(6);
    expect(output.playerState.events.get(1)).toBe(68); expect(output.playerState.eventParms.get(1)).toBe(40);
    expect(output.playerState.powerups.get(14)).toBe(3000); expect(output.playerState.persistant.get(8)).toBe(11);
    expect(output.playerState.jumppadFrame).toBe(50); expect(output.playerState.entityEventSequence).toBe(9);
    expect(output.playerState.origin).toEqual({ x: 1, y: 2, z: 3 });
    expect(output.entities[0]?.origin).toEqual({ x: 4, y: 5, z: 6 }); expect(output.areaMask[0]).toBe(0);
  });

  test("seat state and source mover adjustment remain independent", () => {
    const first = new ClientGameState("baseq3", 0, 10), second = new ClientGameState("missionpack", 1, 20);
    const mover = first.entityAt(5).currentState;
    mover.eType = EntityType.ET_MOVER;
    mover.pos = { type: TrajectoryType.TR_LINEAR, time: 1000, duration: 0, base: { x: 0, y: 0, z: 0 }, delta: { x: 100, y: -20, z: 10 } };
    const point = { x: 1, y: 2, z: 3 };
    expect(adjustPositionForMover(first, point, 5, 1000, 1500)).toEqual({ x: 51, y: -8, z: 8 });
    expect(adjustPositionForMover(second, point, 5, 1000, 1500)).toEqual(point);
    expect(second.entityAt(5).currentState.pos.delta).toEqual({ x: 0, y: 0, z: 0 });
  });

  test("marks project against shared geometry and fade over source lifetime", () => {
    const vertices: MaterialVertex[] = [[-32, -32], [32, -32], [-32, 32], [32, 32]].map(([x = 0, y = 0]) => ({
      position: { x, y, z: 0 }, normal: { x: 0, y: 0, z: 1 }, texCoord: { x: 0, y: 0 }, lightmapCoord: { x: 0, y: 0 },
      color: { x: 255, y: 255, z: 255, w: 255 } }));
    const projector = new BspMarkProjector({ map: { nodes: [], planes: [], leaves: [{ firstSurface: 0, surfaceCount: 1 }],
      leafSurfaces: [0], surfaceCount: 1 }, surfaces: [{ kind: "face", surfaceFlags: 0, contentFlags: 1,
      plane: { normal: { x: 0, y: 0, z: 1 }, distance: 0 }, vertices, indices: [0, 2, 1, 1, 2, 3] }] });
    let time = 100;
    const marks = new ImpactMarkSystem(projector, { clock: () => time, enabled: () => true, energyShader: () => null });
    marks.impactMark({ shader: { name: "gfx/damage/bullet_mrk" }, origin: { x: 0, y: 0, z: 1 }, direction: { x: 0, y: 0, z: 1 },
      orientation: 0, color: { x: 1, y: 1, z: 1, w: 1 }, alphaFade: true, radius: 8, temporary: false });
    expect(marks.activeMarkCount).toBe(2);
    expect(marks.addMarks().every(poly => poly.vertices.every(vertex => vertex.position.z === 0))).toBe(true);
    time = 9600;
    expect(marks.addMarks()[0]?.vertices[0]?.color.w).toBe(127);
    time = 10101;
    expect(marks.addMarks()).toEqual([]); expect(marks.activeMarkCount).toBe(0);
  });

  test.skipIf(!existsSync(archivePath))("retail models and sound feed shared seat presentation", async () => {
    const mount: ArchiveMount = { kind: "archive", identity: createMountIdentity(createMountId("q3-presentation", "base"),
      createContentId({ family: "q3", edition: "retail", package: "baseq3", revision: "local" }), 0),
      archivePath, format: "pk3", archiveDigest: await digestFile(archivePath) };
    using resources = await openMountPlan({ id: createMountPlanId("q3-presentation", "test"), mounts: [mount],
      defaultOrder: [mount.identity.id], prefixOrders: [] });
    const assets = await loadQ3Character(resources, { model: "sarge", skin: "default", headModel: "sarge", headSkin: "default", team: null, teamName: "" });
    const lower: SceneLoadedModel = { kind: "model", path: "models/players/sarge/lower.md3", model: assets.lower.model, resource: assets.lower.resource };
    const upper: SceneLoadedModel = { kind: "model", path: "models/players/sarge/upper.md3", model: assets.upper.model, resource: assets.upper.resource };
    const parent = createModelEntity(lower), child = createModelEntity(upper);
    parent.origin = { x: 10, y: 20, z: 30 }; parent.axis = qvmAnglesToAxis({ x: 0, y: 0, z: 0 }); parent.frame = 1; parent.backLerp = 0.25;
    parent.shaderRGBA = { x: 255, y: 128, z: 0, w: 255 };
    const tag = lerpModelTag(lower, "tag_torso", 0, 1, 0.75);
    if (tag === null) throw new Error("Retail Sarge has no torso tag");
    positionEntityOnTag(child, parent, lower, "tag_torso");
    expect(child.origin.z).toBeCloseTo(30 + tag.origin.z, 4); expect(child.backLerp).toBe(0.25);
    const identity = createIdentityOwner("q3-presentation"), seat = identity.seat(1), scenes: Q3PresentedScene[] = [], warnings: string[] = [];
    const scene = new Q3SceneRecorder({ seat, viewport: { x: 640, y: 0, width: 640, height: 480 }, nearClip: 4, farClip: 4096,
      rail: DEFAULT_RAIL_SETTINGS, fogSelections: () => [], print: text => { warnings.push(text); }, actor: () => null, publish: value => { scenes.push(value); } });
    scene.addRefEntity(parent);
    scene.addRefEntity(createPortalEntity());
    scene.addRefEntity(createBeamEntity());
    scene.addRefEntity(createModelEntity());
    const sprite = createSpriteEntity(); sprite.radius = 8;
    scene.addRefEntity(sprite);
    scene.addRefEntity(parent);
    scene.addPoly({ shader: null, vertices: [{ position: { x: 1, y: 2, z: 3 }, texCoord: { x: 0, y: 0 }, color: { x: 255, y: 255, z: 255, w: 255 } }] });
    scene.addPoly({ shader: { name: "gfx/damage/bullet_mrk" }, vertices: [{ position: { x: 1, y: 2, z: 3 }, texCoord: { x: 0, y: 0 }, color: { x: 255, y: 255, z: 255, w: 255 } }] });
    expect(warnings).toHaveLength(1);
    parent.origin = { x: 0, y: 0, z: 0 };
    const refdef = createRefdef(); refdef.width = 640; refdef.height = 480; refdef.fovX = 90; refdef.fovY = 73.7398; refdef.viewAxis = qvmAnglesToAxis({ x: 0, y: 0, z: 0 });
    scene.renderScene(refdef); scene.renderScene(refdef); scene.clearScene();
    scene.addRefEntity(sprite); scene.renderScene(refdef); refdef.areaMask[0] = 255;
    const firstScene = scenes[0], repeated = scenes[1], cleared = scenes[2];
    if (firstScene === undefined || repeated === undefined || cleared === undefined) throw new Error("Missing admitted scenes");
    expect(firstScene.admission.id.origin).toBe("native");
    expect(firstScene.admission.id.equals(repeated.admission.id)).toBe(false);
    expect(firstScene.admission.entities.map(entity => entity.kind)).toEqual(["model", "portal-surface", "beam", "model", "sprite", "model"]);
    expect(firstScene.models.map(model => model.entityIndex)).toEqual([0, 5]);
    expect(firstScene.portals.map(portal => portal.entityIndex)).toEqual([1]);
    expect(firstScene.specialEntities.map(entity => entity.entityIndex)).toEqual([2, 3]);
    expect(firstScene.effects.map(effect => effect.admission)).toEqual([{ kind: "refentity", index: 4 }, { kind: "polygon", index: 0 }]);
    expect(firstScene.admission.entities[0]).not.toBe(firstScene.admission.entities[5]);
    for (const model of firstScene.models) expect(firstScene.admission.entities[model.entityIndex]).toBe(model.source);
    for (const entity of [...firstScene.portals, ...firstScene.specialEntities]) expect(firstScene.admission.entities[entity.entityIndex]).toBe(entity.source);
    for (const effect of firstScene.effects) expect(effect.source === (effect.admission.kind === "refentity"
      ? firstScene.admission.entities[effect.admission.index] : firstScene.admission.polygons[effect.admission.index])).toBe(true);
    expect(Object.isFrozen(firstScene.admission)).toBe(true); expect(Object.isFrozen(firstScene.admission.entities)).toBe(true);
    expect(Object.isFrozen(firstScene.admission.polygons)).toBe(true);
    expect(cleared.admission.entities).toHaveLength(1); expect(cleared.admission.polygons).toHaveLength(0);
    expect(firstScene.admission.entities).toHaveLength(6); expect(firstScene.admission.polygons).toHaveLength(1);
    expect(repeated.models).toEqual(firstScene.models); expect(repeated.effects).toEqual(firstScene.effects);
    expect(repeated.portals).toEqual(firstScene.portals); expect(repeated.specialEntities).toEqual(firstScene.specialEntities);
    expect(scenes[0]?.camera.viewport.x).toBe(640); expect(scenes[0]?.seat).toBe(seat);
    expect(scenes[0]?.models[0]?.entity.transform.origin).toEqual({ x: 10, y: 20, z: 30 });
    expect(scenes[0]?.models[0]?.entity.resource).toBe(assets.lower.resource);
    expect(scenes[0]?.models[0]?.entity.color.y).toBe(128 / 255); expect(scenes[0]?.source.areaMask[0]).toBe(0);
    const bank = new SoundBank(resources), zero = await bank.register("sound/feedback/hit.wav", "q3");
    if (zero === null) throw new Error("Missing retail default sound");
    const sounds = new Q3PresentationSoundBank(bank, zero, () => null);
    expect(await sounds.registerSound("sound/feedback/hit.wav", false)).toBeNull();
    expect(await sounds.registerSound("sound/feedback/hit.wav", false)).toBeNull();
    const pain = await sounds.registerSound("sound/player/sarge/pain25_1.wav", true);
    if (pain === null) throw new Error("Missing retail pain sound");
    expect(sounds.indexForSound(pain)).toBe(1);
    const played: PlaySound[] = [];
    const audio = new Q3PresentationAudio({ seat, sounds, actor: number => identity.actor(number, 0), frameNumber: () => 12,
      play: sound => { played.push(sound); }, loop: () => undefined, updateActor: () => undefined, stopLoop: () => undefined });
    audio.startSourceSound(pain, { entity: -1, channel: 2, origin: { kind: "fixed", position: { x: 1, y: 2, z: 3 } }, volume: 63.5 });
    expect(played[0]?.volume).toBe(0.5); expect(played[0]?.audience).toEqual({ kind: "seat", seat });
    expect(played[0]?.actor).toBeNull(); expect(played[0]?.origin).toEqual({ kind: "fixed", position: { x: 1, y: 2, z: 3 } });
  });
});
