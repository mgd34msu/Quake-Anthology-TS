// SPDX-License-Identifier: GPL-2.0-or-later
import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { corpusFile, corpusTest } from "../../support/corpus.ts";
import { parsePe, type PeFile } from "../../../src/guest/pe/index.ts";
import type { MonsterMove } from "../../../src/content/q2/foundation/monsters/types.ts";
import { rereleaseMissionPackCallbacks, rereleaseMissionPackMoves } from "../../../src/content/q2/rerelease/monsters/tables/missionpack.ts";
import { carrierMoves } from "../../../src/content/q2/missionpacks/monsters/tables/rogue-carrier.ts";
import { flyerMoves } from "../../../src/content/q2/missionpacks/monsters/tables/rogue-flyer.ts";
import { hoverMoves } from "../../../src/content/q2/missionpacks/monsters/tables/rogue-hover.ts";
import { stalkerMoves } from "../../../src/content/q2/missionpacks/monsters/tables/rogue-stalker.ts";
import { turretMoves } from "../../../src/content/q2/missionpacks/monsters/tables/rogue-turret.ts";
import { widowMoves } from "../../../src/content/q2/missionpacks/monsters/tables/rogue-widow.ts";
import { widow2Moves } from "../../../src/content/q2/missionpacks/monsters/tables/rogue-widow2.ts";
import { fixbotMoves } from "../../../src/content/q2/missionpacks/monsters/tables/xatrix-fixbot.ts";
import { gekkMoves } from "../../../src/content/q2/missionpacks/monsters/tables/xatrix-gekk.ts";
import { q2OriginalMissionPackFallbacks } from "../../../src/content/q2/missionpacks/monsters/index.ts";

// game_x64.dll is stripped. An mmove_t is {int firstframe, lastframe; mframe_t *frame; void (*endfunc)(edict_t *); float sidestep_scale;
// bool lerp_frames} (32 bytes) and an mframe_t is {aifunc; float dist; thinkfunc; int lerp_frame} (32 bytes), so every move is found by
// that layout alone; the think pointers below were named from function bodies or from the same pointer in the port's other tables.
const path = "q2/rerelease/baseq2/game_x64.dll";
const standardAi: Readonly<Record<string, number>> = { stand: 0x52570, walk: 0x52990, run: 0x54b00, charge: 0x52b90, move: 0x52560, none: 0 };
const callbackAddress: Readonly<Record<string, number>> = {
  monster_footstep: 0x9ddc0, stalker_swing_attack: 0x10a950, stalker_jump_straightup: 0x10aeb0, stalker_jump_wait_land: 0x10b150, stalker_jump_up: 0x488e0,
  stalker_jump_down: 0x48760, stalker_idle_noise: 0x1099f0, BossExplode: 0xfa720, carrier_prep_spawn: 0x1072f0, carrier_start_spawn: 0x1077c0,
  carrier_ready_spawn: 0x107390, carrier_spawn_check: 0x107330, widow2_step: 0x113950, widow2_attack_beam: 0x115640, hover_dying: 0xb8740,
  gekk_shrink: 0x48590, change_to_roam: 0x41640,
};
const endAddress: Readonly<Record<string, number>> = { carrier_run: 0x107da0, carrier_dead: 0x1088b0, stalker_dead: 0x10b430, hover_dead: 0xb9520, gekk_dead: 0x48350 };

interface DllFrame { readonly ai: number; readonly dist: number; readonly think: number }
interface DllMove { readonly rva: number; readonly first: number; readonly last: number; readonly end: number; readonly frames: readonly DllFrame[] }

function scanMoves(bytes: Uint8Array, pe: PeFile): DllMove[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), base = Number(pe.preferredBase);
  const text = pe.sections.find(section => section.name === ".text");
  if (text === undefined) throw new Error("DLL has no code section");
  const inText = (value: number): boolean => value >= base + text.rva && value < base + text.rva + text.virtualSize;
  const dataStart = base + 0x13b000, dataEnd = base + 0x299000;
  const fileOffset = (rva: number): number | null => {
    const section = pe.sections.find(value => rva >= value.rva && rva < value.rva + value.rawSize);
    return section === undefined ? null : section.rawOffset + rva - section.rva;
  };
  const moves: DllMove[] = [];
  for (const section of pe.sections.filter(value => value.name === ".rdata" || value.name === ".data")) {
    for (let offset = section.rawOffset; offset + 32 <= section.rawOffset + section.rawSize; offset += 8) {
      const first = view.getInt32(offset, true), last = view.getInt32(offset + 4, true);
      if (first < 0 || last < first || last > 400) continue;
      const frameAddress = Number(view.getBigUint64(offset + 8, true)), end = Number(view.getBigUint64(offset + 16, true));
      if (frameAddress < dataStart || frameAddress >= dataEnd || end !== 0 && !inText(end)) continue;
      const start = fileOffset(frameAddress - base);
      if (start === null) continue;
      const frames: DllFrame[] = [];
      let valid = true;
      for (let index = 0; index <= last - first && valid; index++) {
        const at = start + index * 32;
        if (at + 32 > bytes.length) { valid = false; break; }
        const ai = Number(view.getBigUint64(at, true)), dist = view.getFloat32(at + 8, true), think = Number(view.getBigUint64(at + 16, true)), lerp = view.getInt32(at + 24, true);
        if (ai !== 0 && !inText(ai) || think !== 0 && !inText(think) || lerp < -1 || lerp > 1000 || !(Math.abs(dist) < 500)) valid = false;
        else frames.push({ ai: ai === 0 ? 0 : ai - base, dist, think: think === 0 ? 0 : think - base });
      }
      if (valid) moves.push({ rva: section.rva + offset - section.rawOffset, first, last, end: end === 0 ? 0 : end - base, frames });
    }
  }
  return moves;
}

