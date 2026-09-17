import { expect, test } from "bun:test";
import { rereleaseBotCommand } from "../../../../src/app/bootstrap/simulation/bot-commands.ts";
import type { BotUsercmdT } from "../../../../src/bots/behavior/rerelease/world.ts";
const source: BotUsercmdT = { forwardmove: 300, sidemove: -250, upmove: 0, buttons: 7, impulse: 0, viewAngles: { x: 0, y: 90, z: 0 } };
test("native bot commands retain velocity and distinguish use, jump and holdable controls", () => {
  const q2 = rereleaseBotCommand(source, "q2-rerelease", 100, 500);
  expect(q2).toEqual({ kind: "q2-rerelease", milliseconds: 100, angles: source.viewAngles, forwardMove: 300, sideMove: -250, buttons: 11, serverFrame: 0 });
  const classic = rereleaseBotCommand(source, "q2-classic", 100, 500);
  expect(classic).toEqual({ kind: "q2-classic", milliseconds: 100, angleShorts: [0, 16384, 0], forwardMove: 300, sideMove: -250, upMove: 200, buttons: 3, impulse: 0, lightLevel: 0 });
  const q1 = rereleaseBotCommand(source, "q1-netquake", 100, 500);
  expect(q1).toEqual({ kind: "q1-netquake", acknowledgedServerTimeSeconds: 0.5, viewAngles: source.viewAngles, forwardMove: 300, sideMove: -250, upMove: 200, buttons: 3, impulse: 0 });
  const q3 = rereleaseBotCommand(source, "q3", 100, 500);
  expect(q3).toEqual({ kind: "q3", serverTimeMilliseconds: 500, angleWords: [0, 16384, 0], forwardMove: 119, rightMove: -99, upMove: 127, buttons: 1, weapon: 0 });
  expect(rereleaseBotCommand({ ...source, buttons: 0, upmove: -200 }, "q2-rerelease", 100, 600).buttons).toBe(16);
});
