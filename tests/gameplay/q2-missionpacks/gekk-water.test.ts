// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createGekkDefinition } from "../../../src/content/q2/missionpacks/monsters/gekk.ts";
import { rereleaseMissionPackMoves } from "../../../src/content/q2/rerelease/monsters/tables/missionpack.ts";
import type { Q2Monsters } from "../../../src/content/q2/foundation/monsters/index.ts";
import type { MonsterContext } from "../../../src/content/q2/foundation/monsters/types.ts";

const FL_SWIM = 2;
/** The gekk code under test reads only the fields the scene declares. */
function stand<T>(value: object): T { return value as T; }
interface Scene { readonly edition: "classic" | "rerelease"; readonly flags?: number; readonly spawnflags?: number; readonly distance: number; readonly submerged?: boolean; readonly rolls?: readonly number[]; readonly waterLevel?: 0 | 1 | 2 | 3 }

/** A gekk at the origin whose enemy stands `distance` units away along +x (boxes of half-width 16 on both sides, so the box gap is distance - 32 + 32 = distance). */
function scene(input: Scene) {
  const rolls = [...input.rolls ?? []], moves: string[] = [], bounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 24 } };
  const state = { waterLevel: input.waterLevel ?? 2, locomotion: "swim", nextFrame: 0, attackFinished: 0, move: { name: "gekk_move_swim_loop" } };
  const entity = { flags: input.flags ?? 0, spawnflags: input.spawnflags ?? 0, enemy: "enemy", actor: { id: "gekk" } };
  const enemy = { actor: { id: "enemy" } };
  let moved = 0;
  const game = {
    options: { edition: input.edition },
    body: (target: unknown) => ({ origin: target === entity ? { x: 0, y: 0, z: 0 } : { x: input.distance + 32, y: 0, z: 0 }, bounds }),
    entity: () => enemy,
    monsterTarget: () => ({ viewHeight: 22 }),
    move: () => { moved++; return undefined; },
    host: {
      bodies: { read: () => ({ origin: { x: input.distance + 32, y: 0, z: 0 }, bounds }) },
      pointContents: () => (input.submerged === true ? 56 : 0), now: () => 100, random: () => rolls.shift() ?? 0,
    },
  };
  const context = stand<MonsterContext>({ entity, game, state, setMove: (name: string) => { moves.push(name); return undefined; } });
  return { context, entity, state, moves, moved: () => moved, rolls };
}
const attack = (input: Scene) => {
  const result = scene(input), definition = createGekkDefinition({} as Q2Monsters);
  if (definition.attack === undefined) throw new Error("The gekk has no attack");
  definition.attack(result.context);
  return result;
};

test("a swimming rerelease gekk stays in the water while its enemy is submerged within RANGE_NEAR", () => {
  const result = attack({ edition: "rerelease", flags: FL_SWIM, distance: 440, submerged: true });
  expect(result.moves).toEqual([]); expect(result.entity.flags & FL_SWIM).toBe(FL_SWIM); expect(result.state.nextFrame).toBe(0);
});

test("a swimming rerelease gekk leaves the water through its attack when the enemy is on land, too far, or gone", () => {
  for (const input of [{ distance: 300, submerged: false }, { distance: 441, submerged: true }]) {
    const result = attack({ edition: "rerelease", flags: FL_SWIM | 4, ...input });
    expect(result.moves).toEqual(["gekk_move_leapatk"]);
    expect(result.entity.flags).toBe(4); expect(result.state.locomotion).toBe("walk"); expect(result.state.nextFrame).toBe(75);
    expect(result.moved()).toBe(0);
  }
});

test("a rerelease gekk on land picks spit, run or leap by range, rolls and spawnflags", () => {
  const far = (roll: number) => attack({ edition: "rerelease", distance: 940, rolls: [roll], waterLevel: 0 });
  expect(far(0.6).moves).toEqual(["gekk_move_spit"]);
  expect(far(0.5).moves).toEqual(["gekk_move_run_start"]); expect(far(0.5).state.attackFinished).toBe(102);
  const near = (rolls: number[], spawnflags = 0) => attack({ edition: "rerelease", distance: 939, rolls, spawnflags, waterLevel: 0 });
  expect(near([0.8]).moves).toEqual(["gekk_move_spit"]);
  const held = near([0.7, 0.9]); expect(held.moves).toEqual(["gekk_move_run_start"]); expect(held.state.attackFinished).toBeCloseTo(101.4, 6); expect(held.rolls).toEqual([]);
  expect(near([0.7, 0.7]).moves).toEqual(["gekk_move_leapatk"]);
  const flagged = near([0.7, 0.1], 16); expect(flagged.moves).toEqual(["gekk_move_run_start"]); expect(flagged.state.attackFinished).toBeCloseTo(101.4, 6); expect(flagged.rolls).toEqual([0.1]);
});

test("the classic gekk attack keeps its 1998 water rule: no attack while swimming or wet", () => {
  expect(attack({ edition: "classic", flags: FL_SWIM, distance: 100, rolls: [0.9, 0.9] }).moves).toEqual([]);
  expect(attack({ edition: "classic", distance: 100, rolls: [0.9, 0.9], waterLevel: 1 }).moves).toEqual([]);
  expect(attack({ edition: "classic", distance: 100, rolls: [0.1, 0.1], waterLevel: 0 }).moves).toEqual(["gekk_move_leapatk"]);
});

test("rerelease gekks swim and stand underwater on frames 291-322 without a swim-loop exit callback, and test water at WATER_WAIST", () => {
  const definition = createGekkDefinition({} as Q2Monsters);
  const classic = definition.moves.find(move => move.name === "gekk_move_swim_loop");
  expect(classic?.firstFrame).toBe(242); expect(classic?.frames.some(frame => frame.actions.includes("gekk_swim"))).toBe(true);
  const moves = rereleaseMissionPackMoves("monster_gekk", definition.moves);
  for (const name of ["gekk_move_swim_loop", "gekk_move_standunderwater"]) {
    const move = moves.find(candidate => candidate.name === name);
    expect([move?.firstFrame, move?.lastFrame, move?.frames.length]).toEqual([291, 322, 32]);
    expect(move?.frames.every(frame => frame.actions.length === 0)).toBe(true);
  }
  expect(moves.find(move => move.name === "gekk_move_swim_loop")?.end).toBe("gekk_swim_loop");
  const level = (edition: "classic" | "rerelease", waterLevel: 0 | 1 | 2 | 3, spawnflags = 0) => {
    const result = scene({ edition, distance: 100, waterLevel, spawnflags });
    definition.run?.(result.context);
    return result.moves;
  };
  expect(level("classic", 1)).toEqual(["gekk_move_swim_start"]);
  expect(level("rerelease", 1)).toEqual(["gekk_move_run_start"]);
  expect(level("rerelease", 2)).toEqual(["gekk_move_swim_start"]);
  expect(level("rerelease", 3, 32)).toEqual(["gekk_move_run_start"]);
});
