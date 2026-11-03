// SPDX-License-Identifier: GPL-2.0-or-later
import type { CvarAlias, CvarRegistry } from "./index.ts";

/**
 * The one declaration of how each game spells the engine's shared settings. The canonical cvar is the engine's own
 * (r_gamma, volume, bgmvolume, sensitivity, fov, ...), and the high level stores those names. Every other spelling is
 * registered as a cvar alias in every dialect, so a classic name works whichever game runs. `formats` only chooses
 * which spelling a game's native file is written and read with; it never limits where a name is accepted.
 */
export type LayerFormat = "quake" | "quake2" | "quake3" | "kex-quake" | "kex-quake2";

export interface SettingSpelling {
  readonly name: string;
  /** The native files that spell the setting this way. Empty for a name that is only accepted. */
  readonly formats: readonly LayerFormat[];
  /** From the canonical value to this spelling's, and back. */
  readonly conversion: CvarAlias["conversion"];
  readonly summary: string;
  readonly usage: string;
  readonly example: string;
}

export interface EngineSetting {
  readonly canonical: string;
  /** The registry that owns the canonical cvar: the shared client settings, or each seat's input settings. */
  readonly registry: "shared" | "input";
  /** The native files that spell the setting with the canonical name itself. */
  readonly formats: readonly LayerFormat[];
  readonly spellings: readonly SettingSpelling[];
  /** Cvars a game needs at a fixed value for the setting to take effect. */
  readonly companions?: readonly { readonly format: LayerFormat; readonly name: string; readonly value: string }[];
}

export const identityConversion: CvarAlias["conversion"] = { kind: "identity" };
const identity = identityConversion;
/** A trimmed, finite number, or null. */
export const finiteNumber = (value: string): number | null => {
  const number = value.trim() === "" ? Number.NaN : Number(value);
  return Number.isFinite(number) ? number : null;
};

/** Quake and Quake II brightness: lower values brighten, so gamma = 1 / r_gamma. */
const gammaConversion: CvarAlias["conversion"] = {
  kind: "converted",
  read: value => String(1 / Number(value)),
  write: value => {
    const number = finiteNumber(value);
    return number === null || number < 1 / 3 || number > 2
      ? { kind: "invalid", message: "Gamma must be between 1/3 and 2" }
      : { kind: "value", value: String(1 / number) };
  },
};

/** Quake II's gl_mode table, by width; its heights follow at 3:4. Widths outside the table are the custom mode, -1. */
const Q2_MODE_WIDTHS: readonly number[] = [320, 400, 512, 640, 800, 960, 1024, 1152, 1280, 1600, 2048];
const q2ModeConversion: CvarAlias["conversion"] = {
  kind: "converted",
  read: value => String(Q2_MODE_WIDTHS.indexOf(Number(value))),
  write: value => {
    const width = Q2_MODE_WIDTHS[Number(value)];
    return width === undefined ? { kind: "invalid", message: "gl_mode must name a mode from 0 to 10" } : { kind: "value", value: String(width) };
  },
};

const spelling = (
  name: string,
  formats: readonly LayerFormat[],
  target: string,
  conversion: CvarAlias["conversion"] = identity,
  example = `${name} 1`,
): SettingSpelling => ({
  name,
  formats,
  conversion,
  summary: `Another spelling of ${target}, as written by the game that uses this name. Changes the same setting.`,
  usage: `${name} <value>`,
  example,
});

