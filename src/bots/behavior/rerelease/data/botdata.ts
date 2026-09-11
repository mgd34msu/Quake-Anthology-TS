// Adapted from quake-1-re-ts and quake-2-re-ts botdata readers.
// Schemas follow the installed Q1 2021 and Q2 2023 rerelease bots/*.txt files.
// KEX's reader is closed; this parses documented source data, not recovered engine code.
// Every record retains its original ordered fields, including unknown/repeated fields.

import { parseBlocks, fieldBool, fieldFlagList, fieldNumber, fieldString, type Block, type BlockField } from "./blockparse.ts";

export type BotDataFormat = "q1" | "q2";
export class BotSourceEntry {
  source: Block = { header: [], fields: [], line: 0 };
  unknown: BlockField[] = [];
}

function unknownKey(errors: string[], key: string, line: number): void {
  errors.push(`line ${line}: unknown key "${key}"`);
}

function expectString(errors: string[], key: string, values: string[], line: number): string | undefined {
  const s = fieldString(values);
  if (s === undefined) errors.push(`line ${line}: "${key}" expects a single string`);
  return s;
}

function expectNumber(errors: string[], key: string, values: string[], line: number): number | undefined {
  const n = fieldNumber(values);
  if (n === undefined) errors.push(`line ${line}: "${key}" expects a single number`);
  return n;
}

function expectBool(errors: string[], key: string, values: string[], line: number): boolean | undefined {
  const b = fieldBool(values);
  if (b === undefined) errors.push(`line ${line}: "${key}" expects "true" or "false"`);
  return b;
}

//=============================================================================
// characters.txt
//=============================================================================

export class CharacterEntry extends BotSourceEntry {
  funName = "";
  name = "";
  skin = "";
  dogtag = "";
  shirtColor = 0;
  pantsColor = 0;
}

export interface CharactersResult {
  entries: CharacterEntry[];
  errors: string[];
}

export function parseCharacters(text: string): CharactersResult {
  const { blocks, errors: blockErrors } = parseBlocks(text);
  const errors = blockErrors.map((e) => `line ${e.line}: ${e.message}`);
  const entries: CharacterEntry[] = [];

  for (const block of blocks) {
    const entry = new CharacterEntry();
    entry.source = block;
    for (const f of block.fields) {
      switch (f.key) {
        case "fun_name": {
          const s = expectString(errors, f.key, f.values, f.line);
          if (s !== undefined) entry.funName = s;
          break;
        }
        case "name": {
          const s = expectString(errors, f.key, f.values, f.line);
          if (s !== undefined) entry.name = s;
          break;
        }
        case "skin": {
          const value = expectString(errors, f.key, f.values, f.line);
          if (value !== undefined) entry.skin = value;
          break;
        }
        case "dogtag": {
          const value = expectString(errors, f.key, f.values, f.line);
          if (value !== undefined) entry.dogtag = value;
          break;
        }
        case "shirt_color": {
          const n = expectNumber(errors, f.key, f.values, f.line);
          if (n !== undefined) entry.shirtColor = n;
          break;
        }
        case "pants_color": {
          const n = expectNumber(errors, f.key, f.values, f.line);
          if (n !== undefined) entry.pantsColor = n;
          break;
        }
        default:
          entry.unknown.push(f);
          unknownKey(errors, f.key, f.line);
      }
    }
    entries.push(entry);
  }

  return { entries, errors };
}

//=============================================================================
// weapons.txt
//=============================================================================

export type BotWeaponIdentity = { readonly kind: "q1-bit"; readonly bit: number }
  | { readonly kind: "q2-classname"; readonly classname: string };

export class WeaponEntry extends BotSourceEntry {
  identity: BotWeaponIdentity = { kind: "q1-bit", bit: 0 };
  speed = 0;
  idealFov = 0;
  triggerType: "continuous" | "hold_and_release" = "continuous";
  triggerHold = 0;
  triggerCooldown = 0;
  name = "";
  number = 0;
  damage = 0;
  minRange = 0;
  maxRange = 0;
  minHeight = 0;
  maxHeight = 0;
  priority = 0;
  ammo = "";
  ammoName = "";
  minAmmo = 0;
  maxAmmo = 0;
  flags: string[] = [];
  aimPoint = "";
}

