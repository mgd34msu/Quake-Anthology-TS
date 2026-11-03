// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { corpusFile } from "../../../support/corpus.ts";
import { ClassicGuestWorld } from "../../../../src/app/bootstrap/simulation/classic-guest-world.ts";
import { prepareClassicGuest } from "../../../../src/app/bootstrap/simulation/classic-guest-source.ts";
import { nativePrimaryWeaponHost } from "../../../../src/app/bootstrap/simulation/native-primary-weapons.ts";
import { SharedPhysics } from "../../../../src/app/bootstrap/simulation/physics.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { openMountPlan } from "../../../../src/content/mounts/index.ts";
import { createMountIdentity } from "../../../../src/contracts/content.ts";
import type { ItemId } from "../../../../src/contracts/gameplay.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { OriginalPickupAdmission, OriginalPickupOffer } from "../../../../src/contracts/original-pickups.ts";
import { CvarRegistry } from "../../../../src/core/cvars/index.ts";
import { createNumericOperations, Q2_DONOR_PROFILE } from "../../../../src/core/numeric.ts";
import { parseEntities } from "../../../../src/core/common-parse.ts";
import { decodeQ2Map } from "../../../../src/formats/q2-map/index.ts";
import { ActorCallbackTable, SessionActorRegistry } from "../../../../src/world/actors/index.ts";
import { SharedInventoryTable } from "../../../../src/world/gameplay/index.ts";
import { createSceneQueries } from "../../../../src/world/collision/index.ts";
import { builtinNativePrimary } from "../../../../src/compat/q2/native-primary.ts";
import { NativePrimaryCommands } from "../../../../src/compat/q2/native-primary-commands.ts";
import { NativePrimaryInventory } from "../../../../src/compat/q2/native-primary-inventory.ts";
import { NativePrimaryDrop } from "../../../../src/compat/q2/native-primary-drop.ts";
import { readClassicString } from "../../../../src/compat/q2/classic/records.ts";
import { classicSignature, q2Pointer } from "../../../../src/compat/q2/classic/layout.ts";
import type { Q2UserCommand } from "../../../../src/contracts/protocol.ts";
import { inertAuthority } from "../../../support/authority.ts";

const path = corpusFile("q2/xatrix/gamex86.dll"), pak = corpusFile("q2/xatrix/pak0.pak");
const command: Q2UserCommand = { kind: "q2-classic", milliseconds: 100, angleShorts: [0, 0, 0], forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0, lightLevel: 128 };
function required<T>(value: T | null | undefined): T { if (value === null || value === undefined) throw new Error("Missing native primary fixture value"); return value; }

