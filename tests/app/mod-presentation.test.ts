import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { ApplicationAssets } from "../../src/app/bootstrap/assets.ts";
import { ApplicationAudio } from "../../src/app/bootstrap/audio.ts";
import type { Q3SeatAudioFrame } from "../../src/app/bootstrap/audio/q3.ts";
import { ApplicationModPresentation } from "../../src/app/bootstrap/mod-presentation.ts";
import { ApplicationQ3SceneRenderer } from "../../src/app/bootstrap/q3-client/scene.ts";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import type { Q3SourcePlayerEvent } from "../../src/app/bootstrap/simulation/q3/types.ts";
import { QvmCgameImport } from "../../src/compat/qvm/abi.ts";
import { resolveQvmArtifact } from "../../src/compat/qvm/artifacts.ts";
import { QvmOpcode } from "../../src/compat/qvm/image.ts";
import type { QvmHostCall } from "../../src/compat/qvm/syscalls.ts";
import { readSourceQvmPlayerState } from "../../src/compat/qvm/player-record.ts";
import { digestBytes } from "../../src/content/mounts/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { ModuleIdentity } from "../../src/contracts/execution.ts";
import type { QvmModPresentationDeclaration } from "../../src/contracts/qvm-mod-presentation.ts";
import { BinaryWriter } from "../../src/core/binary/index.ts";
import { anglesToAxis, identityMat4 } from "../../src/core/math.ts";
import { ClientGameStateStorage } from "../../src/network/q3/game-state.ts";
import { createSceneQueries } from "../../src/world/collision/index.ts";
import type { ActiveModPresentation } from "../../src/world/session/mod-presentations.ts";

function executable() {
  const operations: (readonly [QvmOpcode, number?])[] = [], add = (opcode: QvmOpcode, operand?: number) => { operations.push(operand === undefined ? [opcode] : [opcode, operand]); };
  const trap = (code: QvmCgameImport) => { add(QvmOpcode.OP_CONST, -code - 1); add(QvmOpcode.OP_CALL); };
  const constantArgument = (offset: number, value: number) => { add(QvmOpcode.OP_CONST, value); add(QvmOpcode.OP_ARG, offset); };
  add(QvmOpcode.OP_ENTER, 32); add(QvmOpcode.OP_CONST, 90080);
  constantArgument(8, 90000); constantArgument(12, 0); trap(QvmCgameImport.CG_S_REGISTERSOUND); add(QvmOpcode.OP_STORE4);
  trap(QvmCgameImport.CG_UPDATESCREEN); add(QvmOpcode.OP_POP); add(QvmOpcode.OP_CONST, 0); add(QvmOpcode.OP_LEAVE, 32);
  const eventEntry = operations.length;
  add(QvmOpcode.OP_ENTER, 32); trap(QvmCgameImport.CG_UPDATESCREEN); add(QvmOpcode.OP_POP);
  constantArgument(8, 0); constantArgument(12, 1); constantArgument(16, 4);
  add(QvmOpcode.OP_CONST, 90080); add(QvmOpcode.OP_LOAD4); add(QvmOpcode.OP_ARG, 20);
  trap(QvmCgameImport.CG_S_STARTSOUND); add(QvmOpcode.OP_POP);
  constantArgument(8, 82000); trap(QvmCgameImport.CG_R_ADDREFENTITYTOSCENE); add(QvmOpcode.OP_POP); add(QvmOpcode.OP_CONST, 0); add(QvmOpcode.OP_LEAVE, 32);
  const unsupported = [QvmCgameImport.CG_GETSNAPSHOT, QvmCgameImport.CG_S_STARTBACKGROUNDTRACK,
    QvmCgameImport.CG_S_STOPBACKGROUNDTRACK, QvmCgameImport.CG_R_REMAP_SHADER,
    QvmCgameImport.CG_CIN_PLAYCINEMATIC, QvmCgameImport.CG_CIN_STOPCINEMATIC, QvmCgameImport.CG_CIN_RUNCINEMATIC,
    QvmCgameImport.CG_CIN_DRAWCINEMATIC, QvmCgameImport.CG_CIN_SETEXTENTS].map(code => {
      const entry = operations.length;
      add(QvmOpcode.OP_ENTER, 32); trap(code); add(QvmOpcode.OP_POP); add(QvmOpcode.OP_CONST, 0); add(QvmOpcode.OP_LEAVE, 32);
      return { entry, code };
    });
  const frameEntry = operations.length;
  add(QvmOpcode.OP_ENTER, 32); trap(QvmCgameImport.CG_MEMORY_REMAINING); add(QvmOpcode.OP_POP); add(QvmOpcode.OP_CONST, 0); add(QvmOpcode.OP_LEAVE, 32);
  const code = new BinaryWriter(operations.length * 5);
  for (const [opcode, operand] of operations) { code.u8(opcode); if (operand !== undefined) { if (opcode === QvmOpcode.OP_ARG) code.u8(operand); else code.i32(operand); } }
  const instructions = code.finish(), data = new Uint8Array(90100); data.set(new TextEncoder().encode("sound/items/regen.wav\0"), 90000);
  const ref = new DataView(data.buffer, 82000, 140); ref.setInt32(0, 2, true); ref.setFloat32(132, 8, true);
  const output = new BinaryWriter(32 + instructions.length + data.length);
  for (const word of [0x12721444, operations.length, 32, instructions.length, 32 + instructions.length, data.length, 0, 65536]) output.i32(word);
  output.bytes(instructions); output.bytes(data); return { bytes: output.finish(), eventEntry, unsupported, frameEntry };
}

