import type { Q2WeaponDefinition } from "../../foundation/weapons/types.ts";

export const xatrixWeaponDefinitions: readonly Q2WeaponDefinition[] = [
  { name: "trap", item: "q2:ammo_trap", classname: "ammo_trap", ammo: "q2:ammo_trap", quantity: 1, warning: 1,
    viewModel: "models/weapons/v_trap/tris.md2", worldModel: "models/weapons/g_trap/tris.md2", playerModel: 0,
    activateLast: 0, fireLast: 15, idleLast: 48, deactivateLast: 48, pauses: [29, 34, 39, 48], fires: [12], repeating: false },
  { name: "ionripper", item: "q2:weapon_boomer", classname: "weapon_boomer", ammo: "q2:ammo_cells", quantity: 2, warning: 10,
    viewModel: "models/weapons/v_boomer/tris.md2", worldModel: "models/weapons/g_boom/tris.md2", playerModel: 13,
    activateLast: 4, fireLast: 6, idleLast: 36, deactivateLast: 39, pauses: [36], fires: [5], repeating: false },
  { name: "phalanx", item: "q2:weapon_phalanx", classname: "weapon_phalanx", ammo: "q2:ammo_magslug", quantity: 1, warning: 5,
    viewModel: "models/weapons/v_shotx/tris.md2", worldModel: "models/weapons/g_shotx/tris.md2", playerModel: 12,
    activateLast: 5, fireLast: 20, idleLast: 58, deactivateLast: 63, pauses: [29, 42, 55], fires: [7, 8], repeating: false },
];

export const rogueWeaponDefinitions: readonly Q2WeaponDefinition[] = [
  { name: "tesla", item: "q2:ammo_tesla", classname: "ammo_tesla", ammo: "q2:ammo_tesla", quantity: 1, warning: 2,
    viewModel: "models/weapons/v_tesla/tris.md2", worldModel: "models/ammo/am_tesl/tris.md2", playerModel: 0,
    activateLast: 0, fireLast: 8, idleLast: 32, deactivateLast: 32, pauses: [21], fires: [2], repeating: false },
  { name: "proxlauncher", item: "q2:weapon_proxlauncher", classname: "weapon_proxlauncher", ammo: "q2:ammo_prox", quantity: 1, warning: 5,
    viewModel: "models/weapons/v_launch/tris.md2", worldModel: "models/weapons/g_launch/tris.md2", playerModel: 15,
    activateLast: 5, fireLast: 16, idleLast: 59, deactivateLast: 64, pauses: [34, 51, 59], fires: [6], repeating: false },
  { name: "chainfist", item: "q2:weapon_chainfist", classname: "weapon_chainfist", ammo: null, quantity: 0, warning: 0,
    viewModel: "models/weapons/v_chainf/tris.md2", worldModel: "models/weapons/g_chainf/tris.md2", playerModel: 16,
    activateLast: 4, fireLast: 32, idleLast: 57, deactivateLast: 60, pauses: [], fires: [8, 9, 16, 17, 18, 30, 31], repeating: false },
  { name: "disintegrator", item: "q2:weapon_disintegrator", classname: "weapon_disintegrator", ammo: "q2:ammo_disruptor", quantity: 1, warning: 5,
    viewModel: "models/weapons/v_dist/tris.md2", worldModel: "models/weapons/g_dist/tris.md2", playerModel: 12,
    activateLast: 4, fireLast: 9, idleLast: 29, deactivateLast: 34, pauses: [14, 19, 23], fires: [5], repeating: false },
  { name: "etf_rifle", item: "q2:weapon_etf_rifle", classname: "weapon_etf_rifle", ammo: "q2:ammo_flechettes", quantity: 1, warning: 30,
    viewModel: "models/weapons/v_etf_rifle/tris.md2", worldModel: "models/weapons/g_etf_rifle/tris.md2", playerModel: 13,
    activateLast: 4, fireLast: 7, idleLast: 37, deactivateLast: 41, pauses: [18, 28], fires: [6, 7], repeating: false },
  { name: "heatbeam", item: "q2:weapon_plasmabeam", classname: "weapon_plasmabeam", ammo: "q2:ammo_cells", quantity: 2, warning: 10,
    viewModel: "models/weapons/v_beamer/tris.md2", worldModel: "models/weapons/g_beamer/tris.md2", playerModel: 14,
    activateLast: 8, fireLast: 12, idleLast: 39, deactivateLast: 44, pauses: [35], fires: [9, 10, 11, 12], repeating: false },
];
