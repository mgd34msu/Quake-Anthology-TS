// Public base-game enum translation from the extracted id Software 1.16n/1.17 SDK bg_public.h.
import type { QvmAbiProfile } from '../../contracts/execution.ts';
const events: readonly number[] = [
  0, // EV_NONE: legacy 0
  1, // EV_FOOTSTEP: legacy 1
  2, // EV_FOOTSTEP_METAL: legacy 2
  3, // EV_FOOTSPLASH: legacy 3
  4, // EV_FOOTWADE: legacy 4
  5, // EV_SWIM: legacy 5
  6, // EV_STEP_4: legacy 6
  7, // EV_STEP_8: legacy 7
  8, // EV_STEP_12: legacy 8
  9, // EV_STEP_16: legacy 9
  10, // EV_FALL_SHORT: legacy 10
  11, // EV_FALL_MEDIUM: legacy 11
  12, // EV_FALL_FAR: legacy 12
  13, // EV_JUMP_PAD: legacy 13
  14, // EV_JUMP: legacy 14
  15, // EV_WATER_TOUCH: legacy 15
  16, // EV_WATER_LEAVE: legacy 16
  17, // EV_WATER_UNDER: legacy 17
  18, // EV_WATER_CLEAR: legacy 18
  19, // EV_ITEM_PICKUP: legacy 19
  20, // EV_GLOBAL_ITEM_PICKUP: legacy 20
  21, // EV_NOAMMO: legacy 21
  22, // EV_CHANGE_WEAPON: legacy 22
  23, // EV_FIRE_WEAPON: legacy 23
  24, // EV_USE_ITEM0: legacy 24
  25, // EV_USE_ITEM1: legacy 25
  26, // EV_USE_ITEM2: legacy 26
  27, // EV_USE_ITEM3: legacy 27
  28, // EV_USE_ITEM4: legacy 28
  29, // EV_USE_ITEM5: legacy 29
  30, // EV_USE_ITEM6: legacy 30
  31, // EV_USE_ITEM7: legacy 31
  32, // EV_USE_ITEM8: legacy 32
  33, // EV_USE_ITEM9: legacy 33
  34, // EV_USE_ITEM10: legacy 34
  35, // EV_USE_ITEM11: legacy 35
  36, // EV_USE_ITEM12: legacy 36
  37, // EV_USE_ITEM13: legacy 37
  38, // EV_USE_ITEM14: legacy 38
  39, // EV_USE_ITEM15: legacy 39
  40, // EV_ITEM_RESPAWN: legacy 40
  41, // EV_ITEM_POP: legacy 41
  42, // EV_PLAYER_TELEPORT_IN: legacy 42
  43, // EV_PLAYER_TELEPORT_OUT: legacy 43
  44, // EV_GRENADE_BOUNCE: legacy 44
  45, // EV_GENERAL_SOUND: legacy 45
  46, // EV_GLOBAL_SOUND: legacy 46
  48, // EV_BULLET_HIT_FLESH: legacy 47
  49, // EV_BULLET_HIT_WALL: legacy 48
  50, // EV_MISSILE_HIT: legacy 49
  51, // EV_MISSILE_MISS: legacy 50
  53, // EV_RAILTRAIL: legacy 51
  54, // EV_SHOTGUN: legacy 52
  55, // EV_BULLET: legacy 53
  56, // EV_PAIN: legacy 54
  57, // EV_DEATH1: legacy 55
  58, // EV_DEATH2: legacy 56
  59, // EV_DEATH3: legacy 57
  60, // EV_OBITUARY: legacy 58
  61, // EV_POWERUP_QUAD: legacy 59
  62, // EV_POWERUP_BATTLESUIT: legacy 60
  63, // EV_POWERUP_REGEN: legacy 61
  64, // EV_GIB_PLAYER: legacy 62
  66, // EV_DEBUG_LINE: legacy 63
  68, // EV_TAUNT: legacy 64
];
export function qvmEvent(value: number, profile: QvmAbiProfile, reverse = false): number {
  if (profile === 'q3-modern') return value;
  const event = value & 255, flags = value & ~255;
  const mapped = reverse ? events.indexOf(event) : events[event];
  if (mapped === undefined || mapped < 0) throw new Error(`QVM event ${event} is not represented by the selected legacy ABI`);
  return mapped | flags;
}
export function qvmEntityType(value: number, profile: QvmAbiProfile, reverse = false): number {
  if (profile === 'q3-modern') return value;
  const sourceEvents = reverse ? 13 : 12, targetEvents = reverse ? 12 : 13;
  if (value >= sourceEvents) return targetEvents + qvmEvent(value - sourceEvents, profile, reverse);
  if (reverse && value === 12) throw new Error('Legacy QVM has no team entity type');
  return value;
}
export function qvmPersistent(values: readonly number[], profile: QvmAbiProfile): readonly number[] {
  if (profile === 'q3-modern') return values;
  // Source-only reward and accuracy counters remain in the guest memory/checkpoint.
  const result = Array<number>(16).fill(0);
  result[0] = values[0] ?? 0; // PERS_SCORE
  result[1] = values[1] ?? 0; // PERS_HITS
  result[2] = values[2] ?? 0; // PERS_RANK
  result[3] = values[3] ?? 0; // PERS_TEAM
  result[4] = values[4] ?? 0; // PERS_SPAWN_COUNT
  result[6] = values[7] ?? 0; // PERS_ATTACKER
  result[8] = values[8] ?? 0; // PERS_KILLED
  result[9] = values[9] ?? 0; // PERS_IMPRESSIVE_COUNT
  result[10] = values[10] ?? 0; // PERS_EXCELLENT_COUNT
  result[13] = values[11] ?? 0; // PERS_GAUNTLET_FRAG_COUNT
  return result;
}

export function qvmConfigstring(index: number, profile: QvmAbiProfile): number {
  if (profile === 'q3-modern') return index;
  if (index >= 12 && index <= 15) return index + 8;
  if (index >= 16 && index <= 26) throw new Error(`Legacy private configstring ${index} has no declared modern presentation mapping`);
  return index;
}
export function qvmPowerupBits(bits: number, profile: QvmAbiProfile): number {
  if (profile !== 'q3-modern' && (bits & ~0x1ff) !== 0) throw new Error('Legacy ball or private powerup has no modern presentation mapping');
  return bits;
}
export function qvmPowerups(values: readonly number[], profile: QvmAbiProfile): readonly number[] {
  if (profile !== 'q3-modern' && values.slice(9).some(value => value !== 0)) throw new Error('Legacy ball or private powerup has no modern presentation mapping');
  return values;
}