test("component cgame uses source media and actor mapping, preserves baseline delivery and retires across an awaited trap", async () => {
  const temporary = await mkdtemp("/tmp/quake-component-cgame-");
  try {
    const parsed = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--dedicated", "--user-content-root", temporary]);
    if (parsed.kind !== "run") throw new Error("Expected Q3 source fixture");
    const content = await loadApplicationContent(parsed.options), ids = createIdentityOwner("component-cgame"), viewer = ids.actor(5, 2), target = ids.actor(8, 3), seat = ids.seat(0);
    const assets = new ApplicationAssets(content, { identity: Symbol("component-cgame"), session: ids.session, generation: 0 });
    const audio = new ApplicationAudio(content, () => 1000, 1, "sarge", () => undefined, { deferOutput: true });
    const frames: Q3SeatAudioFrame[] = [], receive = spyOn(audio, "receiveCgameFrame").mockImplementation(frame => { frames.push(frame); });
    let owner: ApplicationModPresentation | null = null;
    try {
      await assets.loadWorld();
      const sourceContent = content.recipe.map.entities.content, fixture = executable(), digest = digestBytes(fixture.bytes);
      const module = { id: "mod:component-source", artifactPath: "vm/qagame.qvm", digest, revision: "fixture" } satisfies ModuleIdentity;
      const artifact = resolveQvmArtifact({ module: { ...module, artifactPath: "vm/cgame.qvm" }, role: "cgame", bytes: fixture.bytes });
      if (artifact.kind !== "bytecode") throw new Error("Missing cgame executable");
      const declaration: QvmModPresentationDeclaration = { version: 1, runtime: "qvm-player-events",
        gameplay: { path: module.artifactPath, digest, abiProfile: "q3-modern" }, cgame: { path: artifact.module.artifactPath, digest, abiProfile: "q3-modern" },
        storage: { gameState: 0, playerState: 21000, snapshot: { kind: "synthetic-player-event", address: 22000, pointers: [81000] },
          centities: { address: 76000, stride: 800, capacity: 2, state: 0, origin: 708 }, time: [81004], frameTime: [81008], viewOrigin: [81012] },
        initialize: [{ entry: 0, arguments: [] }], refresh: [], project: [], frame: [{ entry: fixture.frameEntry, arguments: [] }], event: { entry: fixture.eventEntry, arguments: [] } };
      const state = new ClientGameStateStorage(message => { throw new Error(message); }); state.beginEntries();
      const playerState = readSourceQvmPlayerState(new DataView(new ArrayBuffer(468)), "q3-modern");
      let generation = 0, yields = 0, retireAtYield = false, time = 1000, cameraX = 5;
      const frameContexts: number[][] = [];
      const source: ActiveModPresentation = { identity: { selection: { product: "source", id: "component" }, source: { provider: "q3:source", content: sourceContent },
        declarationDigest: digest, modules: [module], providers: [] }, prepared: { kind: "qvm", source: module, artifact, declaration },
        source: { module, abiProfile: "q3-modern", get generation() { return generation; }, assertCurrent: () => {},
          live: actor => actor.equals(viewer) || actor.equals(target), actor: slot => slot === 0 ? viewer : slot === 1 ? target : null,
          context: () => ({ gameState: state.copySourceRecord(), gameStateRevision: 0, snapshot: { serverTime: time, playerState } }) } };
      const options = { assets, audio, queries: createSceneQueries(content.world), seat, viewer, viewport: { x: 0, y: 0, width: 320, height: 240 }, source,
        clock: { now: () => time, frameNumber: () => 1 }, viewOrigin: () => ({ x: cameraX, y: 6, z: 7 }), print: () => {}, nextFrame: async () => { yields++; await Promise.resolve(); if (retireAtYield) generation++; },
        scalar: (call: QvmHostCall) => {
          if (call.kind !== "engine" || call.code !== QvmCgameImport.CG_MEMORY_REMAINING) return null;
          const values = call.guest.view(81008, 16);
          frameContexts.push([values.getInt32(0, true), values.getFloat32(4, true), values.getFloat32(8, true), values.getFloat32(12, true)]); return 1024;
        },
        output: { scene: () => {}, command: () => {}, text: () => {}, listener: () => {} } };
      owner = await ApplicationModPresentation.create(options, 4);
      const retiringRenderer = new ApplicationQ3SceneRenderer(owner.media, owner.services.resources), pendingPreload = retiringRenderer.preload([]);
      retiringRenderer.close(); await expect(pendingPreload).rejects.toThrow("closed");
      expect(yields).toBe(1); expect(owner.media.bank.registrations()[0]?.sound?.name).toBe("sound/items/regen.wav");
      const event: Q3SourcePlayerEvent = { kind: "player-event", actor: target, source: { module, abiProfile: "q3-modern" },
        playerState: { ...playerState, clientNumber: 1 }, event: 349, parameter: 0, origin: { x: 10, y: 20, z: 30 }, sequence: { kind: "external", time: 1000 }, time: 1 };
      await owner.consume(event, 4); expect(frames).toHaveLength(0);
      await owner.consume(event, 5); await owner.consume(event, 5);
      expect(yields).toBe(2); expect(frames).toHaveLength(1);
      expect(frames[0]?.owner).toBe(module.id); expect(frames[0]?.seat).toBe(seat);
      const play = frames[0]?.operations[0]; if (play?.kind !== "play") throw new Error("Missing actual source sound");
      expect(play.sound.actor).toBe(target); expect(play.sound.owner).toBe(module.id); expect(play.sound.channel).toBe(4);
      expect(play.sound.sound.name).toBe("sound/items/regen.wav"); expect(owner.owns(source, viewer)).toBe(true);
      const firstFrame = await owner.frame(0); expect(firstFrame.admission.entities).toHaveLength(1); expect(await owner.frame(0)).toBe(firstFrame);
      expect(() => retiringRenderer.operations(firstFrame, { camera: { origin: options.viewOrigin(), axis: anglesToAxis({ x: 0, y: 0, z: 0 }),
        projection: identityMat4(), viewport: options.viewport, clip: { kind: "none" } }, time: { kind: "milliseconds", value: time },
        target: { kind: "seat", seat } }, 0, { noWorldModel: false, splitScreen: false, supplementalViewWeapon: false })).toThrow("closed");
      time = 1050; cameraX = 15; expect((await owner.frame(1)).admission.entities).toHaveLength(0); await owner.frame(2);
      expect(frameContexts).toEqual([[0, 5, 6, 7], [50, 15, 6, 7], [0, 15, 6, 7]]);
      retireAtYield = true;
      await expect(owner.consume(event, 6)).rejects.toThrow("retired source or viewer");
      expect(frames).toHaveLength(2); expect(frames[1]?.operations).toEqual([{ kind: "release-owner" }]);
      expect(owner.owns(source, viewer)).toBe(false); owner.close(); expect(frames).toHaveLength(2);
      retireAtYield = false;
      for (const { entry, code } of fixture.unsupported) {
        const unsupported = await ApplicationModPresentation.create({ ...options, source: { ...source,
          prepared: { ...source.prepared, declaration: { ...declaration, event: { entry, arguments: [] } } } } });
        try { await expect(unsupported.consume(event, 7)).rejects.toThrow(`Unbound cgame QVM syscall ${code}`); }
        finally { unsupported.close(); }
      }
    } finally { owner?.close(); receive.mockRestore(); audio.close(); assets.close(); await content.close(); }
  } finally { await rm(temporary, { recursive: true, force: true }); }
}, 60000);