export interface WeaponsResult {
  entries: WeaponEntry[];
  errors: string[];
}

export function parseWeapons(text: string, format: BotDataFormat = "q1"): WeaponsResult {
  const { blocks, errors: blockErrors } = parseBlocks(text);
  const errors = blockErrors.map((e) => `line ${e.line}: ${e.message}`);
  const entries: WeaponEntry[] = [];

  for (const block of blocks) {
    const entry = new WeaponEntry();
    entry.source = block;
    for (const f of block.fields) {
      switch (f.key) {
        case "name": {
          const s = expectString(errors, f.key, f.values, f.line);
          if (s !== undefined) entry.name = s;
          break;
        }
        case "speed": {
          const value = expectNumber(errors, f.key, f.values, f.line);
          if (value !== undefined) entry.speed = value;
          break;
        }
        case "ideal_fov": {
          const value = expectNumber(errors, f.key, f.values, f.line);
          if (value !== undefined) entry.idealFov = value;
          break;
        }
        case "trigger_hold": {
          const value = expectNumber(errors, f.key, f.values, f.line);
          if (value !== undefined) entry.triggerHold = value;
          break;
        }
        case "trigger_cooldown": {
          const value = expectNumber(errors, f.key, f.values, f.line);
          if (value !== undefined) entry.triggerCooldown = value;
          break;
        }
        case "trigger_type": {
          const value = expectString(errors, f.key, f.values, f.line);
          if (value === "continuous" || value === "hold_and_release") entry.triggerType = value;
          else if (value !== undefined) errors.push(`line ${f.line}: unsupported trigger_type "${value}"`);
          break;
        }
        case "number": {
          const n = expectNumber(errors, f.key, f.values, f.line);
          if (n !== undefined) entry.number = n;
          break;
        }
        case "damage": {
          const n = expectNumber(errors, f.key, f.values, f.line);
          if (n !== undefined) entry.damage = n;
          break;
        }
        case "min_range": {
          const n = expectNumber(errors, f.key, f.values, f.line);
          if (n !== undefined) entry.minRange = n;
          break;
        }
        case "max_range": {
          const n = expectNumber(errors, f.key, f.values, f.line);
          if (n !== undefined) entry.maxRange = n;
          break;
        }
        case "min_height": {
          const n = expectNumber(errors, f.key, f.values, f.line);
          if (n !== undefined) entry.minHeight = n;
          break;
        }
        case "max_height": {
          const n = expectNumber(errors, f.key, f.values, f.line);
          if (n !== undefined) entry.maxHeight = n;
          break;
        }
        case "priority": {
          const n = expectNumber(errors, f.key, f.values, f.line);
          if (n !== undefined) entry.priority = n;
          break;
        }
        case "ammo": {
          const s = expectString(errors, f.key, f.values, f.line);
          if (s !== undefined) entry.ammo = s;
          break;
        }
        case "ammo_name": {
          const s = expectString(errors, f.key, f.values, f.line);
          if (s !== undefined) entry.ammoName = s;
          break;
        }
        case "min_ammo": {
          const n = expectNumber(errors, f.key, f.values, f.line);
          if (n !== undefined) entry.minAmmo = n;
          break;
        }
        case "max_ammo": {
          const n = expectNumber(errors, f.key, f.values, f.line);
          if (n !== undefined) entry.maxAmmo = n;
          break;
        }
        case "flags":
          entry.flags = fieldFlagList(f.values);
          break;
        case "aim_point": {
          const s = expectString(errors, f.key, f.values, f.line);
          if (s !== undefined) entry.aimPoint = s;
          break;
        }
        default:
          entry.unknown.push(f);
          unknownKey(errors, f.key, f.line);
      }
    }
    entry.identity = format === "q1" ? { kind: "q1-bit", bit: entry.number } : { kind: "q2-classname", classname: entry.name };
    entries.push(entry);
  }

  return { entries, errors };
}

