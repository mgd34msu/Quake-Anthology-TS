// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { createSimulation, savedSimulationSettings } from "../../src/app/bootstrap/simulation/index.ts";
import { simulationQ3GuestCheckpoint, validateSimulationSave } from "../../src/app/bootstrap/simulation/save.ts";
import { Q3NativeGuestSource, type Q3NativeProfile } from "../../src/app/bootstrap/simulation/q3/native-guest-source.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { SaveImage } from "../../src/contracts/session.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import type { WireUserCommand } from "../../src/network/q3/message.ts";
import { UserFileStore } from "../../src/core/files/writable.ts";
import { SaveReader } from "../../src/core/save-value.ts";
import { readGuest } from "../../src/persistence/execution.ts";
import { readSaveImage, writeSaveImage } from "../../src/persistence/save-image.ts";
import { EngineSession } from "../../src/world/session/session.ts";
import { testCorpusRoot } from "../support/corpus.ts";
import { Q3_DATA, Q3_ENTITY_STRIDE, Q3_MODULE_BASE, authoredQ3Pe, syntheticQ3Elf } from "../support/q3-modules.ts";
import { trackedTempDirectories } from "../support/temp-directories.ts";

const tempDirectory = trackedTempDirectories();

/** A user content root holding one mod that ships only a native qagame; the retail baseq3 comes from the installed corpus. */
async function userRootWith(file: string, bytes: Uint8Array): Promise<string> {
  const root = await tempDirectory("q3-native-user-");
  await mkdir(join(root, "q3a", "nativemod"), { recursive: true });
  await writeFile(join(root, "q3a", "nativemod", file), bytes);
  return root;
}
const launchOptions = (userRoot: string, ...flags: string[]) => {
  const launch = parseApplicationCommand([
    "--content-root",
    testCorpusRoot(),
    "--game",
    "q3-classic-nativemod",
    "--map",
    "q3dm1",
    "--movement",
    "q3",
    "--character",
    "q3",
    "--mode",
    "deathmatch",
    "--dedicated",
    "--user-content-root",
    userRoot,
    ...flags,
  ]);
  if (launch.kind !== "run") throw new Error("Expected a native mod launch");
  return launch.options;
};

/** The module's heap chain: how many frames allocated, and the addresses and contents of the blocks, newest first. */
function word(engine: Q3NativeGuestSource, offset: number): number {
  const { memory } = engine,
    address = memory.pointer(BigInt(Q3_MODULE_BASE + 0x3000 + offset));
  if (address === null) throw new Error("Unmapped module data");
  return memory.readUint32(address);
}
function heapChain(engine: Q3NativeGuestSource): { readonly count: number; readonly blocks: readonly { readonly address: number; readonly next: number }[] } {
  const { memory } = engine,
    word = (offset: number): number =>
      memory.readUint32(
        memory.pointer(BigInt(Q3_MODULE_BASE + 0x3000 + offset)) ??
          (() => {
            throw new Error("Unmapped module data");
          })(),
      );
  const blocks: { address: number; next: number }[] = [];
  for (let address = word(Q3_DATA.heapHead); address !== 0 && blocks.length < 1000; ) {
    const next = memory.readUint32(
      memory.pointer(BigInt(address)) ??
        (() => {
          throw new Error("Unmapped heap block");
        })(),
    );
    blocks.push({ address, next });
    address = next;
  }
  return { count: word(Q3_DATA.heapCount), blocks };
}

