// SPDX-License-Identifier: GPL-2.0-or-later
import { CvarFlag, type CvarRegistry } from "../../core/cvars/index.ts";
import { DEFAULT_SHADER_PROFILE } from "../../materials/compile.ts";
import type { FinishShaderProfile } from "../../materials/material-finish.ts";
import { DEFAULT_RAIL_SETTINGS, type RailSettings } from "../../render/scene/particles/primitives.ts";

/** Shared source alias-shadow setting; both rendering backends consume the same geometry. */
export function registerRenderSettings(cvars: CvarRegistry): void {
  cvars.register("r_shadows", "0", CvarFlag.Archive);
  cvars.bindValue("r_shadows", {
    validate: value => (value.trim() !== "" && Number.isFinite(Number(value)) ? null : "Shadows require a finite number"),
    changed: () => undefined,
  });
  cvars.document("r_shadows", {
    summary: "Quake model shadows projected onto the sampled floor. Zero disables; nonzero enables.",
    usage: "r_shadows [0|1]",
    examples: ["r_shadows 1", "r_shadows 0"],
  });
  registerQ3RendererCvars(cvars);
}

const finiteNumber =
  (label: string) =>
  (value: string): string | null =>
    value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 ? null : `${label} requires a non-negative number`;
const flag = (value: string): string | null => (value === "0" || value === "1" ? null : "Use 0 or 1");

/** tr_init.c's renderer cvars that the shared material and scene code consume; shader ones apply to the next shader load, like CVAR_LATCH. */
export function registerQ3RendererCvars(cvars: CvarRegistry): void {
  const number = (name: string, value: string, summary: string, validate: (value: string) => string | null): void => {
    cvars.register(name, value, CvarFlag.Archive);
    cvars.bindValue(name, { validate, changed: () => undefined });
    cvars.document(name, { summary, usage: `${name} <value>`, examples: [`${name} ${value}`] });
  };
  number("r_vertexLight", "0", "Collapse multitexture shaders to vertex lighting. Applies to shaders loaded after a map or vid_restart.", flag);
  number("r_detailTextures", "1", "Draw detail texture stages. Applies to shaders loaded after a map or vid_restart.", flag);
  number("r_railWidth", "16", "Width of railgun ring segments.", finiteNumber("r_railWidth"));
  number("r_railCoreWidth", "6", "Width of the railgun core beam.", finiteNumber("r_railCoreWidth"));
  number("r_railSegmentLength", "32", "Distance between railgun rings.", finiteNumber("r_railSegmentLength"));
  number("r_lodCurveError", "250", "Distance factor at which patch meshes drop tessellation levels.", finiteNumber("r_lodCurveError"));
}

export interface Q3RendererSettings {
  readonly rail: RailSettings;
  readonly curveError: number;
}

export function q3RendererSettings(cvars: CvarRegistry | null | undefined): Q3RendererSettings {
  const read = (name: string, fallback: number): number => {
    const value = cvars?.find(name) === undefined || cvars === null || cvars === undefined ? fallback : cvars.variableValue(name);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    rail: {
      coreWidth: read("r_railCoreWidth", DEFAULT_RAIL_SETTINGS.coreWidth),
      ringWidth: read("r_railWidth", DEFAULT_RAIL_SETTINGS.ringWidth),
      segmentLength: read("r_railSegmentLength", DEFAULT_RAIL_SETTINGS.segmentLength),
    },
    curveError: read("r_lodCurveError", 250),
  };
}

export function shaderProfileFromCvars(cvars: CvarRegistry | null | undefined): FinishShaderProfile {
  const flagValue = (name: string, fallback: boolean): boolean =>
    cvars?.find(name) === undefined || cvars === null || cvars === undefined ? fallback : cvars.variableValue(name) !== 0;
  return {
    ...DEFAULT_SHADER_PROFILE,
    vertexLight: flagValue("r_vertexLight", DEFAULT_SHADER_PROFILE.vertexLight),
    detailTextures: flagValue("r_detailTextures", DEFAULT_SHADER_PROFILE.detailTextures),
  };
}
