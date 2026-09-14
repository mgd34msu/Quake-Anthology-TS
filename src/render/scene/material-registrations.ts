import type { ContentId } from "../../contracts/content.ts";
import type { DecodedWorld } from "../../contracts/scene.ts";
import type { CompiledMaterial } from "../../materials/compile.ts";

class Registration {
  constructor(private readonly scope: ProviderShaderRegistrations) {}
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
  snapshot(): readonly RegisteredSceneMaterial[] {
    return [...this.admitted.values()].flatMap(material => material === null ? [] : [material])
      .sort((a, b) => a.finished.sort - b.finished.sort);
  }
}

export class ProviderShaderRegistrations {
  private readonly registrations = new Map<string, ShaderRegistration>();
  constructor(readonly owner: SceneMaterialRegistrations) {}
  key(key: ShaderLogicalKey): string {
    const binding = key.binding;
    if (binding.kind === "unlit") return `${key.name}\0unlit\0${binding.lightmapIndex}`;
    if (binding.world.owner !== this.owner) throw new Error("Shader world belongs to another scene");
    return `${key.name}\0world\0${binding.world.ordinal}\0${binding.lightmapIndex}\0${binding.baseTextureName ?? ""}`;
  }
  find(key: ShaderLogicalKey): ShaderRegistration | undefined { return this.registrations.get(this.key(key)); }
  reserve(key: ShaderLogicalKey): ShaderRegistration {
    const cacheKey = this.key(key);
    let registration = this.registrations.get(cacheKey);
    if (registration === undefined) {
      registration = new Registration(this); this.registrations.set(cacheKey, registration); this.owner.admit(registration);
    }
    return registration;
  }
  publish(registration: ShaderRegistration, compiled: CompiledMaterial): RegisteredSceneMaterial {
    if (registration.provider !== this) throw new Error("Shader belongs to another provider");
    return this.owner.publish(registration, compiled);
  }
  beginReplacement(): ShaderReplacementStage { return new ShaderReplacementStage(this); }
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
    const registration = this.provider.find(key) ?? new Registration(this.provider);
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
