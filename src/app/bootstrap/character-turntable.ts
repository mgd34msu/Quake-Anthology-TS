import type { ContentId, GameFamily, ResourceId } from "../../contracts/content.ts";
import { createMountPlanId } from "../../contracts/content.ts";
import type { ImageLevel, Palette, RenderState, RendererImage } from "../../contracts/render.ts";
import type { Vec2, Vec3 } from "../../contracts/math.ts";
import type { ModelFrame, ModelTransform, Q3MeshModel } from "../../contracts/scene.ts";
import type { InstalledCatalog } from "../../content/catalog/index.ts";
import { openMountPlan, type MountedContent, type OpenedResource } from "../../content/mounts/index.ts";
import { rgbaImage, SceneImageRegistry } from "../../render/scene/resources.ts";
import type { ImagePicture } from "../../text/draw2d.ts";
import { buildMd2Geometry, buildMdlGeometry, parseMd2, parseMdl, sampleTimedFrame } from "../../formats/q12-model/index.ts";
import { decodeBmp, decodeGif, decodeJpeg, decodePalette, decodePcx, decodePng, decodeQ3Tga, decodeTga,
  expandIndexedImage, indexedRenderImage, q1PlayerTranslation } from "../../formats/images/index.ts";
import { floodSkin } from "../../render/scene/skin.ts";
import { loadQ3Character, type Q3CharacterPart } from "../../content/q3/foundation/assets.ts";
import { PlayerAnimation } from "../../movement/q3/constants.ts";
import { composeModelTransform, modelWorldDirection, modelWorldPoint } from "../../render/scene/models/transform.ts";
import { inspectShaderScript, stripShaderExtension, type ParsedShaderStage, type ShaderDefinition } from "../../materials/material.ts";
import type { StartupCharacterPreview } from "./startup-selection.ts";

export interface CharacterTurntableRequest extends StartupCharacterPreview {}

export interface CharacterTurntableView {
  readonly resource: ResourceId;
  request(preview: CharacterTurntableRequest, nowMilliseconds: number): ResourceId;
  picture(resource: ResourceId): ImagePicture | null;
}

interface TurntableTexture {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly alphaTest: RenderState["alphaTest"];
}
interface TurntableVertex {
  readonly position: Vec3;
  readonly normal: Vec3;
  readonly texCoord: Vec2;
  readonly texture: number;
}
export interface CharacterTurntableScene {
  readonly vertices: readonly TurntableVertex[];
  readonly indices: readonly number[];
  readonly textures: readonly TurntableTexture[];
  readonly center: Vec3;
  readonly radius: number;
  readonly halfHeight: number;
  readonly floorZ: number;
  readonly initialYaw: number;
}

const TURNTABLE_WIDTH = 288;
const TURNTABLE_HEIGHT = 384;
const TURNTABLE_FRAME_MILLISECONDS = 40;
const TURNTABLE_ROTATION_MILLISECONDS = 9000;
const IDENTITY: ModelTransform = {
  origin: { x: 0, y: 0, z: 0 },
  axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
  scale: { x: 1, y: 1, z: 1 },
};

function at<T>(values: readonly T[], index: number, label: string): T {
  const value = values[index];
  if (value === undefined) throw new RangeError(`Missing ${label} ${index}`);
  return value;
}

function missingTexture(): TurntableTexture {
  const width = 16, height = 16, pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    pixels.set(((x + y) & 1) === 0 ? [72, 72, 78, 255] : [38, 38, 44, 255], (y * width + x) * 4);
  return { width, height, pixels, alphaTest: "none" };
}