//=============================================================================
// items.txt
//=============================================================================

/** One "spawnflags BIT = name" pair; items.txt allows repeating the key to list several. */
export class ItemSpawnflag {
  bit = 0;
  name = "";
}

export class ItemEntry extends BotSourceEntry {
  /** FLT_MAX is the documented source default when sight_dist is absent. */
  sightDist = 3.4028234663852886e38;
  name = "";
  spawnflags: ItemSpawnflag[] = [];
  flags: string[] = [];
  /** Only set in ctf's items.txt (item_flag_team1/2); absent everywhere else. */
  team: number | undefined = undefined;
}

export interface ItemsResult {
  entries: ItemEntry[];
  errors: string[];
}

export function parseItems(text: string): ItemsResult {
  const { blocks, errors: blockErrors } = parseBlocks(text);
  const errors = blockErrors.map((e) => `line ${e.line}: ${e.message}`);
  const entries: ItemEntry[] = [];

  for (const block of blocks) {
    const entry = new ItemEntry();
    entry.source = block;
    for (const f of block.fields) {
      switch (f.key) {
        case "name": {
          const s = expectString(errors, f.key, f.values, f.line);
          if (s !== undefined) entry.name = s;
          break;
        }
        case "sight_dist": {
          const value = expectNumber(errors, f.key, f.values, f.line);
          if (value !== undefined) entry.sightDist = value;
          break;
        }
        case "flags":
          entry.flags = fieldFlagList(f.values);
          break;
        case "spawnflags": {
          if (f.values.length === 3 && f.values[1] === "=") {
            const bit = Number(f.values[0]);
            const name = f.values[2];
            if (name === undefined) throw new Error("Missing source spawnflag name");
            if (!Number.isInteger(bit)) {
              errors.push(`line ${f.line}: "spawnflags" bit "${f.values[0]}" is not an integer`);
            } else {
              const flag = new ItemSpawnflag();
              flag.bit = bit;
              flag.name = name;
              entry.spawnflags.push(flag);
            }
          } else {
            errors.push(`line ${f.line}: "spawnflags" expects "BIT = name"`);
          }
          break;
        }
        case "team": {
          const n = expectNumber(errors, f.key, f.values, f.line);
          if (n !== undefined) entry.team = n;
          break;
        }
        default:
          entry.unknown.push(f);
          unknownKey(errors, f.key, f.line);
      }
    }
    entries.push(entry);
  }

  return { entries, errors };
}

//=============================================================================
// monsters.txt
//=============================================================================

export class MonsterEntry extends BotSourceEntry {
  classname = "";
  flags: string[] = [];
}

export interface MonstersResult {
  entries: MonsterEntry[];
  errors: string[];
}

export function parseMonsters(text: string): MonstersResult {
  const { blocks, errors: blockErrors } = parseBlocks(text);
  const errors = blockErrors.map((e) => `line ${e.line}: ${e.message}`);
  const entries: MonsterEntry[] = [];

  for (const block of blocks) {
    const entry = new MonsterEntry();
    entry.source = block;
    for (const f of block.fields) {
      switch (f.key) {
        case "classname": {
          const s = expectString(errors, f.key, f.values, f.line);
          if (s !== undefined) entry.classname = s;
          break;
        }
        case "flags":
          entry.flags = fieldFlagList(f.values);
          break;
        default:
          entry.unknown.push(f);
          unknownKey(errors, f.key, f.line);
      }
    }
    entries.push(entry);
  }

  return { entries, errors };
}

//=============================================================================
// interactables.txt
//=============================================================================

export interface BotInteractableBounds {
  readonly mins: readonly [number, number, number];
  readonly maxs: readonly [number, number, number];
}
export class InteractableEntry extends BotSourceEntry {
  bounds: BotInteractableBounds | undefined;
  name = "";
  interaction = "";
  /** Plain integer here -- NOT items.txt's "BIT = name" form. */
  spawnflags: number | undefined = undefined;
  health: boolean | undefined = undefined;
  targetname: boolean | undefined = undefined;
  logicOp: string | undefined = undefined;
}

