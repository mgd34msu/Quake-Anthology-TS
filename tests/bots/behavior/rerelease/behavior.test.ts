import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { BotAssetFiles } from "../../../../src/bots/behavior/assets.ts";
import { loadQuake1Knowledge } from "../../../../src/bots/behavior/rerelease/data/knowledge-q1.ts";
import { Bot_LoadKnowledge } from "../../../../src/bots/behavior/rerelease/data/knowledge-q2.ts";
import { RereleaseBotBehavior } from "../../../../src/bots/behavior/rerelease/profile.ts";
import type { BotEntityT, BotSelfT, BotUsercmdT, BotWorldT } from "../../../../src/bots/behavior/rerelease/world.ts";
import { BotEntityKind, BOT_BUTTON_ATTACK } from "../../../../src/bots/behavior/rerelease/world.ts";
import { Bot_SetWeapon, Bot_UseItem, Bot_TriggerEdict, Bot_GetItemID, Bot_PickedUpItem } from "../../../../src/bots/behavior/rerelease/q2-exports.ts";
import type { Q2BotExportsHost, Q2BotItemView } from "../../../../src/bots/behavior/rerelease/q2-exports.ts";
import { SourceRereleaseNavigation } from "../../../../src/bots/behavior/rerelease/nav.ts";
import { navigationFromAsset, NavigationRuntime, parseKexNavigation } from "../../../../src/bots/navigation/index.ts";
import { createContentDigest } from "../../../../src/contracts/content.ts";
import { readQ1Bsp } from "../../../../src/formats/q1-map/index.ts";
import { createSceneQueries } from "../../../../src/world/collision/index.ts";
import { navigationWorld, profile } from "../../navigation/prediction.ts";

const q1 = "/home/buzzkill/Projects/qfiles/q1/rerelease/id1/pak0.pak";
const q2 = "/home/buzzkill/Projects/qfiles/q2/rerelease/baseq2/pak0.pak";
const zero = { x: 0, y: 0, z: 0 };

async function retailFiles(path: string): Promise<BotAssetFiles> {
  const archive = await openArchive(path), files = new BotAssetFiles();
  try {
    for (const entry of archive.entries) if (entry.path.startsWith("bots/") && entry.path.endsWith(".txt")) files.add(entry.path, await archive.readEntry(entry));
  } finally { archive.close(); }
  return files;
}

