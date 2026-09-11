// SPDX-License-Identifier: GPL-2.0-or-later
// Source: quake2-rerelease-dll/rerelease/game.h. Windows x64 default packing.
import type { GuestFieldLayout, GuestLayout, GuestStorage } from "../../../contracts/execution.ts";

interface Member { readonly name: string; readonly type: GuestStorage | GuestLayout; readonly count: number; }
function member(name: string, type: Member["type"], count = 1): Member { return { name, type, count }; }
function size(type: GuestStorage): number {
  switch (type) {
    case "int8": case "uint8": return 1;
    case "int16": case "uint16": return 2;
    case "int32": case "uint32": case "float32": return 4;
    case "int64": case "uint64": case "float64": case "pointer": return 8;
  }
}
function structure(name: string, members: readonly Member[]): GuestLayout {
  const fields: GuestFieldLayout[] = [];
  let cursor = 0, alignment = 1;
  for (const field of members) {
    const width = typeof field.type === "string" ? size(field.type) : field.type.byteLength;
    const align = typeof field.type === "string" ? width : field.type.alignment;
    alignment = Math.max(alignment, align);
    cursor = Math.ceil(cursor / align) * align;
    if (typeof field.type === "string") fields.push({ name: field.name, byteOffset: cursor, storage: field.type, count: field.count });
    else for (let i = 0; i < field.count; i++) for (const nested of field.type.fields) {
      fields.push({ ...nested, name: `${field.name}${field.count === 1 ? "" : `[${i}]`}.${nested.name}`, byteOffset: cursor + i * width + nested.byteOffset });
    }
    cursor += width * field.count;
  }
  return { id: `q2-rerelease-x64:${name}`, byteLength: Math.ceil(cursor / alignment) * alignment, alignment, pointerBytes: 8, byteOrder: "little-endian", fields };
}
export function fieldOffset(layout: GuestLayout, name: string): number {
  const field = layout.fields.find(value => value.name === name);
  if (field === undefined) throw new Error(`Unknown ${layout.id} field ${name}`);
  return field.byteOffset;
}
const m = member;
export const vec2Layout = structure("vec2_t", [m("xy", "float32", 2)]);
export const vec3Layout = structure("vec3_t", [m("xyz", "float32", 3)]);
export const planeLayout = structure("cplane_t", [m("normal", "float32", 3), m("dist", "float32"), m("type", "uint8"), m("signbits", "uint8"), m("pad", "uint8", 2)]);
export const surfaceLayout = structure("csurface_t", [m("name", "uint8", 32), m("flags", "uint32"), m("value", "int32"), m("id", "uint32"), m("material", "uint8", 16)]);
export const traceLayout = structure("trace_t", [m("allsolid", "uint8"), m("startsolid", "uint8"), m("fraction", "float32"), m("endpos", "float32", 3), m("plane", planeLayout), m("surface", "pointer"), m("contents", "uint32"), m("ent", "pointer"), m("plane2", planeLayout), m("surface2", "pointer")]);
export const cvarLayout = structure("cvar_t", [m("name", "pointer"), m("string", "pointer"), m("latched_string", "pointer"), m("flags", "uint32"), m("modified_count", "int32"), m("value", "float32"), m("next", "pointer"), m("integer", "int32")]);
export const pmoveStateLayout = structure("pmove_state_t", [m("pm_type", "int32"), m("origin", "float32", 3), m("velocity", "float32", 3), m("pm_flags", "uint16"), m("pm_time", "uint16"), m("gravity", "int16"), m("delta_angles", "float32", 3), m("viewheight", "int8")]);
export const usercmdLayout = structure("usercmd_t", [m("msec", "uint8"), m("buttons", "uint8"), m("angles", "float32", 3), m("forwardmove", "float32"), m("sidemove", "float32"), m("server_frame", "uint32")]);
export const touchListLayout = structure("touch_list_t", [m("num", "uint32"), m("touches", traceLayout, 32)]);
export const pmoveLayout = structure("pmove_t", [m("s", pmoveStateLayout), m("cmd", usercmdLayout), m("snapinitial", "uint8"), m("touch", touchListLayout), m("viewangles", "float32", 3), m("mins", "float32", 3), m("maxs", "float32", 3), m("groundentity", "pointer"), m("groundplane", planeLayout), m("watertype", "uint32"), m("waterlevel", "uint8"), m("player", "pointer"), m("trace", "pointer"), m("clip", "pointer"), m("pointcontents", "pointer"), m("viewoffset", "float32", 3), m("screen_blend", "float32", 4), m("rdflags", "uint8"), m("jump_sound", "uint8"), m("step_clip", "uint8"), m("impact_delta", "float32")]);
export const entityStateLayout = structure("entity_state_t", [m("number", "uint32"), m("origin", "float32", 3), m("angles", "float32", 3), m("old_origin", "float32", 3), m("modelindex", "int32"), m("modelindex2", "int32"), m("modelindex3", "int32"), m("modelindex4", "int32"), m("frame", "int32"), m("skinnum", "int32"), m("effects", "uint64"), m("renderfx", "uint32"), m("solid", "uint32"), m("sound", "int32"), m("event", "uint8"), m("alpha", "float32"), m("scale", "float32"), m("instance_bits", "uint8"), m("loop_volume", "float32"), m("loop_attenuation", "float32"), m("owner", "int32"), m("old_frame", "int32")]);
export const playerStateLayout = structure("player_state_t", [m("pmove", pmoveStateLayout), m("viewangles", "float32", 3), m("viewoffset", "float32", 3), m("kick_angles", "float32", 3), m("gunangles", "float32", 3), m("gunoffset", "float32", 3), m("gunindex", "int32"), m("gunskin", "int32"), m("gunframe", "int32"), m("gunrate", "int32"), m("screen_blend", "float32", 4), m("damage_blend", "float32", 4), m("fov", "float32"), m("rdflags", "uint8"), m("stats", "int16", 64), m("team_id", "uint8")]);
export const clientLayout = structure("gclient_shared_t", [m("ps", playerStateLayout), m("ping", "int32")]);
export const heightFogLayout = structure("height_fog_t", [m("start", "float32", 4), m("end", "float32", 4), m("falloff", "float32"), m("density", "float32")]);
// g_local.h item_id_t excludes the #if 0 disintegrator; IT_TOTAL=82.
// bg_local.h ammo_t has AMMO_MAX=12. These are private inventory sizes, not MAX_ITEMS.
export const persistentClientLayout = structure("client_persistant_t", [m("userinfo", "uint8", 2048), m("social_id", "uint8", 256), m("netname", "uint8", 32), m("hand", "int32"), m("autoswitch", "int32"), m("autoshield", "int32"), m("connected", "uint8"), m("spawned", "uint8"), m("health", "int32"), m("max_health", "int32"), m("savedFlags", "uint64"), m("selected_item", "int32"), m("selected_item_time", "int64"), m("inventory", "int32", 82), m("max_ammo", "int16", 12), m("weapon", "pointer"), m("lastweapon", "pointer"), m("power_cubes", "int32"), m("score", "int32"), m("game_help1changed", "int32"), m("game_help2changed", "int32"), m("helpchanged", "int32"), m("help_time", "int64"), m("spectator", "uint8"), m("bob_skip", "uint8"), m("wanted_fog", "float32", 5), m("wanted_heightfog", heightFogLayout), m("fog_transition_time", "int64"), m("megahealth_time", "int64"), m("lives", "int32"), m("n64_crouch_warn_times", "uint8"), m("n64_crouch_warning", "int64")]);
export const privateClientPrefixLayout = structure("gclient_t_private_prefix", [m("shared", clientLayout), m("pers", persistentClientLayout)]);
export const respawnClientLayout = structure("client_respawn_t", [m("coop_respawn", persistentClientLayout), m("entertime", "int64"), m("score", "int32"), m("cmd_angles", "float32", 3), m("spectator", "uint8"), m("ctf_team", "int32"), m("ctf_state", "int32"), ...["ctf_lasthurtcarrier", "ctf_lastreturnedflag", "ctf_flagsince", "ctf_lastfraggedcarrier"].map(name => m(name, "int64")), m("id_state", "uint8"), m("lastidtime", "int64"), m("voted", "uint8"), m("ready", "uint8"), m("admin", "uint8"), m("ghost", "pointer")]);
const damageIndicatorLayout = structure("damage_indicator_t", [m("from", "float32", 3), m("health", "int32"), m("armor", "int32"), m("power", "int32")]);
const kickLayout = structure("gclient_t_kick", [m("angles", "float32", 3), m("origin", "float32", 3), m("time", "int64"), m("total", "int64")]);
export const privateClientLayout = structure("gclient_t", [
  m("shared", clientLayout), m("pers", persistentClientLayout), m("resp", respawnClientLayout), m("old_pmove", pmoveStateLayout),
  ...["showscores", "showeou", "showinventory", "showhelp", "buttons", "oldbuttons", "latched_buttons"].map(name => m(name, "uint8")), m("cmd", usercmdLayout),
  m("weapon_fire_finished", "int64"), m("weapon_think_time", "int64"), m("weapon_fire_buffered", "uint8"), m("weapon_thunk", "uint8"), m("newweapon", "pointer"),
  ...["damage_armor", "damage_parmor", "damage_blood", "damage_knockback"].map(name => m(name, "int32")), m("damage_from", "float32", 3), m("damage_indicators", damageIndicatorLayout, 4), m("num_damage_indicators", "uint8"), m("killer_yaw", "float32"), m("weaponstate", "int32"), m("kick", kickLayout), m("quake_time", "int64"), m("kick_origin", "float32", 3), m("v_dmg_roll", "float32"), m("v_dmg_pitch", "float32"), m("v_dmg_time", "int64"), m("fall_time", "int64"), ...["fall_value", "damage_alpha", "bonus_alpha"].map(name => m(name, "float32")), ...["damage_blend", "v_angle", "v_forward"].map(name => m(name, "float32", 3)), m("bobtime", "float32"), m("oldviewangles", "float32", 3), m("oldvelocity", "float32", 3), m("oldgroundentity", "pointer"), m("flash_time", "int64"), m("next_drown_time", "int64"), m("old_waterlevel", "uint8"), m("breather_sound", "int32"), m("machinegun_shots", "int32"), m("anim_end", "int32"), m("anim_priority", "int32"), m("anim_duck", "uint8"), m("anim_run", "uint8"),
  ...["anim_time", "quad_time", "invincible_time", "breather_time", "enviro_time", "invisible_time"].map(name => m(name, "int64")), m("grenade_blew_up", "uint8"), ...["grenade_time", "grenade_finished_time", "quadfire_time"].map(name => m(name, "int64")), m("silencer_shots", "int32"), m("weapon_sound", "int32"), m("pickup_msg_time", "int64"), m("flood_locktill", "int64"), m("flood_when", "int64", 10), m("flood_whenhead", "int32"), m("respawn_time", "int64"), m("chase_target", "pointer"), m("update_chase", "uint8"), ...["double_time", "ir_time", "nuke_time", "tracker_pain_time"].map(name => m(name, "int64")), m("owned_sphere", "pointer"), m("empty_click_sound", "int64"), m("inmenu", "uint8"), m("menu", "pointer"), m("menutime", "int64"), m("menudirty", "uint8"), m("ctf_grapple", "pointer"), m("ctf_grapplestate", "int32"), ...["ctf_grapplereleasetime", "ctf_regentime", "ctf_techsndtime", "ctf_lasttechmsg"].map(name => m(name, "int64")), m("trail_head", "pointer"), m("trail_tail", "pointer"), m("no_weapon_chains", "uint8"), m("landmark_free_fall", "uint8"), m("landmark_name", "pointer"), m("landmark_rel_pos", "float32", 3), m("landmark_noise_time", "int64"), m("invisibility_fade_time", "int64"), m("chase_msg_time", "int64"), m("menu_sign", "int32"), m("last_ladder_pos", "float32", 3), m("last_ladder_sound", "int64"), m("coop_respawn_state", "int32"), m("last_damage_time", "int64"),
  m("sight_entity", "pointer"), m("sight_entity_time", "int64"), m("sound_entity", "pointer"), m("sound_entity_time", "int64"), m("sound2_entity", "pointer"), m("sound2_entity_time", "int64"), m("num_lag_origins", "uint8"), m("next_lag_origin", "uint8"), m("is_lag_compensated", "uint8"), m("lag_restore_origin", "float32", 3), m("slow_view_angles", "float32", 3), m("slow_view_angle_time", "int64"), m("help_draw_points", "uint8"), m("help_draw_index", "uint64"), m("help_draw_count", "uint64"), m("help_draw_time", "int64"), m("step_frame", "uint32"), m("help_poi_image", "int32"), m("help_poi_location", "float32", 3), m("awaiting_respawn", "uint8"), m("respawn_timeout", "int64"), m("fog", "float32", 5), m("heightfog", heightFogLayout), m("last_attacker_time", "int64"), m("last_firing_time", "int64"),
]);
const armorInfoLayout = structure("armorInfo_t", [m("item_id", "int32"), m("max_count", "int32")]);
export const serverEntityLayout = structure("sv_entity_t", [m("init", "uint8"), m("ent_flags", "uint64"), m("buttons", "uint8"), m("spawnflags", "uint32"), ...["item_id", "armor_type", "armor_value", "health", "max_health", "starting_health", "weapon", "team", "lobby_usernum", "respawntime", "viewheight", "last_attackertime"].map(name => m(name, "int32")), m("waterlevel", "uint8"), ...["viewangles", "viewforward", "velocity", "start_origin", "end_origin"].map(name => m(name, "float32", 3)), ...["enemy", "ground_entity", "classname", "targetname"].map(name => m(name, "pointer")), m("netname", "uint8", 32), m("inventory", "int32", 256), m("armor_info", armorInfoLayout, 3)]);
export const edictLayout = structure("edict_shared_t", [m("s", entityStateLayout), m("client", "pointer"), m("sv", serverEntityLayout), m("inuse", "uint8"), m("linked", "uint8"), m("linkcount", "int32"), m("areanum", "int32"), m("areanum2", "int32"), m("svflags", "uint32"), ...["mins", "maxs", "absmin", "absmax", "size"].map(name => m(name, "float32", 3)), m("solid", "uint8"), m("clipmask", "uint32"), m("owner", "pointer")]);
// g_local.h:544 save_data_t has a value pointer and registration-list pointer.
const saveFunctionLayout = structure("save_data_t", [m("value", "pointer"), m("list", "pointer")]);
// g_local.h:3026-3138. Only this source-proven prefix is exposed; the remaining
// source-private record stays opaque and uses the exported runtime stride.
export const privateEdictPrefixLayout = structure("edict_t_private_prefix", [m("shared", edictLayout), m("spawn_count", "int32"), m("movetype", "int32"), m("flags", "uint64"), m("model", "pointer"), m("freetime", "int64"), m("message", "pointer"), m("classname", "pointer"), m("spawnflags", "uint32"), m("timestamp", "int64"), m("angle", "float32"), ...["target", "targetname", "killtarget", "team", "pathtarget", "deathtarget", "healthtarget", "itemtarget", "combattarget", "target_ent"].map(name => m(name, "pointer")), ...["speed", "accel", "decel"].map(name => m(name, "float32")), ...["movedir", "pos1", "pos2", "pos3", "velocity", "avelocity"].map(name => m(name, "float32", 3)), m("mass", "int32"), m("air_finished", "int64"), m("gravity", "float32"), m("goalentity", "pointer"), m("movetarget", "pointer"), m("yaw_speed", "float32"), m("ideal_yaw", "float32"), m("nextthink", "int64"), ...["prethink", "postthink", "think", "touch", "use", "pain", "die"].map(name => m(name, saveFunctionLayout)), ...["touch_debounce_time", "pain_debounce_time", "damage_debounce_time", "fly_sound_debounce_time", "last_move_time"].map(name => m(name, "int64")), m("health", "int32"), m("max_health", "int32"), m("gib_health", "int32"), m("show_hostile", "int64"), m("powerarmor_time", "int64"), m("map", "pointer"), m("viewheight", "int32"), m("deadflag", "uint8"), m("takedamage", "uint8"), m("dmg", "int32"), m("radius_dmg", "int32"), m("dmg_radius", "float32"), m("sounds", "int32"), m("count", "int32"), ...["chain", "enemy", "oldenemy", "activator", "groundentity"].map(name => m(name, "pointer")), m("groundentity_linkcount", "int32")]);
export const rectangleLayout = structure("vrect_t", [m("x", "int32"), m("y", "int32"), m("width", "int32"), m("height", "int32")]);
export const cgameServerDataLayout = structure("cg_server_data_t", [m("layout", "uint8", 1024), m("inventory", "int16", 256)]);

export function importTableLayout(kind: "game" | "cgame", names: readonly string[]): GuestLayout {
  return structure(`${kind}_import_t`, [m("tick_rate", "uint32"), m("frame_time_s", "float32"), m("frame_time_ms", "uint32"), ...names.map(name => m(name, "pointer"))]);
}
export function exportTableLayout(kind: "game" | "cgame", names: readonly string[]): GuestLayout {
  const members = [m("apiversion", "int32"), ...names.map(name => m(name, "pointer"))];
  if (kind === "game") members.splice(20, 0, m("edicts", "pointer"), m("edict_size", "uint64"), m("num_edicts", "uint32"), m("max_edicts", "uint32"), m("server_flags", "uint32"));
  return structure(`${kind}_export_t`, members);
}
