import { samePresentationOwner, type PresentationOwner } from "../../contracts/presentation.ts";
import { createWorldSurfaceAdmission } from "../../render/scene/world.ts";
import { createSourceSceneOrder, sceneModelBatches, sequenceDrawGroup, type SceneOperation } from "../../render/scene/submissions.ts";
import { weaponViewOrigin } from "./weapon-view.ts";
import { SelectedQ3WeaponPresenter } from "./q3-selected-weapon.ts";
import { ForeignHeldWeapons } from "./held-weapon.ts";
import type { ApplicationAssets } from "./assets.ts";
import type { SimulationPresentation, SimulationPresentationEvent } from "./simulation/types.ts";
import type { ContentId } from "../../contracts/content.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { SceneEntity, SceneLight } from "../../contracts/scene.ts";
import type { SceneCamera } from "../../contracts/render.ts";
import type { WorldSnapshot } from "../../contracts/session.ts";
import type { Q3CharacterAssets, Q3CharacterView } from "../../content/q3/foundation/index.ts";
import { Q3CharacterPresenter } from "../../content/q3/foundation/index.ts";
import { add3, sub3, scale3, length3, normalize3OrZero, vectorToAngles, anglesToAxis } from "../../core/math.ts";
import { qvmAngleVectors } from "../../core/qvm-math.ts";
import type { WorldScene, WorldViewInput } from "../../render/scene/world.ts";
import type { ModelTransform } from "../../render/scene/view.ts";
import { SceneModelRenderer } from "../../render/scene/models/index.ts";
import type { ModelSkinningFrame, ModelSourceOptions } from "../../render/scene/models/types.ts";
import { shadowBodyFilter } from "../../render/scene/shadows.ts";
import { prepareFlare } from "../../render/scene/flare.ts";
import type { SceneFlare } from "../../contracts/flare.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { RendererImage } from "../../contracts/render.ts";
import type { RegisteredSceneMaterial } from "../../render/scene/material-registrations.ts";
import { railGeometry } from "../../render/scene/particles/primitives.ts";
import { prepareMaterialBatches } from "../../materials/evaluate.ts";

interface ModelPass {
  readonly entity: SceneEntity;
  readonly options: (entity: SceneEntity) => ModelSourceOptions;
}
interface ModelGroup {
  readonly renderer: SceneModelRenderer;
  readonly passes: ModelPass[];
}
interface PresentationObject {
  readonly opacity: number;
  readonly passes: { readonly group: ModelGroup; readonly pass: ModelPass }[];
}

interface BrushPresentation {
  readonly scene: WorldScene;
  readonly model: number;
  readonly transform: ModelTransform;
  readonly frame: number;
  readonly alpha: number;
}

export function seatModelVisible(viewer: ActorId | null, source: Pick<SimulationPresentation, "actor" | "viewWeapon">): boolean {
  const firstPerson = viewer?.equals(source.actor) ?? false;
  return source.viewWeapon ? firstPerson : !firstPerson;
}

export class ApplicationWorldScene {
  private readonly groups = new Map<ContentId, ModelGroup>();
  private readonly ordered: { readonly group: ModelGroup; readonly pass: ModelPass }[] = [];
  private readonly objects = new Map<ModelPass, PresentationObject>();
  private readonly characters = new Map<string, Q3CharacterPresenter>();
  private readonly selectedWeapons = new Map<string, SelectedQ3WeaponPresenter>();
  private readonly foreignWeapons: ForeignHeldWeapons;
  private readonly lightStyles = new Map<number, { readonly pattern: string; readonly owner?: PresentationOwner }>();
  private inlineModels: NonNullable<WorldViewInput["inlineModels"]> = [];
  private brushModels: readonly BrushPresentation[] = [];
  private preparedTime = 0;
  private previousTime = 0;
  private flares: { readonly flare: SceneFlare; readonly origin: Vec3; readonly image: RendererImage; readonly imagePath: string }[] = [];
  private shaderBeams: { readonly material: RegisteredSceneMaterial; readonly origin: Vec3; readonly end: Vec3; readonly width: number }[] = [];

