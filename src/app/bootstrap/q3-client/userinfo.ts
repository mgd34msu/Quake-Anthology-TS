import { CvarFlag } from "../../../core/cvars/index.ts";
import type { CvarRegistry } from "../../../core/cvars/index.ts";

/** Q3 userinfo is consumed by the Q3 cgame's MD3 loader; foreign bodies render through unified presentation instead. */
export function q3ClientModel(character: string, model: string): string {
  return character === "q3" ? model : "sarge";
}

/** Keep a retained/configured foreign model name out of Q3 CS_PLAYERS. */
export function applyQ3ProxyModel(cvars: CvarRegistry, character: string): void {
  if (character === "q3") return;
  for (const name of ["model", "headmodel", "team_model", "team_headmodel"])
    if (cvars.find(name) !== undefined) cvars.set(name, "sarge/default", true);
}

export function initializeQ3ClientCvars(cvars: CvarRegistry, identity: { readonly name: string; readonly model: string }): void {
  cvars.register("cl_timeNudge", "0", CvarFlag.Temporary);
  cvars.register("rate", "25000", CvarFlag.Archive | CvarFlag.UserInfo);
  cvars.register("cl_maxpackets", "30", CvarFlag.Archive);
  cvars.register("cl_packetdup", "1", CvarFlag.Archive);
  cvars.register("snaps", "20", CvarFlag.Archive | CvarFlag.UserInfo);
  cvars.register("name", identity.name, CvarFlag.Archive | CvarFlag.UserInfo);
  for (const name of ["model", "headmodel", "team_model", "team_headmodel"])
    cvars.register(name, `${identity.model}/default`, CvarFlag.Archive | CvarFlag.UserInfo);
  for (const [name, value] of [["color1", "4"], ["color2", "5"], ["sex", "male"], ["cl_anonymous", "0"], ["cg_predictItems", "1"]] satisfies readonly (readonly [string, string])[])
    cvars.register(name, value, CvarFlag.Archive | CvarFlag.UserInfo);
  cvars.register("teamtask", "0", CvarFlag.UserInfo);
  cvars.register("password", "", CvarFlag.UserInfo);
  cvars.register("handicap", "100", CvarFlag.Archive | CvarFlag.UserInfo);
  cvars.register("cl_maxPing", "800", CvarFlag.Archive);
  cvars.register("cl_serverStatusResendTime", "750", 0);
  cvars.register("sv_master1", "master.quake3arena.com", 0);
}