function finishScene(vertices: TurntableVertex[], indices: number[], textures: TurntableTexture[], initialYaw = 0.85): CharacterTurntableScene {
  if (vertices.length === 0 || indices.length < 3) throw new Error("Character model has no preview geometry");
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const vertex of vertices) {
    minX = Math.min(minX, vertex.position.x); minY = Math.min(minY, vertex.position.y); minZ = Math.min(minZ, vertex.position.z);
    maxX = Math.max(maxX, vertex.position.x); maxY = Math.max(maxY, vertex.position.y); maxZ = Math.max(maxZ, vertex.position.z);
  }
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
  let radius = 1;
  for (const vertex of vertices) radius = Math.max(radius, Math.hypot(vertex.position.x - center.x, vertex.position.y - center.y));
  return { vertices, indices, textures, center, radius, halfHeight: Math.max(1, (maxZ - minZ) / 2), floorZ: minZ, initialYaw };
}

async function firstOpen(mounts: MountedContent, paths: readonly string[]): Promise<OpenedResource | null> {
  for (const path of paths) {
    const opened = await mounts.open(path);
    if (opened !== null && opened.bytes.length !== 0) return opened;
  }
  return null;
}

async function requiredOpen(mounts: MountedContent, paths: readonly string[]): Promise<OpenedResource> {
  const opened = await firstOpen(mounts, paths);
  if (opened === null) throw new Error(`Character preview resource missing: ${paths.join(", ")}`);
  return opened;
}

async function loadPalette(mounts: MountedContent, family: "q1" | "q2"): Promise<Palette> {
  const path = family === "q1" ? "gfx/palette.lmp" : "pics/colormap.pcx";
  const opened = await requiredOpen(mounts, [path]);
  if (family === "q1") return decodePalette(opened.bytes, opened.reference);
  const colors = decodePcx(opened.bytes, path).palette;
  if (colors === null) throw new Error("Quake II colormap has no palette");
  return { colors, source: opened.reference };
}

function decodeImage(bytes: Uint8Array, path: string, family: GameFamily,
  alphaTest: RenderState["alphaTest"] = "none"): TurntableTexture {
  const suffix = path.slice(path.lastIndexOf(".")).toLowerCase();
  if (suffix === ".pcx") {
    const pcx = decodePcx(bytes, path);
    if (pcx.palette === null) throw new Error(`PCX has no palette: ${path}`);
    const pixels = new Uint8Array(pcx.width * pcx.height * 4);
    for (const [offset, index] of pcx.indices.entries())
      pixels.set([pcx.palette[index * 3] ?? 0, pcx.palette[index * 3 + 1] ?? 0, pcx.palette[index * 3 + 2] ?? 0,
        family !== "q3" && index === 255 ? 0 : 255], offset * 4);
    return { width: pcx.width, height: pcx.height, pixels, alphaTest };
  }
  const image = suffix === ".tga" ? family === "q3" ? decodeQ3Tga(bytes, path) : decodeTga(bytes, path)
    : suffix === ".jpg" || suffix === ".jpeg" ? decodeJpeg(bytes, path)
    : suffix === ".png" ? decodePng(bytes, path)
    : suffix === ".bmp" ? decodeBmp(bytes, path)
    : suffix === ".gif" ? decodeGif(bytes, path).frames[0].image
    : null;
  if (image === null) throw new Error(`Unsupported character texture format: ${path}`);
  if (family !== "q3" || alphaTest !== "none") return { width: image.width, height: image.height, pixels: image.pixels, alphaTest };
  // Q3 implicit diffuse shaders do not alpha-test; diffuse alpha is ancillary.
  const pixels = new Uint8Array(image.pixels);
  for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255;
  return { width: image.width, height: image.height, pixels, alphaTest };
}

