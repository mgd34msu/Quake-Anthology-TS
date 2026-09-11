/* quakec_mg3/monsters/{soldier,mg3_hknight_infected}.qc. GPL-2.0-or-later. */
import type { MonsterAi, MonsterFrame, MonsterOperation } from "../../../base/animation.ts";

const frames = new Map<string, MonsterFrame>();
const action = (name: string): MonsterOperation => ({ kind: "action", name });
const move = (mode: MonsterAi, distance: number): MonsterOperation => ({ kind: "ai", mode, distance });
function sequence(name: string, first: number, distances: readonly number[], ai: MonsterAi | null, last: string, additions: ReadonlyMap<number, readonly MonsterOperation[]> = new Map<number, readonly MonsterOperation[]>()): undefined {
  for (const [i, distance] of distances.entries()) frames.set(`${name}${i + 1}`, { frame: first + i, next: i + 1 < distances.length ? `${name}${i + 2}` : last,
    operations: [...additions.get(i + 1) ?? [], ...ai === null ? [] : [move(ai, distance)]] });
  return undefined;
}
const idle: MonsterOperation = { kind: "sound", path: "soldier/idle.wav", channel: "voice", attenuation: 2, comparison: "less", chance: 0.2 };
sequence("army_stand", 0, Array<number>(8).fill(0), "stand", "army_stand1");
sequence("army_walk", 90, [1, 1, 1, 1, 2, 3, 4, 4, 2, 2, 2, 1, 0, 1, 1, 1, 3, 3, 3, 3, 2, 1, 1, 1], "walk", "army_walk1", new Map([[1, [idle]]]));
sequence("army_run", 73, [11, 15, 10, 10, 8, 15, 10, 8], "run", "army_run1", new Map([[1, [idle]]]));
sequence("army_atk", 81, Array<number>(9).fill(0), null, "army_run1", new Map(Array.from({ length: 9 }, (_, i): [number, readonly MonsterOperation[]] =>
  [i + 1, [move("face", 0), ...i === 4 ? [action("army_fire")] : i === 6 ? [action("army_refire")] : []]])));
sequence("army_pain", 40, Array<number>(6).fill(0), null, "army_run1", new Map([[6, [move("pain", 1)]]]));
sequence("army_painb", 46, Array<number>(14).fill(0), null, "army_run1", new Map([[2, [move("painforward", 13)]], [3, [move("painforward", 9)]], [12, [move("pain", 2)]]]));
sequence("army_painc", 60, Array<number>(13).fill(0), null, "army_run1", new Map([[2, [move("pain", 1)]], [5, [move("painforward", 1)]], [6, [move("painforward", 1)]],
  [8, [move("pain", 1)]], [9, [move("painforward", 4)]], [10, [move("painforward", 3)]], [11, [move("painforward", 6)]], [12, [move("painforward", 8)]]]));
for (const [corpse, pose] of [[1, 53], [2, 62]] satisfies readonly (readonly [number, number])[]) {
  frames.set(`hknight_corpse${corpse}`, { frame: pose, next: `hknight_corpse${corpse}_2`, operations: [{ kind: "solid", solid: "none" }] });
  frames.set(`hknight_corpse${corpse}_2`, { frame: pose, next: `hknight_corpse${corpse}_2`, operations: [action("infected_corpse_hold")] });
  frames.set(`hknight_corpse${corpse}_rise0`, { frame: pose, next: `hknight_corpse${corpse}_rise${corpse === 1 ? 1 : 2}`, operations: [action("infected_test_rise")] });
}
function rise(corpse: number, poses: readonly number[], distances: ReadonlyMap<number, number>): undefined {
  for (const [i, frame] of poses.entries()) {
    const step = i + 1, distance = distances.get(step), operations: MonsterOperation[] = [];
    if (step === 2) operations.push(action("infected_rise_pain"));
    if (distance !== undefined) operations.push(move("forward", distance));
    if (step === poses.length) operations.push(action("infected_resurrect"));
    frames.set(`hknight_corpse${corpse}_rise${step}`, { frame, next: step === poses.length ? "hknight_run1" : `hknight_corpse${corpse}_rise${step + 1}`, operations });
  }
  return undefined;
}
rise(1, [53, 52, 51, 50, 49, 48, 47, 46, 45, 44, 43, 42, 0, 1], new Map([[4, -11], [5, -10], [10, -7], [11, -8], [14, -10]]));
rise(2, [62, 61, 60, 59, 58, 57, 56, 55, 55, 0, 1], new Map<number, number>());
export const infectedFrames: ReadonlyMap<string, MonsterFrame> = frames;
