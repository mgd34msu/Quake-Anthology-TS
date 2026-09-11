import type { JsonValue } from "../../schema/contracts.ts";
import type { OracleInput } from "../../../tools/reference/q2/oracle.ts";
import type { SourceLocation } from "../../../tools/reference/q2/sources.ts";

export interface Q2ReferenceCase {
  readonly id: string;
  readonly contract: string;
  readonly sources: readonly SourceLocation[];
  readonly preconditions: readonly string[];
  readonly input: OracleInput;
  readonly expected: JsonValue;
}

const classicThink: readonly SourceLocation[] = [
  { source: "classicPhys", firstLine: 95, lastLine: 111, symbol: "SV_RunThink" },
];
const rereleaseThink: readonly SourceLocation[] = [
  { source: "rereleasePhys", firstLine: 99, lastLine: 113, symbol: "SV_RunThink" },
];
const pickupSources: readonly SourceLocation[] = [
  { source: "classicLocal", firstLine: 234, lastLine: 240, symbol: "gitem_t.pickup" },
  { source: "classicItems", firstLine: 447, lastLine: 510, symbol: "Add_Ammo/Pickup_Ammo" },
  { source: "classicItems", firstLine: 761, lastLine: 821, symbol: "Touch_Item" },
];
const pickupPreconditions = ["Alive client; ordinary supported ammo; positive quantity; no weapon flag; singleplayer; no stay-coop or respawn flags; target callback observes without deleting the item."];
const armorSources: readonly SourceLocation[] = [
  { source: "classicLocal", firstLine: 202, lastLine: 210, symbol: "gitem_armor_t" },
  { source: "classicItems", firstLine: 39, lastLine: 41, symbol: "armor_info" },
  { source: "classicCombat", firstLine: 255, lastLine: 292, symbol: "CheckArmor" },
  { source: "classicCombat", firstLine: 474, lastLine: 477, symbol: "T_Damage remaining take" },
];
const crossSources: readonly SourceLocation[] = [
  { source: "rereleaseLocal", firstLine: 251, lastLine: 262, symbol: "SPAWNFLAG_EDITOR_MASK" },
  { source: "rereleaseLocal", firstLine: 733, lastLine: 733, symbol: "SFL_CROSS_TRIGGER_MASK" },
  { source: "rereleaseTarget", firstLine: 1985, lastLine: 2031, symbol: "trigger_crossunit_trigger_use/target_crossunit_target_think" },
];
const commandSources: readonly SourceLocation[] = [
  { source: "classicMove", firstLine: 779, lastLine: 822, symbol: "PM_CheckJump" },
  { source: "classicMove", firstLine: 994, lastLine: 1003, symbol: "PM_CheckDuck" },
  { source: "rereleaseGame", firstLine: 417, lastLine: 425, symbol: "button_t" },
  { source: "rereleaseMove", firstLine: 1065, lastLine: 1102, symbol: "PM_CheckJump" },
  { source: "rereleaseMove", firstLine: 1372, lastLine: 1391, symbol: "PM_CheckDuck" },
];
const commandPreconditions = ["Only command predicates are evaluated. Alive grounded client; landing timer and jump-held clear; no ladder; standing transition trace clear. Full movement is outside this case."];
const configSources: readonly SourceLocation[] = [
  { source: "rereleaseSpawn", firstLine: 1517, lastLine: 1529, symbol: "SP_worldspawn Q64 and air acceleration" },
  { source: "rereleaseCgame", firstLine: 19, lastLine: 26, symbol: "InitCGame configuration consumption" },
];