export interface InteractablesResult {
  entries: InteractableEntry[];
  errors: string[];
}

export function parseInteractables(text: string): InteractablesResult {
  const { blocks, errors: blockErrors } = parseBlocks(text);
  const errors = blockErrors.map((e) => `line ${e.line}: ${e.message}`);
  const entries: InteractableEntry[] = [];

  for (const block of blocks) {
    const entry = new InteractableEntry();
    entry.source = block;
    for (const f of block.fields) {
      switch (f.key) {
        case "name": {
          const s = expectString(errors, f.key, f.values, f.line);
          if (s !== undefined) entry.name = s;
          break;
        }
        case "interaction": {
          const s = expectString(errors, f.key, f.values, f.line);
          if (s !== undefined) entry.interaction = s;
          break;
        }
        case "spawnflags": {
          const n = expectNumber(errors, f.key, f.values, f.line);
          if (n !== undefined) entry.spawnflags = n;
          break;
        }
        case "health": {
          const b = expectBool(errors, f.key, f.values, f.line);
          if (b !== undefined) entry.health = b;
          break;
        }
        case "targetname": {
          const b = expectBool(errors, f.key, f.values, f.line);
          if (b !== undefined) entry.targetname = b;
          break;
        }
        case "bounds": {
          const [openMin, x0, y0, z0, closeMin, openMax, x1, y1, z1, closeMax] = f.values;
          const values = [x0, y0, z0, x1, y1, z1].map(Number);
          if (f.values.length !== 10 || openMin !== "{" || closeMin !== "}" || openMax !== "{" || closeMax !== "}" || !values.every(Number.isFinite)) {
            errors.push(`line ${f.line}: "bounds" expects { x y z } { x y z }`);
          } else {
            entry.bounds = { mins: [Number(x0), Number(y0), Number(z0)], maxs: [Number(x1), Number(y1), Number(z1)] };
          }
          break;
        }
        case "logic_op": {
          const s = expectString(errors, f.key, f.values, f.line);
          if (s !== undefined) entry.logicOp = s;
          break;
        }
        default:
          entry.unknown.push(f);
          unknownKey(errors, f.key, f.line);
      }
    }
    entries.push(entry);
  }

  return { entries, errors };
}

//=============================================================================
// game_rules.txt
//=============================================================================

export interface BotRuleCondition { readonly cvar: string; readonly value: number; }
export class GameRuleEntry extends BotSourceEntry {
  conditions: BotRuleCondition[] = [];
  onlyGameType: string | undefined;
  notGameType: string | undefined;
  logicOp: "and" | "or" = "or";
  hasTeams: boolean | undefined;
  teamDamage: boolean | undefined;
  weaponStaySpecified = false;
  cvar = "";
  value = 0;
  weaponStay = false;
  gameType = "";
}

export interface GameRulesResult {
  entries: GameRuleEntry[];
  errors: string[];
}

