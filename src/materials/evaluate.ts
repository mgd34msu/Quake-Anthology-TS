/* Ordered Q3 stage evaluation adapted from tr_shade.c and tr_shade_calc.c.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Vec2, Vec3, Vec4 } from "../contracts/math.ts";
import type { BatchFog, DrawBatch, RenderState, TextureBinding, RendererImage } from "../contracts/render.ts";
import type { CompiledMaterial } from "./compile.ts";
import { animatedPictureIndex, evaluateStageColor } from "./color.ts";
import type { StageColorContext } from "./color.ts";
import { projectDlightTexture, receivesProjectedDlights } from "./dlight.ts";
import type { DynamicLight } from "./q3-lighting.ts";
import { deformGeometry } from "./deform.ts";
import type { DeformView, ProjectionShadowContext } from "./deform.ts";
import { attenuateFogColor, fogPassState } from "./fog.ts";
import type { FogAdjustment } from "./fog.ts";
import { MaterialDeformState } from "./geometry.ts";
import type { MaterialGeometry, MaterialVertex } from "./geometry.ts";
import { evaluateTexCoords, SourceColorGenerator, SourceTexCoordGenerator, stageState } from "./material.ts";
import { sourceMaterialIterator, type FinishedIteratorStage } from "./material-iterator.ts";
import type { BatchLighting } from "../contracts/render.ts";
import { sourceStateChanges } from "./source-state.ts";

export interface MaterialDrawContext extends Omit<StageColorContext, "time" | "previousColor"> {
  readonly time: number;
  readonly timeOffset: number;
  readonly refdefTime: number;
  readonly shaderTexCoord: Vec2;
  readonly deformView: DeformView;
  readonly projectionShadow: ProjectionShadowContext | null;
  readonly renderText: readonly string[];
  readonly dynamicLights?: { readonly lights: readonly DynamicLight[]; readonly mask: number; readonly image: RendererImage };
  /** Scene-owned masks and resources, evaluated on the deformed vertices. */
  readonly dynamicLightBatches?: (geometry: MaterialGeometry) => readonly DrawBatch[];
  readonly modelLighting?: (geometry: MaterialGeometry) => Extract<BatchLighting, { readonly kind: "q2-world" }> & { readonly pass: "model" };
  readonly lightmapLighting?: (geometry: MaterialGeometry) => Extract<BatchLighting, { readonly kind: "q2-world" }>;
  readonly depthRange: RenderState["depthRange"];
  readonly polygonOffset: RenderState["polygonOffset"];
  readonly q1Fog?: { readonly density: number; readonly color: Vec3; readonly texture: TextureBinding };
  readonly fog: { readonly coordinates: (position: Vec3) => Vec2; readonly texture: TextureBinding; readonly color: Vec4 } | null;
  project(position: Vec3): Vec4;
}

function textureBinding(bundle: Extract<FinishedIteratorStage, { readonly active: true }>, time: number): TextureBinding {
  const binding = bundle.binding;
  if (binding.kind === "retain-current-texture") return binding;
  if (binding.kind === "video") {
    return { kind: "dynamic-image", source: binding.source };
  }
  const playback = binding.playback;
  if (playback.kind === "single") return { kind: "bind-image", image: playback.image.image };
  const image = playback.frames[animatedPictureIndex(time, playback.frequency, playback.frames.length)];
  if (image === undefined) throw new Error("Animation frame is outside the registered image bundle");
  return { kind: "bind-image", image: image.image };
}