  constructor(readonly assets: ApplicationAssets, private readonly characterAssets: Q3CharacterAssets | null, private readonly planarShadows: () => boolean = () => false) {
    this.foreignWeapons = new ForeignHeldWeapons(assets);
  }

  receive(events: readonly SimulationPresentationEvent[]): void {
    for (const source of events) if (source.kind === "presentation-owner" && source.event.kind === "retired") {
      for (const [style, value] of this.lightStyles) if (samePresentationOwner(value.owner, source.event.owner)) this.lightStyles.delete(style);
    } else if ((source.kind === "q1" || source.kind === "q2") && source.event.kind === "lightstyle")
      this.lightStyles.set(source.event.style, { pattern: source.event.pattern, ...(source.owner === undefined ? {} : { owner: source.owner }) });
  }

  style(index: number, absent: number): number {
    const pattern = this.lightStyles.get(index)?.pattern;
    return pattern === undefined || pattern.length === 0 ? absent : pattern.charCodeAt(Math.trunc(this.preparedTime * 10) % pattern.length) - 97;
  }

  async prepare(viewer: ActorId | null, snapshot: WorldSnapshot, presentations: readonly SimulationPresentation[], characters: readonly Q3CharacterView[], fieldOfView = 90): Promise<void> {
    this.objects.clear();
    this.ordered.length = 0;
    this.flares = [];
    this.shaderBeams = [];
    this.previousTime = this.preparedTime;
    this.preparedTime = snapshot.frame.time.kind === "seconds" ? snapshot.frame.time.value : snapshot.frame.time.value / 1000;
    for (const group of this.groups.values()) group.passes.length = 0;
    const inlineModels: NonNullable<WorldViewInput["inlineModels"]>[number][] = [];
    const brushModels: BrushPresentation[] = [];
    const append = async (content: ContentId, entity: SceneEntity, options?: (entity: SceneEntity) => ModelSourceOptions, object?: PresentationObject): Promise<void> => {
      let group = this.groups.get(content);
      if (group === undefined) {
        group = { renderer: new SceneModelRenderer(await this.assets.provider(content), this.assets.world), passes: [] };
        this.groups.set(content, group);
      }
      const pass: ModelPass = { entity, options: options ?? (() => ({})) };
      group.passes.push(pass);
      this.ordered.push({ group, pass });
      const logical = object ?? { opacity: entity.opacity ?? 1, passes: [] };
      logical.passes.push({ group, pass }); this.objects.set(pass, logical);
    };
    for (const original of presentations) {
      let source = original;
      if (!source.visible) continue;
      if (source.shaderBeam !== undefined) {
        const provider = await this.assets.provider(source.content), beam = source.shaderBeam;
        this.shaderBeams.push({ material: await provider.shaders.register(beam.path), origin: source.origin, end: beam.end, width: beam.width });
        continue;
      }
      if (source.flare !== undefined) {
        const provider = await this.assets.provider(source.content), flare = source.flare;
        let imagePath = flare.image;
        let texture = await provider.textures.load(imagePath, { family: "q2", wrap: "clamp", mipmap: false, usage: "sprite" });
        if (texture === null && imagePath !== "misc/flare.tga") {
          imagePath = "misc/flare.tga";
          texture = await provider.textures.load(imagePath, { family: "q2", wrap: "clamp", mipmap: false, usage: "sprite" });
        }
        if (texture !== null) this.flares.push({ flare, origin: source.origin, image: texture.image, imagePath });
        continue;
      }
      if (source.path === "") continue;
      if (!seatModelVisible(viewer, source)) continue;
      if (!source.viewWeapon && characters.some(character => character.actor.equals(source.actor))) continue;
      const cable = source.q3GrappleCable;
      let cableStart: Vec3 | null = null;
      if (cable !== undefined) {
        const local = viewer?.equals(cable.owner) === true, aim = qvmAngleVectors(cable.ownerAngles);
        cableStart = cable.offhand ? add3(add3(cable.ownerOrigin, { x: 0, y: 0, z: 26 }), scale3(aim.right, local ? -10 : -6))
          : add3(cable.ownerOrigin, { x: 0, y: 0, z: local ? cable.viewHeight : 0 });
        if (local && cable.offhand) cableStart = add3(cableStart, scale3(aim.forward, 3));
        source = { ...source, path: !cable.attached ? cable.flight : length3(sub3(source.origin, cableStart)) > 64 ? cable.pull : cable.hold };
      }
      if (source.q3Weapon !== undefined) {
        const key = `${source.content}/${source.actor.slot}/${source.actor.generation}`;
        let presenter = this.selectedWeapons.get(key);
        if (presenter === undefined) { presenter = new SelectedQ3WeaponPresenter(this.assets, this.characterAssets?.animation ?? null); this.selectedWeapons.set(key, presenter); }
        await append(source.content, await presenter.frame(source, fieldOfView), () => ({ viewModel: true }));
        continue;
      }
      const asset = await this.assets.model(source.content, source.path);
      const modelFlags = asset.model.kind === "q1-mdl" ? asset.model.flags
        : asset.model.kind === "md5" && asset.model.skinSelection.kind === "q1-mdl-replacement" ? asset.model.skinSelection.flags : 0;
      const angles = source.family === "q1" && (modelFlags & 8) !== 0 ? { ...source.angles,
        y: Math.fround((360 / 65536) * (Math.trunc(Math.fround(100 * this.preparedTime) * (65536 / 360)) & 65535)) } : source.angles;
      const axis = anglesToAxis(angles);
      if (asset.model.kind === "brush-model") {
        const transform = { origin: weaponViewOrigin(source), axis, scale: source.scale };
        const alpha = source.alpha ?? 1;
        if (asset.brushScene === this.assets.world) inlineModels.push({ model: asset.model.model, transform, animationFrame: source.frame,
          alternateAnimation: source.family === "q1" && source.frame !== 0,
          entityRGBA: { x: 255, y: 255, z: 255, w: alpha * 255 }, castsShadow: alpha === 1 });
        else {
          if (asset.brushScene === null) throw new Error(`Brush model ${source.path} has no prepared scene`);
          brushModels.push({ scene: asset.brushScene, model: asset.model.model, transform, frame: source.frame, alpha });
        }
        continue;
      }
      const entity: SceneEntity = { actor: source.actor, resource: asset.resource, model: asset.model,
        transform: { origin: weaponViewOrigin(source), axis, scale: { x: source.scale, y: source.scale, z: source.scale } }, previousOrigin: source.previousOrigin ?? source.origin,
        pose: { kind: "frame", frame: source.frame, previousFrame: source.oldFrame, backLerp: source.backLerp ?? 0 }, skin: source.skin,
        opacity: source.alpha ?? 1, color: { x: 1, y: 1, z: 1, w: 1 }, shaderTime: { kind: "seconds", value: 0 }, flags: { kind: source.family, bits: source.renderFlags },
        lightingOrigin: source.origin, shadowPlane: 0, attachments: [] };
      const attachments: SceneEntity["attachments"][number][] = [];
      for (const attachment of source.modelAttachments ?? []) {
        const child = await this.assets.model(source.content, attachment.path);
        attachments.push({ tag: attachment.tag, entity: { ...entity, resource: child.resource, model: child.model, transform: { origin: { x: 0, y: 0, z: 0 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }), scale: { x: 1, y: 1, z: 1 } }, attachments: [] } });
      }
      if (cable !== undefined && cableStart !== null) {
        const delta = sub3(cableStart, source.origin), distance = length3(delta), direction = normalize3OrZero(delta), axis = anglesToAxis(vectorToAngles(direction));
        const count = Math.floor(distance / cable.segmentLength);
        if (count > 65536) throw new Error("Source grapple cable exceeds the model segment limit");
        for (let index = 0; index <= count; index++) await append(source.content, { ...entity,
          transform: { ...entity.transform, origin: sub3(cableStart, scale3(direction, (index + 1) * cable.segmentLength)), axis } });
        continue;
      }
      await append(source.content, { ...entity, attachments }, () => ({ viewModel: source.viewWeapon, ...(source.modelBeam === undefined ? {} : { modelBeam: source.modelBeam }),
        ...(source.indexedSkin === undefined ? {} : { indexedSkin: source.indexedSkin }),
        ...(source.playerColors === undefined ? {} : { playerColors: source.playerColors }),
        player: source.family === "q2" && source.path.startsWith("players/"), customShader: source.skinPath ?? null }));
    }
    if (this.characterAssets !== null) for (const character of characters) {
      const key = `${character.actor.slot}:${character.actor.generation}`;
      let presenter = this.characters.get(key);
      if (presenter === undefined) {
        presenter = new Q3CharacterPresenter(this.characterAssets);
        presenter.reset(character, Math.trunc(this.preparedTime * 1000));
        this.characters.set(key, presenter);
      }
      const equipped = presentations.find(source => source.viewWeapon && source.visible && source.actor.equals(character.actor));
      let weapon: readonly import("../../content/q3/foundation/presentation.ts").Q3CharacterPass[] = [];
      if (equipped?.q3Weapon !== undefined) {
        const weaponKey = `${equipped.content}/${equipped.actor.slot}/${equipped.actor.generation}`;
        let selected = this.selectedWeapons.get(weaponKey);
        if (selected === undefined) { selected = new SelectedQ3WeaponPresenter(this.assets, this.characterAssets.animation); this.selectedWeapons.set(weaponKey, selected); }
        weapon = await selected.world(equipped, character, viewer?.equals(character.actor) ?? false);
      } else if (equipped !== undefined && !viewer?.equals(character.actor)) {
        weapon = await this.foreignWeapons.frame(equipped, character);
      }
      const passes = presenter.frame(character, { timeMilliseconds: Math.trunc(this.preparedTime * 1000),
        frameMilliseconds: Math.max(0, Math.trunc(this.preparedTime * 1000) - Math.trunc(this.previousTime * 1000)), shaderTime: { kind: "seconds", value: 0 },
        swingSpeed: 0.3, noPlayerAnimations: false, personalModel: viewer?.equals(character.actor) ?? false, shadowPlane: null, weapon });
      const object: PresentationObject = { opacity: character.opacity ?? 1, passes: [] };
      for (const pass of passes) await append(pass.content ?? this.assets.content.recipe.character.appearance.content, pass.entity, pass.options, object);
    }
    this.inlineModels = inlineModels;
    this.brushModels = brushModels;
    for (const group of this.groups.values()) for (const pass of group.passes) await group.renderer.preload([pass.entity], pass.options);
  }

  styles(): Pick<WorldViewInput, "q1Styles" | "q2Styles"> {
    return {
      q1Styles: Array.from({ length: 256 }, (_, index) => this.lightStyles.has(index) ? this.style(index, 12) * 22 : 256),
      q2Styles: Array.from({ length: 256 }, (_, index) => { const value = this.style(index, 12) / 12; return { rgb: { x: value, y: value, z: value }, white: value * 3 }; })
    };
  }

  view(input: WorldViewInput, operations: readonly SceneOperation[], shadowLights: readonly SceneLight[], infrared: boolean, weaponCamera: SceneCamera = input.camera): ReturnType<WorldScene["prepareView"]> {
    input = { ...input, source: input.source ?? createWorldSurfaceAdmission(createSourceSceneOrder(this.assets.materialRegistrations)), inlineModels: this.inlineModels, ...this.styles() };
    const skinningFrame: ModelSkinningFrame = { meshes: new WeakMap(), poses: new WeakMap() };

    if (shadowLights.length > 0) {
      const retainBody = shadowBodyFilter(shadowLights);
      const casters = [...this.groups.values()].flatMap(group => group.passes.filter(pass => (this.objects.get(pass)?.opacity ?? 1) === 1).flatMap(pass => group.renderer.prepareShadowCasters([pass.entity], input, pass.options, skinningFrame, retainBody)));
      const shadows = this.assets.world.prepareShadows([...shadowLights, ...(input.lights ?? []).map(light => ({ origin: light.origin, radius: light.radius, color: light.color, additive: true,
        profile: { kind: "q2", scale: 1, cone: null, shadow: { kind: "none" } } } satisfies import("../../contracts/scene.ts").SceneLight))], input, casters);
      input = { ...input, q2FragmentLighting: shadows.lighting, beforeView: shadows.operations };
    }
    this.assets.world.prepareWorldOperations(input);
    const modelOperations = this.modelOperations(input, infrared, weaponCamera, skinningFrame);
    const polygon = (operation: SceneOperation): boolean => operation.kind === "scene-group" && operation.order.kind === "source" && operation.order.source.entity.kind === "world";
    return this.assets.world.prepareView({ ...input, operations: [...operations.filter(polygon), ...modelOperations, ...operations.filter(operation => !polygon(operation))] });
  }

  supplemental(input: WorldViewInput, weaponCamera: SceneCamera = input.camera): readonly SceneOperation[] {
    const inline = this.inlineModels.flatMap(model => this.assets.world.prepareModel(model.model, model.transform,
      { ...input, ...(model.animationFrame === undefined ? {} : { animationFrame: model.animationFrame }),
        ...(model.alternateAnimation === undefined ? {} : { alternateAnimation: model.alternateAnimation }) }));
    return [...inline, ...this.modelOperations(input, false, weaponCamera)];
  }

  private modelOperations(input: WorldViewInput, infrared: boolean, weaponCamera: SceneCamera,
    skinningFrame: ModelSkinningFrame = { meshes: new WeakMap(), poses: new WeakMap() }): readonly SceneOperation[] {
    const modelOperations: SceneOperation[] = [], emitted = new Set<PresentationObject>();
    const prepare = (group: ModelGroup, pass: ModelPass) => pass.options(pass.entity).viewModel === true && input.camera.clip.kind === "portal" ? [] : group.renderer.prepare([pass.entity],
      pass.options(pass.entity).viewModel === true ? { ...input, camera: weaponCamera } : input,
      current => ({ ...pass.options(current), infrared, planarShadow: this.planarShadows() }), skinningFrame);
    for (const { group, pass } of this.ordered) {
      const object = this.objects.get(pass);
      if (object === undefined || object.opacity === 1) { modelOperations.push(...prepare(group, pass)); continue; }
      if (emitted.has(object)) continue;
      emitted.add(object);
      if (object.opacity !== 0) modelOperations.push({ kind: "scene-group", order: { kind: "sequence", phase: "translucent" },
        operations: [{ kind: "object-opacity", opacity: object.opacity,
          batches: object.passes.flatMap(pass => sceneModelBatches(prepare(pass.group, pass.pass))) }] });
    }
    if (this.flares.length > 0) modelOperations.push(sequenceDrawGroup("translucent", this.flares.map(flare => prepareFlare(flare.flare, flare.origin, input.camera, flare.image, flare.imagePath))));
    for (const beam of this.shaderBeams) {
      const geometry = railGeometry({ kind: "rail-core", origin: beam.end, oldOrigin: beam.origin, shaderRGBA: { x: 255, y: 255, z: 255, w: 255 } }, input.camera.origin,
        { coreWidth: beam.width, ringWidth: 16, segmentLength: 32 });
      modelOperations.push(sequenceDrawGroup("translucent", prepareMaterialBatches(beam.material, geometry, this.assets.world.materialContext(input))));
    }
    const brushes = this.brushModels.flatMap(brush => brush.scene.prepareModel(brush.model, brush.transform, { ...input, animationFrame: brush.frame,
      alternateAnimation: brush.scene.map.kind === "q1-bsp" && brush.frame !== 0,
      materialContext: { ...input.materialContext, entityRGBA: { x: 255, y: 255, z: 255, w: brush.alpha * 255 } } }));
    return [...brushes, ...modelOperations];
  }

  close(): undefined { this.ordered.length = 0; this.objects.clear(); this.groups.clear(); this.characters.clear(); this.selectedWeapons.clear(); this.shaderBeams = []; return undefined; }
}