export function parseGameRules(text: string): GameRulesResult {
  const { blocks, errors: blockErrors } = parseBlocks(text);
  const errors = blockErrors.map((e) => `line ${e.line}: ${e.message}`);
  const entries: GameRuleEntry[] = [];

  for (const block of blocks) {
    const entry = new GameRuleEntry();
    entry.source = block;
    const cvars: string[] = [], values: number[] = [];
    for (const f of block.fields) {
      switch (f.key) {
        case "cvar": {
          const s = expectString(errors, f.key, f.values, f.line);
          if (s !== undefined) { entry.cvar = s; cvars.push(s); }
          break;
        }
        case "value": {
          const n = expectNumber(errors, f.key, f.values, f.line);
          if (n !== undefined) { entry.value = n; values.push(n); }
          break;
        }
        case "weapon_stay": {
          const b = expectBool(errors, f.key, f.values, f.line);
          if (b !== undefined) { entry.weaponStay = b; entry.weaponStaySpecified = true; }
          break;
        }
        case "has_teams": {
          const value = expectBool(errors, f.key, f.values, f.line);
          if (value !== undefined) entry.hasTeams = value;
          break;
        }
        case "team_damage": {
          const value = expectBool(errors, f.key, f.values, f.line);
          if (value !== undefined) entry.teamDamage = value;
          break;
        }
        case "only_gametype": {
          const value = expectString(errors, f.key, f.values, f.line);
          if (value !== undefined) entry.onlyGameType = value;
          break;
        }
        case "not_gametype": {
          const value = expectString(errors, f.key, f.values, f.line);
          if (value !== undefined) entry.notGameType = value;
          break;
        }
        case "logic_op": {
          const value = expectString(errors, f.key, f.values, f.line);
          if (value === "and" || value === "or") entry.logicOp = value;
          else if (value !== undefined) errors.push(`line ${f.line}: unsupported logic_op "${value}"`);
          break;
        }
        case "game_type": {
          const s = expectString(errors, f.key, f.values, f.line);
          if (s !== undefined) entry.gameType = s;
          break;
        }
        default:
          entry.unknown.push(f);
          unknownKey(errors, f.key, f.line);
      }
    }
    if (cvars.length !== values.length || cvars.length > 2) errors.push(`line ${block.line}: game rule expects one or two paired cvar/value entries`);
    cvars.forEach((cvar, index) => { const value = values[index]; if (value !== undefined) entry.conditions.push({ cvar, value }); });
    entries.push(entry);
  }

  return { entries, errors };
}

//=============================================================================
// teams.txt
//=============================================================================

export class TeamEntry extends BotSourceEntry {
  value = 0;
  name = "";
}

export interface TeamsResult {
  entries: TeamEntry[];
  errors: string[];
}

export function parseTeams(text: string): TeamsResult {
  const { blocks, errors: blockErrors } = parseBlocks(text);
  const errors = blockErrors.map((e) => `line ${e.line}: ${e.message}`);
  const entries: TeamEntry[] = [];

  for (const block of blocks) {
    const entry = new TeamEntry();
    entry.source = block;
    for (const f of block.fields) {
      switch (f.key) {
        case "value": {
          const n = expectNumber(errors, f.key, f.values, f.line);
          if (n !== undefined) entry.value = n;
          break;
        }
        case "name": {
          const s = expectString(errors, f.key, f.values, f.line);
          if (s !== undefined) entry.name = s;
          break;
        }
        default:
          entry.unknown.push(f);
          unknownKey(errors, f.key, f.line);
      }
    }
    entries.push(entry);
  }

  return { entries, errors };
}

//=============================================================================
// chats.txt
//=============================================================================

export class ChatEntry extends BotSourceEntry {
  locstring = "";
  type = "";
  time = 0;
  chance = 0;
  team = false;
}

export interface ChatsResult {
  entries: ChatEntry[];
  errors: string[];
}

export function parseChats(text: string): ChatsResult {
  const { blocks, errors: blockErrors } = parseBlocks(text);
  const errors = blockErrors.map((e) => `line ${e.line}: ${e.message}`);
  const entries: ChatEntry[] = [];

  for (const block of blocks) {
    const entry = new ChatEntry();
    entry.source = block;
    for (const f of block.fields) {
      switch (f.key) {
        case "locstring": {
          const s = expectString(errors, f.key, f.values, f.line);
          if (s !== undefined) entry.locstring = s;
          break;
        }
        case "type": {
          const s = expectString(errors, f.key, f.values, f.line);
          if (s !== undefined) entry.type = s;
          break;
        }
        case "time": {
          const n = expectNumber(errors, f.key, f.values, f.line);
          if (n !== undefined) entry.time = n;
          break;
        }
        case "chance": {
          const n = expectNumber(errors, f.key, f.values, f.line);
          if (n !== undefined) entry.chance = n;
          break;
        }
        case "team": {
          const b = expectBool(errors, f.key, f.values, f.line);
          if (b !== undefined) entry.team = b;
          break;
        }
        default:
          entry.unknown.push(f);
          unknownKey(errors, f.key, f.line);
      }
    }
    entries.push(entry);
  }

  return { entries, errors };
}