async function loadDirectTexture(mounts: MountedContent, shader: string, family: GameFamily,
  alphaTest: RenderState["alphaTest"] = "none"): Promise<TurntableTexture> {
  const normalized = shader.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalized === "") return missingTexture();
  const variants = [normalized];
  // Retail Tim team skins point at an older medium/ directory whose textures
  // shipped beside the final model instead.
  if (normalized.startsWith("models/players/medium/"))
    variants.push(normalized.replace("models/players/medium/", "models/players/"));
  const candidates = variants.flatMap(path => {
    const explicit = path.lastIndexOf(".") > path.lastIndexOf("/");
    if (!explicit) return [".tga", ".jpg", ".png", ".jpeg", ".pcx", ".bmp", ".gif"].map(extension => `${path}${extension}`);
    // Q3 image lookup substitutes supported extensions for shader map names.
    const stem = path.slice(0, path.lastIndexOf("."));
    return [path, ...[".tga", ".jpg", ".png", ".jpeg", ".pcx", ".bmp", ".gif"]
      .map(extension => `${stem}${extension}`).filter(candidate => candidate !== path)];
  });
  const opened = await firstOpen(mounts, candidates);
  if (opened === null) return missingTexture();
  try { return decodeImage(opened.bytes, opened.reference.requestedPath, family, alphaTest); }
  catch { return missingTexture(); }
}

function byteText(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

function shaderKey(name: string): string {
  return stripShaderExtension(name.replaceAll("\\", "/").replace(/^\/+/, "")).toLowerCase();
}

const q3ShaderCatalogs = new WeakMap<MountedContent, Promise<ReadonlyMap<string, ShaderDefinition>>>();
async function q3Shaders(mounts: MountedContent): Promise<ReadonlyMap<string, ShaderDefinition>> {
  const cached = q3ShaderCatalogs.get(mounts);
  if (cached !== undefined) return cached;
  const pending = (async (): Promise<ReadonlyMap<string, ShaderDefinition>> => {
    const definitions = new Map<string, ShaderDefinition>();
    const files = await mounts.listFiles("scripts", ".shader").catch((): readonly string[] => []);
    for (const file of files) {
      const opened = await mounts.open(`scripts/${file.replaceAll("\\", "/")}`);
      if (opened === null) continue;
      let entries: ReturnType<typeof inspectShaderScript>["entries"];
      try { entries = inspectShaderScript(byteText(opened.bytes), opened.reference.requestedPath).entries; }
      catch { continue; }
      for (const entry of entries) {
        const definition = entry.textResult.kind === "accepted" ? entry.textResult.definition : entry.textResult.partial;
        const key = shaderKey(definition.name);
        if (!definitions.has(key)) definitions.set(key, definition);
      }
    }
    return definitions;
  })();
  q3ShaderCatalogs.set(mounts, pending);
  return pending;
}

function stageImageName(stage: ParsedShaderStage): string | null {
  if (stage.map.kind === "image") return stage.map.name;
  if (stage.map.kind === "animation") return stage.map.frames[0] ?? null;
  return null;
}

async function loadTexture(mounts: MountedContent, shader: string, family: GameFamily): Promise<TurntableTexture | null> {
  if (family !== "q3") return loadDirectTexture(mounts, shader, family);
  const normalized = shader.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalized === "") return missingTexture();
  const definition = (await q3Shaders(mounts)).get(shaderKey(normalized));
  if (definition === undefined) return loadDirectTexture(mounts, normalized, family);
  if (definition.surfaceParms.includes("nodraw")) return null;
  const imageStages = definition.stages.flatMap(stage => {
    const name = stageImageName(stage);
    return name === null ? [] : [{ stage, name }];
  });
  const additive = (stage: ParsedShaderStage): boolean =>
    stage.blend.destination === "one" && (stage.blend.source === "one" || stage.blend.source === "src-alpha");
  const baseStages = imageStages.filter(({ stage }) => stage.tcGen.kind === "texture" && !additive(stage));
  const chosen = baseStages.at(-1) ?? imageStages[0];
  if (chosen !== undefined) return loadDirectTexture(mounts, chosen.name, family, chosen.stage.alphaFunc);
  if (definition.stages.some(stage => stage.map.kind === "whiteimage"))
    return { width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]), alphaTest: "none" };
  return missingTexture();
}

