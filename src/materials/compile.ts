/* Shader compilation joins Q3 parser state with shared render contracts.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { RenderMaterial, ShaderStage, TexCoordModifier, Waveform } from "../contracts/render.ts";
import { inspectShaderScript } from "./material.ts";
import type { ShaderDefinition, ShaderRegistrationHost, SourceWaveStorage, RegisteredExplicitShader } from "./material.ts";
import { finishShader, implicitShaderInput } from "./material-finish.ts";
import type { FinishedShader, FinishShaderProfile, FinishImplicitShaderInput } from "./material-finish.ts";

export const DEFAULT_SHADER_PROFILE: FinishShaderProfile = {
  detailTextures: true, vertexLight: false, uiFullscreen: false, hardware: "generic",
  iterator: { ignoreFastPath: false, multitexture: true, textureEnvAdd: true, driver: "generic" },
};

export interface CompiledMaterial {
  readonly registered: RegisteredExplicitShader;
  readonly finished: FinishedShader;
  readonly material: Extract<RenderMaterial, { readonly kind: "q3" }>;
}

function semanticWave(wave: SourceWaveStorage): Waveform {
  const kinds: readonly Waveform["kind"][] = ["none", "sin", "square", "triangle", "sawtooth", "inversesawtooth", "noise"];
  const kind = kinds[wave.func];
  if (kind === undefined) throw new Error(`Unknown source waveform ${wave.func}`);
  return { kind, base: wave.base, amplitude: wave.amplitude, phase: wave.phase, frequency: wave.frequency };
}

/** Retains parsed stages independently of FinishShader's optional pass collapse. */
export function shaderRenderMaterial(definition: ShaderDefinition): Extract<RenderMaterial, { readonly kind: "q3" }> {
  const stages: ShaderStage[] = definition.stages.map(stage => {
    const modifiers: TexCoordModifier[] = stage.tcMods.map(modifier => modifier.kind === "transform"
      ? { kind: "transform", matrix: [modifier.m00, modifier.m01, modifier.m10, modifier.m11], translation: modifier.translation }
      : modifier);
    return { map: stage.map, blend: stage.blend, depthTest: stage.depthFunc, depthWrite: stage.depthWrite,
      alphaTest: stage.alphaFunc, detail: stage.detail, color: stage.rgbGen, alpha: stage.alphaGen,
      coordinates: stage.tcGen, modifiers, sourceState: { ...stage.sourceState,
        rgbWave: semanticWave(stage.sourceState.rgbWave), alphaWave: semanticWave(stage.sourceState.alphaWave) } };
  });
  return { kind: "q3", name: definition.name, stages, deformations: definition.deforms,
    surfaceParameters: definition.surfaceParms, sort: definition.sort, cull: definition.cull,
    polygonOffset: definition.polygonOffset, noMipmaps: definition.noMipMaps, noPicmip: definition.noPicMip,
    entityMergeable: definition.entityMergable, portalRange: definition.portalRange, clampTime: definition.clampTime,
    sky: definition.sky, fog: definition.fog, sun: definition.sun };
}

export async function compileShaderScript(text: string, host: ShaderRegistrationHost, options: {
  readonly source?: string; readonly lightmapIndex?: number; readonly profile?: FinishShaderProfile;
} = {}): Promise<readonly CompiledMaterial[]> {
  const inspection = inspectShaderScript(text, options.source ?? "<shader>"), materials: CompiledMaterial[] = [];
  for (const entry of inspection.entries) {
    const registered = await entry.program.register(host);
    const finished = finishShader({ definition: registered.definition, images: registered.stages,
      lightmapIndex: options.lightmapIndex ?? -1, profile: options.profile ?? DEFAULT_SHADER_PROFILE });
    materials.push({ registered, finished, material: shaderRenderMaterial(registered.definition) });
  }
  return materials;
}

export interface SurfaceParameterFlags { readonly surface: number; readonly contents: number; readonly clearSolid: boolean; }
const surfaceFlags: Readonly<Record<string, number>> = {
  nodamage: 1, slick: 2, sky: 4, ladder: 8, noimpact: 0x10, nomarks: 0x20, flesh: 0x40,
  nodraw: 0x80, hint: 0x100, nolightmap: 0x400, pointlight: 0x800, metalsteps: 0x1000,
  nosteps: 0x2000, nonsolid: 0x4000, lightfilter: 0x8000, alphashadow: 0x10000, nodlight: 0x20000, dust: 0x40000,
};
const contentFlags: Readonly<Record<string, number>> = {
  lava: 8, slime: 16, water: 32, fog: 64, areaportal: 0x8000, playerclip: 0x10000,
  monsterclip: 0x20000, clusterportal: 0x100000, donotenter: 0x200000, origin: 0x1000000,
  detail: 0x8000000, structural: 0x10000000, trans: 0x20000000, nodrop: 0x80000000,
};
const nonSolid = new Set(["water", "slime", "lava", "playerclip", "monsterclip", "nodrop", "nonsolid", "origin", "areaportal", "clusterportal", "donotenter", "fog"]);

/** tr_shader.c retains clearSolid metadata but does not clear renderer contents. */
export function shaderSurfaceFlags(parameters: readonly string[]): SurfaceParameterFlags {
  let surface = 0, contents = 0, clearSolid = false;
  for (const parameter of parameters) {
    const key = parameter.toLowerCase();
    surface |= surfaceFlags[key] ?? 0; contents |= contentFlags[key] ?? 0;
    clearSolid ||= nonSolid.has(key);
  }
  return { surface: surface >>> 0, contents: contents >>> 0, clearSolid };
}

/** Implicit shaders retain the same definition and registered bundles as scripts. */
export function compileImplicitMaterial(input: FinishImplicitShaderInput): CompiledMaterial {
  const prepared = implicitShaderInput(input);
  const registered: RegisteredExplicitShader = { kind: "defined", definition: prepared.definition, stages: prepared.images, sky: null };
  return { registered, finished: finishShader(prepared), material: shaderRenderMaterial(prepared.definition) };
}