function coordinates(bundle: FinishedIteratorStage, vertex: MaterialVertex, time: number, context: MaterialDrawContext): Vec2 {
  let generator = bundle.stage.tcGen, input = vertex.texCoord;
  switch (bundle.tcGen) {
    case SourceTexCoordGenerator.Bad: throw new Error("Uninitialized source texture coordinates need retained tess storage");
    case SourceTexCoordGenerator.Identity: input = { x: 0, y: 0 }; generator = { kind: "texture" }; break;
    case SourceTexCoordGenerator.Texture: generator = { kind: "texture" }; break;
    case SourceTexCoordGenerator.Lightmap: generator = { kind: "lightmap" }; break;
    case SourceTexCoordGenerator.EnvironmentMapped: generator = { kind: "environment" }; break;
    case SourceTexCoordGenerator.Fog:
      if (context.fog === null) throw new Error("Fog texture coordinates require the current volume");
      input = context.fog.coordinates(vertex.position); generator = { kind: "texture" }; break;
    case SourceTexCoordGenerator.Vector:
      if (generator.kind !== "vector") throw new Error("Vector texture coordinates lost source projection vectors");
      break;
  }
  return evaluateTexCoords({ ...bundle.stage, tcGen: generator }, input, vertex.position, vertex.normal, time,
    { lightmap: vertex.lightmapCoord, viewOrigin: context.localViewOrigin, shaderTexCoord: context.shaderTexCoord });
}

function retainedState(bits: number, initial: RenderState): RenderState {
  let result = initial;
  for (const change of sourceStateChanges(null, bits)) {
    switch (change.kind) {
      case "depth-function": result = { ...result, depthTest: change.value }; break;
      case "blend": result = { ...result, blend: change.enabled
        ? { source: change.source, destination: change.destination } : { source: "one", destination: "zero" } }; break;
      case "depth-write": result = { ...result, depthWrite: change.value }; break;
      case "depth-test": if (!change.enabled) result = { ...result, depthTest: "always", depthWrite: false }; break;
      case "alpha-test": result = { ...result, alphaTest: change.value }; break;
      case "polygon-mode": if (change.value === "line") throw new Error("Material polygon-line state requires explicit line geometry"); break;
    }
  }
  return result;
}

/** Invoke per draw at execution time. Sky surfaces require the sky geometry path. */
export function prepareMaterialBatches(compiled: CompiledMaterial, input: MaterialGeometry, context: MaterialDrawContext): readonly DrawBatch[] {
  if (compiled.finished.iterator.kind === "sky") throw new Error("Sky materials require sky-box/cloud geometry preparation before ordinary stage evaluation");
  return evaluateMaterialPasses(compiled, input, context);
}

