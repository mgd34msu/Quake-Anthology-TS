// SPDX-License-Identifier: GPL-2.0-or-later
/* quakec_mg3/monsters/mg3_demodog.qc frame declarations. GPL-2.0-or-later. */
import type { MonsterAi, MonsterFrame, MonsterOperation } from "../../base/animation.ts";

/** The id1 dog and the MG3 explosive dog share one frame layout and differ only in name prefix. */
function dogFrameTable(prefix: string): ReadonlyMap<string, MonsterFrame> {
  const frames = new Map<string, MonsterFrame>();
  function sequence(
    name: string,
    first: number,
    distances: readonly number[],
    ai: MonsterAi | null,
    last: string,
    actions: ReadonlyMap<number, readonly MonsterOperation[]> = new Map<number, readonly MonsterOperation[]>(),
  ): undefined {
    for (const [index, distance] of distances.entries()) {
      const operations: MonsterOperation[] = ai === null ? [] : [{ kind: "ai", mode: ai, distance }];
      operations.push(...(actions.get(index + 1) ?? []));
      frames.set(`${prefix}_${name}${index + 1}`, {
        frame: first + index,
        next: index + 1 < distances.length ? `${prefix}_${name}${index + 2}` : last,
        operations,
      });
    }
    return undefined;
  }
  const idle: MonsterOperation = { kind: "sound", path: "dog/idle.wav", channel: "voice", attenuation: 2, comparison: "less", chance: 0.2 };
  sequence("stand", 69, Array<number>(9).fill(0), "stand", `${prefix}_stand1`);
  sequence(
    "walk",
    78,
    Array<number>(8).fill(8),
    null,
    `${prefix}_walk1`,
    new Map(
      Array.from({ length: 8 }, (_, index): [number, readonly MonsterOperation[]] => [
        index + 1,
        index === 0 ? [idle, { kind: "ai", mode: "walk", distance: 8 }] : [{ kind: "ai", mode: "walk", distance: 8 }],
      ]),
    ),
  );
  const run = [16, 32, 32, 20, 64, 32, 16, 32, 32, 20, 64, 32];
  sequence(
    "run",
    48,
    run,
    null,
    `${prefix}_run1`,
    new Map(
      run.map((distance, index): [number, readonly MonsterOperation[]] => [
        index + 1,
        index === 0 ? [idle, { kind: "ai", mode: "run", distance }] : [{ kind: "ai", mode: "run", distance }],
      ]),
    ),
  );
  sequence(
    "atta",
    0,
    Array<number>(8).fill(10),
    null,
    `${prefix}_run1`,
    new Map(
      Array.from({ length: 8 }, (_, index): [number, readonly MonsterOperation[]] => [
        index + 1,
        index === 3
          ? [
              { kind: "sound", path: "dog/dattack1.wav", channel: "voice", attenuation: 1, comparison: "less", chance: null },
              { kind: "action", name: `${prefix}_bite` },
            ]
          : [{ kind: "ai", mode: "charge", distance: 10 }],
      ]),
    ),
  );
  sequence(
    "leap",
    60,
    Array<number>(9).fill(0),
    null,
    `${prefix}_leap9`,
    new Map([
      [1, [{ kind: "ai", mode: "face", distance: 0 }]],
      [
        2,
        [
          { kind: "ai", mode: "face", distance: 0 },
          { kind: "action", name: `${prefix}_jump` },
        ],
      ],
    ]),
  );
  sequence("pain", 26, Array<number>(6).fill(0), null, `${prefix}_run1`);
  sequence(
    "painb",
    32,
    Array<number>(16).fill(0),
    null,
    `${prefix}_run1`,
    new Map([
      [3, [{ kind: "ai", mode: "pain", distance: 4 }]],
      [4, [{ kind: "ai", mode: "pain", distance: 12 }]],
      [5, [{ kind: "ai", mode: "pain", distance: 12 }]],
      [6, [{ kind: "ai", mode: "pain", distance: 2 }]],
      [8, [{ kind: "ai", mode: "pain", distance: 4 }]],
      [10, [{ kind: "ai", mode: "pain", distance: 10 }]],
    ]),
  );
  sequence("die", 8, Array<number>(9).fill(0), null, `${prefix}_die9`);
  sequence("dieb", 17, Array<number>(9).fill(0), null, `${prefix}_dieb9`);
  return frames;
}
export const demodogFrames: ReadonlyMap<string, MonsterFrame> = dogFrameTable("demodog");
export const dogFrames: ReadonlyMap<string, MonsterFrame> = dogFrameTable("dog");