test.skipIf(!existsSync(q1) || !existsSync(q2))("retail Q1/Q2 profiles use source commands, resume held triggers, and borrow actual selected movement routes", async () => {
  const q1Knowledge = loadQuake1Knowledge(await retailFiles(q1)), knowledge = Bot_LoadKnowledge(await retailFiles(q2));
  if (q1Knowledge === null) throw new Error("Installed Q1 bot data is absent");
  expect(q1Knowledge.weapons).toHaveLength(8);
  expect(knowledge.weapons).toHaveLength(21);
  const grenade = knowledge.weaponByName("ammo_grenades");
  if (grenade === undefined) throw new Error("Retail Q2 hand grenade missing");
  expect(grenade.number).toBeGreaterThan(0);
  expect(grenade.triggerType).toBe("hold_and_release");
  expect(grenade.triggerHold).toBe(3);
  expect(grenade.triggerCooldown).toBe(1);
  let now = 0;
  const self: BotSelfT = { id: 1, origin: zero, velocity: zero, viewAngles: zero, eye: { x: 0, y: 0, z: 22 }, health: 100,
    armor: 0, items: grenade.number, ammo: { ammo_grenades: 20 }, currentWeapon: grenade.number, onGround: true,
    waterLevel: 0, team: 1, dead: false, hasProtection: false };
  const enemy: BotEntityT = { id: 2, kind: BotEntityKind.Player, classname: "player", origin: { x: 256, y: 0, z: 0 },
    center: { x: 256, y: 0, z: 22 }, head: { x: 256, y: 0, z: 22 }, feet: { x: 256, y: 0, z: -24 }, velocity: zero,
    health: 100, team: 2, dead: false, invisible: false, waterLevel: 0, isBot: false, spawnflags: 0, hasHealth: true, hasTargetname: false };
  const world: BotWorldT = { time: () => now, frameTime: () => 0.05, self: () => self,
    traceLine: (_start, end) => ({ fraction: 1, endpos: end, startsolid: false, hitId: -1 }),
    traceBox: (_start, _mins, _maxs, end) => ({ fraction: 1, endpos: end, startsolid: false, hitId: -1 }),
    pointContents: () => 0, entities: () => [enemy], hearing: () => [], nav: () => null };
  const hooks: string[] = [], chats: string[] = [];
  const behavior = new RereleaseBotBehavior({ definition: "retail-q2-pak0", source: "q2-rerelease", knowledge, skill: "nightmare", seed: 123,
    gameMode: { gameType: "dm", weaponStay: false }, maxHealth: 100, runSpeed: 300, walkSpeed: 150,
    movement: { gravity: 800, jumpVelocity: 270, jumpAirSeconds: 0.675, maximumLandingRise: 40, startAbove: 56,
      bodyMins: { x: -16, y: -16, z: -6 }, bodyMaxs: { x: 16, y: 16, z: 32 } }, callbacks: { time: () => now,
      preThink: name => { hooks.push(name); }, postThink: name => { hooks.push(name); },
      chat: event => { chats.push(event.locstring); }, selectWeapon() {}, weaponImpulse: () => 0, humanTeammateNear: () => false } });
  let firstHold = -1, firstRelease = -1;
  for (let frame = 0; frame < 100; frame++) {
    now = frame * 0.05;
    const command = behavior.think(world);
    if ((command.buttons & BOT_BUTTON_ATTACK) !== 0 && firstHold < 0) firstHold = now;
    if ((command.buttons & BOT_BUTTON_ATTACK) === 0 && firstHold >= 0 && firstRelease < 0) firstRelease = now;
  }
  expect(firstHold).toBeGreaterThanOrEqual(0);
  expect(firstRelease - firstHold).toBeCloseTo(3, 5);
  expect(hooks.slice(0, 2)).toEqual(["Bot_BeginFrame", "Bot_EndFrame"]);
  const checkpoint = behavior.checkpoint(), savedTime = now;
  const advance = (): readonly BotUsercmdT[] => {
    const commands: BotUsercmdT[] = [];
    for (let frame = 0; frame < 30; frame++) { now += 0.05; commands.push(structuredClone(behavior.think(world))); }
    return commands;
  };
  const first = advance(), after = behavior.checkpoint();
  behavior.restore(checkpoint); now = savedTime;
  expect(advance()).toEqual(first);
  expect(behavior.checkpoint()).toEqual(after);
  behavior.requestMoveToPoint({ x: 500, y: 0, z: 0 });
  expect(behavior.goalStatus()).toBe(2);
  behavior.resetForLevel({ gameType: "coop", weaponStay: true });
  expect(behavior.goalStatus()).toBe(0);

  const shotgun = q1Knowledge.weaponByName("shotgun"), rocket = q1Knowledge.weaponByName("rocket_launcher");
  if (shotgun === undefined || rocket === undefined) throw new Error("Retail Q1 weapons missing");
  const q1Self: BotSelfT = { ...self, items: shotgun.number | rocket.number, currentWeapon: shotgun.number,
    ammo: { ammo_shells: 25, ammo_rockets: 5 } };
  const q1World: BotWorldT = { ...world, self: () => q1Self };
  const q1Behavior = new RereleaseBotBehavior({ ...behavior.options, definition: "retail-q1-pak0", source: "q1-rerelease",
    knowledge: q1Knowledge, skill: "hard", gameMode: { gameType: "deathmatch", weaponStay: false }, runSpeed: 320, walkSpeed: 160,
    callbacks: { ...behavior.options.callbacks, weaponImpulse: number => number === rocket.number ? 7 : 2 } });
  hooks.length = 0;
  const q1Commands: BotUsercmdT[] = [];
  for (let frame = 0; frame < 30; frame++) { now = frame * 0.05; q1Commands.push(q1Behavior.think(q1World)); }
  expect(hooks.slice(0, 2)).toEqual(["Bot_PreThink", "Bot_PostThink"]);
  expect(q1Commands.some(command => command.impulse === 7)).toBe(true);

  const archive = await openArchive(q1);
  try {
    const mapEntry = archive.findEntries("maps/dm4.bsp")[0], navEntry = archive.findEntries("bots/navigation/dm4.nav")[0];
    if (mapEntry === undefined || navEntry === undefined) throw new Error("Retail dm4 navigation missing");
    const bytes = await archive.readEntry(mapEntry), geometry = readQ1Bsp(bytes), scene = createSceneQueries(geometry), host = navigationWorld(scene);
    const graph = navigationFromAsset({ name: "dm4", format: geometry.kind, digest: createContentDigest(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")) },
      parseKexNavigation(await archive.readEntry(navEntry), "dm4.nav"), profile, host);
    const runtime = new NavigationRuntime(graph, host), navigation = new SourceRereleaseNavigation(runtime);
    let reached = false;
    for (const edge of graph.edges) {
      if (edge.mode !== "walk" || Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y) < 64) continue;
      const path = navigation.planPath(edge.start, edge.end);
      if (path === null) continue;
      expect(path.points.length).toBeGreaterThan(1);
      expect(path.cost).toBeGreaterThan(0);
      expect(host.commands).toBeGreaterThan(0);
      expect(navigation.pathValid(path)).toBe(true);
      runtime.blockEdge(edge.id, "source route changed");
      expect(navigation.pathValid(path)).toBe(false);
      reached = true; break;
    }
    expect(reached).toBe(true);
  } finally { archive.close(); }
}, 30000);

test("Q2 source bot exports preserve existing inventory authority and named use/touch/pickup ordering", () => {
  const calls: string[] = [], items: readonly Q2BotItemView[] = [
    { id: 0, classname: null, weapon: false, useCallback: null },
    { id: 1, classname: "weapon_blaster", weapon: true, useCallback: "Use_Weapon" },
    { id: 2, classname: "weapon_rocketlauncher", weapon: true, useCallback: "Use_Weapon" },
  ];
  let selected = 0, pending = 0;
  const inventory = [0, 1, 1];
  const host: Q2BotExportsHost = { itemCount: items.length,
    bot: () => ({ inuse: true, bot: true, client: { currentWeapon: 1, pendingWeapon: pending, selectedItem: selected,
      origin: zero, viewOffset: zero, commandAngles: zero } }),
    entity: () => ({ inuse: true, useCallback: "door_use", touchCallback: "door_touch" }),
    item: id => items[id] ?? null, inventory: (_entity, item) => inventory[item] ?? 0,
    setSelectedItem: (_entity, item) => { selected = item; calls.push(`select:${item}`); },
    validateSelectedItem: () => { calls.push("validate"); }, disableWeaponChains: () => { calls.push("disable_chains"); },
    useItem: (callback, _entity, item) => { calls.push(`${callback}:${item}`); pending = item; },
    changeWeaponInstantly: () => { calls.push("ChangeWeapon:instant"); },
    triggerUse: name => { calls.push(name); }, triggerTouch: (name, _target, _other, touching) => { calls.push(`${name}:${touching}`); },
    forceLook() {}, pickedUpBy: (item, client) => item === 9 && client === 0 };
  Bot_SetWeapon(host, 1, 2, true);
  expect(calls.splice(0)).toEqual(["disable_chains", "Use_Weapon:2", "ChangeWeapon:instant"]);
  Bot_SetWeapon(host, 1, 2, true);
  expect(calls).toEqual([]);
  Bot_UseItem(host, 1, 2);
  expect(calls.splice(0)).toEqual(["select:2", "validate", "select:0", "disable_chains", "Use_Weapon:2"]);
  Bot_TriggerEdict(host, 1, 9);
  expect(calls).toEqual(["door_use", "door_touch:true"]);
  expect(Bot_GetItemID(host, "WEAPON_ROCKETLAUNCHER")).toBe(2);
  expect(Bot_GetItemID(host, "none")).toBe(0);
  expect(Bot_PickedUpItem(host, 1, 9)).toBe(true);
  expect(inventory).toEqual([0, 1, 1]);
});