function q1Frame(model: ReturnType<typeof parseMdl>): ModelFrame {
  const frames = model.frames.flatMap(set => set.kind === "single" ? [set.frame] : set.frames.map(item => item.frame));
  return frames.find(frame => frame.name.toLowerCase().startsWith("stand")) ?? at(frames, 0, "Q1 frame");
}

async function loadQ1Scene(mounts: MountedContent, request: CharacterTurntableRequest): Promise<CharacterTurntableScene> {
  const [modelAsset, palette] = await Promise.all([
    requiredOpen(mounts, ["progs/player.mdl"]),
    loadPalette(mounts, "q1"),
  ]);
  const model = parseMdl(modelAsset.bytes, modelAsset.reference.requestedPath);
  const geometry = buildMdlGeometry(model, q1Frame(model).vertices);
  const skin = sampleTimedFrame(at(model.skins, 0, "Q1 skin"), 0);
  const texture = expandIndexedImage(indexedRenderImage(
    [{ width: model.skinWidth, height: model.skinHeight, pixels: floodSkin(skin, model.skinWidth, model.skinHeight, palette) }],
    palette, { kind: "opaque" }, null, q1PlayerTranslation(request.topColor, request.bottomColor)));
  return finishScene(geometry.vertices.map(vertex => ({ ...vertex, texture: 0 })), [...geometry.indices], [{ ...texture, alphaTest: "gt0" }], -0.55);
}

async function q2Skin(mounts: MountedContent, model: string, skin: string, modelSkins: readonly string[]): Promise<OpenedResource> {
  const known = model.toLowerCase() === "female" ? "athena" : model.toLowerCase() === "cyborg" ? "oni911" : "grunt";
  const candidates = skin !== "" ? [`players/${model}/${skin}.pcx`]
    : [...modelSkins.filter(path => path.trim() !== ""), `players/${model}/${known}.pcx`, `players/${model}/grunt.pcx`, `players/${model}/skin.pcx`];
  const selected = await firstOpen(mounts, candidates);
  if (selected !== null) return selected;
  const listed = (await mounts.listFiles(`players/${model}`, ".pcx"))
    .map(name => name.split(/[\\/]/).at(-1) ?? name)
    .filter(name => !name.toLowerCase().endsWith("_i.pcx") && name.toLowerCase() !== "weapon.pcx")
    .sort();
  const fallback = listed[0];
  if (fallback !== undefined) {
    const opened = await mounts.open(`players/${model}/${fallback}`);
    if (opened !== null) return opened;
  }
  return requiredOpen(mounts, candidates);
}

async function loadQ2Scene(mounts: MountedContent, request: CharacterTurntableRequest): Promise<CharacterTurntableScene> {
  const modelAsset = await requiredOpen(mounts, [`players/${request.model}/tris.md2`]);
  const model = parseMd2(modelAsset.bytes, modelAsset.reference.requestedPath);
  const [palette, skinAsset] = await Promise.all([
    loadPalette(mounts, "q2"),
    q2Skin(mounts, request.model, request.skin, model.skins),
  ]);
  const frame = model.frames.find(candidate => candidate.name.toLowerCase().startsWith("stand")) ?? at(model.frames, 0, "Q2 frame");
  const geometry = buildMd2Geometry(model, frame.vertices);
  const pcx = decodePcx(skinAsset.bytes, skinAsset.reference.requestedPath);
  const texture = expandIndexedImage(indexedRenderImage(
    [{ width: pcx.width, height: pcx.height, pixels: floodSkin(pcx.indices, pcx.width, pcx.height, palette) }],
    palette, { kind: "index", index: 255 }));
  return finishScene(geometry.vertices.map(vertex => ({ ...vertex, texture: 0 })), [...geometry.indices], [{ ...texture, alphaTest: "gt0" }]);
}

function animationFrame(model: Q3MeshModel, firstFrame: number | undefined): number {
  if (model.frames.length === 0) throw new Error("Q3 character part has no frames");
  return Math.max(0, Math.min(model.frames.length - 1, Math.trunc(firstFrame ?? 0)));
}