/** Boots the shipped 1998 Xatrix DLL and binds every built-in native primary service for that digest against it. */
test.skipIf(!existsSync(path) || !existsSync(pak))("1998 Xatrix runs original give, use, drop and pickups through the built-in native primary", async () => {
  const archive = await openArchive(pak), geometry = decodeQ2Map(await archive.readEntry(required(archive.findEntries("maps/xswamp.bsp")[0])), "xswamp"); await archive.close();
  const identity = createMountIdentity("mount:test:native-primary", "q2:classic:xatrix:installed", 1);
  using mounts = await openMountPlan({ id: "mount-plan:test:native-primary", mounts: [{ kind: "loose", identity, rootPath: corpusFile("q2/xatrix") }], defaultOrder: [identity.id], prefixOrders: [] });
  const artifact = required(await mounts.open("gamex86.dll"));
  const prepared = await prepareClassicGuest({ kind: "native", owner: { provider: "q2:classic-native", content: identity.content }, role: "server-game", api: { kind: "q2-classic-game", version: 3 },
    profile: { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" }, artifact: artifact.reference }, mounts);
  const primary = required(builtinNativePrimary(prepared.execution.artifact.digest, "classic"));
  const identityOwner = createIdentityOwner("native-primary-1998");
  const actors = new SessionActorRegistry(identityOwner), callbacks = new ActorCallbackTable(actors), scene = createSceneQueries(geometry);
  const physics = new SharedPhysics({ actors, callbacks, scene, numeric: Q2_DONOR_PROFILE, sourceOrder: (a, b) => a.slot - b.slot,
    worldActor: () => required(actors.atSource(prepared.execution.owner.provider, 0)).id, onBlocked: () => undefined });
  const cvars = new CvarRegistry({ dialect: "q2-classic", context: { session: actors.session, origin: { kind: "server-console" } } });
  cvars.register("deathmatch", "0"); cvars.register("coop", "0"); cvars.register("ctf", "0");
  const offers: OriginalPickupOffer[] = [], prints: string[] = [];
  let selectionMode: () => "original" | "replacement" = () => "replacement";
  const pickups: OriginalPickupAdmission = {
    runSource: (offer, execute) => {
      offers.push(offer);
      return execute(selectionMode() === "original" ? { kind: "original" } : { kind: "replacement", current: () => true, grant: () => "accepted" }, { consumePickup: () => undefined });
    },
    touch: () => "refused",
  };
  const world = ClassicGuestWorld.create({ prepared, capabilities: {}, instructionBudget: 8_000_000, services: {
    numeric: createNumericOperations(Q2_DONOR_PROFILE), scene, cvars, maxClients: 1, mapPath: "maps/xswamp.bsp", pickups, admit: () => undefined,
    collision: (actor, value) => physics.setCollision(actor, value), print: text => { prints.push(text); }, command: () => ({ arguments: [], args: "" }),
    addCommand: () => undefined, debugGraph: () => undefined,
    engine: { actors, callbacks, bodies: physics.bodies, combat: inertAuthority(actors, callbacks), inventory: new SharedInventoryTable(actors), trace: request => physics.trace(request),
      pointContents: () => 0, inPvs: () => true, inPhs: () => true, setAreaPortal: () => undefined, setSolid: (actor, solid, model) => physics.setSolid(actor, solid, model, "q2"),
      inlineModelBounds: model => scene.modelBounds(model), emit: event => { if (event.kind === "print") prints.push(event.text); return undefined; } },
  } });
  try {
    const origin = required(parseEntities(geometry.entities).find(entity => entity.get("classname") === "info_player_start")).get("origin") ?? "0 0 128";
    const [x = 0, y = 0, z = 0] = origin.split(" ").map(Number);
    const solid = (px: number, py: number, pz: number): boolean => {
      const result = scene.pointContents({ point: { x: px, y: py, z: pz }, target: { kind: "world" }, policy: { kind: "q2", contentsMask: -1, leafContents: "merged" }, numeric: Q2_DONOR_PROFILE, passActor: null });
      return ((result.kind === "q2" ? result.merged : result.contents) & 1) !== 0;
    };
    // Ten spots (two sets of five), at least 56 units from the start and each other, whose 40x40 footprint is empty from the floor up.
    const spots: string[] = [];
    for (let radius = 64; spots.length < 10 && radius <= 512; radius += 8) for (let angle = 0; angle < 16 && spots.length < 10; angle++) {
      const px = x + Math.round(radius * Math.cos(angle * Math.PI / 8)), py = y + Math.round(radius * Math.sin(angle * Math.PI / 8));
      const clear = [-20, 0, 20].every(dx => [-20, 0, 20].every(dy => [16, 40].every(dz => !solid(px + dx, py + dy, z + dz))));
      if (clear && spots.every(spot => { const [sx = 0, sy = 0] = spot.split(" ").map(Number); return Math.hypot(sx - px, sy - py) >= 56; })) spots.push(`${px} ${py} ${z + 8}`);
    }
    expect(spots).toHaveLength(10);
    const entities = `{ "classname" "worldspawn" } { "classname" "info_player_start" "origin" "${origin}" }`
      + ["item_armor_jacket", "ammo_shells", "weapon_shotgun", "item_bandolier", "item_pack"].map((classname, index) => ` { "classname" "${classname}" "origin" "${spots[index]}" } { "classname" "${classname}" "origin" "${spots[index + 5]}" }`).join("");
    await world.initLoading(async () => { await Bun.sleep(0); });
    await world.spawnLoading("xswamp", entities, async () => { await Bun.sleep(0); }, "");
    expect(world.connect(1, "\\name\\Primary\\skin\\male/grunt\\ip\\127.0.0.1").allowed).toBe(true); world.begin(1);
    for (let frame = 0; frame < 4; frame++) { world.think(1, command); world.frame(100); }

    const host = nativePrimaryWeaponHost(world, actors), memory = world.source.memory, actor = required(world.actor(1));
    const record = required(host.recordFor(actor)), client = required(memory.readPointer(memory.offset(record.address, 84n)));
    const counts = (index: number): number => memory.readInt32(memory.offset(client, BigInt(primary.inventory.inventory + index * 4)));
    const calls: string[] = [];
    const commands = new NativePrimaryCommands(host, primary.commands, {
      give: (_, category) => { calls.push(`give:${category}`); },
      giveItem: () => false,
      giveAmmo: (_, item: ItemId, change) => { calls.push(`ammo:${item}:${change.kind}`); },
      drop: () => null,
    });
    const inventory = new NativePrimaryInventory(host, primary.inventory, {
      rows: () => null, use: () => { throw new Error("No canonical rows exist, so the original use must run"); }, print: (_, text) => { prints.push(text); },
      itemAt: address => commands.itemAt(address), descriptor: index => required(commands.sourceItem(required(commands.inventorySlots().find(item => item.index === index)).item)).address,
    });
    const drop = new NativePrimaryDrop(host, primary.drop, commands, {
      rows: () => null, selected: () => null, projection: () => { throw new Error("No canonical rows exist"); }, dropped: () => true, consume: (_, execute) => { execute(); },
      action: () => null, print: (_, text) => { prints.push(text); },
    });
    try {
      const index = (name: ItemId): number => required(commands.sourceItem(name)).index;
      expect(commands.inventorySlots().length).toBe(46);
      expect(commands.weapons().map(weapon => weapon.item)).toContain("q2:weapon_phalanx");

      // Original Cmd_Give_f: the category hooks and the named ammo grants reach the bound regions, and the original item stores follow.
      world.command(1, ["give", "all"], "all"); world.frame(100);
      expect(calls).toContain("give:weapons"); expect(calls).toContain("give:ammo");
      expect(counts(index("q2:weapon_railgun"))).toBe(1);
      expect(counts(index("q2:ammo_slugs"))).toBeGreaterThan(0);
      world.command(1, ["give", "shells", "7"], "shells 7"); world.frame(100);
      expect(calls.some(call => call.startsWith("ammo:q2:ammo_shells:"))).toBe(true);

      // Original Cmd_Use_f selects the weapon (newweapon at the declared offset) and ValidateSelectedItem/SelectNextItem keep a legal cursor.
      const pending = BigInt(primary.drop.client.pending), weapon = BigInt(primary.drop.client.weapon);
      world.command(1, ["use", "Railgun"], "Railgun"); world.frame(100);
      const railgun = required(commands.sourceItem("q2:weapon_railgun")).address;
      expect(memory.readPointer(memory.offset(client, pending))?.byteOffset ?? memory.readPointer(memory.offset(client, weapon))?.byteOffset).toBe(railgun.byteOffset);
      world.command(1, ["invnext"], ""); world.frame(100);
      const cursor = memory.readInt32(memory.offset(client, BigInt(primary.inventory.cursor)));
      expect(cursor).toBeGreaterThan(0); expect(cursor).toBeLessThan(primary.inventory.count);
      expect(counts(cursor)).toBeGreaterThan(0);

      // Original Cmd_Drop_f spawns the pickup through Drop_Item and debits the declared counter.
      const before = counts(index("q2:weapon_shotgun"));
      world.command(1, ["drop", "Shotgun"], "Shotgun"); world.frame(100);
      expect(counts(index("q2:weapon_shotgun"))).toBe(before - 1);
      expect(prints.join("")).not.toContain("Unknown item");

      // Touch_Item runs the declared grants. Under an original selection the DLL writes the recipient; under a replacement the recipient regions
      // are skipped and the guest still returns through its own stack and respawn tail, leaving the source counters untouched.
      const classnames = ["item_armor_jacket", "ammo_shells", "weapon_shotgun", "item_bandolier", "item_pack"];
      const findItem = (classname: string, spot: string | undefined): number => {
        const [sx = 0, sy = 0] = (spot ?? "").split(" ").map(Number);
        for (let slot = 2; slot < world.source.host.edicts.descriptor().count; slot++) {
          const view = world.source.host.edicts.at(slot), name = view.bytes.getUint32(0x118, true);
          if (name !== 0 && readClassicString(memory, memory.pointer(BigInt(name))) === classname && Math.abs(view.bytes.getFloat32(4, true) - sx) < 1 && Math.abs(view.bytes.getFloat32(8, true) - sy) < 1) return slot;
        }
        throw new Error(`Spawned ${classname} is missing at ${spot}`);
      };
      const touch = memory.offset(world.source.imageBase, BigInt(primary.pickups.touch));
      const touchItem = (slot: number): void => {
        const result = world.source.host.invoke(touch, classicSignature([q2Pointer, q2Pointer, q2Pointer, q2Pointer]),
          [world.source.host.edicts.at(slot).address, record.address, null, null].map(value => ({ kind: "pointer" as const, value })));
        expect(result.kind).toBe("void");
      };
      const stores = (): Uint8Array => new Uint8Array(memory.copy(memory.offset(client, 0x2e4n), 0x704 - 0x2e4));
      const clearStores = (): void => { memory.write(memory.offset(client, 0x2e4n), new Uint8Array(primary.inventory.count * 4)); };
      const slots = classnames.map((classname, index) => findItem(classname, spots[index])), others = classnames.map((classname, index) => findItem(classname, spots[index + 5]));
      let mode: "original" | "replacement" = "original";
      selectionMode = () => mode;
      offers.length = 0; clearStores();
      for (const slot of slots) touchItem(slot);
      expect(offers.map(offer => offer.item)).toEqual(classnames.map((name): ItemId => `q2:${name}`));
      expect(counts(index("q2:item_armor_jacket"))).toBeGreaterThan(0);
      expect(counts(index("q2:ammo_shells"))).toBeGreaterThan(0);
      expect(counts(index("q2:weapon_shotgun"))).toBe(1);
      expect(memory.readInt32(memory.offset(client, BigInt(primary.pickups.supply.ammo.capacities[0] ?? 0)))).toBe(300);
      mode = "replacement"; offers.length = 0; clearStores();
      const untouched = stores();
      for (const slot of others) touchItem(slot);
      expect(offers.map(offer => offer.item)).toEqual(classnames.map((name): ItemId => `q2:${name}`));
      expect(stores()).toEqual(untouched);
    } finally { drop.close(); inventory.close(); commands.close(); }
  } finally { world.close(); }
}, 120_000);
