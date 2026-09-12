import { weaponViewOrigin } from "./weapon-view.ts";
import { SelectedQ3WeaponPresenter } from "./q3-selected-weapon.ts";
import type { ApplicationAssets } from "./assets.ts";
import type { SimulationPresentation, SimulationPresentationEvent } from "./simulation/types.ts";
import type { ContentId } from "../../contracts/content.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { SceneEntity, SceneLight } from "../../contracts/scene.ts";
import type { RenderOperation, SceneCamera } from "../../contracts/render.ts";
import type { WorldSnapshot } from "../../contracts/session.ts";
import type { Q3CharacterAssets, Q3CharacterView } from "../../content/q3/foundation/index.ts";
import { Q3CharacterPresenter } from "../../content/q3/foundation/index.ts";
import { anglesToAxis } from "../../core/math.ts";
import type { WorldScene, WorldViewInput } from "../../render/scene/world.ts";
import type { ModelTransform } from "../../render/scene/view.ts";
import { SceneModelRenderer } from "../../render/scene/models/index.ts";
import type { ModelSourceOptions } from "../../render/scene/models/types.ts";

interface ModelGroup {
  readonly renderer: SceneModelRenderer;
  readonly entities: SceneEntity[];
  readonly options: Map<SceneEntity, ModelSourceOptions>;
}

interface BrushPresentation {
  readonly scene: WorldScene;
  readonly model: number;
  readonly transform: ModelTransform;
  readonly frame: number;
}

export class ApplicationWorldScene {
  private readonly groups = new Map<ContentId, ModelGroup>();
  private readonly characters = new Map<string, Q3CharacterPresenter>();
  private readonly selectedWeapons = new Map<string, SelectedQ3WeaponPresenter>();
  private readonly lightStyles = new Map<number, string>();
  private inlineModels: NonNullable<WorldViewInput["inlineModels"]> = [];
  private brushModels: readonly BrushPresentation[] = [];
  private preparedTime = 0;
  private previousTime = 0;

  constructor(readonly assets: ApplicationAssets, private readonly characterAssets: Q3CharacterAssets | null) {}

  receive(events: readonly SimulationPresentationEvent[]): void {
    for (const source of events) if ((source.kind === "q1" || source.kind === "q2") && source.event.kind === "lightstyle")
      this.lightStyles.set(source.event.style, source.event.pattern);
  }

  style(index: number, absent: number): number {
    const pattern = this.lightStyles.get(index);
    return pattern === undefined || pattern.length === 0 ? absent : pattern.charCodeAt(Math.trunc(this.preparedTime * 10) % pattern.length) - 97;
  }