export const ENGINE_SETTINGS: readonly EngineSetting[] = [
  {
    canonical: "volume",
    registry: "shared",
    formats: ["quake"],
    spellings: [
      {
        ...spelling("s_volume", ["quake2", "quake3"], "volume", identity, "s_volume 0.7"),
        summary: "Alias of volume. Changes the same effects gain and audio menu preference.",
        usage: "s_volume <0..1>",
      },
      spelling("snd_volume", ["kex-quake", "kex-quake2"], "volume", identity, "snd_volume 0.7"),
    ],
  },
  {
    canonical: "bgmvolume",
    registry: "shared",
    formats: ["quake"],
    spellings: [
      {
        ...spelling("s_musicvolume", ["quake3"], "bgmvolume", identity, "s_musicvolume 0.5"),
        summary: "Alias of bgmvolume. Changes the same music gain and audio menu preference.",
        usage: "s_musicvolume <0..1>",
      },
      {
        ...spelling("ogg_volume", [], "bgmvolume", identity, "ogg_volume 0.5"),
        summary: "Quake II music volume. Alias of bgmvolume and the shared music gain.",
        usage: "ogg_volume <0..1>",
      },
      spelling("snd_musicvolume", ["kex-quake"], "bgmvolume", identity, "snd_musicvolume 0.5"),
      spelling("s_bgvolume", ["kex-quake2"], "bgmvolume", identity, "s_bgvolume 0.5"),
    ],
  },
  {
    canonical: "r_gamma",
    registry: "shared",
    formats: ["quake3"],
    spellings: [
      {
        ...spelling("gamma", ["quake", "kex-quake"], "r_gamma", gammaConversion, "gamma 0.5"),
        summary: "Quake brightness convention: lower values brighten. Alias of r_gamma with gamma = 1 / r_gamma.",
        usage: "gamma <1/3..2>",
      },
      {
        ...spelling("vid_gamma", ["quake2"], "r_gamma", gammaConversion, "vid_gamma 0.5"),
        summary: "Quake II brightness convention: lower values brighten. Alias of r_gamma with vid_gamma = 1 / r_gamma.",
        usage: "vid_gamma <1/3..2>",
      },
    ],
  },
  {
    canonical: "fov",
    registry: "shared",
    formats: ["quake", "quake2"],
    spellings: [
      spelling("cg_fov", ["quake3"], "fov", identity, "cg_fov 100"),
      spelling("r_fov", ["kex-quake"], "fov", identity, "r_fov 100"),
      spelling("fov_0", ["kex-quake2"], "fov", identity, "fov_0 100"),
    ],
  },
  {
    canonical: "r_fullscreen",
    registry: "shared",
    formats: ["quake3"],
    spellings: [spelling("vid_fullscreen", ["quake2"], "r_fullscreen", identity, "vid_fullscreen 1")],
  },
  {
    canonical: "r_customwidth",
    registry: "shared",
    formats: ["quake3"],
    spellings: [
      spelling("vid_config_x", ["quake"], "r_customwidth", identity, "vid_config_x 1280"),
      spelling("v_width", ["kex-quake", "kex-quake2"], "r_customwidth", identity, "v_width 1280"),
      {
        ...spelling("gl_mode", ["quake2"], "r_customwidth", q2ModeConversion, "gl_mode 8"),
        summary: "Quake II video mode index. Changes the custom width to the mode's width; -1 reads back for widths outside the table.",
        usage: "gl_mode <0..10>",
      },
    ],
    companions: [{ format: "quake3", name: "r_mode", value: "-1" }],
  },
  {
    canonical: "r_customheight",
    registry: "shared",
    formats: ["quake3"],
    spellings: [
      spelling("vid_config_y", ["quake"], "r_customheight", identity, "vid_config_y 720"),
      spelling("v_height", ["kex-quake", "kex-quake2"], "r_customheight", identity, "v_height 720"),
    ],
  },
  {
    canonical: "sensitivity",
    registry: "input",
    formats: ["quake", "quake2", "quake3"],
    spellings: [spelling("cl_sensitivity", ["kex-quake"], "sensitivity", identity, "cl_sensitivity 4.5")],
  },
  // The rerelease Quake II keeps m_pitch at 0.01325 with a matching sensitivity scale, so those two stay with that game.
  { canonical: "m_pitch", registry: "input", formats: ["quake", "quake2", "quake3", "kex-quake"], spellings: [] },
];

/**
 * Register every spelling of the settings the registry owns as an alias of the canonical cvar. A name the registry
 * already has as a real cvar is left as it is, so a game that defines the name itself keeps its own.
 */
export function registerSettingAliases(cvars: CvarRegistry, registry: EngineSetting["registry"]): void {
  for (const setting of ENGINE_SETTINGS) {
    if (setting.registry !== registry || cvars.find(setting.canonical) === undefined) continue;
    for (const entry of setting.spellings) {
      if (cvars.find(entry.name) !== undefined) continue;
      cvars.registerAlias({
        name: entry.name,
        target: setting.canonical,
        conversion: entry.conversion,
        documentation: { summary: entry.summary, usage: entry.usage, examples: [entry.example] },
      });
    }
  }
}