async function loadQ3Scene(mounts: MountedContent, request: CharacterTurntableRequest): Promise<CharacterTurntableScene> {
  const skin = request.skin || "default";
  const assets = await loadQ3Character(mounts, { model: request.model, skin, headModel: "", headSkin: skin, team: null, teamName: "" });
  const textures: TurntableTexture[] = [], textureCache = new Map<string, number | null>();
  const textureIndex = async (shader: string): Promise<number | null> => {
    const existing = textureCache.get(shader);
    if (existing !== undefined) return existing;
    const loaded = await loadTexture(mounts, shader, "q3");
    if (loaded === null) { textureCache.set(shader, null); return null; }
    const index = textures.length;
    textureCache.set(shader, index);
    textures.push(loaded);
    return index;
  };
  const vertices: TurntableVertex[] = [], indices: number[] = [];
  const appendPart = async (part: Q3CharacterPart, frame: number, transform: ModelTransform): Promise<void> => {
    for (const surface of part.model.surfaces) {
      const shader = part.surfaces.find(candidate => candidate.name === surface.name)?.shader
        ?? part.surfaces.find(candidate => candidate.name === `${surface.name}_t`)?.shader
        ?? part.surfaces.find(candidate => candidate.name === surface.name.replace(/_t$/, ""))?.shader
        ?? surface.shaders[0] ?? "";
      const texture = await textureIndex(shader);
      if (texture === null) continue;
      const base = vertices.length;
      const frameVertices = at(surface.frames, frame, "Q3 surface frame");
      for (const [index, vertex] of frameVertices.entries()) vertices.push({
        position: modelWorldPoint(transform, vertex.position),
        normal: modelWorldDirection(transform, vertex.normal),
        texCoord: at(surface.textureCoordinates, index, "Q3 UV"),
        texture,
      });
      for (const index of surface.indices) indices.push(base + index);
    }
  };
  const legsFrame = animationFrame(assets.lower.model, assets.animation.animations[PlayerAnimation.LEGS_IDLE]?.firstFrame);
  const torsoFrame = animationFrame(assets.upper.model, assets.animation.animations[PlayerAnimation.TORSO_STAND]?.firstFrame);
  await appendPart(assets.lower, legsFrame, IDENTITY);
  const torsoTag = assets.lower.model.tags[legsFrame]?.find(tag => tag.name === "tag_torso");
  const torsoTransform: ModelTransform = torsoTag === undefined ? IDENTITY : { origin: torsoTag.origin, axis: torsoTag.axis, scale: { x: 1, y: 1, z: 1 } };
  await appendPart(assets.upper, torsoFrame, torsoTransform);
  const headTag = assets.upper.model.tags[torsoFrame]?.find(tag => tag.name === "tag_head");
  const headTransform = headTag === undefined ? torsoTransform
    : composeModelTransform(torsoTransform, { origin: headTag.origin, axis: headTag.axis, scale: { x: 1, y: 1, z: 1 } });
  await appendPart(assets.head, 0, headTransform);
  return finishScene(vertices, indices, textures);
}

export async function loadCharacterTurntableScene(mounts: MountedContent, request: CharacterTurntableRequest): Promise<CharacterTurntableScene> {
  if (request.model.trim() === "") throw new Error("Character preview has no model");
  return request.family === "q1" ? loadQ1Scene(mounts, request)
    : request.family === "q2" ? loadQ2Scene(mounts, request)
    : loadQ3Scene(mounts, request);
}

interface ProjectedVertex {
  readonly x: number; readonly y: number; readonly q: number;
  readonly u: number; readonly v: number;
  readonly nx: number; readonly ny: number; readonly nz: number;
  readonly texture: number;
}

