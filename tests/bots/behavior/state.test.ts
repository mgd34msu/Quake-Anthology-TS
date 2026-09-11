import { expect, test } from "bun:test";
import { PlayerState } from "../../../src/content/q3/base/shared/player-state.ts";
import { BotState, copyBotPlayerState } from "../../../src/bots/behavior/q3/ai-state.ts";

test("source bot observations remain detached from shared player bindings", () => {
  let origin = { x: 24, y: 48, z: 64 }, velocity = { x: 1, y: 2, z: 3 };
  const stats = new Int32Array(16), ammo = new Int32Array(16);
  const player = new PlayerState("baseq3", {
    origin: () => origin, setOrigin: value => { origin = value; }, velocity: () => velocity, setVelocity: value => { velocity = value; },
    stats: { read: index => stats[index] ?? 0, write: (index, value) => { stats[index] = value; } },
    ammo: { read: index => ammo[index] ?? 0, write: (index, value) => { ammo[index] = value; } },
  });
  player.stats.set(0, 125); player.ammo.set(2, 100);
  const bot = new BotState("baseq3");
  copyBotPlayerState(bot.curPs, player);
  expect(bot.curPs.origin).toEqual(origin);
  expect(bot.curPs.ammo.get(2)).toBe(100);
  bot.curPs.copyFrom(new PlayerState("baseq3"));
  expect(bot.curPs.origin).toEqual({ x: 0, y: 0, z: 0 });
  expect(bot.curPs.stats.get(0)).toBe(0);
  expect(bot.curPs.ammo.get(2)).toBe(0);
  expect(player.origin).toEqual({ x: 24, y: 48, z: 64 });
  expect(player.stats.get(0)).toBe(125);
  expect(player.ammo.get(2)).toBe(100);
});