export const q2Cases: readonly Q2ReferenceCase[] = [
  {
    id: "q2.clock.classic10hz-rerelease40hz",
    contract: "Classic stores frame*double(0.1) in binary32 seconds; rerelease accumulates the supplied integer millisecond frame time. The documented 40 Hz setting supplies 25 ms.",
    sources: [
      { source: "classicLocal", firstLine: 73, lastLine: 73, symbol: "FRAMETIME" },
      { source: "classicLocal", firstLine: 301, lastLine: 304, symbol: "level_locals_t.time" },
      { source: "classicMain", firstLine: 353, lastLine: 359, symbol: "G_RunFrame" },
      { source: "rereleaseLocal", firstLine: 288, lastLine: 309, symbol: "gtime_t" },
      { source: "rereleaseMain", firstLine: 415, lastLine: 415, symbol: "FRAME_TIME_MS initialization" },
      { source: "rereleaseMain", firstLine: 823, lastLine: 831, symbol: "G_RunFrame_" },
      { source: "rereleaseReadme", firstLine: 46, lastLine: 48, symbol: "40hz Tickrate Support" },
    ],
    preconditions: ["Normal frame path, level starts at zero; binary32 storage with binary64 evaluation of the unsuffixed classic literal; no claim about x87 excess precision; wire codec is outside this clock."],
    input: { kind: "clock", classicFrames: [1, 2, 3, 10], rereleaseStepMs: 25, rereleaseFrames: 4 },
    expected: { classicTimesSeconds: [0.10000000149011612, 0.20000000298023224, 0.30000001192092896, 1], rereleaseTimesMs: [25, 50, 75, 100] },
  },
  {
    id: "q2.think.classic-lookahead-due",
    contract: "A nextthink less than level.time+0.001 fires early; it is zero inside the callback, callback rescheduling survives, and SV_RunThink returns false.",
    sources: classicThink, preconditions: ["Valid synchronous think callback; values use seconds."],
    input: { kind: "think", family: "classic", now: 0.1, nextthink: 0.1009, reschedule: 0.2 },
    expected: { now: 0.10000000149011612, nextthink: 0.20000000298023224, mayContinuePhysics: false, trace: [{ event: "think.enter", nextthink: 0 }, { event: "think.return", nextthink: 0.20000000298023224 }] },
  },
  {
    id: "q2.think.classic-lookahead-future",
    contract: "A deadline beyond the classic epsilon remains pending and returns true.",
    sources: classicThink, preconditions: ["Values use seconds."],
    input: { kind: "think", family: "classic", now: 0.1, nextthink: 0.102, reschedule: 0.2 },
    expected: { now: 0.10000000149011612, nextthink: 0.10199999809265137, mayContinuePhysics: true, trace: [] },
  },
  {
    id: "q2.think.classic-disabled",
    contract: "A zero deadline disables think even after level time has advanced.",
    sources: classicThink, preconditions: ["Values use seconds."],
    input: { kind: "think", family: "classic", now: 1, nextthink: 0, reschedule: 2 },
    expected: { now: 1, nextthink: 0, mayContinuePhysics: true, trace: [] },
  },
  {
    id: "q2.think.rerelease-one-ms-future",
    contract: "Rerelease does not apply the classic 1 ms lookahead.",
    sources: rereleaseThink, preconditions: ["Values use integer milliseconds."],
    input: { kind: "think", family: "rerelease", now: 100, nextthink: 101, reschedule: 200 },
    expected: { now: 100, nextthink: 101, mayContinuePhysics: true, trace: [] },
  },
  {
    id: "q2.think.rerelease-equal-deadline",
    contract: "An equal rerelease deadline runs synchronously, clears nextthink first, preserves rescheduling, and returns false.",
    sources: rereleaseThink, preconditions: ["Valid synchronous think callback; integer milliseconds."],
    input: { kind: "think", family: "rerelease", now: 100, nextthink: 100, reschedule: 125 },
    expected: { now: 100, nextthink: 125, mayContinuePhysics: false, trace: [{ event: "think.enter", nextthink: 0 }, { event: "think.return", nextthink: 125 }] },
  },
  {
    id: "q2.frame.classic-world-client-order",
    contract: "The world runs first, the client takes ClientBeginServerFrame, later edicts run in slot order, then rules and final client frames run.",
    sources: [{ source: "classicMain", firstLine: 353, lastLine: 410, symbol: "G_RunFrame" }],
    preconditions: ["No intermission, ground changes, or entity callback mutations. Slots 0,1,2,3 in use; maxclients=1; entity callback order is recorded, not complete physics."],
    input: { kind: "frame-order", deleteLaterActor: false, spawnActor: false },
    expected: { trace: ["level.framenum++", "level.time=frame*0.1", "AI_SetSightClient", { event: "current_entity+old_origin", actor: 0 }, { event: "G_RunEntity.enter", actor: 0 }, { event: "G_RunEntity.return", actor: 0 }, { event: "current_entity+old_origin", actor: 1 }, { event: "ClientBeginServerFrame", actor: 1 }, { event: "current_entity+old_origin", actor: 2 }, { event: "G_RunEntity.enter", actor: 2 }, { event: "G_RunEntity.return", actor: 2 }, { event: "current_entity+old_origin", actor: 3 }, { event: "G_RunEntity.enter", actor: 3 }, { event: "G_RunEntity.return", actor: 3 }, "CheckDMRules", "ClientEndServerFrames"] },
  },
  {
    id: "q2.frame.classic-live-edict-loop",
    contract: "The loop reads current num_edicts and inuse each iteration: an authored append is visible in the same frame and a deleted later slot is skipped.",
    sources: [{ source: "classicMain", firstLine: 376, lastLine: 410, symbol: "G_RunFrame live edict loop" }],
    preconditions: ["No intermission or ground changes; maxclients=1. Callback at slot 2 explicitly clears slot 3 inuse, appends active slot 4, and sets num_edicts=5. This fixture does not model G_Spawn allocator policy."],
    input: { kind: "frame-order", deleteLaterActor: true, spawnActor: true },
    expected: { trace: ["level.framenum++", "level.time=frame*0.1", "AI_SetSightClient", { event: "current_entity+old_origin", actor: 0 }, { event: "G_RunEntity.enter", actor: 0 }, { event: "G_RunEntity.return", actor: 0 }, { event: "current_entity+old_origin", actor: 1 }, { event: "ClientBeginServerFrame", actor: 1 }, { event: "current_entity+old_origin", actor: 2 }, { event: "G_RunEntity.enter", actor: 2 }, { event: "authored.delete", actor: 3 }, { event: "authored.append", actor: 4 }, { event: "G_RunEntity.return", actor: 2 }, { event: "current_entity+old_origin", actor: 4 }, { event: "G_RunEntity.enter", actor: 4 }, { event: "G_RunEntity.return", actor: 4 }, "CheckDMRules", "ClientEndServerFrames"] },
  },
  {
    id: "q2.pickup.full-ammo-still-uses-targets",
    contract: "False pickup return suppresses feedback/freeing, but targets fire before the failed-pickup early return and before ITEM_TARGETS_USED is set.",
    sources: pickupSources, preconditions: pickupPreconditions,
    input: { kind: "pickup", inventory: 200, capacity: 200, quantity: 50, targetsUsed: false },
    expected: { taken: false, targetsUsed: true, freed: false, inventory: 200, trace: [{ event: "Pickup_Ammo.enter", inventory: 200 }, { event: "Pickup_Ammo.return", taken: false, inventory: 200 }, { event: "Touch_Item.observes-return", taken: false }, { event: "G_UseTargets.enter", inventory: 200, targetsUsed: false }, "G_UseTargets.return", "ITEM_TARGETS_USED=set"] },
  },
  {
    id: "q2.pickup.targets-once",
    contract: "ITEM_TARGETS_USED suppresses a repeat target callback when the pickup still fails.",
    sources: pickupSources, preconditions: pickupPreconditions,
    input: { kind: "pickup", inventory: 200, capacity: 200, quantity: 50, targetsUsed: true },
    expected: { taken: false, targetsUsed: true, freed: false, inventory: 200, trace: [{ event: "Pickup_Ammo.enter", inventory: 200 }, { event: "Pickup_Ammo.return", taken: false, inventory: 200 }, { event: "Touch_Item.observes-return", taken: false }] },
  },
  {
    id: "q2.pickup.partial-ammo-synchronous-return",
    contract: "Clamped partial pickup returns true; targets synchronously observe the updated inventory before the item is freed.",
    sources: pickupSources, preconditions: pickupPreconditions,
    input: { kind: "pickup", inventory: 199, capacity: 200, quantity: 50, targetsUsed: false },
    expected: { taken: true, targetsUsed: true, freed: true, inventory: 200, trace: [{ event: "Pickup_Ammo.enter", inventory: 199 }, { event: "Pickup_Ammo.return", taken: true, inventory: 200 }, { event: "Touch_Item.observes-return", taken: true }, "pickup.feedback", { event: "G_UseTargets.enter", inventory: 200, targetsUsed: false }, "G_UseTargets.return", "ITEM_TARGETS_USED=set", "G_FreeEdict"] },
  },
  {
    id: "q2.armor.round-up-one-damage", contract: "Armor saves ceil(binary32(protection*damage)), so jacket armor absorbs one normal damage entirely.",
    sources: armorSources, preconditions: ["Client with selected armor, positive damage entering CheckArmor; no preceding damage modifiers modeled."],
    input: { kind: "armor", damage: 1, inventory: 50, armor: "jacket", energy: false, bypass: false },
    expected: { absorbed: 1, remainingArmor: 49, remainingDamage: 0, effect: "SpawnDamage" },
  },
  {
    id: "q2.armor.binary32-before-ceil", contract: "The binary32 product of stored 0.3f and 10 is 3, so ceil saves 3. Promoting stored 0.3f directly to binary64 multiplication would incorrectly save 4 in this model.",
    sources: armorSources, preconditions: ["Binary32 multiplication without x87 excess precision; client with jacket armor; normal damage."],
    input: { kind: "armor", damage: 10, inventory: 50, armor: "jacket", energy: false, bypass: false },
    expected: { absorbed: 3, remainingArmor: 47, remainingDamage: 7, effect: "SpawnDamage" },
  },
  {
    id: "q2.armor.energy-jacket", contract: "Jacket energy protection is zero and emits no armor spark event.",
    sources: armorSources, preconditions: ["Client with jacket armor; no preceding damage modifiers modeled."],
    input: { kind: "armor", damage: 10, inventory: 50, armor: "jacket", energy: true, bypass: false },
    expected: { absorbed: 0, remainingArmor: 50, remainingDamage: 10, effect: null },
  },
  {
    id: "q2.armor.clamp-inventory", contract: "Absorption cannot exceed remaining armor inventory.",
    sources: armorSources, preconditions: ["Client with body armor; no preceding damage modifiers modeled."],
    input: { kind: "armor", damage: 10, inventory: 2, armor: "body", energy: false, bypass: false },
    expected: { absorbed: 2, remainingArmor: 0, remainingDamage: 8, effect: "SpawnDamage" },
  },
  {
    id: "q2.armor.no-armor-flag", contract: "DAMAGE_NO_ARMOR returns zero before inventory mutation or effects.",
    sources: armorSources, preconditions: ["Client with body armor; no preceding damage modifiers modeled."],
    input: { kind: "armor", damage: 10, inventory: 100, armor: "body", energy: false, bypass: true },
    expected: { absorbed: 0, remainingArmor: 100, remainingDamage: 10, effect: null },
  },
  {
    id: "q2.cross-unit.all-required", contract: "A trigger ORs its bits into unit flags; the target requires every requested non-editor bit before using targets and freeing itself.",
    sources: crossSources, preconditions: ["Non-deathmatch target think invoked; synchronous G_UseTargets callback returns without mutation."],
    input: { kind: "cross-unit", flags: 1, trigger: 2, required: 3 },
    expected: { flags: 3, satisfied: true, trace: ["flags|=trigger", "G_FreeEdict(trigger)", "G_UseTargets(target,target)", "G_FreeEdict(target)"] },
  },
  {
    id: "q2.cross-unit.missing-required", contract: "One missing required bit prevents progression.",
    sources: crossSources, preconditions: ["Non-deathmatch target think invoked."],
    input: { kind: "cross-unit", flags: 1, trigger: 4, required: 3 },
    expected: { flags: 5, satisfied: false, trace: ["flags|=trigger", "G_FreeEdict(trigger)"] },
  },
  {
    id: "q2.cross-unit.high-bit-unsigned", contract: "The uint32 comparison supports high trigger bits without signed JavaScript comparison loss.",
    sources: crossSources, preconditions: ["Non-deathmatch target think invoked."],
    input: { kind: "cross-unit", flags: 0, trigger: 2147483648, required: 2147483648 },
    expected: { flags: 2147483648, satisfied: true, trace: ["flags|=trigger", "G_FreeEdict(trigger)", "G_UseTargets(target,target)", "G_FreeEdict(target)"] },
  },
  {
    id: "q2.cross-unit.editor-bits-excluded", contract: "The cross-trigger mask excludes bits 8 through 15, including an authored required editor bit.",
    sources: crossSources, preconditions: ["Direct target-think input; spawn parsing/inhibition is outside this malformed-requirement boundary case."],
    input: { kind: "cross-unit", flags: 0, trigger: 256, required: 256 },
    expected: { flags: 256, satisfied: false, trace: ["flags|=trigger", "G_FreeEdict(trigger)"] },
  },
  {
    id: "q2.save.poi-story-fields", contract: "Original FIELD_AUTO declarations retain these POI, health bar, and story fields. This is a field-selection projection, not a save codec round trip.",
    sources: [{ source: "rereleaseSave", firstLine: 728, lastLine: 740, symbol: "level_locals_t save fields" }],
    preconditions: ["Entity references are represented symbolically; JSON encoding, pointer remapping, and load hooks are not evaluated."],
    input: { kind: "save-fields", struct: "level_locals_t", fields: { current_poi_stage: 9, valid_poi: true, current_poi_image: 7, current_dynamic_poi: "edict:17", health_bar_entities: ["edict:18"], story_active: true, not_a_save_field: 999 } },
    expected: { retained: { current_poi_stage: 9, valid_poi: true, current_poi_image: 7, current_dynamic_poi: "edict:17", health_bar_entities: ["edict:18"], story_active: true }, omitted: ["not_a_save_field"] },
  },
  {
    id: "q2.save.fog-brush-animation-fields", contract: "The source declares entity fog and all sampled brush animation fields, including enabled and next_tick.",
    sources: [{ source: "rereleaseSave", firstLine: 1262, lastLine: 1301, symbol: "edict_t fog/bmodel_anim fields" }],
    preconditions: ["Field selection only; supplied density is the binary32 value of authored 0.35; next_tick is represented in integer milliseconds."],
    input: { kind: "save-fields", struct: "edict_t", fields: { "fog.density": 0.3499999940395355, "fog.sky_factor": 0.5, "bmodel_anim.enabled": true, "bmodel_anim.start": 5, "bmodel_anim.end": 12, "bmodel_anim.alternate": true, "bmodel_anim.currently_alternate": false, "bmodel_anim.next_tick": 125 } },
    expected: { retained: { "fog.density": 0.3499999940395355, "fog.sky_factor": 0.5, "bmodel_anim.enabled": true, "bmodel_anim.start": 5, "bmodel_anim.end": 12, "bmodel_anim.alternate": true, "bmodel_anim.currently_alternate": false, "bmodel_anim.next_tick": 125 }, omitted: [] },
  },
  {
    id: "q2.save.max-ammo-array", contract: "Rerelease saves the max_ammo array, whose index 8 stores flechette capacity. A TS-only max_flechettes field name is not the original representation.",
    sources: [{ source: "rereleaseSave", firstLine: 484, lastLine: 497, symbol: "std::array save type" }, { source: "rereleaseSave", firstLine: 788, lastLine: 802, symbol: "client_persistant_t.max_ammo" }, { source: "rereleaseShared", firstLine: 79, lastLine: 98, symbol: "ammo_t" }],
    preconditions: ["Field-selection projection; valid int16 capacities in original enum order; no byte codec claimed."],
    input: { kind: "save-fields", struct: "client_persistant_t", fields: { max_ammo: [200, 100, 50, 50, 200, 50, 50, 5, 200, 5, 12, 50], max_flechettes: 200 } },
    expected: { retained: { max_ammo: [200, 100, 50, 50, 200, 50, 50, 5, 200, 5, 12, 50] }, omitted: ["max_flechettes"] },
  },
  {
    id: "q2.save.cross-unit-fields", contract: "Game-level serialization has separate cross-level and cross-unit flag fields.",
    sources: [{ source: "rereleaseSave", firstLine: 661, lastLine: 680, symbol: "game_locals_t save fields" }],
    preconditions: ["Field selection only."],
    input: { kind: "save-fields", struct: "game_locals_t", fields: { cross_level_flags: 3, cross_unit_flags: 65537 } },
    expected: { retained: { cross_level_flags: 3, cross_unit_flags: 65537 }, omitted: [] },
  },
  {
    id: "q2.flechette.source-default", contract: "Extract the original ammo enum index and initialized flechette capacity directly from raw source.",
    sources: [{ source: "rereleaseShared", firstLine: 79, lastLine: 98, symbol: "ammo_t" }, { source: "rereleaseClient", firstLine: 844, lastLine: 858, symbol: "InitClientPersistant default ammo capacities" }],
    preconditions: ["The !taken_loadout initialization branch is selected; capacity upgrades and custom loadouts are outside this case."],
    input: { kind: "flechette-default" }, expected: { arrayIndex: 8, arrayLength: 12, defaultCapacity: 200, savedField: "max_ammo" },
  },
  {
    id: "q2.q64.publishes-and-sets-server-config", contract: "Q64 non-deathmatch worldspawn publishes CONFIG_N64_PHYSICS and immediately sets server pm_config, then publishes and stores air acceleration.",
    sources: configSources, preconditions: ["Start at the displayed worldspawn block with integer cvar air acceleration; this does not run prediction."],
    input: { kind: "q64-config", isN64: true, deathmatch: false, initialN64Physics: false, airacceleration: 1 },
    expected: { serverN64Physics: true, serverAiracceleration: 1, trace: [{ event: "configstring", name: "CONFIG_N64_PHYSICS", value: "1" }, { event: "server.pm_config.n64_physics", value: true }, "G_InitStatusbar", { event: "configstring", name: "CS_AIRACCEL", value: "1" }, { event: "server.pm_config.airaccel", value: 1 }] },
  },
  {
    id: "q2.q64.deathmatch-does-not-enable", contract: "Q64 deathmatch skips the N64 physics enable block; air acceleration still propagates.",
    sources: configSources, preconditions: ["Initial server n64_physics=false; surrounding worldspawn reset and cgame update callbacks are outside this block."],
    input: { kind: "q64-config", isN64: true, deathmatch: true, initialN64Physics: false, airacceleration: 0 },
    expected: { serverN64Physics: false, serverAiracceleration: 0, trace: ["G_InitStatusbar", { event: "configstring", name: "CS_AIRACCEL", value: "0" }, { event: "server.pm_config.airaccel", value: 0 }] },
  },
  {
    id: "q2.q64.block-does-not-clear-prior-state", contract: "This source block contains no else clearing n64_physics; prior state is retained when its condition is false.",
    sources: configSources, preconditions: ["Deliberately supplied pre-block true state; this does not imply that full worldspawn fails to reset configuration."],
    input: { kind: "q64-config", isN64: false, deathmatch: false, initialN64Physics: true, airacceleration: 0 },
    expected: { serverN64Physics: true, serverAiracceleration: 0, trace: ["G_InitStatusbar", { event: "configstring", name: "CS_AIRACCEL", value: "0" }, { event: "server.pm_config.airaccel", value: 0 }] },
  },
  {
    id: "q2.commands.classic-jump-threshold-below", contract: "upmove=9 does not hold classic jump; the rerelease jump button does hold rerelease jump.",
    sources: commandSources, preconditions: commandPreconditions,
    input: { kind: "command-predicates", upmove: 9, buttons: 8, n64Physics: false },
    expected: { classicHoldingJump: false, classicGroundedDuckBranch: false, rereleaseHoldingJump: true, rereleaseGroundedDuckBranch: false },
  },
  {
    id: "q2.commands.classic-jump-threshold-equal", contract: "upmove=10 holds classic jump independently of rerelease button bits.",
    sources: commandSources, preconditions: commandPreconditions,
    input: { kind: "command-predicates", upmove: 10, buttons: 0, n64Physics: false },
    expected: { classicHoldingJump: true, classicGroundedDuckBranch: false, rereleaseHoldingJump: false, rereleaseGroundedDuckBranch: false },
  },
  {
    id: "q2.commands.crouch-native-predicates", contract: "Negative classic upmove and rerelease BUTTON_CROUCH request their grounded duck branches.",
    sources: commandSources, preconditions: commandPreconditions,
    input: { kind: "command-predicates", upmove: -400, buttons: 16, n64Physics: false },
    expected: { classicHoldingJump: false, classicGroundedDuckBranch: true, rereleaseHoldingJump: false, rereleaseGroundedDuckBranch: true },
  },
  {
    id: "q2.commands.q64-disables-duck", contract: "Q64 configuration prevents the rerelease duck branch even with BUTTON_CROUCH set.",
    sources: commandSources, preconditions: commandPreconditions,
    input: { kind: "command-predicates", upmove: -400, buttons: 16, n64Physics: true },
    expected: { classicHoldingJump: false, classicGroundedDuckBranch: true, rereleaseHoldingJump: false, rereleaseGroundedDuckBranch: false },
  },
];