function sampleTexture(texture: TurntableTexture, u: number, v: number, output: [number, number, number, number]): void {
  const wrappedU = u - Math.floor(u), wrappedV = v - Math.floor(v);
  const px = wrappedU * texture.width - 0.5, py = wrappedV * texture.height - 0.5;
  const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
  const wrap = (value: number, size: number): number => ((value % size) + size) % size;
  const xs = [wrap(x0, texture.width), wrap(x0 + 1, texture.width)], ys = [wrap(y0, texture.height), wrap(y0 + 1, texture.height)];
  output[0] = 0; output[1] = 0; output[2] = 0; output[3] = 0;
  for (let row = 0; row < 2; row++) for (let column = 0; column < 2; column++) {
    const weight = (column === 0 ? 1 - fx : fx) * (row === 0 ? 1 - fy : fy);
    const offset = ((ys[row] ?? 0) * texture.width + (xs[column] ?? 0)) * 4;
    for (let channel = 0; channel < 4; channel++) output[channel] = (output[channel] ?? 0) + (texture.pixels[offset + channel] ?? 0) * weight;
  }
}

export function renderCharacterTurntable(scene: CharacterTurntableScene, yawRadians: number,
  width = TURNTABLE_WIDTH, height = TURNTABLE_HEIGHT): ImageLevel {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new RangeError("Invalid turntable dimensions");
  const pixels = new Uint8Array(width * height * 4), depths = new Float32Array(width * height).fill(-Infinity);
  const cos = Math.cos(yawRadians), sin = Math.sin(yawRadians), pitch = 0.18;
  const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch);
  const verticalExtent = scene.halfHeight * cosPitch + scene.radius * sinPitch;
  const scale = Math.min(width * 0.44 / scene.radius, height * 0.47 / verticalExtent);
  const cameraDistance = Math.max(80, scene.radius * 4.5, scene.halfHeight * 3);
  const projectPoint = (position: Vec3): { readonly x: number; readonly y: number; readonly q: number; readonly perspective: number } => {
    const dx = position.x - scene.center.x, dy = position.y - scene.center.y, dz = position.z - scene.center.z;
    const forward = dx * cos - dy * sin, right = dx * sin + dy * cos;
    const up = dz * cosPitch - forward * sinPitch, toward = forward * cosPitch + dz * sinPitch;
    const perspective = cameraDistance / Math.max(1, cameraDistance - toward);
    return { x: width / 2 + right * scale * perspective, y: height * 0.52 - up * scale * perspective,
      q: perspective / cameraDistance, perspective };
  };
  const floor = projectPoint({ x: scene.center.x, y: scene.center.y, z: scene.floorZ });
  const floorRadiusX = scene.radius * 1.10 * scale * floor.perspective;
  const floorRadiusY = Math.max(5, floorRadiusX * 0.24);
  for (let y = Math.max(0, Math.floor(floor.y - floorRadiusY)); y <= Math.min(height - 1, Math.ceil(floor.y + floorRadiusY)); y++)
    for (let x = Math.max(0, Math.floor(floor.x - floorRadiusX)); x <= Math.min(width - 1, Math.ceil(floor.x + floorRadiusX)); x++) {
      const ellipse = ((x + 0.5 - floor.x) / floorRadiusX) ** 2 + ((y + 0.5 - floor.y) / floorRadiusY) ** 2;
      if (ellipse > 1) continue;
      const offset = (y * width + x) * 4;
      if (ellipse > 0.90) pixels.set([176, 118, 52, 150], offset);
      else pixels.set([5, 8, 12, Math.trunc(105 * (1 - ellipse * 0.45))], offset);
    }
  const projected: ProjectedVertex[] = scene.vertices.map(vertex => {
    const point = projectPoint(vertex.position);
    const dx = vertex.normal.x, dy = vertex.normal.y, dz = vertex.normal.z;
    const forward = dx * cos - dy * sin, right = dx * sin + dy * cos;
    return { x: point.x, y: point.y, q: point.q, u: vertex.texCoord.x, v: vertex.texCoord.y,
      nx: right, ny: dz * cosPitch - forward * sinPitch, nz: forward * cosPitch + dz * sinPitch, texture: vertex.texture };
  });
  const sample: [number, number, number, number] = [0, 0, 0, 0];
  for (let index = 0; index + 2 < scene.indices.length; index += 3) {
    const a = projected[at(scene.indices, index, "turntable index")];
    const b = projected[at(scene.indices, index + 1, "turntable index")];
    const c = projected[at(scene.indices, index + 2, "turntable index")];
    if (a === undefined || b === undefined || c === undefined) continue;
    const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(denominator) < 1e-9) continue;
    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))), maxX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))), maxY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
    const texture = scene.textures[a.texture] ?? missingTexture();
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const wa = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / denominator;
      const wb = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / denominator;
      const wc = 1 - wa - wb;
      if (wa < -0.0001 || wb < -0.0001 || wc < -0.0001) continue;
      const q = wa * a.q + wb * b.q + wc * c.q;
      if (q <= 0) continue;
      const pixelIndex = y * width + x;
      if (q <= (depths[pixelIndex] ?? -Infinity)) continue;
      const u = (wa * a.u * a.q + wb * b.u * b.q + wc * c.u * c.q) / q;
      const v = (wa * a.v * a.q + wb * b.v * b.q + wc * c.v * c.q) / q;
      sampleTexture(texture, u, v, sample);
      if (texture.alphaTest === "gt0" && sample[3] <= 0) continue;
      if (texture.alphaTest === "ge128" && sample[3] < 128) continue;
      if (texture.alphaTest === "lt128" && sample[3] >= 128) continue;
      let nx = (wa * a.nx * a.q + wb * b.nx * b.q + wc * c.nx * c.q) / q;
      let ny = (wa * a.ny * a.q + wb * b.ny * b.q + wc * c.ny * c.q) / q;
      let nz = (wa * a.nz * a.q + wb * b.nz * b.q + wc * c.nz * c.q) / q;
      const normalLength = Math.hypot(nx, ny, nz) || 1;
      nx /= normalLength; ny /= normalLength; nz /= normalLength;
      const key = Math.max(0, nx * -0.35 + ny * 0.72 + nz * 0.60);
      const fill = Math.max(0, nx * 0.45 + ny * 0.20 + nz * 0.75);
      const shade = Math.min(1.18, 0.42 + key * 0.62 + fill * 0.28);
      depths[pixelIndex] = q;
      const offset = pixelIndex * 4;
      pixels[offset] = Math.max(0, Math.min(255, Math.trunc(sample[0] * shade)));
      pixels[offset + 1] = Math.max(0, Math.min(255, Math.trunc(sample[1] * shade)));
      pixels[offset + 2] = Math.max(0, Math.min(255, Math.trunc(sample[2] * shade)));
      pixels[offset + 3] = Math.max(0, Math.min(255, Math.trunc(sample[3])));
    }
  }
  return { width, height, pixels };
}