//=============================================================================
// settings_PC.txt / settings_Consoles.txt / settings_Nintendo.txt
//=============================================================================

export class BotAimingSettings {
  maxAcceleration = 0;
  springStiffness = 0;
  damping = 0;
  velocityOffset = 0;
  leadTargets = false;
  modifierMaxAngle = 0;
  modifierApplyTime = 0;
  modifierAccelScalar = 0;
  modifierSpringScalar = 0;
  modifierDampingScalar = 0;
}

export class BotBehaviorSettings {
  combatMaxItemDist = 512;
  combatMinHealthPct = 100;
  combatMinAmmoPct = 100;
  combatMinArmorPct = 100;
  combatGrabWeapons = true;
  reactToDangers = false;
  allowCombat = false;
  allowGrabItemsInCombat = false;
  allowMelee = false;
  allowCheckSix = false;
  allowGrabItems = false;
  allowGrabPowerItems = false;
  deferPowerItemsToHumans = false;
  minRespawnTime = 0;
  maxRespawnTime = 0;
}

export class BotMovementSettings {
  allowJumpingInCombat = false;
  jumpChance = 0;
  jumpCooldown = 0;
  walkOnly = false;
  allowRocketJumping = false;
}

export class BotSensesSettings {
  sightTime = 0;
  sightDecayTime = 0;
  invisEnemySightScalar = 0;
  maxInvisEnemySightDist = 0;
  fovAngle = 0;
  forgetNonVisEnemyTime = 0;
  soundRange = 0;
  soundTime = 0;
  soundDecayTime = 0;
  soundPersistTime = 0;
}

export class BotWeaponSenseSettings {
  fovScalar = 0;
  decayTime = 0;
  fovAngle = 0;
  sightTime = 0;
}

export class BotSkillSettings {
  source: Block = { header: [], fields: [], line: 0 };
  skill = "";
  aiming = new BotAimingSettings();
  behaviors = new BotBehaviorSettings();
  movement = new BotMovementSettings();
  senses = new BotSensesSettings();
  weapons = new BotWeaponSenseSettings();
  /** Dotted keys this reader doesn't recognize, kept verbatim rather than dropped. */
  unknown: Record<string, string[]> = {};
}

export interface BotSettingsResult {
  skills: BotSkillSettings[];
  errors: string[];
}