const heapPe = (): Uint8Array => authoredQ3Pe({ heap: true });
const nativeCases: readonly (readonly [string, string, () => Uint8Array, Q3NativeProfile])[] = [
  ["authored PE", "qagamex86.dll", authoredQ3Pe, "q3-pe"],
  ["synthetic ELF", "qagamei386.so", syntheticQ3Elf, "q3-elf"],
  ["authored PE that allocates heap every frame", "qagamex86.dll", heapPe, "q3-pe"],
];
for (const [label, file, build, profile] of nativeCases) {
  test(`a mod that ships a native ${label} qagame runs spawn, connect, frames and a save through the server entry point`, async () => {
    const userRoot = await userRootWith(file, build());
    const options = launchOptions(userRoot, "--vm-game", "0");
    async function open(image?: SaveImage) {
      const content = await loadApplicationContent(options),
        prepared = content.preparedQ3Game;
      if (prepared === null || prepared.kind !== "native") throw new Error("The native qagame was not selected");
      expect(content.recipe.execution[0]).toMatchObject({ kind: "native", api: { kind: "q3-qagame" }, artifact: { requestedPath: file } });
      const identity = createIdentityOwner("q3-native-world"),
        session = new EngineSession(identity, { kind: "headless" });
      const clients = (image === undefined ? [0] : savedSimulationSettings(image).clientSlots).map(slot => {
        if (image !== undefined) session.closeClient(session.createClient(slot).id);
        return session.createClient(slot);
      });
      let buffer: CommandBuffer | null = null;
      const commands = () => {
        if (buffer === null) throw new Error("Guest console not bound");
        return buffer;
      };
      let milliseconds = image === undefined ? 0 : savedSimulationSettings(image).hostMilliseconds;
      const printed: string[] = [];
      const simulation = createSimulation({
        dedicated: true,
        identity,
        recipe: content.recipe,
        world: content.world,
        mounts: content.mounts,
        mode: "deathmatch",
        skill: 1,
        seed: 7,
        maxClients: 8,
        q3Guest: {
          prepared,
          gameDirectory: "nativemod",
          writable: new UserFileStore(join(userRoot, "guest-files")),
          print: text => {
            printed.push(text);
          },
          common: {
            milliseconds: () => milliseconds,
            realTime: output => {
              output?.({ second: 0, minute: 0, hour: 0, day: 1, month: 0, year: 124, weekday: 1, yearDay: 0, isDst: 0 });
              return 1704067200;
            },
            commands: {
              executeNow: text => {
                commands().executeNow(text);
              },
              append: text => commands().append(text),
              insert: text => commands().insert(text),
            },
          },
        },
        ...(image === undefined ? {} : { restore: image, restoredClients: clients.map(client => client.id) }),
      });
      session.attachWorld(simulation);
      const guest = simulation.q3Guest();
      if (guest === null) throw new Error("Missing shared Q3 guest");
      buffer = new CommandBuffer({
        dialect: "q3",
        cvars: guest.state.cvars,
        context: { session: identity.session, origin: { kind: "server-console" } },
        print: text => {
          printed.push(text);
        },
      });
      const output: string[] = [];
      const sink = {
        configstring: (index: number, value: string) => {
          output.push(`config:${index}:${value}`);
        },
        sendServerCommand: (slot: number, text: string) => {
          output.push(`command:${slot}:${text}`);
        },
        dropClient: async (slot: number, reason: string) => {
          output.push(`drop:${slot}:${reason}`);
        },
      };
      guest.state.cvars.set("bot_enable", "0", true);
      if (image === undefined) await guest.initialize(sink);
      else guest.completeRestore(sink);
      commands().execute();
      const userCommand = (): WireUserCommand => ({
        serverTime: milliseconds,
        angles: [0, 0, 0],
        buttons: 0,
        weapon: 2,
        forwardmove: 0,
        rightmove: 0,
        upmove: 0,
      });
      if (image === undefined) {
        const client = clients[0];
        if (client === undefined) throw new Error("Missing test client");
        const admission = await guest.connect(client.id, "\\name\\NativePlayer\\model\\sarge/default\\rate\\25000\\snaps\\20");
        if (admission.kind !== "accepted") throw new Error(admission.reason);
        await guest.begin(admission.player, userCommand());
      }
      simulation.drainPresentationEvents();
      simulation.events.take();
      output.length = 0;
      const frames = async (count: number) => {
        const trace: { readonly frame: SaveImage["frame"]; readonly time: number; readonly commandTime: number }[] = [];
        for (let frame = 0; frame < count; frame++) {
          milliseconds += 50;
          const player = guest.players()[0];
          if (player === undefined) throw new Error("Guest client vanished");
          await guest.think(player, userCommand());
          const completed = await session.stepAsync({ elapsedMilliseconds: 50, commands: [] });
          commands().execute();
          simulation.drainPresentationEvents();
          simulation.events.take();
          trace.push({
            frame: completed.snapshot.frame,
            time: guest.records.entity(0).s.time,
            commandTime: guest.records.player(player.sourceEntity).commandTimeMilliseconds,
          });
        }
        return trace;
      };
      return {
        simulation,
        guest,
        clients,
        frames,
        printed,
        output,
        async close() {
          await guest.shutdown();
          session.close();
          await content.close();
        },
      };
    }
    let active: Awaited<ReturnType<typeof open>> | null = null;
    try {
      active = await open();
      const engine = active.guest.engine;
      expect(engine.kind).toBe("native");
      if (!(engine instanceof Q3NativeGuestSource)) throw new Error("Expected a native engine");
      expect(engine.profile).toBe(profile);
      // GAME_INIT ran the module's own startup through the shared trap table.
      expect(active.printed).toContain("hello from the Q3 test module\n");
      expect(active.guest.state.configstrings.get(3)).toBe("synthetic");
      expect(engine.data.numEntities).toBe(64);
      // Connect and begin spawned the player where the module put it, solid and linked in the shared scene.
      const player = active.guest.players()[0];
      if (player === undefined) throw new Error("Missing admitted player");
      expect(active.guest.records.player(player.sourceEntity).origin).toEqual({ x: 100, y: 200, z: 60 });
      expect(active.guest.records.entity(player.sourceEntity).r.linked).toBe(true);
      expect(active.guest.records.entity(player.sourceEntity).s.number).toBe(player.sourceEntity);
      const frames = await active.frames(12);
      expect(frames.at(-1)?.time).toBe(12 * 50);
      expect(frames.at(-1)?.commandTime).toBe(12 * 50);
      const image = active.simulation.checkpoint(),
        saved = simulationQ3GuestCheckpoint(image);
      if (saved === null || saved.kind !== "native-guest") throw new Error("Missing native guest checkpoint");
      expect(() => validateSimulationSave({ ...image, guests: [] })).toThrow("exactly one");
      expect(() => validateSimulationSave({ ...image, guests: [{ ...saved, module: { ...saved.module, revision: "other-revision" } }] })).toThrow(
        "differs from the selected artifact",
      );
      const path = join(userRoot, "native.sav");
      await writeSaveImage(path, image);
      const continuous = await active.frames(12);
      const continuousChain = build === heapPe ? heapChain(engine) : { count: 0, blocks: [] };
      await active.close();
      active = null;
      active = await open(await readSaveImage(path));
      expect(active.guest.engine.kind).toBe("native");
      expect(active.printed).not.toContain("hello from the Q3 test module\n");
      const restoredPlayer = active.guest.players()[0];
      if (restoredPlayer === undefined) throw new Error("Saved client vanished");
      expect(active.guest.records.entity(restoredPlayer.sourceEntity).s.number).toBe(restoredPlayer.sourceEntity);
      expect(active.guest.records.entity(0).s.time).toBe(12 * 50);
      // The restored process continues exactly as the original did.
      expect(await active.frames(12)).toEqual(continuous);
      expect(Q3_ENTITY_STRIDE).toBe(active.guest.engine.data.entityStrideBytes);
      if (build !== heapPe) {
        // An image written before the heap image existed has neither field; it reads as version 2 with no heap and restores to the same continuation.
        const { version: _version, heap: _heap, ...legacy } = saved;
        const migrated = readGuest(new SaveReader(legacy));
        expect(migrated).toMatchObject({ kind: "native-guest", version: 2, heap: null });
        await active.close();
        active = null;
        active = await open({ ...image, guests: [migrated] });
        expect(await active.frames(12)).toEqual(continuous);
      }
      if (build === heapPe) {
        const restoredEngine = active.guest.engine;
        if (!(restoredEngine instanceof Q3NativeGuestSource)) throw new Error("Expected a native engine");
        // Blocks allocated after startup, before and after the save, are all live and identical to the uninterrupted run's.
        const chain = heapChain(restoredEngine);
        expect(chain.count).toBe(24);
        expect(chain.blocks.length).toBe(24);
        expect(chain).toEqual(continuousChain);
        const heapSaved = saved.heap;
        expect(saved.version).toBe(2);
        expect(heapSaved?.blocks.length).toBe(12);
        expect(heapSaved?.windows?.fls.length).toBe(1);
        const flsHead = word(restoredEngine, Q3_DATA.heapHead);
        // The runtime's heap table came back with them: the module frees its newest block by address and the runtime knows it.
        await restoredEngine.shutdownAsync(false);
        // The fiber-local slot came back holding the newest block, so the module reads it after the restore.
        expect(word(restoredEngine, Q3_DATA.flsValue)).toBe(flsHead);
        expect(
          restoredEngine.memory.readUint32(
            restoredEngine.memory.pointer(BigInt(Q3_MODULE_BASE + 0x3000 + Q3_DATA.heapFreed)) ??
              (() => {
                throw new Error("Unmapped module data");
              })(),
          ),
        ).toBe(1);
      }
    } finally {
      await active?.close();
    }
  }, 120000);
}

test("native selection needs vm_game 0 and falls back to the bytecode otherwise", async () => {
  const userRoot = await userRootWith("qagamex86.dll", authoredQ3Pe());
  for (const flags of [[], ["--vm-game", "1"], ["--vm-game", "2"]]) {
    // The mod ships no bytecode of its own, so the bytecode path runs the one its base game provides.
    const content = await loadApplicationContent(launchOptions(userRoot, ...flags));
    try {
      expect(content.preparedQ3Game?.kind).toBe("qvm");
      expect(content.recipe.execution[0]?.kind).toBe("qvm");
    } finally {
      await content.close();
    }
  }
  const content = await loadApplicationContent(launchOptions(userRoot, "--vm-game", "0"));
  try {
    expect(content.preparedQ3Game?.kind).toBe("native");
  } finally {
    await content.close();
  }
}, 60000);
