// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { RereleaseFrameSnapshot } from "../../../../src/app/bootstrap/simulation/bot-rerelease-world.ts";
import type { BotEntityT } from "../../../../src/bots/behavior/rerelease/world.ts";

test("one frame's entity list is built once for every bot and dropped when the frame ends", () => {
  const snapshot = new RereleaseFrameSnapshot();
  let builds = 0;
  const build = (): readonly BotEntityT[] => {
    builds++;
    return [];
  };
  snapshot.begin();
  const first = snapshot.entities(build);
  expect(snapshot.entities(build)).toBe(first);
  expect(builds).toBe(1);
  snapshot.end();
  snapshot.entities(build);
  snapshot.entities(build);
  expect(builds).toBe(3);
  const frame = snapshot.frame;
  snapshot.begin();
  expect(snapshot.frame).toBe(frame + 1);
  expect(snapshot.entities(build)).not.toBe(first);
  expect(builds).toBe(4);
  snapshot.end();
});
