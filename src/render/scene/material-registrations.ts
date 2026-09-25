import type { ContentId } from "../../contracts/content.ts";
import type { DecodedWorld } from "../../contracts/scene.ts";
import type { CompiledMaterial } from "../../materials/compile.ts";
import type { SceneShaderBinding, SceneShaderRegistry } from "./shaders.ts";
import type { WorldScene } from "./world.ts";
import { normalizeShaderName, stripShaderExtension } from "../../materials/material.ts";

export interface SceneMaterialRemap { readonly material: RegisteredSceneMaterial; readonly timeOffset: number; readonly source: SceneShaderRegistry; }
export type ShaderRemapResult = "committed" | "unchanged" | "stale";
interface BoundSceneMaterial { readonly material: RegisteredSceneMaterial; readonly source: SceneShaderRegistry; readonly binding: SceneShaderBinding; }
interface EffectiveRemap { readonly replacement: string; readonly source: SceneShaderRegistry; readonly timeOffset: number; readonly materials: Map<ShaderRegistration, SceneMaterialRemap>; }
function shaderName(name: string): string { return normalizeShaderName(stripShaderExtension(name)); }

export function currentRemap(material: CompiledMaterial): SceneMaterialRemap | null {
  return material instanceof MaterialHandle ? material.registration.provider.owner.currentRemap(material) : null;
}

class Registration {
  readonly name: string;
  constructor(private readonly scope: ProviderShaderRegistrations, name: string) { this.name = shaderName(name); }
  get provider(): ProviderShaderRegistrations { return this.scope; }
}
class WorldIdentity {
  constructor(private readonly scene: SceneMaterialRegistrations, readonly ordinal: number) {}
  get owner(): SceneMaterialRegistrations { return this.scene; }
}
export type ShaderRegistration = Registration;
export type ShaderWorldIdentity = WorldIdentity;
export interface RegisteredSceneMaterial extends CompiledMaterial {
  readonly registration: ShaderRegistration;
}
export interface ShaderLogicalKey {
  readonly name: string;
  readonly binding: { readonly kind: "unlit"; readonly lightmapIndex: -1 | -2 | -3 | -4 }
    | { readonly kind: "source"; readonly request: number }
    | { readonly kind: "world"; readonly world: ShaderWorldIdentity; readonly lightmapIndex: number; readonly baseTextureName: string | null };
}

class MaterialHandle implements RegisteredSceneMaterial {
  constructor(readonly registration: ShaderRegistration, private current: CompiledMaterial) {}
  get registered() { return this.current.registered; }
  get finished() { return this.current.finished; }
  get material() { return this.current.material; }
  replace(current: CompiledMaterial): void { this.current = current; }
}

export class SceneMaterialRegistrations {
  private readonly providers = new Map<ContentId, ProviderShaderRegistrations>();
  private readonly worlds = new WeakMap<DecodedWorld, ShaderWorldIdentity>();
  private worldOrdinal = 0;
  private readonly admitted = new Map<ShaderRegistration, MaterialHandle | null>();
  private readonly bindings = new Map<ShaderRegistration, BoundSceneMaterial>();
  private readonly remaps = new Map<string, EffectiveRemap>();
  private readonly remapRequests = new Map<string, object>();
  private readonly scenes = new Set<WorldScene>();
  private bindingRevision = 0;
  private remapRevision = 0;
  get materialRevision(): number { return this.remapRevision; }