/** Sky frontend may call this after generating the source cloud coordinates. */
export function evaluateMaterialPasses(compiled: CompiledMaterial, input: MaterialGeometry, context: MaterialDrawContext): readonly DrawBatch[] {
  const definition = compiled.registered.definition;
  let time = context.time - context.timeOffset;
  if (definition.clampTime !== 0 && time >= definition.clampTime) time = definition.clampTime;
  time = Math.fround(time);
  const state = new MaterialDeformState(input, context.refdefTime, context.renderText, definition);
  const geometry = deformGeometry(state, definition.deforms, context.deformView, time, context.noise, context.projectionShadow);
  const batches: DrawBatch[] = [];
  const previousColors: Vec4[] = geometry.vertices.map(() => ({ x: 0, y: 0, z: 0, w: 0 }));
  const lightmapLighting = context.lightmapLighting !== undefined && compiled.finished.hasLightmapStage ? context.lightmapLighting(geometry) : null;
  const modelLighting = context.modelLighting !== undefined && compiled.finished.sourceStages.some(stage => stage.rgbGen === SourceColorGenerator.LightingDiffuse) ? context.modelLighting(geometry) : null;
  const iterator = lightmapLighting === null && modelLighting === null ? compiled.finished.iterator : sourceMaterialIterator({ stages: compiled.finished.sourceStages,
    sky: definition.sky !== null, polygonOffset: definition.polygonOffset, deformCount: definition.deforms.length },
    { ignoreFastPath: true, multitexture: false, textureEnvAdd: false, driver: "generic" });
  for (const pass of iterator.passes) {
    const first = pass.bundles[0], second = pass.bundles[1];
    if (!first.active) continue;
    const renderState = retainedState(pass.stateBits, { ...stageState(pass.stage, definition.cull), depthRange: context.depthRange,
      polygonOffset: definition.polygonOffset ? context.polygonOffset : null });
    const texture = textureBinding(first, time);
    const adjustment: FogAdjustment = pass.fogAdjustment;
    const q1Fog = context.q1Fog;
    const fragmentFog = q1Fog === undefined || q1Fog.density <= 0 ? {} : { fog: { kind: "exp2", density: q1Fog.density, color: q1Fog.color, effect: adjustment } satisfies BatchFog };
    const vertices = geometry.vertices.map((vertex, index) => {
      const previousColor = previousColors[index] ?? { x: 0, y: 0, z: 0, w: 0 };
      let color = evaluateStageColor(pass.stage, vertex, { ...context, time, previousColor }, pass.alphaGen === "skip", pass.rgbGen);
      if (context.fog !== null) color = attenuateFogColor(color, adjustment, context.fog.coordinates(vertex.position));
      previousColors[index] = color;
      return { position: context.project(vertex.position), color, texCoord: coordinates(first, vertex, time, context) };
    });
    if (second === undefined) {
      batches.push({ lighting: first.isLightmap && lightmapLighting !== null ? { ...lightmapLighting, pass: "material-lightmap" }
        : pass.rgbGen === SourceColorGenerator.LightingDiffuse && modelLighting !== null ? modelLighting : { kind: "vertex" },
        ...fragmentFog, primitive: "triangles", texturing: "single", state: renderState, texture, indices: geometry.indices, vertices });
    } else {
      if (!second.active) throw new Error("Collapsed stage lost its second registered texture");
      const secondTexture = textureBinding(second, time);
      const paired = vertices.map((vertex, index) => {
        const source = geometry.vertices[index];
        if (source === undefined) throw new Error("Material vertex indexing escaped the source geometry");
        return { ...vertex, texCoord2: coordinates(second, source, time, context) };
      });
      batches.push({ ...fragmentFog, lighting: { kind: "vertex" }, primitive: "triangles", texturing: "pair", state: renderState, texture, indices: geometry.indices,
        vertices: paired, secondTexture: { binding: secondTexture,
          environment: iterator.multitextureEnv === "add" ? "add" : "modulate" } });
    }
  }
  if (context.dynamicLightBatches !== undefined && receivesProjectedDlights(compiled)) {
    batches.push(...context.dynamicLightBatches(geometry));
  } else if (context.dynamicLights !== undefined && receivesProjectedDlights(compiled)) {
    const dynamic = context.dynamicLights;
    for (const batch of projectDlightTexture(geometry, dynamic.mask, dynamic.lights, dynamic.image, context.project, definition.cull))
      batches.push({ ...batch, state: { ...batch.state, depthRange: context.depthRange,
        polygonOffset: definition.polygonOffset ? context.polygonOffset : null } });
  }
  const fog = context.fog;
  if (fog !== null && compiled.finished.fogPass !== "none") {
    batches.push({ lighting: { kind: "vertex" }, primitive: "triangles", texturing: "single", texture: fog.texture, indices: geometry.indices,
      state: { ...fogPassState(compiled.finished.fogPass, definition.cull), depthRange: context.depthRange,
        polygonOffset: definition.polygonOffset ? context.polygonOffset : null },
      vertices: geometry.vertices.map(vertex => ({ position: context.project(vertex.position), texCoord: fog.coordinates(vertex.position), color: fog.color })) });
  }
  const q1Fog = context.q1Fog;
  if (q1Fog !== undefined && q1Fog.density > 0) {
    for (let index = 0; index < batches.length; index++) {
      const batch = batches[index];
      if (batch !== undefined && batch.fog === undefined) batches[index] = { ...batch, fog: { kind: "exp2", density: q1Fog.density, color: q1Fog.color, effect: "none" } };
    }
    if (compiled.finished.fogPass !== "none") batches.push({ lighting: { kind: "vertex" }, primitive: "triangles", texturing: "single",
      texture: q1Fog.texture, indices: geometry.indices,
      fog: { kind: "exp2", density: q1Fog.density, color: q1Fog.color, effect: "overlay" },
      state: { ...fogPassState(compiled.finished.fogPass, definition.cull), depthRange: context.depthRange,
        polygonOffset: definition.polygonOffset ? context.polygonOffset : null },
      vertices: geometry.vertices.map(vertex => ({ position: context.project(vertex.position), texCoord: { x: 0, y: 0 }, color: { x: 1, y: 1, z: 1, w: 1 } })) });
  }
  return batches;
}
