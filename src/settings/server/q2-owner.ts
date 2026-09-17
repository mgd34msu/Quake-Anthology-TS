import { Q2CvarFlag } from "../../core/cvars/index.ts";
import { CvarRegistry } from "../../core/cvars/index.ts";
import type { Q2ProductRuntime, Q2CompositionServices } from "../../content/composition/q2/index.ts";
import { Q2Ctf } from "../../content/q2/multiplayer/ctf/index.ts";
import { Q2Lmctf } from "../../content/q2/multiplayer/lmctf/runtime.ts";
import { createQ2PlayerRules } from "../../content/q2/base/player/types.ts";
import type { Q2PlayerRules } from "../../content/q2/base/player/types.ts";
import type { Q2RereleaseOptions } from "../../content/q2/rerelease/types.ts";
import { createQ2CtfRules } from "../../content/q2/multiplayer/ctf/types.ts";
import { createLmctfRules } from "../../content/q2/multiplayer/lmctf/types.ts";
import { bindLmctfConsoleRules } from "./lmctf-cvars.ts";
import { q2CombatSettings, q2CtfCaptureSettings, q2LimitSettings, q2SpawnSettings, q2DeathBallSettings, q2RereleaseSettings } from "./q2.ts";
import { lmctfLimitSettings, lmctfRuneSettings, lmctfWeaponSettings } from "./lmctf.ts";
import type { ServerSettingCollection } from "./types.ts";

const rereleaseCombatDefaults = [
  ["g_instant_weapon_switch", "0", Q2CvarFlag.Latch], ["g_weapon_respawn_time", "30", 0],
  ["g_dm_weapons_stay", "0", 0], ["g_dm_instant_items", "1", 0], ["g_dm_same_level", "0", 0],
  ["g_no_mines", "0", 0], ["g_no_nukes", "0", 0], ["g_no_spheres", "0", 0],
  ["g_dm_random_items", "0", 0], ["g_dm_no_quadfire_drop", "0", 0],
  ["g_dm_no_quad_drop", "0", 0], ["g_dm_no_stack_double", "0", 0], ["g_dm_strong_mines", "0", 0],
] satisfies readonly (readonly [string, string, number])[];
export function q2RereleaseItemServices(cvars: CvarRegistry): Pick<Q2CompositionServices, "randomItems" | "dropQuadFire"> {
  if (cvars.dialect !== "q2-rerelease") return {};
  return {
    randomItems: () => {
      const flags = q2SourceDeathmatchFlags(cvars);
      return { enabled: cvars.variableValue("g_dm_random_items") !== 0,
        noMines: cvars.variableValue("g_no_mines") !== 0 || (flags & 0x20000) !== 0,
        noNukes: cvars.variableValue("g_no_nukes") !== 0 || (flags & 0x80000) !== 0,
        noSpheres: cvars.variableValue("g_no_spheres") !== 0 || (flags & 0x40000) !== 0 };
    },
    dropQuadFire: () => cvars.variableValue("g_dm_no_quadfire_drop") === 0,
  };
}
export function q2SourceDeathmatchFlags(cvars: CvarRegistry): number {
  let flags = Math.trunc(cvars.variableValue("dmflags"));
  if (cvars.dialect !== "q2-rerelease") return flags;
  for (const [name, mask, inverted] of [
    ["g_dm_weapons_stay", 4, false], ["g_dm_instant_items", 16, false],
    ["g_dm_same_level", 32, false], ["g_dm_no_quad_drop", 16384, true],
  ] satisfies readonly (readonly [string, number, boolean])[]) {
    const enabled = (cvars.variableValue(name) !== 0) !== inverted;
    flags = enabled ? flags | mask : flags & ~mask;
  }
  return flags;
}
type NumericPlayerRule = "maxSpectators" | "floodMessages" | "floodSeconds" | "floodWaitSeconds" | "rollSpeed" | "rollAngle" | "runPitch" | "runRoll" | "bobUp" | "bobPitch" | "bobRoll";
const playerNumbers: readonly (readonly [string, NumericPlayerRule, string, number])[] = [
  ["maxspectators", "maxSpectators", "4", Q2CvarFlag.ServerInfo],
  ["flood_msgs", "floodMessages", "4", 0], ["flood_persecond", "floodSeconds", "4", 0], ["flood_waitdelay", "floodWaitSeconds", "10", 0],
  ["sv_rollspeed", "rollSpeed", "200", 0], ["sv_rollangle", "rollAngle", "2", 0],
  ["run_pitch", "runPitch", "0.002", 0], ["run_roll", "runRoll", "0.005", 0],
  ["bob_up", "bobUp", "0.005", 0], ["bob_pitch", "bobPitch", "0.002", 0], ["bob_roll", "bobRoll", "0.002", 0],
];
const playerStrings: readonly (readonly [string, "password" | "spectatorPassword"])[] = [["password", "password"], ["spectator_password", "spectatorPassword"]];
type BooleanRereleaseOption = "coopSquadRespawn" | "coopInstancedItems" | "coopLives" | "coopPlayerCollision" | "deathmatchForceRespawn" | "deathmatchNoFallDamage" | "deathmatchSpawnFarthest" | "deathmatchAllowExit";
const rereleaseBooleans: readonly (readonly [string, BooleanRereleaseOption, string, number])[] = [
  ["g_coop_squad_respawn", "coopSquadRespawn", "1", Q2CvarFlag.Latch],
  ["g_coop_instanced_items", "coopInstancedItems", "1", Q2CvarFlag.Latch],
  ["g_coop_enable_lives", "coopLives", "0", Q2CvarFlag.Latch],
  ["g_coop_player_collision", "coopPlayerCollision", "0", Q2CvarFlag.Latch],
  ["g_dm_force_respawn", "deathmatchForceRespawn", "0", 0],
  ["g_dm_no_fall_damage", "deathmatchNoFallDamage", "0", 0],
  ["g_dm_spawn_farthest", "deathmatchSpawnFarthest", "1", 0],
  ["g_dm_allow_exit", "deathmatchAllowExit", "0", 0],
];
const rereleaseNumbers: readonly (readonly [string, "coopNumLives" | "deathmatchForceRespawnTime", string, number])[] = [
  ["g_coop_num_lives", "coopNumLives", "2", Q2CvarFlag.Latch],
  ["g_dm_force_respawn_time", "deathmatchForceRespawnTime", "0", 0],
];