export interface CharacterTurntableOptions {
  readonly catalog: () => InstalledCatalog;
  readonly images: SceneImageRegistry;
  readonly print: (text: string) => undefined;
}

export class CharacterTurntable implements CharacterTurntableView {
  readonly resource: ResourceId = "resource:character-turntable:viewer";
  private readonly image: RendererImage;
  private readonly imagePicture: ImagePicture;
  private readonly mounts = new Map<string, Promise<MountedContent>>();
  private readonly scenes = new Map<string, Promise<CharacterTurntableScene | null>>();
  private readonly failures = new Set<string>();
  private stopAnimation: (() => void) | null = null;
  private desiredKey = "";
  private scene: CharacterTurntableScene | null = null;
  private sceneKey = "";
  private lastRequestedAt = -Infinity;
  private lastRenderedAt = -Infinity;
  private rotationStartedAt: number | null = null;
  private closed = false;

  constructor(private readonly options: CharacterTurntableOptions) {
    this.image = options.images.register("character-turntable", rgbaImage({
      width: TURNTABLE_WIDTH, height: TURNTABLE_HEIGHT,
      pixels: new Uint8Array(TURNTABLE_WIDTH * TURNTABLE_HEIGHT * 4),
    }), { wrap: "clamp", filter: "linear" });
    this.imagePicture = { kind: "image", name: "character-turntable", image: this.image };
    this.stopAnimation = options.images.trackAnimation(this.image, milliseconds => this.tick(milliseconds), () => { this.stopAnimation = null; });
  }

