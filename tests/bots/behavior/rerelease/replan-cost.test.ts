// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { testCorpusRoot } from "../../../support/corpus.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { createContentDigest } from "../../../../src/contracts/content.ts";
import { decodeQ2Map } from "../../../../src/formats/q2-map/index.ts";
import { createSceneQueries } from "../../../../src/world/collision/index.ts";
import { navigationFromAsset, NavigationRuntime, parseKexNavigation } from "../../../../src/bots/navigation/index.ts";
import { BotAssetFiles } from "../../../../src/bots/behavior/assets.ts";
import { Bot_LoadKnowledge } from "../../../../src/bots/behavior/rerelease/data/knowledge-q2.ts";
import { RereleaseBotBehavior } from "../../../../src/bots/behavior/rerelease/profile.ts";
import { SourceRereleaseNavigation, type BotNavigation } from "../../../../src/bots/behavior/rerelease/nav.ts";
import { BotContents, BotEntityKind, type BotEntityT, type BotSelfT, type BotWorldT } from "../../../../src/bots/behavior/rerelease/world.ts";
import { navigationWorld, profile } from "../../navigation/prediction.ts";
import { literal } from "../../../support/literal.ts";

const pak = resolve(testCorpusRoot(), "q2/rerelease/baseq2/pak0.pak");
const zero = { x: 0, y: 0, z: 0 };

test.skipIf(!existsSync(pak))("bots whose goal has no graph node nearby replan on the interval, and share one hazard cache per graph", async () => {
  const archive = await openArchive(pak), files = new BotAssetFiles();
  let mapBytes: Uint8Array, navBytes: Uint8Array;
  try {
    for (const entry of archive.entries) if (entry.path.startsWith("bots/") && entry.path.endsWith(".txt")) files.add(entry.path, await archive.readEntry(entry));
    const mapEntry = archive.findEntries("maps/base1.bsp")[0], navEntry = archive.findEntries("bots/navigation/base1.nav")[0];
    if (mapEntry === undefined || navEntry === undefined) throw new Error("Required supplied map/navigation asset missing");
    mapBytes = await archive.readEntry(mapEntry); navBytes = await archive.readEntry(navEntry);
  } finally { archive.close(); }
  const geometry = decodeQ2Map(mapBytes), scene = createSceneQueries(geometry), navWorld = navigationWorld(scene);
  const map = { name: "maps/base1.bsp", format: geometry.kind, digest: createContentDigest(new Bun.CryptoHasher("sha256").update(mapBytes).digest("hex")) };
  const runtime = new NavigationRuntime(navigationFromAsset(map, parseKexNavigation(navBytes, "base1.nav"), profile, navWorld), navWorld);
  const nodes = runtime.graph.nodes;
  const standing = nodes.filter(node => runtime.outgoing(node.id).length > 0).slice(0, 8);
  if (standing.length < 8) throw new Error("base1 navigation is smaller than the fixture expects");
  const knowledge = Bot_LoadKnowledge(files);
  const run = (freshNodeViews: boolean): { plans: number; contents: number; milliseconds: number; frames: number } => {
    let now = 0, plans = 0, contents = 0;
    const source = new SourceRereleaseNavigation(runtime);
    // A node list rebuilt on every call defeats the per-graph hazard cache, which is what each plan paid before it existed.
    const navigation: BotNavigation = { get nodeCount() { return source.nodeCount; }, get nodes() { return freshNodeViews ? source.nodes.slice() : source.nodes; },
      pathValid: path => source.pathValid(path), planPath: (start, goal, options) => { plans++; return source.planPath(start, goal, options); } };
    const bots = standing.map((node, index) => {
      // An enemy dead ahead whose position the planner cannot stand a body next to: seen, so it is the goal, and unplannable.
      const goal = { x: node.origin.x + 480, y: node.origin.y, z: node.origin.z };
      const enemy: BotEntityT = { id: 99, kind: BotEntityKind.Player, classname: "player", origin: goal, center: goal, head: goal, feet: goal, velocity: zero,
        health: 100, team: 2, dead: false, invisible: false, waterLevel: 0, isBot: false, spawnflags: 0, hasHealth: true, hasTargetname: false };
      const self: BotSelfT = { id: index + 1, origin: node.origin, velocity: zero, viewAngles: zero, eye: { ...node.origin, z: node.origin.z + 22 }, health: 100,
        armor: 0, items: 0, ammo: {}, currentWeapon: 0, onGround: true, waterLevel: 0, team: 1, dead: false, hasProtection: false };
      const world: BotWorldT = { time: () => now, frameTime: () => 0.05, self: () => self,
        traceLine: (_start, end) => ({ fraction: 1, endpos: end, startsolid: false, hitId: -1 }),
        traceBox: (start, mins, maxs, end) => { const hit = scene.trace({ start, end, shape: { kind: "box", bounds: { min: mins, max: maxs } }, target: { kind: "world" }, policy: profile.policy, numeric: profile.movement.numeric, passActor: null });
          return { fraction: hit.fraction, endpos: hit.end, startsolid: hit.startSolid || hit.allSolid, hitId: -1 }; },
        pointContents: point => { contents++; const result = scene.pointContents({ point, target: { kind: "world" }, policy: profile.policy, numeric: profile.movement.numeric, passActor: null });
          const value = result.kind === "q2" ? result.merged : 0; return (value & 8) !== 0 ? BotContents.Lava : (value & 16) !== 0 ? BotContents.Slime : BotContents.Empty; },
        entities: () => [enemy], hearing: () => [], nav: () => navigation };
      const behavior = new RereleaseBotBehavior({ definition: "retail-q2-pak0", source: "q2-rerelease", knowledge, skill: "nightmare", seed: 100 + index,
        gameMode: { gameType: "dm", weaponStay: false }, maxHealth: 100, runSpeed: 300, walkSpeed: 150,
        movement: { gravity: 800, jumpVelocity: 270, jumpAirSeconds: 0.675, maximumLandingRise: 40, startAbove: 56,
          bodyMins: { x: -16, y: -16, z: -6 }, bodyMaxs: { x: 16, y: 16, z: 32 } }, callbacks: { time: () => now,
          preThink() {}, postThink() {}, chat() {}, selectWeapon() {}, weaponImpulse: () => 0, humanTeammateNear: () => false } });
      return { behavior, world };
    });
    const frames = 200, started = performance.now();
    for (let frame = 0; frame < frames; frame++) { now = frame * 0.05; for (const bot of bots) bot.behavior.think(bot.world); }
    return { plans, contents, milliseconds: performance.now() - started, frames };
  };
  const before = run(true), after = run(false);
  for (const [label, result] of literal([["rebuilt-per-plan", before], ["per-map", after]])) {
    console.log(`${label}: ${result.plans} plans, ${result.contents} pointContents, ${(result.milliseconds / result.frames).toFixed(3)} ms/frame for 8 bots`);
  }
  expect(after.plans).toBeGreaterThan(0);
  expect(after.contents).toBeLessThan(before.contents);
}, 120000);