  currentRemap(material: RegisteredSceneMaterial): SceneMaterialRemap | null {
    if (this.remaps.size === 0) return null;
    return this.remaps.get(material.registration.name)?.materials.get(material.registration) ?? null;
  }
  remapDefinition(name: string): Pick<EffectiveRemap, "replacement" | "source" | "timeOffset"> | null { return this.remaps.get(shaderName(name)) ?? null; }
  async bindWorld(world: WorldScene): Promise<void> {
    this.scenes.add(world); this.bindingRevision++;
    for (const name of this.remaps.keys()) for (;;) {
      const selected = this.remaps.get(name), bindings = world.rawRemapBindings(name);
      if (selected === undefined || bindings.length === 0) break;
      const prepared = await selected.source.prepareRemapMaterials(selected.replacement, bindings.map(value => value.binding));
      if (!this.scenes.has(world)) { prepared.discard(); return; }
      if (this.remaps.get(name) !== selected || !prepared.current()) { prepared.discard(); continue; }
      if (!prepared.accepted) { prepared.discard(); break; }
      prepared.commit();
      world.publishRawRemap(name, prepared.materials.map(material => this.retained(material.registration)), selected.source, selected.timeOffset);
      break;
    }
  }
  releaseWorld(world: WorldScene): void { if (this.scenes.delete(world)) this.bindingRevision++; }
  async bindMaterial(source: SceneShaderRegistry, material: RegisteredSceneMaterial, binding: SceneShaderBinding): Promise<void> {
    const previous = this.bindings.get(material.registration);
    if (previous?.material === material && previous.binding === binding && previous.source === source) return;
    this.bindings.set(material.registration, { source, material, binding }); this.bindingRevision++;
    const key = shaderName(material.material.name);
    for (;;) {
      const selected = this.remaps.get(key);
      if (selected === undefined || selected.materials.has(material.registration)) return;
      const prepared = await selected.source.prepareRemapMaterials(selected.replacement, [binding]);
      if (this.remaps.get(key) !== selected || !prepared.current()) { prepared.discard(); continue; }
      if (!prepared.accepted) { prepared.discard(); return; }
      const replacement = prepared.materials[0];
      if (replacement === undefined) { prepared.discard(); throw new Error("Shader remap lost its registered binding"); }
      prepared.commit();
      selected.materials.set(material.registration, { material: this.retained(replacement.registration), timeOffset: selected.timeOffset, source: selected.source });
      return;
    }
  }

  async remap(request: { readonly original: string; readonly replacement: string; readonly timeOffset: number; readonly source: SceneShaderRegistry;
    readonly current: () => boolean }): Promise<ShaderRemapResult> {
    if (request.source.registrations.owner !== this) throw new Error("Shader remap source belongs to another scene");
    if (!request.current()) return "stale";
    const key = shaderName(request.original), token = {}; this.remapRequests.set(key, token);
    const current = (): boolean => this.remapRequests.get(key) === token && request.current();
    if (!current()) return "stale";
    if (key === shaderName(request.replacement)) {
      this.remaps.delete(key); this.remapRevision++;
      for (const world of this.scenes) world.publishRawRemap(key, [], request.source, 0);
      return "committed";
    }
    for (;;) {
      const revision = this.bindingRevision;
      const originals = [...this.bindings.values()].filter(value => shaderName(value.material.material.name) === key);
      const worlds = [...this.scenes].map(world => ({ world, bindings: world.rawRemapBindings(key) }));
      const bindings = [...originals.map(value => value.binding), ...worlds.flatMap(value => value.bindings.map(binding => binding.binding))];
      const prepared = await request.source.prepareRemapMaterials(request.replacement, bindings.length === 0 ? [{ kind: "unlit", lightmapIndex: -1, mipmap: true }] : bindings);
      if (!current() || !prepared.current()) { prepared.discard(); return "stale"; }
      if (!prepared.accepted) { prepared.discard(); return "unchanged"; }
      if (revision !== this.bindingRevision) { prepared.discard(); continue; }
      const materials = new Map<ShaderRegistration, SceneMaterialRemap>();
      for (const [index, original] of originals.entries()) {
        const material = prepared.materials[index];
        if (material === undefined) { prepared.discard(); throw new Error("Shader remap lost a prepared binding"); }
        materials.set(original.material.registration, { material, timeOffset: request.timeOffset, source: request.source });
      }
      prepared.commit();
      for (const [registration, remap] of materials) materials.set(registration, { ...remap, material: this.retained(remap.material.registration) });
      this.remaps.set(key, { replacement: request.replacement, source: request.source, timeOffset: request.timeOffset, materials }); this.remapRevision++;
      let offset = originals.length;
      for (const { world, bindings } of worlds) {
        world.publishRawRemap(key, prepared.materials.slice(offset, offset + bindings.length).map(material => this.retained(material.registration)), request.source, request.timeOffset);
        offset += bindings.length;
      }
      return "committed";
    }
  }

