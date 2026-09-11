// SPDX-License-Identifier: GPL-2.0-or-later
// Function order and source widths: rerelease/game.h game/cgame imports and exports.
import type { GuestStorage, GuestValueLayout, NativeCallAbi } from "../../../contracts/execution.ts";
import type { GuestCallSignature } from "../../../guest/core/contracts.ts";
import { exportTableLayout, importTableLayout, rectangleLayout, traceLayout, vec2Layout } from "./layouts.ts";

export const rereleaseAbi: NativeCallAbi = { kind: "windows-x86-64", image: "pe32+", pointerBytes: 8, call: "microsoft-x64" };
const scalar = (storage: GuestStorage): GuestValueLayout => ({ kind: "scalar", storage });
const P = scalar("pointer"), I = scalar("int32"), U = scalar("uint32"), Q = scalar("uint64"), F = scalar("float32"), B = scalar("uint8"), H = scalar("int16"), UH = scalar("uint16");
const T: GuestValueLayout = { kind: "aggregate", layout: traceLayout };
const R: GuestValueLayout = { kind: "aggregate", layout: rectangleLayout };
const V2: GuestValueLayout = { kind: "aggregate", layout: vec2Layout };
export function signature(parameters: readonly GuestValueLayout[], result: GuestValueLayout | "void" = "void"): GuestCallSignature { return { abi: rereleaseAbi, parameters, result, variadic: false }; }
function entry<N extends string>(name: N, parameters: readonly GuestValueLayout[], result: GuestValueLayout | "void" = "void") { return { name, signature: signature(parameters, result) }; }