function matches(move: MonsterMove, candidate: DllMove): boolean {
  if (candidate.first !== move.firstFrame || candidate.last !== move.lastFrame) return false;
  if ((candidate.end !== 0) !== (move.end !== null)) return false;
  const known = move.end === null ? undefined : endAddress[move.end];
  if (known !== undefined && known !== candidate.end) return false;
  return candidate.frames.every((frame, index) => {
    const source = move.frames[index];
    if (source === undefined || Math.abs(frame.dist - source.distance) > 1e-3) return false;
    const expected = typeof source.ai === "string" ? standardAi[source.ai] : undefined;
    if (typeof source.ai === "string" ? expected !== frame.ai : frame.ai === 0 || Object.values(standardAi).includes(frame.ai)) return false;
    if ((frame.think !== 0) !== (source.actions.length > 0)) return false;
    const action = source.actions[0];
    const address = typeof action === "string" ? callbackAddress[action] : undefined;
    return address === undefined || address === frame.think;
  });
}

const species: Readonly<Record<string, readonly MonsterMove[]>> = {
  monster_gekk: gekkMoves, monster_fixbot: fixbotMoves, monster_stalker: stalkerMoves, monster_daedalus: hoverMoves, monster_carrier: carrierMoves,
  monster_widow: widowMoves, monster_widow2: widow2Moves, monster_turret: turretMoves, monster_kamikaze: flyerMoves,
};
/** Rerelease moves pinned to the mmove_t they were read from. */
const pinned: Readonly<Record<string, number>> = {
  gekk_move_death1: 0x146ed0, fixbot_move_stand2: 0x146c70, stalker_move_run: 0x15c2f0, stalker_move_walk: 0x15c2c8, stalker_move_false_death_end: 0x15c240,
  stalker_move_swing_l: 0x15c268, stalker_move_swing_r: 0x15c310, stalker_move_jump_straightup: 0x15c288, stalker_move_jump_up: 0x15c1e0,
  stalker_move_jump_down: 0x15c330, stalker_move_death: 0x15c3b0, hover_move_death1: 0x154398, carrier_move_death: 0x15c178, carrier_move_spawn: 0x15c0d0,
  widow2_move_walk: 0x15d568, widow2_move_run: 0x15e450, widow2_move_attack_pre_beam: 0x15d548,
};
/** Port moves the DLL has no table for (it linked a different animation set or the port keeps them for its own logic). */
const absent: Readonly<Record<string, readonly string[]>> = {
  monster_gekk: ["gekk_move_standunderwater", "gekk_move_swim_loop"],
  monster_fixbot: ["fixbot_move_pickup", "fixbot_move_attack1", "fixbot_move_land", "fixbot_move_death1", "fixbot_move_backward"],
  monster_stalker: ["stalker_move_dodge_run"],
  monster_daedalus: ["hover_move_start_attack2", "hover_move_end_attack2"],
  monster_kamikaze: ["flyer_move_start", "flyer_move_stop", "flyer_move_rollright", "flyer_move_rollleft", "flyer_move_defense", "flyer_move_bankright", "flyer_move_bankleft"],
};

corpusTest(path)("rerelease mission pack monster moves equal the mmove_t tables in game_x64.dll", () => {
  const bytes = new Uint8Array(readFileSync(corpusFile(path))), pe = parsePe(bytes);
  expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe("045d49c53722d9b922caf14f168dd28a97d4c514a6e443a3140560f8668baccd");
  const dll = scanMoves(bytes, pe), byRva = new Map(dll.map(move => [move.rva, move]));
  const missing: string[] = [], absentFound: string[] = [];
  for (const [classname, classic] of Object.entries(species)) {
    expect(q2OriginalMissionPackFallbacks.has(classname)).toBe(true);
    for (const move of rereleaseMissionPackMoves(classname, classic)) {
      const rva = pinned[move.name], candidates = rva === undefined ? dll : [byRva.get(rva)];
      const found = candidates.some(candidate => candidate !== undefined && matches(move, candidate));
      if (!found) (absent[classname]?.includes(move.name) === true ? absentFound : missing).push(`${classname}:${move.name}`);
    }
  }
  expect(missing).toEqual([]);
  expect(absentFound.sort()).toEqual(Object.entries(absent).flatMap(([classname, names]) => names.map(name => `${classname}:${name}`)).sort());
});

corpusTest(path)("the classic mission pack tables differ from the DLL exactly at the moves the overrides replace", () => {
  const bytes = new Uint8Array(readFileSync(corpusFile(path))), pe = parsePe(bytes), dll = scanMoves(bytes, pe);
  const changed = new Set(Object.values(rereleaseMissionPackCallbacks).flatMap(list => list.map(spec => spec.move)));
  for (const [classname, classic] of Object.entries(species)) {
    for (const move of classic) {
      if (absent[classname]?.includes(move.name) === true) continue;
      const rva = pinned[move.name];
      const candidates = rva === undefined ? dll : dll.filter(candidate => candidate.rva === rva);
      const equal = candidates.some(candidate => matches(move, candidate));
      if (changed.has(move.name)) expect([move.name, equal]).toEqual([move.name, false]);
      else expect([move.name, equal]).toEqual([move.name, true]);
    }
  }
});