  async prepareRemapRefresh(sources: ReadonlyMap<SceneShaderRegistry, SceneShaderRegistry>): Promise<{ validate(): void; commit(): void }> {
    const revision = this.remapRevision, bindingRevision = this.bindingRevision, bindings = [...sources.values()].flatMap(source => source.materialBindings());
    const replacements = new Map<string, EffectiveRemap>();
    for (const [name, selected] of this.remaps) {
      const source = sources.get(selected.source);
      if (source === undefined) throw new Error("Remap image source was not prepared");
      const originals = bindings.filter(value => shaderName(value.material.material.name) === name);
      const prepared = await source.prepareRemapMaterials(selected.replacement, originals.map(value => value.binding));
      if (!prepared.accepted) { prepared.discard(); throw new Error("Current remap could not be rebuilt from its source images"); }
      const materials = new Map<ShaderRegistration, SceneMaterialRemap>();
      for (const [index, original] of originals.entries()) {
        const material = prepared.materials[index];
        if (material === undefined) { prepared.discard(); throw new Error("Refreshed remap lost a binding"); }
        materials.set(original.material.registration, { material, source: selected.source, timeOffset: selected.timeOffset });
      }
      prepared.commit(); replacements.set(name, { ...selected, materials });
    }
    const validate = (): void => { if (revision !== this.remapRevision || bindingRevision !== this.bindingRevision) throw new Error("Shader remap bindings changed during image preparation"); };
    return { validate, commit: () => {
      validate();
      this.bindings.clear();
      for (const [source, replacement] of sources) for (const value of replacement.materialBindings())
        this.bindings.set(value.material.registration, { ...value, source, material: this.retained(value.material.registration) });
      this.bindingRevision++;
      this.remaps.clear();
      for (const [name, selected] of replacements) {
        for (const [registration, remap] of selected.materials) selected.materials.set(registration, { ...remap, material: this.retained(remap.material.registration) });
        this.remaps.set(name, selected);
      }
      this.remapRevision++;
    } };
  }

  provider(content: ContentId): ProviderShaderRegistrations {
    let provider = this.providers.get(content);
    if (provider === undefined) { provider = new ProviderShaderRegistrations(this); this.providers.set(content, provider); }
    return provider;
  }
  world(map: DecodedWorld): ShaderWorldIdentity {
    let world = this.worlds.get(map);
    if (world === undefined) { world = new WorldIdentity(this, this.worldOrdinal++); this.worlds.set(map, world); }
    return world;
  }
  admit(registration: ShaderRegistration): void {
    if (registration.provider.owner !== this) throw new Error("Shader registration belongs to another scene");
    if (!this.admitted.has(registration)) this.admitted.set(registration, null);
  }
  publish(registration: ShaderRegistration, compiled: CompiledMaterial): RegisteredSceneMaterial {
    if (!this.admitted.has(registration)) throw new Error("Shader was not admitted to this scene");
    const previous = this.admitted.get(registration);
    if (previous !== undefined && previous !== null) { previous.replace(compiled); return previous; }
    const material = new MaterialHandle(registration, compiled);
    this.admitted.set(registration, material); return material;
  }
  retained(registration: ShaderRegistration): RegisteredSceneMaterial {
    const material = this.admitted.get(registration);
    if (material === undefined || material === null) throw new Error("Shader registration is not published");
    return material;
  }
  requireMaterial(material: CompiledMaterial): RegisteredSceneMaterial {
    if (!(material instanceof MaterialHandle) || material.registration.provider.owner !== this) throw new Error("Material is not registered in this scene");
    return material;
  }
  cancel(registration: ShaderRegistration): void {
    if (this.admitted.get(registration) !== null) throw new Error("Only an unpublished shader admission can be cancelled");
    this.admitted.delete(registration);
  }
  snapshot(sorted = true): readonly RegisteredSceneMaterial[] {
    const materials = [...this.admitted.values()].flatMap(material => material === null ? [] : [material]);
    return sorted ? materials.sort((a, b) => a.finished.sort - b.finished.sort) : materials;
  }
}