export function restoreQ2ServerCvars(cvars: CvarRegistry, value: unknown): void {
  const validated = new CvarRegistry({ dialect: cvars.dialect, context: cvars.context });
  validated.restoreSaveState(value);
  const saved = validated.captureSaveState(), names = new Set(saved.order);
  const missing = cvars.snapshots().filter(variable => !names.has(variable.name));
  cvars.restoreSaveState({ ...saved,
    variables: [...saved.variables, ...missing.map(variable => ({ ...variable, latchedValue: variable.latchedValue ?? null }))],
    order: [...missing.map(variable => variable.name), ...saved.order] });
}

export function q2ServerSettingCollections(match: string, q2Combat: boolean, rerelease = false): readonly ServerSettingCollection[] {
  return [q2SpawnSettings(), ...(q2Combat ? [q2CombatSettings()] : []),
    ...(match === "q2:lmctf" ? [lmctfLimitSettings(), lmctfRuneSettings(), lmctfWeaponSettings()] : [q2LimitSettings()]),
    ...(match === "q2:ctf" ? [q2CtfCaptureSettings()] : []), ...(match === "q2:deathball" ? [q2DeathBallSettings()] : []),
    ...(rerelease ? [q2RereleaseSettings()] : [])];
}
export function registerQ2ServerCvars(cvars: CvarRegistry, match: string): void {
  if (match === "q2:deathball") {
    cvars.register("dball_team1_skin", "male/ctf_r", 0); cvars.register("dball_team2_skin", "male/ctf_b", 0); cvars.register("goallimit", "0", 0);
  }
  if (cvars.dialect === "q2-rerelease") for (const [name, value, flags] of rereleaseCombatDefaults) cvars.register(name, value, flags);
  const defaults = createQ2PlayerRules();
  cvars.register("sv_gravity", "800", 0);
  cvars.register("sv_airaccelerate", "0", 0);
  cvars.register("dmflags", "0", Q2CvarFlag.ServerInfo);
  cvars.register("timelimit", String(defaults.timeLimitMinutes), Q2CvarFlag.ServerInfo);
  cvars.register("fraglimit", String(defaults.fragLimit), Q2CvarFlag.ServerInfo);
  for (const [name, , value, flags] of playerNumbers) cvars.register(name, value, flags);
  for (const [name] of playerStrings) cvars.register(name, "", Q2CvarFlag.UserInfo);
  cvars.register("needpass", "0", Q2CvarFlag.ServerInfo);
  cvars.register("cheats", "0", Q2CvarFlag.ServerInfo | Q2CvarFlag.Latch);
  for (const axis of ["x", "y", "z"]) cvars.register(`gun_${axis}`, "0", 0);
  cvars.register(cvars.dialect === "q2-rerelease" ? "g_map_list" : "sv_maplist", "", 0);
  if (cvars.dialect === "q2-rerelease") cvars.register("g_map_list_shuffle", "0", 0);
  if (cvars.dialect === "q2-rerelease") for (const [name, , value, flags] of [...rereleaseBooleans, ...rereleaseNumbers]) cvars.register(name, value, flags);
  if (match === "q2:ctf") cvars.register("capturelimit", String(createQ2CtfRules().captureLimit), Q2CvarFlag.ServerInfo);
  if (match === "q2:lmctf") bindLmctfConsoleRules(cvars, createLmctfRules());
}
export function bindQ2ServerCvars(cvars: CvarRegistry, product: Q2ProductRuntime): void {
  bindQ2PlayerCvars(cvars, product.players.rules, product.rerelease?.players.rereleaseOptions ?? null);
  const mode = product.match.source;
  if (mode instanceof Q2Lmctf) bindLmctfConsoleRules(cvars, mode.rules);
  else for (const [key, name] of [["timeLimitMinutes", "timelimit"], ["fragLimit", "fraglimit"]] satisfies readonly (readonly ["timeLimitMinutes" | "fragLimit", string])[]) {
    Object.defineProperty(product.players.rules, key, { enumerable: true, configurable: true,
      get: () => cvars.variableValue(name), set: (value: number) => { cvars.set(name, String(value)); } });
  }
  if (mode instanceof Q2Ctf) Object.defineProperty(mode.rules, "captureLimit", { enumerable: true, configurable: true,
    get: () => cvars.variableValue("capturelimit"), set: (value: number) => { cvars.set("capturelimit", String(value)); } });
}

