/* Character resource search follows cg_players.c CG_FindClientModelFile,
 * CG_FindClientHeadFile and CG_RegisterClientModelname.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { ResolvedResourceReference } from "../../../contracts/content.ts";
import type { Q3MeshModel } from "../../../contracts/scene.ts";
import type { OpenedResource } from "../../mounts/index.ts";
import { parseMd3, parseSkin } from "../../../formats/q3-model/md3.ts";
import type { SkinSurface } from "../../../formats/q3-model/md3.ts";
import { toSceneMd3 } from "../../../formats/q3-model/scene.ts";
import { parsePlayerAnimationConfig } from "./animation-config.ts";
import type { PlayerAnimationConfig } from "./animation-config.ts";

export interface Q3CharacterSelection {
  readonly model: string;
  readonly skin: string;
  readonly headModel: string;
  readonly headSkin: string;
  readonly team: "red" | "blue" | null;
  readonly teamName: string;
}

export interface Q3CharacterPart {
  readonly resource: ResolvedResourceReference;
  readonly model: Q3MeshModel;
  readonly skinResource: ResolvedResourceReference;
  readonly surfaces: readonly SkinSurface[];
}

export interface Q3CharacterAssets {
  readonly selection: Q3CharacterSelection;
  readonly lower: Q3CharacterPart;
  readonly upper: Q3CharacterPart;
  readonly head: Q3CharacterPart;
  readonly animationResource: ResolvedResourceReference;
  readonly animation: PlayerAnimationConfig;
  readonly icon: ResolvedResourceReference | null;
}

/** The selected content mount plan supplies every byte, independently of map geometry. */
export interface Q3CharacterResources {
  open(path: string): Promise<OpenedResource | null>;
}

function byteText(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

function component(value: string, name: string, star: boolean): void {
  const plain = star && value.startsWith("*") ? value.slice(1) : value;
  if (plain.length === 0 || plain === "." || plain === ".." || /[\0/\\]/.test(plain)) throw new RangeError(`Invalid Q3 ${name}: ${value}`);
}

async function first(resources: Q3CharacterResources, paths: readonly string[]): Promise<OpenedResource | null> {
  for (const path of paths) {
    const resource = await resources.open(path);
    if (resource !== null && resource.bytes.length !== 0) return resource;
  }
  return null;
}

async function required(resources: Q3CharacterResources, paths: readonly string[]): Promise<OpenedResource> {
  const resource = await first(resources, paths);
  if (resource === null) throw new Error(`Q3 character resource missing: ${paths.join(", ")}`);
  return resource;
}

function bodyFiles(selection: Q3CharacterSelection, base: string, teamName: string): string[] {
  const paths: string[] = [], team = selection.team ?? "default";
  for (const folder of ["", "characters/"]) for (const prefix of teamName ? [teamName, ""] : [""]) {
    paths.push(`models/players/${folder}${selection.model}/${prefix}${base}_${selection.skin}_${team}.skin`.slice(0, 63));
    paths.push(`models/players/${folder}${selection.model}/${prefix}${base}_${selection.team ?? selection.skin}.skin`.slice(0, 63));
  }
  return paths;
}

function headFiles(selection: Q3CharacterSelection, base: string, extension: string, teamName: string): string[] {
  const model = selection.headModel || selection.model;
  const name = model.startsWith("*") ? model.slice(1) : model;
  const paths: string[] = [], team = selection.team ?? "default";
  const limit = base === "head" ? 63 : 127;
  for (const folder of model.startsWith("*") ? ["heads/"] : ["", "heads/"]) for (const prefix of teamName ? [teamName, ""] : [""]) {
    paths.push(`models/players/${folder}${name}/${selection.headSkin}/${prefix}${base}_${team}.${extension}`.slice(0, limit));
    paths.push(`models/players/${folder}${name}/${prefix}${base}_${selection.team ?? selection.headSkin}.${extension}`.slice(0, limit));
  }
  return paths;
}

export async function loadQ3Character(resources: Q3CharacterResources, selection: Q3CharacterSelection): Promise<Q3CharacterAssets> {
  component(selection.model, "model", false); component(selection.skin, "skin", false);
  if (selection.headModel !== "") component(selection.headModel, "head model", true);
  component(selection.headSkin, "head skin", false);
  if (selection.teamName !== "") component(selection.teamName, "team name", false);
  const model = selection.model, head = selection.headModel || model;
  const headName = head.startsWith("*") ? head.slice(1) : head;
  const [lower, upper, face, animation] = await Promise.all([
    required(resources, [`models/players/${model}/lower.md3`, `models/players/characters/${model}/lower.md3`]),
    required(resources, [`models/players/${model}/upper.md3`, `models/players/characters/${model}/upper.md3`]),
    required(resources, head.startsWith("*") ? [`models/players/heads/${headName}/${headName}.md3`]
      : [`models/players/${head}/head.md3`, `models/players/heads/${headName}/${headName}.md3`]),
    required(resources, [`models/players/${model}/animation.cfg`, `models/players/characters/${model}/animation.cfg`]),
  ]);
  const teamNames = selection.teamName ? [`${selection.teamName}/`, selection.team === "blue" ? "Pagans/" : "Stroggs/"] : [""];
  let skins: readonly [OpenedResource, OpenedResource, OpenedResource] | null = null;
  for (const team of teamNames) {
    const [legs, torso, headSkin] = await Promise.all([first(resources, bodyFiles(selection, "lower", team)),
      first(resources, bodyFiles(selection, "upper", team)), first(resources, headFiles(selection, "head", "skin", team))]);
    if (legs !== null && torso !== null && headSkin !== null) { skins = [legs, torso, headSkin]; break; }
  }
  if (skins === null) throw new Error(`Q3 character skin missing: ${model}/${selection.skin}, ${head}/${selection.headSkin}`);
  const makePart = (mesh: OpenedResource, skin: OpenedResource): Q3CharacterPart => ({
    resource: mesh.reference, model: toSceneMd3(parseMd3(mesh.bytes, mesh.reference.requestedPath)),
    skinResource: skin.reference, surfaces: parseSkin(byteText(skin.bytes)),
  });
  const iconTeam = selection.teamName ? `${selection.teamName}/` : "";
  const icon = await first(resources, [...headFiles(selection, "icon", "skin", iconTeam), ...headFiles(selection, "icon", "tga", iconTeam)]);
  return { selection, lower: makePart(lower, skins[0]), upper: makePart(upper, skins[1]), head: makePart(face, skins[2]),
    animationResource: animation.reference, animation: parsePlayerAnimationConfig(byteText(animation.bytes), animation.reference.requestedPath),
    icon: icon?.reference ?? null };
}
