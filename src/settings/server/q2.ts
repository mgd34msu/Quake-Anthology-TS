import { createQ2PlayerRules } from "../../content/q2/base/player/types.ts";
import { createQ2CtfRules } from "../../content/q2/multiplayer/ctf/types.ts";
import { serverFriendlyFire, serverLimit, serverToggle } from "./common.ts";
import type { ServerSettingCollection } from "./types.ts";

export function q2LimitSettings(): ServerSettingCollection {
  const defaults = createQ2PlayerRules();
  return { id: "q2:limits", definitions: [
    serverLimit("server:time-limit", "timelimit", "Time limit (minutes)", defaults.timeLimitMinutes, "End the level after this many minutes. Zero disables the limit.", "live", false),
    serverLimit("server:frag-limit", "fraglimit", "Frag limit", defaults.fragLimit, "End the level when a player reaches this score. Zero disables the limit."),
  ] };
}
export function q2CtfCaptureSettings(): ServerSettingCollection {
  return { id: "q2:ctf-captures", definitions: [serverLimit("server:capture-limit", "capturelimit", "Capture limit", createQ2CtfRules().captureLimit, "End the level when a team reaches this capture count. Zero disables the limit.")] };
}
export function q2CombatSettings(): ServerSettingCollection {
  return { id: "q2:combat", definitions: [serverFriendlyFire({ kind: "bit", name: "dmflags", mask: 256, inverted: true }, true)] };
}
export function q2DeathBallSettings(): ServerSettingCollection {
  return { id: "q2:deathball", definitions: [serverLimit("server:goal-limit", "goallimit", "Goal limit", 0, "End DeathBall when a team reaches this goal score. Zero disables the limit.")] };
}
export function q2RereleaseSettings(): ServerSettingCollection {
  return { id: "q2:rerelease", definitions: [
    serverToggle("server:q2.random-items", { kind: "value", name: "g_dm_random_items" }, "Random item respawns", false, "Replace respawning pickups using the source item categories."),
    serverToggle("server:q2.no-quadfire-drop", { kind: "value", name: "g_dm_no_quadfire_drop" }, "Prevent DualFire drop", false, "Do not drop active DualFire Damage on death."),
    serverToggle("server:q2.instant-switch", { kind: "value", name: "g_instant_weapon_switch" }, "Instant weapon switching", false, "Skip weapon lowering and raising animations.", "next-map"),
    serverLimit("server:q2.weapon-respawn", "g_weapon_respawn_time", "Weapon respawn seconds", 30, "Delay before a collected deathmatch weapon returns.", "live", false),
    serverToggle("server:q2.weapons-stay", { kind: "value", name: "g_dm_weapons_stay" }, "Weapons stay", false, "Leave map weapons for other players."),
    serverToggle("server:q2.instant-items", { kind: "value", name: "g_dm_instant_items" }, "Instant powerups", true, "Activate powerups on pickup."),
    serverToggle("server:q2.same-level", { kind: "value", name: "g_dm_same_level" }, "Repeat current level", false, "Restart the same map after the match."),
    serverToggle("server:q2.no-quad-drop", { kind: "value", name: "g_dm_no_quad_drop" }, "Prevent Quad drop", false, "Do not drop active Quad Damage on death."),
    serverToggle("server:q2.no-stack-double", { kind: "value", name: "g_dm_no_stack_double" }, "Disable stacked Double Damage", false, "Do not stack Double Damage with other damage multipliers."),
    serverToggle("server:q2.strong-mines", { kind: "value", name: "g_dm_strong_mines" }, "Strong proximity mines", false, "Use the source strong mine damage policy."),
    serverToggle("server:q2.squad-respawn", { kind: "value", name: "g_coop_squad_respawn" }, "Respawn near teammates", true, "Use the source safe teammate respawn checks.", "next-map"),
    serverToggle("server:q2.instanced-items", { kind: "value", name: "g_coop_instanced_items" }, "Individual cooperative pickups", true, "Each cooperative player can collect their own copy of an eligible pickup.", "next-map"),
    serverToggle("server:q2.coop-lives", { kind: "value", name: "g_coop_enable_lives" }, "Limited cooperative lives", false, "Use source cooperative lives and all-dead restart rules.", "next-map"),
    serverLimit("server:q2.coop-num-lives", "g_coop_num_lives", "Extra cooperative lives", 2, "Additional lives per cooperative player.", "next-map"),
    serverToggle("server:q2.player-collision", { kind: "value", name: "g_coop_player_collision" }, "Cooperative player collision", false, "Allow cooperative players to block one another.", "next-map"),
    serverToggle("server:q2.force-respawn", { kind: "value", name: "g_dm_force_respawn" }, "Force deathmatch respawn", false, "Respawn dead players using the source respawn delay."),
    serverLimit("server:q2.respawn-time", "g_dm_force_respawn_time", "Forced respawn delay", 0, "Seconds before forced respawn. Zero uses source timing.", "live", false),
    serverToggle("server:q2.no-fall-damage", { kind: "value", name: "g_dm_no_fall_damage" }, "Disable deathmatch fall damage", false, "Suppress falling damage in deathmatch."),
    serverToggle("server:q2.farthest-spawn", { kind: "value", name: "g_dm_spawn_farthest" }, "Farthest deathmatch spawn", true, "Prefer the spawn farthest from living players."),
    serverToggle("server:q2.allow-exit", { kind: "value", name: "g_dm_allow_exit" }, "Allow deathmatch exits", false, "Allow players to activate authored level exits."),
  ] };
}
/** These bits are read while the selected Q2 item owner spawns map entities. */
export function q2SpawnSettings(): ServerSettingCollection {
  return { id: "q2:item-spawn", definitions: [
    serverToggle("server:q2.no-health", { kind: "bit", name: "dmflags", mask: 1, inverted: false }, "Exclude health items", false, "Remove health pickups when the next map is spawned.", "next-map"),
    serverToggle("server:q2.no-powerups", { kind: "bit", name: "dmflags", mask: 2, inverted: false }, "Exclude powerups", false, "Remove powerup pickups when the next map is spawned.", "next-map"),
    serverToggle("server:q2.no-armor", { kind: "bit", name: "dmflags", mask: 2048, inverted: false }, "Exclude armor items", false, "Remove armor pickups when the next map is spawned.", "next-map"),
  ] };
}
