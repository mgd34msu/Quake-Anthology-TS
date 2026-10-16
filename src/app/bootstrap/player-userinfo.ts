import { CvarFlag, type CvarRegistry } from "../../core/cvars/index.ts";
import { nativeAtoi } from "../../core/numeric.ts";

/** Identity follows the source console, independently of movement and appearance. */
export function registerPlayerUserinfo(cvars: CvarRegistry, index: number, model = "male"): void {
  const dialect = cvars.dialect;
  if (dialect === "q3") return;
  const register = (name: string, value: string, declarationFlags: number): void => {
    const existing = cvars.find(name);
    if (!dialect.startsWith("q1") || existing === undefined || cvars.isConsoleCreated(name)) cvars.register(name, value, declarationFlags);
    else if ((existing.flags & declarationFlags) !== declarationFlags) cvars.addFlags(name, declarationFlags);
  };
  const flags = CvarFlag.Archive | CvarFlag.UserInfo;
  if (dialect === "q1-netquake" || dialect === "q1-quakeworld") register("qts_weapon_autoswitch", "always", flags);
  if (dialect === "q2-rerelease") register("autoswitch", "0", flags);
  if (dialect === "q1-netquake") {
    register("_cl_name", cvars.find("name")?.value ?? `Player ${index + 1}`, CvarFlag.Archive);
    register("_cl_color", cvars.find("color")?.value ?? "0", CvarFlag.Archive); return;
  }
  register("name", `Player ${index + 1}`, flags);
  if (dialect === "q1-quakeworld") {
    for (const [name, value] of [["topcolor", "0"], ["bottomcolor", "0"], ["team", ""], ["skin", ""]])
      if (name !== undefined && value !== undefined) register(name, value, flags);
    return;
  }
  register("spectator", "0", CvarFlag.UserInfo);
  register("password", "", CvarFlag.UserInfo);
  for (const [name, value] of [["skin", `${model}/${model === "female" ? "athena" : model === "cyborg" ? "oni911" : "grunt"}`], ["rate", "25000"], ["msg", "1"], ["hand", "0"], ["fov", "90"], ["gender", model === "female" ? "female" : "male"]])
    if (name !== undefined && value !== undefined) register(name, value, flags);
}

export function playerUserinfo(cvars: CvarRegistry): string {
  const info = cvars.infoString(CvarFlag.UserInfo);
  if (cvars.dialect !== "q1-netquake") return info;
  const color = nativeAtoi(cvars.variableString(cvars.find("color") === undefined ? "_cl_color" : "color"));
  const name = cvars.variableString(cvars.find("name") === undefined ? "_cl_name" : "name").slice(0, 15);
  const other = info.replace(/\\(?:name|topcolor|bottomcolor)\\[^\\]*/g, "");
  return `${other}\\name\\${name}\\topcolor\\${Math.min(13, (color >> 4) & 15)}\\bottomcolor\\${Math.min(13, color & 15)}`;
}

export interface CharacterAppearance {
  readonly character: string;
  readonly characterModel: string;
  readonly characterSkin?: string;
  readonly characterTopColor?: number;
  readonly characterBottomColor?: number;
}

/** Apply the chosen character appearance to the seat's userinfo cvars. */
export function applyCharacterAppearance(cvars: CvarRegistry, options: CharacterAppearance): void {
  const dialect = cvars.dialect;
  const top = Math.min(13, Math.max(0, Math.trunc(options.characterTopColor ?? 0)));
  const bottom = Math.min(13, Math.max(0, Math.trunc(options.characterBottomColor ?? 0)));
  if (dialect === "q1-netquake") {
    const packed = String((top << 4) | bottom);
    if (cvars.find("_cl_color") !== undefined) cvars.set("_cl_color", packed, true);
    if (cvars.find("color") !== undefined) cvars.set("color", packed, true);
  } else if (dialect === "q1-quakeworld") {
    if (cvars.find("topcolor") !== undefined) cvars.set("topcolor", String(top), true);
    if (cvars.find("bottomcolor") !== undefined) cvars.set("bottomcolor", String(bottom), true);
  }
  const skin = options.characterSkin?.trim();
  if (skin === undefined || skin === "") return;
  if (dialect.startsWith("q2") && options.character === "q2" && cvars.find("skin") !== undefined)
    cvars.set("skin", `${options.characterModel}/${skin}`, true);
  if (dialect === "q3" && options.character === "q3")
    for (const name of ["model", "headmodel", "team_model", "team_headmodel"])
      if (cvars.find(name) !== undefined) cvars.set(name, `${options.characterModel}/${skin}`, true);
  if (dialect === "q1-quakeworld" && options.character === "q1" && cvars.find("skin") !== undefined)
    cvars.set("skin", skin, true);
}