  async prepare(viewer: ActorId, snapshot: WorldSnapshot, presentations: readonly SimulationPresentation[], characters: readonly Q3CharacterView[]): Promise<void> {
    this.previousTime = this.preparedTime;
    this.preparedTime = snapshot.frame.time.kind === "seconds" ? snapshot.frame.time.value : snapshot.frame.time.value / 1000;
    for (const group of this.groups.values()) { group.entities.length = 0; group.options.clear(); }
    const inlineModels: NonNullable<WorldViewInput["inlineModels"]>[number][] = [];
    const brushModels: BrushPresentation[] = [];
    const append = async (content: ContentId, entity: SceneEntity, options?: (entity: SceneEntity) => ModelSourceOptions): Promise<void> => {
      let group = this.groups.get(content);
      if (group === undefined) {
        group = { renderer: new SceneModelRenderer(await this.assets.provider(content), this.assets.world), entities: [], options: new Map<SceneEntity, ModelSourceOptions>() };
        this.groups.set(content, group);
      }
      const activeGroup = group;
      activeGroup.entities.push(entity);
      const addOptions = (current: SceneEntity): void => {
        if (options !== undefined) activeGroup.options.set(current, options(current));
        for (const child of current.attachments) addOptions(child.entity);
      };
      addOptions(entity);
    };
    for (const source of presentations) {
      if (!source.visible || source.path === "") continue;
      if (source.viewWeapon ? !source.actor.equals(viewer) : source.actor.equals(viewer)) continue;
      if (!source.viewWeapon && characters.some(character => character.actor.equals(source.actor))) continue;
      if (source.q3Weapon !== undefined) {
        const key = `${source.content}/${source.actor.slot}/${source.actor.generation}`;
        let presenter = this.selectedWeapons.get(key);
        if (presenter === undefined) { presenter = new SelectedQ3WeaponPresenter(this.assets, this.characterAssets?.animation ?? null); this.selectedWeapons.set(key, presenter); }
        await append(source.content, await presenter.frame(source), () => ({ viewModel: true }));
        continue;
      }
      const asset = await this.assets.model(source.content, source.path);
      const axis = anglesToAxis(source.angles);
      if (asset.model.kind === "brush-model") {
        if (asset.brushScene === this.assets.world) inlineModels.push({ model: asset.model.model, transform: { origin: weaponViewOrigin(source), axis }, animationFrame: source.frame });
        else {
          if (asset.brushScene === null) throw new Error(`Brush model ${source.path} has no prepared scene`);
          brushModels.push({ scene: asset.brushScene, model: asset.model.model, transform: { origin: weaponViewOrigin(source), axis }, frame: source.frame });
        }
        continue;
      }
      const entity: SceneEntity = { actor: source.actor, resource: asset.resource, model: asset.model,
        transform: { origin: weaponViewOrigin(source), axis, scale: { x: source.scale, y: source.scale, z: source.scale } }, previousOrigin: source.previousOrigin ?? source.origin,
        pose: { kind: "frame", frame: source.frame, previousFrame: source.oldFrame, backLerp: source.backLerp ?? 0 }, skin: source.skin,
        color: { x: 1, y: 1, z: 1, w: source.alpha ?? 1 }, shaderTime: { kind: "seconds", value: 0 }, flags: { kind: source.family, bits: source.renderFlags },
        lightingOrigin: source.origin, shadowPlane: 0, attachments: [] };
      await append(source.content, entity, () => ({ viewModel: source.viewWeapon, ...(source.modelBeam === undefined ? {} : { modelBeam: source.modelBeam }),
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
      const equipped = presentations.find(source => source.viewWeapon && source.visible && source.actor.equals(character.actor) && source.q3Weapon !== undefined);
      let weapon: readonly import("../../content/q3/foundation/presentation.ts").Q3CharacterPass[] = [];
      if (equipped !== undefined) {
        const weaponKey = `${equipped.content}/${equipped.actor.slot}/${equipped.actor.generation}`;
        let selected = this.selectedWeapons.get(weaponKey);
        if (selected === undefined) { selected = new SelectedQ3WeaponPresenter(this.assets, this.characterAssets.animation); this.selectedWeapons.set(weaponKey, selected); }
        weapon = await selected.world(equipped, character, character.actor.equals(viewer));
      }
      const passes = presenter.frame(character, { timeMilliseconds: Math.trunc(this.preparedTime * 1000),
        frameMilliseconds: Math.max(0, Math.trunc(this.preparedTime * 1000) - Math.trunc(this.previousTime * 1000)), shaderTime: { kind: "seconds", value: 0 },
        swingSpeed: 0.3, noPlayerAnimations: false, personalModel: character.actor.equals(viewer), shadowPlane: null, weapon });
      for (const pass of passes) await append(pass.content ?? this.assets.content.recipe.character.appearance.content, pass.entity, pass.options);
    }
    this.inlineModels = inlineModels;
    this.brushModels = brushModels;
    for (const group of this.groups.values()) await group.renderer.preload(group.entities, entity => group.options.get(entity) ?? {});
  }

  styles(): Pick<WorldViewInput, "q1Styles" | "q2Styles"> {
    return {
      q1Styles: Array.from({ length: 256 }, (_, index) => this.lightStyles.has(index) ? this.style(index, 12) * 22 : 256),
      q2Styles: Array.from({ length: 256 }, (_, index) => { const value = this.style(index, 12) / 12; return { rgb: { x: value, y: value, z: value }, white: value * 3 }; })
    };
  }

  view(input: WorldViewInput, operations: readonly RenderOperation[], shadowLights: readonly SceneLight[], infrared: boolean, weaponCamera: SceneCamera = input.camera): ReturnType<WorldScene["prepareView"]> {
    input = { ...input, inlineModels: this.inlineModels, ...this.styles() };

    if (shadowLights.length > 0) {
      const casters = [...this.groups.values()].flatMap(group => group.renderer.prepareShadowCasters(group.entities, input, entity => group.options.get(entity) ?? {}));
      const shadows = this.assets.world.prepareShadows([...shadowLights, ...(input.lights ?? []).map(light => ({ origin: light.origin, radius: light.radius, color: light.color, additive: true,
        profile: { kind: "q2", scale: 1, cone: null, shadow: { kind: "none" } } } satisfies import("../../contracts/scene.ts").SceneLight))], input, casters);
      input = { ...input, q2FragmentLighting: shadows.lighting, beforeView: shadows.operations };
    }
    const batches = [...this.groups.values()].flatMap(group => group.entities.flatMap(entity => group.renderer.prepare([entity],
      group.options.get(entity)?.viewModel === true ? { ...input, camera: weaponCamera } : input,
      current => ({ ...group.options.get(current), infrared }))));
    const brushes = this.brushModels.flatMap(brush => brush.scene.prepareModel(brush.model, brush.transform, { ...input, animationFrame: brush.frame }));
    return this.assets.world.prepareView({ ...input, operations: [...brushes, { kind: "draw", batches }, ...operations] });
  }

  close(): undefined { this.groups.clear(); this.characters.clear(); this.selectedWeapons.clear(); return undefined; }
}