export class ProviderShaderRegistrations {
  private readonly registrations = new Map<string, ShaderRegistration>();
  constructor(readonly owner: SceneMaterialRegistrations) {}
  key(key: ShaderLogicalKey): string {
    const binding = key.binding;
    if (binding.kind === "unlit") return `${key.name}\0unlit\0${binding.lightmapIndex}`;
    if (binding.kind === "source") return `${key.name}\0source\0${binding.request}`;
    if (binding.world.owner !== this.owner) throw new Error("Shader world belongs to another scene");
    return `${key.name}\0world\0${binding.world.ordinal}\0${binding.lightmapIndex}\0${binding.baseTextureName ?? ""}`;
  }
  find(key: ShaderLogicalKey): ShaderRegistration | undefined { return this.registrations.get(this.key(key)); }
  reserve(key: ShaderLogicalKey): ShaderRegistration {
    const cacheKey = this.key(key);
    let registration = this.registrations.get(cacheKey);
    if (registration === undefined) {
      registration = new Registration(this, key.name); this.registrations.set(cacheKey, registration); this.owner.admit(registration);
    }
    return registration;
  }
  publish(registration: ShaderRegistration, compiled: CompiledMaterial): RegisteredSceneMaterial {
    if (registration.provider !== this) throw new Error("Shader belongs to another provider");
    return this.owner.publish(registration, compiled);
  }
  beginReplacement(): ShaderReplacementStage { return new ShaderReplacementStage(this); }
  cancel(key: ShaderLogicalKey, registration: ShaderRegistration): void {
    const cacheKey = this.key(key);
    if (this.registrations.get(cacheKey) !== registration) throw new Error("Shader admission does not match its request");
    this.owner.cancel(registration); this.registrations.delete(cacheKey);
  }
  commit(key: ShaderLogicalKey, registration: ShaderRegistration, compiled: CompiledMaterial): RegisteredSceneMaterial {
    const cacheKey = this.key(key), previous = this.registrations.get(cacheKey);
    if (previous !== undefined && previous !== registration) throw new Error("Shader registration changed during replacement");
    if (registration.provider !== this) throw new Error("Replacement shader belongs to another provider");
    this.registrations.set(cacheKey, registration); this.owner.admit(registration);
    return this.publish(registration, compiled);
  }
}

export class ShaderReplacementStage {
  private state: "preparing" | "committed" | "discarded" = "preparing";
  private readonly entries = new Map<string, { readonly key: ShaderLogicalKey; readonly registration: ShaderRegistration; material: MaterialHandle | null }>();
  constructor(readonly provider: ProviderShaderRegistrations) {}
  private requirePreparing(): void { if (this.state !== "preparing") throw new Error(`Shader replacement is ${this.state}`); }
  reserve(key: ShaderLogicalKey): ShaderRegistration {
    this.requirePreparing();
    const cacheKey = this.provider.key(key), previous = this.entries.get(cacheKey);
    if (previous !== undefined) return previous.registration;
    const registration = this.provider.find(key) ?? new Registration(this.provider, key.name);
    this.entries.set(cacheKey, { key, registration, material: null }); return registration;
  }
  publish(registration: ShaderRegistration, compiled: CompiledMaterial): RegisteredSceneMaterial {
    this.requirePreparing();
    const entry = [...this.entries.values()].find(value => value.registration === registration);
    if (entry === undefined) throw new Error("Shader was not admitted to this replacement");
    if (entry.material === null) entry.material = new MaterialHandle(registration, compiled);
    else entry.material.replace(compiled);
    return entry.material;
  }
  cancel(key: ShaderLogicalKey, registration: ShaderRegistration): void {
    this.requirePreparing();
    const cacheKey = this.provider.key(key), entry = this.entries.get(cacheKey);
    if (entry?.registration !== registration || entry.material !== null) throw new Error("Only an unpublished staged shader admission can be cancelled");
    this.entries.delete(cacheKey);
  }
  validate(): void {
    this.requirePreparing();
    for (const entry of this.entries.values()) {
      if (entry.material === null) throw new Error("Shader replacement has unfinished registrations");
      const previous = this.provider.find(entry.key);
      if (previous !== undefined && previous !== entry.registration) throw new Error("Shader registration changed during replacement");
    }
  }
  commit(): void {
    this.validate();
    for (const entry of this.entries.values()) if (entry.material !== null) {
      const current = entry.material;
      const compiled: CompiledMaterial = { registered: current.registered, finished: current.finished, material: current.material };
      const retained = this.provider.commit(entry.key, entry.registration, compiled);
      current.replace(retained);
    }
    this.state = "committed";
  }
  discard(): void { this.requirePreparing(); this.entries.clear(); this.state = "discarded"; }
}