export const gameImports = [
  entry("Broadcast_Print", [I, P]), entry("Com_Print", [P]), entry("Client_Print", [P, I, P]), entry("Center_Print", [P, P]),
  entry("sound", [P, B, I, F, F, F]), entry("positioned_sound", [P, P, B, I, F, F, F]), entry("local_sound", [P, P, P, B, I, F, F, F, U]),
  entry("configstring", [I, P]), entry("get_configstring", [I], P), entry("Com_Error", [P]),
  entry("modelindex", [P], I), entry("soundindex", [P], I), entry("imageindex", [P], I), entry("setmodel", [P, P]),
  entry("trace", [P, P, P, P, P, U], T), entry("clip", [P, P, P, P, P, U], T), entry("pointcontents", [P], U),
  entry("inPVS", [P, P, B], B), entry("inPHS", [P, P, B], B), entry("SetAreaPortalState", [I, B]), entry("AreasConnected", [I, I], B),
  entry("linkentity", [P]), entry("unlinkentity", [P]), entry("BoxEdicts", [P, P, P, Q, I, P, P], Q),
  entry("multicast", [P, I, B]), entry("unicast", [P, B, U]),
  entry("WriteChar", [I]), entry("WriteByte", [I]), entry("WriteShort", [I]), entry("WriteLong", [I]), entry("WriteFloat", [F]), entry("WriteString", [P]), entry("WritePosition", [P]), entry("WriteDir", [P]), entry("WriteAngle", [F]), entry("WriteEntity", [P]),
  entry("TagMalloc", [Q, I], P), entry("TagFree", [P]), entry("FreeTags", [I]),
  entry("cvar", [P, P, U], P), entry("cvar_set", [P, P], P), entry("cvar_forceset", [P, P], P),
  entry("argc", [], I), entry("argv", [I], P), entry("args", [], P), entry("AddCommandString", [P]), entry("DebugGraph", [F, I]), entry("GetExtension", [P], P),
  entry("Bot_RegisterEdict", [P]), entry("Bot_UnRegisterEdict", [P]), entry("Bot_MoveToPoint", [P, P, F], I), entry("Bot_FollowActor", [P, P], I), entry("GetPathToGoal", [P, P], B),
  entry("Loc_Print", [P, I, P, P, Q]), entry("Draw_Line", [P, P, P, F, B]), entry("Draw_Point", [P, F, P, F, B]), entry("Draw_Circle", [P, F, P, F, B]), entry("Draw_Bounds", [P, P, P, F, B]), entry("Draw_Sphere", [P, F, P, F, B]), entry("Draw_OrientedWorldText", [P, P, P, F, F, B]), entry("Draw_StaticWorldText", [P, P, P, P, F, F, B]), entry("Draw_Cylinder", [P, F, F, P, F, B]), entry("Draw_Ray", [P, P, F, F, P, F, B]), entry("Draw_Arrow", [P, P, F, P, P, F, B]),
  entry("ReportMatchDetails_Multicast", [B]), entry("ServerFrame", [], U), entry("SendToClipBoard", [P]), entry("Info_ValueForKey", [P, P, P, Q], Q), entry("Info_RemoveKey", [P, P], B), entry("Info_SetValueForKey", [P, P, P], B),
];
export const gameExports = [
  entry("PreInit", []), entry("Init", []), entry("Shutdown", []), entry("SpawnEntities", [P, P, P]),
  entry("WriteGameJson", [B, P], P), entry("ReadGameJson", [P]), entry("WriteLevelJson", [B, P], P), entry("ReadLevelJson", [P]), entry("CanSave", [], B),
  entry("ClientChooseSlot", [P, P, B, P, Q, B], P), entry("ClientConnect", [P, P, P, B], B), entry("ClientBegin", [P]), entry("ClientUserinfoChanged", [P, P]), entry("ClientDisconnect", [P]), entry("ClientCommand", [P]), entry("ClientThink", [P, P]),
  entry("RunFrame", [B]), entry("PrepFrame", []), entry("ServerCommand", []),
  entry("Pmove", [P]), entry("GetExtension", [P], P), entry("Bot_SetWeapon", [P, I, B]), entry("Bot_TriggerEdict", [P, P]), entry("Bot_UseItem", [P, I]), entry("Bot_GetItemID", [P], I), entry("Edict_ForceLookAtPoint", [P, P]), entry("Bot_PickedUpItem", [P, P], B), entry("Entity_IsVisibleToPlayer", [P, P], B), entry("GetShadowLightData", [I], P),
];
export const cgameImports = [
  entry("Com_Print", [P]), entry("get_configstring", [I], P), entry("Com_Error", [P]), entry("TagMalloc", [Q, I], P), entry("TagFree", [P]), entry("FreeTags", [I]), entry("cvar", [P, P, U], P), entry("cvar_set", [P, P], P), entry("cvar_forceset", [P, P], P), entry("AddCommandString", [P]), entry("GetExtension", [P], P),
  entry("CL_FrameValid", [], B), entry("CL_FrameTime", [], F), entry("CL_ClientTime", [], Q), entry("CL_ClientRealTime", [], Q), entry("CL_ServerFrame", [], I), entry("CL_ServerProtocol", [], I), entry("CL_GetClientName", [I], P), entry("CL_GetClientPic", [I], P), entry("CL_GetClientDogtag", [I], P), entry("CL_GetKeyBinding", [P], P),
  entry("Draw_RegisterPic", [P], B), entry("Draw_GetPicSize", [P, P, P]), entry("SCR_DrawChar", [I, I, I, I, B]), entry("SCR_DrawPic", [I, I, I, I, P]), entry("SCR_DrawColorPic", [I, I, I, I, P, P]), entry("SCR_SetAltTypeface", [B]), entry("SCR_DrawFontString", [P, I, I, I, P, B, I]), entry("SCR_MeasureFontString", [P, I], V2), entry("SCR_FontLineHeight", [I], F), entry("CL_GetTextInput", [P, P], B), entry("CL_GetWarnAmmoCount", [I], I), entry("Localize", [P, P, Q], P), entry("SCR_DrawBind", [I, P, P, I, I, I], I), entry("CL_InAutoDemoLoop", [], B),
];
export const cgameExports = [
  entry("Init", []), entry("Shutdown", []), entry("DrawHUD", [I, P, R, R, I, I, P]), entry("TouchPics", []), entry("LayoutFlags", [P], H), entry("GetActiveWeaponWheelWeapon", [P], I), entry("GetOwnedWeaponWheelWeapons", [P], U), entry("GetWeaponWheelAmmoCount", [P, I], H), entry("GetPowerupWheelCount", [P, I], H), entry("GetHitMarkerDamage", [P], H), entry("Pmove", [P]), entry("ParseConfigString", [I, P]), entry("ParseCenterPrint", [P, I, B]), entry("ClearNotify", [I]), entry("ClearCenterprint", [I]), entry("NotifyMessage", [I, P, B]), entry("GetMonsterFlashOffset", [UH, P]), entry("GetExtension", [P], P),
];
export type GameImportName = typeof gameImports[number]["name"];
export type CgameImportName = typeof cgameImports[number]["name"];
export type GameExportName = typeof gameExports[number]["name"];
export type CgameExportName = typeof cgameExports[number]["name"];
export const gameImportLayout = importTableLayout("game", gameImports.map(value => value.name));
export const gameExportLayout = exportTableLayout("game", gameExports.map(value => value.name));
export const cgameImportLayout = importTableLayout("cgame", cgameImports.map(value => value.name));
export const cgameExportLayout = exportTableLayout("cgame", cgameExports.map(value => value.name));
export const getApiSignature = signature([P], P);
