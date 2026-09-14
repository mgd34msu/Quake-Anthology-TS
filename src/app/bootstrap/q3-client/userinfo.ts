import { CvarFlag } from "../../../core/cvars/index.ts";
import type { CvarRegistry } from "../../../core/cvars/index.ts";

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