function applySkillField(settings: BotSkillSettings, key: string, values: string[], line: number, errors: string[]): void {
  const num = (): number | undefined => expectNumber(errors, key, values, line);
  const bool = (): boolean | undefined => expectBool(errors, key, values, line);

  switch (key) {
    case "aiming.lead_targets": {
      const value = bool();
      if (value !== undefined) settings.aiming.leadTargets = value;
      break;
    }
    case "behaviors.combat.max_item_dist": {
      const value = num();
      if (value !== undefined) settings.behaviors.combatMaxItemDist = value;
      break;
    }
    case "behaviors.combat.min_health_pct": {
      const value = num();
      if (value !== undefined) settings.behaviors.combatMinHealthPct = value;
      break;
    }
    case "behaviors.combat.min_ammo_pct": {
      const value = num();
      if (value !== undefined) settings.behaviors.combatMinAmmoPct = value;
      break;
    }
    case "behaviors.combat.min_armor_pct": {
      const value = num();
      if (value !== undefined) settings.behaviors.combatMinArmorPct = value;
      break;
    }
    case "behaviors.combat.grab_weapons": {
      const value = bool();
      if (value !== undefined) settings.behaviors.combatGrabWeapons = value;
      break;
    }
    case "behaviors.react_to_dangers": {
      const value = bool();
      if (value !== undefined) settings.behaviors.reactToDangers = value;
      break;
    }
    case "movement.allow_rocket_jumping": {
      const value = bool();
      if (value !== undefined) settings.movement.allowRocketJumping = value;
      break;
    }
    case "weapons.fov_scalar": {
      const value = num();
      if (value !== undefined) settings.weapons.fovScalar = value;
      break;
    }
    case "aiming.max_acceleration": {
      const n = num();
      if (n !== undefined) settings.aiming.maxAcceleration = n;
      break;
    }
    case "aiming.spring_stiffness": {
      const n = num();
      if (n !== undefined) settings.aiming.springStiffness = n;
      break;
    }
    case "aiming.damping": {
      const n = num();
      if (n !== undefined) settings.aiming.damping = n;
      break;
    }
    case "aiming.velocity_offset": {
      const n = num();
      if (n !== undefined) settings.aiming.velocityOffset = n;
      break;
    }
    case "aiming.modifier.max_angle": {
      const n = num();
      if (n !== undefined) settings.aiming.modifierMaxAngle = n;
      break;
    }
    case "aiming.modifier.apply_time": {
      const n = num();
      if (n !== undefined) settings.aiming.modifierApplyTime = n;
      break;
    }
    case "aiming.modifier.accel_scalar": {
      const n = num();
      if (n !== undefined) settings.aiming.modifierAccelScalar = n;
      break;
    }
    case "aiming.modifier.spring_scalar": {
      const n = num();
      if (n !== undefined) settings.aiming.modifierSpringScalar = n;
      break;
    }
    case "aiming.modifier.damping_scalar": {
      const n = num();
      if (n !== undefined) settings.aiming.modifierDampingScalar = n;
      break;
    }
    case "behaviors.allow_combat": {
      const b = bool();
      if (b !== undefined) settings.behaviors.allowCombat = b;
      break;
    }
    case "behaviors.combat.allow_grab_items":
    case "behaviors.allow_grab_items_in_combat": {
      const b = bool();
      if (b !== undefined) settings.behaviors.allowGrabItemsInCombat = b;
      break;
    }
    case "behaviors.combat.allow_melee":
    case "behaviors.allow_melee": {
      const b = bool();
      if (b !== undefined) settings.behaviors.allowMelee = b;
      break;
    }
    case "behaviors.allow_check_six": {
      const b = bool();
      if (b !== undefined) settings.behaviors.allowCheckSix = b;
      break;
    }
    case "behaviors.allow_grab_items": {
      const b = bool();
      if (b !== undefined) settings.behaviors.allowGrabItems = b;
      break;
    }
    case "behaviors.allow_grab_power_items": {
      const b = bool();
      if (b !== undefined) settings.behaviors.allowGrabPowerItems = b;
      break;
    }
    case "behaviors.defer_power_items_to_humans": {
      const b = bool();
      if (b !== undefined) settings.behaviors.deferPowerItemsToHumans = b;
      break;
    }
    case "behaviors.min_respawn_time": {
      const n = num();
      if (n !== undefined) settings.behaviors.minRespawnTime = n;
      break;
    }
    case "behaviors.max_respawn_time": {
      const n = num();
      if (n !== undefined) settings.behaviors.maxRespawnTime = n;
      break;
    }
    case "movement.allow_jumping_in_combat": {
      const b = bool();
      if (b !== undefined) settings.movement.allowJumpingInCombat = b;
      break;
    }
    case "movement.jump_chance": {
      const n = num();
      if (n !== undefined) settings.movement.jumpChance = n;
      break;
    }
    case "movement.jump_cooldown": {
      const n = num();
      if (n !== undefined) settings.movement.jumpCooldown = n;
      break;
    }
    case "movement.walk_only": {
      const b = bool();
      if (b !== undefined) settings.movement.walkOnly = b;
      break;
    }
    case "senses.sight_time": {
      const n = num();
      if (n !== undefined) settings.senses.sightTime = n;
      break;
    }
    case "senses.sight_decay_time": {
      const n = num();
      if (n !== undefined) settings.senses.sightDecayTime = n;
      break;
    }
    case "senses.invis_enemy_sight_scalar": {
      const n = num();
      if (n !== undefined) settings.senses.invisEnemySightScalar = n;
      break;
    }
    case "senses.max_invis_enemy_sight_dist": {
      const n = num();
      if (n !== undefined) settings.senses.maxInvisEnemySightDist = n;
      break;
    }
    case "senses.fov_angle": {
      const n = num();
      if (n !== undefined) settings.senses.fovAngle = n;
      break;
    }
    case "senses.forget_non_vis_enemy_time": {
      const n = num();
      if (n !== undefined) settings.senses.forgetNonVisEnemyTime = n;
      break;
    }
    case "senses.sound_range": {
      const n = num();
      if (n !== undefined) settings.senses.soundRange = n;
      break;
    }
    case "senses.sound_time": {
      const n = num();
      if (n !== undefined) settings.senses.soundTime = n;
      break;
    }
    case "senses.sound_decay_time": {
      const n = num();
      if (n !== undefined) settings.senses.soundDecayTime = n;
      break;
    }
    case "senses.sound_persist_time": {
      const n = num();
      if (n !== undefined) settings.senses.soundPersistTime = n;
      break;
    }
    case "weapons.decay_time": {
      const n = num();
      if (n !== undefined) settings.weapons.decayTime = n;
      break;
    }
    case "weapons.fov_angle": {
      const n = num();
      if (n !== undefined) settings.weapons.fovAngle = n;
      break;
    }
    case "weapons.sight_time": {
      const n = num();
      if (n !== undefined) settings.weapons.sightTime = n;
      break;
    }
    default:
      settings.unknown[key] = values;
      unknownKey(errors, key, line);
  }
}