  request(preview: CharacterTurntableRequest, nowMilliseconds: number): ResourceId {
    if (this.closed) return this.resource;
    this.lastRequestedAt = nowMilliseconds;
    let catalog: InstalledCatalog;
    try { catalog = this.options.catalog(); }
    catch { return this.resource; }
    const key = [catalog.generation, preview.product, preview.family, preview.model, preview.skin, preview.topColor, preview.bottomColor].join("\0");
    if (key !== this.desiredKey) {
      this.desiredKey = key;
      this.rotationStartedAt = null;
      void this.load(key, catalog, preview);
    }
    return this.resource;
  }

  picture(resource: ResourceId): ImagePicture | null {
    return resource === this.resource ? this.imagePicture : null;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopAnimation?.();
    this.stopAnimation = null;
    for (const pending of this.mounts.values()) void pending.then(mounted => mounted.close()).catch(() => undefined);
    this.mounts.clear();
    this.scenes.clear();
    if (this.options.images.isResident(this.image)) this.options.images.release(this.image);
  }

  private async mounted(catalog: InstalledCatalog, product: ContentId): Promise<MountedContent> {
    const key = `${catalog.generation}:${product}`;
    const existing = this.mounts.get(key);
    if (existing !== undefined) return existing;
    const pending = (async (): Promise<MountedContent> => {
      const mounts = await catalog.mountsFor(product);
      const revision = `character-${catalog.generation}-${product.replaceAll(/[^a-zA-Z0-9._-]+/g, "-")}`;
      return openMountPlan({ id: createMountPlanId("startup", revision), mounts,
        defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
    })();
    this.mounts.set(key, pending);
    return pending;
  }

  private async load(key: string, catalog: InstalledCatalog, preview: CharacterTurntableRequest): Promise<void> {
    let pending = this.scenes.get(key);
    if (pending === undefined) {
      if (this.scenes.size >= 24) this.scenes.clear();
      pending = (async (): Promise<CharacterTurntableScene | null> => {
        try { return await loadCharacterTurntableScene(await this.mounted(catalog, preview.product), preview); }
        catch (error) {
          if (!this.failures.has(key)) {
            this.failures.add(key);
            this.options.print(`Character preview unavailable: ${error instanceof Error ? error.message : String(error)}\n`);
          }
          return null;
        }
      })();
      this.scenes.set(key, pending);
    }
    const scene = await pending;
    if (this.closed || this.desiredKey !== key) return;
    this.scene = scene;
    this.sceneKey = key;
    this.rotationStartedAt = null;
    this.lastRenderedAt = -Infinity;
  }

  private tick(milliseconds: number): void {
    if (this.closed || this.scene === null || this.sceneKey !== this.desiredKey) return;
    if (milliseconds - this.lastRequestedAt > 300) return;
    if (milliseconds - this.lastRenderedAt < TURNTABLE_FRAME_MILLISECONDS) return;
    this.rotationStartedAt ??= milliseconds;
    const elapsed = Math.max(0, milliseconds - this.rotationStartedAt);
    const yaw = this.scene.initialYaw + (elapsed % TURNTABLE_ROTATION_MILLISECONDS) / TURNTABLE_ROTATION_MILLISECONDS * Math.PI * 2;
    try {
      this.options.images.update(this.image, 0, renderCharacterTurntable(this.scene, yaw));
      this.lastRenderedAt = milliseconds;
    } catch (error) {
      this.scene = null;
      this.options.print(`Character preview failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
}
