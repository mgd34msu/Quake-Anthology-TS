// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { corpusFile } from "../../../support/corpus.ts";
import { existsSync } from "node:fs";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { BotAssetFiles } from "../../../../src/bots/behavior/assets.ts";
import { Bot_LoadKnowledge } from "../../../../src/bots/behavior/rerelease/data/knowledge-q2.ts";
import { RereleaseBotBehavior } from "../../../../src/bots/behavior/rerelease/profile.ts";
import type { BotEntityT, BotSelfT, BotWorldT } from "../../../../src/bots/behavior/rerelease/world.ts";
import { BotEntityKind } from "../../../../src/bots/behavior/rerelease/world.ts";
import type { BotNavigation } from "../../../../src/bots/behavior/rerelease/nav.ts";

const q2 = corpusFile("q2/rerelease/baseq2/pak0.pak");
const zero = { x: 0, y: 0, z: 0 };

test.skipIf(!existsSync(q2))("a goal with no route is not replanned every frame", async () => {
  const archive = await openArchive(q2), files = new BotAssetFiles();
  try {
    for (const entry of archive.entries) if (entry.path.startsWith("bots/") && entry.path.endsWith(".txt")) files.add(entry.path, await archive.readEntry(entry));
  } finally { archive.close(); }
  const knowledge = Bot_LoadKnowledge(files);
  let now = 0, plans = 0;
  const self: BotSelfT = { id: 1, origin: zero, velocity: zero, viewAngles: zero, eye: { x: 0, y: 0, z: 22 }, health: 100,
    armor: 0, items: 0, ammo: {}, currentWeapon: 0, onGround: true, waterLevel: 0, team: 1, dead: false, hasProtection: false };
  const enemy: BotEntityT = { id: 2, kind: BotEntityKind.Player, classname: "player", origin: { x: 600, y: 0, z: 0 },
    center: { x: 600, y: 0, z: 22 }, head: { x: 600, y: 0, z: 22 }, feet: { x: 600, y: 0, z: -24 }, velocity: zero,
    health: 100, team: 2, dead: false, invisible: false, waterLevel: 0, isBot: false, spawnflags: 0, hasHealth: true, hasTargetname: false };
  const navigation: BotNavigation = { nodeCount: 4, nodes: [], pathValid: () => false, planPath: () => { plans++; return null; } };
  const world: BotWorldT = { time: () => now, frameTime: () => 0.05, self: () => self,
    traceLine: (_start, end) => ({ fraction: 1, endpos: end, startsolid: false, hitId: -1 }),
    traceBox: (_start, _mins, _maxs, end) => ({ fraction: 1, endpos: end, startsolid: false, hitId: -1 }),
    pointContents: () => 0, entities: () => [enemy], hearing: () => [], nav: () => navigation };
  const behavior = new RereleaseBotBehavior({ definition: "retail-q2-pak0", source: "q2-rerelease", knowledge, skill: "nightmare", seed: 123,
    gameMode: { gameType: "dm", weaponStay: false }, maxHealth: 100, runSpeed: 300, walkSpeed: 150,
    movement: { gravity: 800, jumpVelocity: 270, jumpAirSeconds: 0.675, maximumLandingRise: 40, startAbove: 56,
      bodyMins: { x: -16, y: -16, z: -6 }, bodyMaxs: { x: 16, y: 16, z: 32 } }, callbacks: { time: () => now,
      preThink() {}, postThink() {}, chat() {}, selectWeapon() {}, weaponImpulse: () => 0, humanTeammateNear: () => false } });
  for (let frame = 0; frame < 100; frame++) { now = frame * 0.05; behavior.think(world); }
  // 5 simulated seconds at a two second replan interval; before the pacing every frame planned.
  expect(plans).toBeGreaterThan(0);
  expect(plans).toBeLessThanOrEqual(6);
});