export function bindQ2PlayerCvars(cvars: CvarRegistry, rules: Q2PlayerRules, rerelease: Q2RereleaseOptions | null): void {
  for (const [name, key] of playerNumbers) Object.defineProperty(rules, key, { enumerable: true, configurable: true,
    get: () => cvars.variableValue(name), set: (value: number) => { cvars.set(name, String(value), true); } });
  for (const [name, key] of playerStrings) Object.defineProperty(rules, key, { enumerable: true, configurable: true,
    get: () => cvars.variableString(name), set: (value: string) => { cvars.set(name, value, true); } });
  const needPassword = (): void => {
    const required = (name: string): boolean => { const value = cvars.variableString(name); return value !== "" && value.toLowerCase() !== "none"; };
    cvars.set("needpass", String((required("password") ? 1 : 0) | (required("spectator_password") ? 2 : 0)), true);
  };
  for (const [name] of playerStrings) cvars.bindValue(name, { validate: () => null, changed: needPassword });
  needPassword();
  Object.defineProperty(rules, "cheats", { enumerable: true, configurable: true,
    get: () => cvars.variableValue("cheats") !== 0, set: (value: boolean) => { cvars.set("cheats", value ? "1" : "0", true); } });
  Object.defineProperty(rules, "gunOffset", { enumerable: true, configurable: true,
    get: () => ({ x: cvars.variableValue("gun_x"), y: cvars.variableValue("gun_y"), z: cvars.variableValue("gun_z") }),
    set: (value: Q2PlayerRules["gunOffset"]) => { for (const axis of ["x", "y", "z"] satisfies readonly (keyof Q2PlayerRules["gunOffset"])[]) cvars.set(`gun_${axis}`, String(value[axis]), true); } });
  const mapList = rerelease === null ? "sv_maplist" : "g_map_list";
  Object.defineProperty(rules, "mapList", { enumerable: true, configurable: true,
    get: () => cvars.variableString(mapList).split(rerelease === null ? /[\s,]+/ : /\s+/).filter(value => value !== ""),
    set: (value: readonly string[]) => { cvars.set(mapList, value.join(" "), true); } });
  if (rerelease !== null) {
    Object.defineProperty(rules, "mapListShuffle", { enumerable: true, configurable: true,
      get: () => cvars.variableValue("g_map_list_shuffle") !== 0, set: (value: boolean) => { cvars.set("g_map_list_shuffle", value ? "1" : "0", true); } });
    for (const [name, key] of rereleaseBooleans) Object.defineProperty(rerelease, key, { enumerable: true, configurable: true,
      get: () => cvars.variableValue(name) !== 0, set: (value: boolean) => { cvars.set(name, value ? "1" : "0", true); } });
    for (const [name, key] of rereleaseNumbers) Object.defineProperty(rerelease, key, { enumerable: true, configurable: true,
      get: () => cvars.variableValue(name), set: (value: number) => { cvars.set(name, String(value), true); } });
  }
}