function parseSkillBlock(block: Block, errors: string[]): BotSkillSettings | undefined {
  if (block.header[0] !== "skill" || block.header.length !== 2) {
    errors.push(`line ${block.line}: block header is not "skill <name>" (got ${JSON.stringify(block.header)})`);
    return undefined;
  }
  const settings = new BotSkillSettings();
  settings.source = block;
  const name = block.header[1];
  if (name === undefined) throw new Error("Missing source skill name");
  settings.skill = name;
  for (const f of block.fields) applySkillField(settings, f.key, f.values, f.line, errors);
  return settings;
}

/**
 * Parses one of settings_PC.txt/settings_Consoles.txt/settings_Nintendo.txt
 * (all three are byte-identical in the retail id1 pak, but this reader
 * doesn't assume that -- it parses whichever text it's given).
 */
export function parseBotSettings(text: string): BotSettingsResult {
  const { blocks, errors: blockErrors } = parseBlocks(text);
  const errors = blockErrors.map((e) => `line ${e.line}: ${e.message}`);
  const skills: BotSkillSettings[] = [];

  for (const block of blocks) {
    const settings = parseSkillBlock(block, errors);
    if (settings !== undefined) skills.push(settings);
  }

  return { skills, errors };
}

/** The Q2 rerelease danger family; unknown flags remain available to the behavior owner. */
export class DangerEntry extends BotSourceEntry {
  name = "";
  sightDist = 3.4028234663852886e38;
  flags: string[] = [];
}
export interface DangersResult { entries: DangerEntry[]; errors: string[]; }
export function parseDangers(text: string): DangersResult {
  const { blocks, errors: blockErrors } = parseBlocks(text);
  const errors = blockErrors.map(error => `line ${error.line}: ${error.message}`), entries: DangerEntry[] = [];
  for (const block of blocks) {
    const entry = new DangerEntry(); entry.source = block;
    for (const field of block.fields) {
      if (field.key === "name") {
        const value = expectString(errors, field.key, field.values, field.line);
        if (value !== undefined) entry.name = value;
      } else if (field.key === "sight_dist") {
        const value = expectNumber(errors, field.key, field.values, field.line);
        if (value !== undefined) entry.sightDist = value;
      } else if (field.key === "flags") entry.flags = fieldFlagList(field.values);
      else { entry.unknown.push(field); unknownKey(errors, field.key, field.line); }
    }
    entries.push(entry);
  }
  return { entries, errors };
}
