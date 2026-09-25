import { bodyBaseVisible, bodyMaterials, type ComponentBody, type PreparedPrimaryBody } from "./component-bodies.ts";
import type { QvmBodyPart } from "../../contracts/qvm-mod-presentation.ts";
import type { SourceTime } from "../../contracts/time.ts";
import type { QvmHeldWeapon } from "./q3-client/qvm.ts";
import { attachSceneEntity, modelAttachmentTag } from "../../render/scene/models/transform.ts";
import { samePresentationOwner, type PresentationOwner } from "../../contracts/presentation.ts";
import { createWorldSurfaceAdmission } from "../../render/scene/world.ts";
import { createSourceSceneOrder, sceneModelBatches, sequenceDrawGroup, type SceneOperation } from "../../render/scene/submissions.ts";
import { weaponViewOrigin } from "./weapon-view.ts";
import { SelectedQ3WeaponPresenter } from "./q3-selected-weapon.ts";
import { NativeHeldWeapons, type ResolvedHeldEntity } from "./native-held-weapon.ts";
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
  readonly resolve?: ResolvedHeldEntity;
  readonly time?: SourceTime;
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
  private readonly groups = new Map<string, ModelGroup>();
  private readonly ordered: { readonly group: ModelGroup; readonly pass: ModelPass }[] = [];
  private readonly objects = new Map<ModelPass, PresentationObject>();
  private readonly characters = new Map<string, Q3CharacterPresenter>();
  private readonly selectedWeapons = new Map<string, SelectedQ3WeaponPresenter>();
  private readonly foreignWeapons: ForeignHeldWeapons;
  private readonly nativeWeapons: NativeHeldWeapons;
  private readonly lightStyles = new Map<number, { readonly pattern: string; readonly owner?: PresentationOwner }>();
  private inlineModels: NonNullable<WorldViewInput["inlineModels"]> = [];
  private brushModels: readonly BrushPresentation[] = [];
  private preparedTime = 0;
  private previousTime = 0;
  private flares: { readonly flare: SceneFlare; readonly origin: Vec3; readonly image: RendererImage; readonly imagePath: string }[] = [];
  private shaderBeams: { readonly material: RegisteredSceneMaterial; readonly origin: Vec3; readonly end: Vec3; readonly width: number }[] = [];

  constructor(readonly assets: ApplicationAssets, private readonly characterAssets: Q3CharacterAssets | null, private readonly planarShadows: () => boolean = () => false) {
    this.foreignWeapons = new ForeignHeldWeapons(assets);
    this.nativeWeapons = new NativeHeldWeapons(assets);
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

  async prepare(viewer: ActorId | null, snapshot: WorldSnapshot, presentations: readonly SimulationPresentation[], characters: readonly Q3CharacterView[], fieldOfView = 90, heldWeapons: readonly QvmHeldWeapon[] = [], viewWeaponVisible = true, bodies: readonly ComponentBody[] = [], primaryBodies: readonly PreparedPrimaryBody[] = []): Promise<void> {
    this.objects.clear();
    this.ordered.length = 0;
    this.flares = [];
    this.shaderBeams = [];
    this.previousTime = this.preparedTime;
    this.preparedTime = snapshot.frame.time.kind === "seconds" ? snapshot.frame.time.value : snapshot.frame.time.value / 1000;
    for (const group of this.groups.values()) group.passes.length = 0;
    const inlineModels: NonNullable<WorldViewInput["inlineModels"]>[number][] = [];
    const brushModels: BrushPresentation[] = [];
    const append = async (content: ContentId, entity: SceneEntity, options?: (entity: SceneEntity) => ModelSourceOptions, object?: PresentationObject, shaderContent?: ContentId, time?: SourceTime, resolve?: ResolvedHeldEntity): Promise<void> => {
      const key = `${content}/${shaderContent ?? content}`;
      let group = this.groups.get(key);
      if (group === undefined) {
        const provider = await this.assets.provider(content);
        group = { renderer: new SceneModelRenderer(shaderContent === undefined ? provider : { family: "q3", palette: provider.palette, textures: provider.textures, shaders: (await this.assets.provider(shaderContent)).shaders }, this.assets.world), passes: [] };
        this.groups.set(key, group);
      }
      const pass: ModelPass = { entity, ...(resolve === undefined ? {} : { resolve }), options: options ?? (() => ({})), ...(time === undefined ? {} : { time }) };
      group.passes.push(pass);
      this.ordered.push({ group, pass });
      const logical = object ?? { opacity: entity.opacity ?? 1, passes: [] };
      logical.passes.push({ group, pass }); this.objects.set(pass, logical);
    };
    const posed = new Map<string, { readonly part: QvmBodyPart; readonly content: ContentId; readonly entity: SceneEntity; readonly options: (entity: SceneEntity) => ModelSourceOptions }>();
    const affected = (actor: ActorId | null): actor is ActorId => actor !== null && bodies.some(body => body.actor.equals(actor));
    const retain = (part: QvmBodyPart, content: ContentId, entity: SceneEntity, options: (entity: SceneEntity) => ModelSourceOptions): void => {
      if (entity.actor === null) return;
      const key = `${entity.actor.slot}/${entity.actor.generation}/${part}/${entity.resource.id}`;
      if (!posed.has(key)) posed.set(key, { part, content, entity, options });
    };
    const appendBody = async (content: ContentId, entity: SceneEntity, options: (entity: SceneEntity) => ModelSourceOptions,
      base: boolean, object?: PresentationObject): Promise<void> => {
      if (!affected(entity.actor)) { await append(content, entity, options, object); return; }
      const actor = entity.actor, assets = this.characterAssets;
      const part: QvmBodyPart = entity.resource.id === assets?.lower.resource.id ? "lower"
        : entity.resource.id === assets?.upper.resource.id ? "upper" : entity.resource.id === assets?.head.resource.id ? "head" : "body";
      const body = { ...entity, attachments: [] };
      retain(part, content, body, options);
      if (!base || bodyBaseVisible(bodies, actor, part)) await append(content, body, options, object);
      for (const attachment of entity.attachments) {
        const tag = modelAttachmentTag(entity, attachment.tag);
        if (tag === null) continue;
        const child = attachSceneEntity(entity, attachment.entity, tag);
        if (assets !== null && [assets.lower, assets.upper, assets.head].some(part => part.resource.id === child.resource.id))
          await appendBody(content, child, options, base, object);
        else await append(content, child, options, object);
      }
    };
    for (const original of presentations) {
      let source = original;
      if (!source.visible || source.viewWeapon && !viewWeaponVisible && viewer?.equals(source.actor)) continue;
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
      const options = (): ModelSourceOptions => ({ viewModel: source.viewWeapon, ...(source.modelBeam === undefined ? {} : { modelBeam: source.modelBeam }),
        ...(source.indexedSkin === undefined ? {} : { indexedSkin: source.indexedSkin }),
        ...(source.playerColors === undefined ? {} : { playerColors: source.playerColors }),
        player: source.family === "q2" && source.path.startsWith("players/"), customShader: source.skinPath ?? null });
      if (source.nativeHeldWeapon === true) {
        const equipped = presentations.find(candidate => candidate.viewWeapon && candidate.actor.equals(source.actor));
        if (equipped === undefined || equipped.path === "" && equipped.heldWeapon === undefined) continue;
        const declaration = await this.foreignWeapons.declaration(equipped);
        if (declaration?.kind === "none") continue;
        const attach = await this.nativeWeapons.attachment(source.content, entity);
        let passes: readonly import("../../content/q3/foundation/presentation.ts").Q3CharacterPass[];
        if (equipped.q3Weapon !== undefined && declaration === undefined) {
          const key = `${equipped.content}/${equipped.actor.slot}/${equipped.actor.generation}`;
          let selected = this.selectedWeapons.get(key);
          if (selected === undefined) { selected = new SelectedQ3WeaponPresenter(this.assets, this.characterAssets?.animation ?? null); this.selectedWeapons.set(key, selected); }
          passes = await selected.world({ ...equipped, visible: true }, { origin: entity.lightingOrigin, powerups: 0 }, false);
        } else passes = await this.foreignWeapons.frame(equipped, { origin: entity.lightingOrigin, color: entity.color, opacity: entity.opacity ?? 1 });
        if (passes.length === 0) throw new Error(`Selected weapon ${equipped.path} has no source held model`);
        const object: PresentationObject = { opacity: entity.opacity ?? 1, passes: [] };
        for (const pass of passes) await append(pass.content ?? equipped.content, pass.entity, pass.options, object, undefined, undefined, attach(pass.entity));
        continue;
      }
      if (source.viewWeapon) await append(source.content, { ...entity, attachments }, options);
      else await appendBody(source.content, { ...entity, attachments }, options, true);
    }
    if (this.characterAssets !== null) for (const character of characters) {
      const key = `${character.actor.slot}:${character.actor.generation}`;
      let presenter = this.characters.get(key);
      if (presenter === undefined) {
        presenter = new Q3CharacterPresenter(this.characterAssets);
        presenter.reset(character, Math.trunc(this.preparedTime * 1000));
        this.characters.set(key, presenter);
      }
      const equipped = presentations.find(source => source.viewWeapon && source.actor.equals(character.actor));
      const declaration = equipped === undefined ? undefined : await this.foreignWeapons.declaration(equipped);
      let weapon: readonly import("../../content/q3/foundation/presentation.ts").Q3CharacterPass[] = [];
      if (equipped?.q3Weapon !== undefined && declaration === undefined) {
        const weaponKey = `${equipped.content}/${equipped.actor.slot}/${equipped.actor.generation}`;
        let selected = this.selectedWeapons.get(weaponKey);
        if (selected === undefined) { selected = new SelectedQ3WeaponPresenter(this.assets, this.characterAssets.animation); this.selectedWeapons.set(weaponKey, selected); }
        weapon = await selected.world({ ...equipped, visible: true }, character, viewer?.equals(character.actor) ?? false);
      } else if (equipped !== undefined && !viewer?.equals(character.actor)) {
        weapon = await this.foreignWeapons.frame(equipped, character);
      }
      const passes = presenter.frame(character, { timeMilliseconds: Math.trunc(this.preparedTime * 1000),
        frameMilliseconds: Math.max(0, Math.trunc(this.preparedTime * 1000) - Math.trunc(this.previousTime * 1000)), shaderTime: { kind: "seconds", value: 0 },
        swingSpeed: 0.3, noPlayerAnimations: false, personalModel: viewer?.equals(character.actor) ?? false, shadowPlane: null, weapon });
      const object: PresentationObject = { opacity: character.opacity ?? 1, passes: [] };
      for (const pass of passes) {
        const content = pass.content ?? this.assets.content.recipe.character.appearance.content;
        if (pass.entity.resource.id === this.characterAssets.lower.resource.id) await appendBody(content, pass.entity, pass.options, pass.shader === null, object);
        else await append(content, pass.entity, pass.options, object);
      }
    }
    for (const held of heldWeapons) {
      const equipped = presentations.find(source => source.viewWeapon && source.actor.equals(held.parent.actor));
      if (equipped === undefined) continue;
      const declaration = await this.foreignWeapons.declaration(equipped);
      if (declaration?.kind === "none") continue;
      const tag = modelAttachmentTag(held.parent, "tag_weapon");
      if (tag === null) throw new Error("Original source torso has no weapon attachment");
      let passes: readonly import("../../content/q3/foundation/presentation.ts").Q3CharacterPass[];
      if (equipped.q3Weapon !== undefined && declaration === undefined) {
        const key = `${equipped.content}/${equipped.actor.slot}/${equipped.actor.generation}`;
        let selected = this.selectedWeapons.get(key);
        if (selected === undefined) { selected = new SelectedQ3WeaponPresenter(this.assets, this.characterAssets?.animation ?? null); this.selectedWeapons.set(key, selected); }
        passes = await selected.world({ ...equipped, visible: true }, { origin: held.parent.lightingOrigin, powerups: 0 }, false);
      } else passes = await this.foreignWeapons.frame(equipped, { origin: held.parent.lightingOrigin, color: { x: 1, y: 1, z: 1, w: 1 } });
      if (passes.length === 0) throw new Error(`Selected weapon ${equipped.path} has no source held model`);
      for (const [index, pass] of passes.entries()) {
        const attach = (entity: SceneEntity): SceneEntity => ({ ...attachSceneEntity(held.parent, entity, tag), flags: held.parent.flags,
          lightingOrigin: held.parent.lightingOrigin, shadowPlane: held.parent.shadowPlane });
        if (index !== 0) { await append(pass.content ?? equipped.content, attach(pass.entity), pass.options); continue; }
        for (const sourcePass of held.passes) {
          const shader = sourcePass.shader;
          const entity: SceneEntity = { ...attach(pass.entity), color: shader === null ? pass.entity.color : { x: sourcePass.color.x / 255, y: sourcePass.color.y / 255, z: sourcePass.color.z / 255, w: sourcePass.color.w / 255 },
            shaderTime: { kind: "seconds", value: sourcePass.shaderTime } };
          await append(pass.content ?? equipped.content, entity, value => ({ ...pass.options(value), customShader: shader }), undefined, shader === null ? undefined : held.content);
        }
      }
    }
    for (const source of primaryBodies) {
      retain(source.part, source.content, source.entity, () => source.options);
      if (!source.base || bodyBaseVisible(bodies, source.actor, source.part)) await append(source.content, source.entity, () => source.options, undefined, source.shaderContent, { kind: "milliseconds", value: source.time });
    }
    for (const model of posed.values()) {
      const actor = model.entity.actor;
      if (actor === null) continue;
      for (const body of bodies) if (body.actor.equals(actor)) for (const pass of bodyMaterials(body, model.part)) {
        const c = pass.shaderRGBA;
        const entity: SceneEntity = { ...model.entity, color: { x: c.x / 255, y: c.y / 255, z: c.z / 255, w: c.w / 255 },
          flags: { kind: "q3", bits: pass.renderFlags }, shaderTime: { kind: "seconds", value: pass.shaderTime },
          lightingOrigin: pass.lightingOrigin, shadowPlane: pass.shadowPlane };
        await append(model.content, entity, current => ({ ...model.options(current), customShader: pass.customShader?.name ?? null,
          customSkin: pass.customSkin?.surfaces ?? null, shaderTexCoord: pass.shaderTexCoord, nonNormalizedAxes: pass.nonNormalizedAxes }), undefined, body.content,
          { kind: "milliseconds", value: body.time });
      }
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

    if (shadowLights.length > 0 && input.noWorldModel !== true) {
      const retainBody = shadowBodyFilter(shadowLights);
      const casters = [...this.groups.values()].flatMap(group => group.passes.filter(pass => (this.objects.get(pass)?.opacity ?? 1) === 1).flatMap(pass => {
        const entity = pass.resolve === undefined ? pass.entity : pass.resolve(input.camera.origin, "shadow");
        return entity === null ? [] : group.renderer.prepareShadowCasters([entity], pass.time === undefined ? input : { ...input, time: pass.time }, pass.options, skinningFrame, retainBody);
      }));
      const shadows = this.assets.world.prepareShadows([...shadowLights, ...(input.lights ?? []).map(light => ({ origin: light.origin, radius: light.radius, color: light.color, additive: true,
        profile: { kind: "q2", scale: 1, cone: null, shadow: { kind: "none" } } } satisfies import("../../contracts/scene.ts").SceneLight))], input, casters);
      input = { ...input, q2FragmentLighting: shadows.lighting, beforeView: shadows.operations };
    }
    this.assets.world.prepareWorldOperations(input);
    const modelOperations = this.modelOperations(input, infrared, weaponCamera, skinningFrame);
    const polygon = (operation: SceneOperation): boolean => operation.kind === "scene-group" && operation.order.kind === "source" && operation.order.source.entity.kind === "world";
    return this.assets.world.prepareView({ ...input, operations: [...operations.filter(polygon), ...modelOperations, ...operations.filter(operation => !polygon(operation))] });
  }

  supplemental(input: WorldViewInput, weaponCamera: SceneCamera = input.camera, infrared = false): readonly SceneOperation[] {
    const inline = this.inlineModels.flatMap(model => this.assets.world.prepareModel(model.model, model.transform,
      { ...input, ...(model.animationFrame === undefined ? {} : { animationFrame: model.animationFrame }),
        ...(model.alternateAnimation === undefined ? {} : { alternateAnimation: model.alternateAnimation }) }));
    return [...inline, ...this.modelOperations(input, infrared, weaponCamera)];
  }

  private modelOperations(input: WorldViewInput, infrared: boolean, weaponCamera: SceneCamera,
    skinningFrame: ModelSkinningFrame = { meshes: new WeakMap(), poses: new WeakMap() }): readonly SceneOperation[] {
    const modelOperations: SceneOperation[] = [], emitted = new Set<PresentationObject>();
    const prepare = (group: ModelGroup, pass: ModelPass) => {
      const entity = pass.resolve === undefined ? pass.entity : pass.resolve(input.camera.origin, "view");
      if (entity === null || pass.options(entity).viewModel === true && input.camera.clip.kind === "portal") return [];
      const current = pass.time === undefined ? input : { ...input, time: pass.time };
      return group.renderer.prepare([entity], pass.options(entity).viewModel === true ? { ...current, camera: weaponCamera } : current,
        entity => ({ ...pass.options(entity), infrared, noWorldModel: input.noWorldModel === true, planarShadow: input.noWorldModel !== true && this.planarShadows() }), skinningFrame);
    };
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
