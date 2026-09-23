import type { ActorId } from "../../contracts/identity.ts";
import type { ModuleIdentity } from "../../contracts/execution.ts";
import type { Q3PlayerState } from "../../contracts/protocol.ts";
import type { Axis, Vec3 } from "../../contracts/math.ts";
import type { QvmModPresentationDeclaration, QvmPresentationArgument, QvmPresentationCall, QvmScenePresentation } from "../../contracts/qvm-mod-presentation.ts";
import type { Q3SourcePlayerEvent } from "../../app/bootstrap/simulation/q3/types.ts";
import type { SourceGameStateRecord } from "../../network/q3/game-state.ts";
import { dot3, vectorToAngles } from "../../core/math.ts";
import { qvmAnglesToAxis } from "../../core/qvm-math.ts";
import { float32ToBits } from "../../core/numeric.ts";
import { QvmModule, type QvmModuleOptions } from "./module.ts";
import { QvmOpcode } from "./image.ts";
import { qvmPlayerStateBytes, writeSourceQvmPlayerState } from "./player-record.ts";
import { qvmEntityStateBytes } from "./entity-record.ts";
import { QVM_GAME_STATE_BYTES, qvmSnapshotBytes, writeSourceQvmGameState, writeSourceQvmSnapshot, type QvmSourceSnapshot } from "./client-state-record.ts";
import { QvmCgameImport, QvmCgameExport } from "./abi.ts";
import type { QvmHostCall, QvmHostResult } from "./syscalls.ts";
import type { QvmFunctionCall } from "./interpreter.ts";

export interface QvmSceneContext {
  readonly revision: number;
  readonly gameState: SourceGameStateRecord;
  readonly gameStateRevision: number;
  readonly snapshot: Omit<QvmSourceSnapshot, "number">;
  readonly actors: readonly { readonly actor: ActorId; readonly slot: number; readonly owned: boolean }[];
  readonly commands: readonly { readonly sequence: number; readonly arguments: readonly string[] }[];
  readonly baseline?: QvmSceneContext;
}

export interface QvmPresentationContext {
  readonly gameState: SourceGameStateRecord;
  readonly gameStateRevision: number;
  readonly frameTimeMilliseconds: number;
  readonly timeMilliseconds?: number;
  readonly viewOrigin: Vec3;
  readonly viewAxis?: Axis;
  readonly weaponPresented?: boolean;
  readonly snapshot: { readonly serverTime: number; readonly playerState: Q3PlayerState };
  readonly scene?: QvmSceneContext;
}
export interface QvmModPresentationOptions {
  readonly artifact: QvmModuleOptions["artifact"];
  readonly source: ModuleIdentity;
  readonly declaration: QvmModPresentationDeclaration;
  readonly host: QvmModuleOptions["host"];
  context(): QvmPresentationContext;
  actor(sourceSlot: number): ActorId | null;
  live(actor: ActorId): boolean;
  assertCurrent(): void;
}
function matches(first: ModuleIdentity, second: ModuleIdentity): boolean {
  return first.id === second.id && first.artifactPath === second.artifactPath && first.digest === second.digest && first.revision === second.revision;
}
function int32(value: number): number {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) throw new RangeError("Source presentation value exceeds int32");
  return value;
}
class RetiredPlayer extends Error {}

export function validateQvmModPresentation(options: Pick<QvmModPresentationOptions, "artifact" | "source" | "declaration">): void {
  const { artifact, source, declaration } = options, storage = declaration.storage;
  if (artifact.role !== "cgame" || artifact.module.artifactPath !== declaration.cgame.path || artifact.module.digest !== declaration.cgame.digest
    || (artifact.abiProfile ?? "q3-modern") !== declaration.cgame.abiProfile || source.artifactPath !== declaration.gameplay.path || source.digest !== declaration.gameplay.digest)
    throw new Error("Source presentation differs from its declared gameplay/cgame artifacts");
  if (declaration.gameplay.abiProfile !== declaration.cgame.abiProfile) throw new Error("Source presentation requires matching player-state ABI profiles");
  const end = artifact.image.dataLength + artifact.image.literalLength + artifact.image.bssLength;
  const range = (address: number, size: number): void => {
    if (!Number.isSafeInteger(address) || address < 0 || !Number.isSafeInteger(size) || size < 1 || address + size > end)
      throw new Error("Source presentation storage exceeds the original data image");
  };
  range(storage.gameState, QVM_GAME_STATE_BYTES);
  for (const address of [...storage.time, ...storage.frameTime]) range(address, 4);
  for (const address of [...storage.viewOrigin, ...(storage.viewAngles ?? [])]) range(address, 12);
  for (const address of storage.viewAxis ?? []) range(address, 36);
  const entities = storage.centities;
  range(entities.address, entities.stride * entities.capacity);
  if (!Number.isSafeInteger(entities.capacity) || entities.capacity < 1 || !Number.isSafeInteger(entities.stride)
    || !Number.isSafeInteger(entities.state) || entities.state < 0 || entities.state + qvmEntityStateBytes(declaration.cgame.abiProfile) > entities.stride)
    throw new Error("Source presentation centity layout is invalid");
  if (declaration.runtime === "qvm-player-events") {
    const storage = declaration.storage, psBytes = qvmPlayerStateBytes(declaration.cgame.abiProfile), snapshotBytes = qvmSnapshotBytes(declaration.cgame.abiProfile);
    range(storage.playerState, psBytes); range(storage.snapshot.address, snapshotBytes);
    for (const address of storage.snapshot.pointers) range(address, 4);
    if (storage.centities.origin < 0 || storage.centities.origin + 12 > entities.stride) throw new Error("Source centity origin exceeds its record");
    if (storage.playerState < storage.snapshot.address + snapshotBytes && storage.snapshot.address < storage.playerState + psBytes)
      throw new Error("Event projection state must be separate from the viewing player's snapshot");
  } else {
    range(declaration.storage.serverCommandSequence, 4);
    for (const offset of [declaration.storage.centities.previousEvent, declaration.storage.centities.snapshotTime])
      if (!Number.isSafeInteger(offset) || offset < 0 || offset + 4 > entities.stride) throw new Error("Source centity event cursor exceeds its record");
    const { player, mesh } = declaration.body;
    for (const entry of [player.entry, mesh.entry, declaration.eventCheck.entry]) if (artifact.image.instructions[entry]?.opcode !== QvmOpcode.OP_ENTER)
      throw new Error("Source mesh scope has no original function entry");
    for (const argument of [player.centityArgument, mesh.entityArgument, mesh.stateArgument, declaration.eventCheck.centityArgument])
      if (!Number.isInteger(argument) || argument < 0 || argument > 9) throw new Error("Source mesh scope has an invalid argument");
    if (mesh.shaderOffset !== 112) throw new Error("Source mesh shader field differs from the declared refEntity ABI");
    if (declaration.snapshots.length === 0) throw new Error("Source scene requires original snapshot processing");
  }
  const checkCall = (call: QvmPresentationCall, initializing: boolean): void => {
    if (!Number.isInteger(call.entry) || artifact.image.instructions[call.entry]?.opcode !== QvmOpcode.OP_ENTER || call.arguments.length > 10)
      throw new Error("Source presentation call has no original function entry");
    for (const argument of call.arguments) {
      if (argument.kind === "address") range(argument.value, 1);
      else if (argument.kind === "int32") int32(argument.value);
      else if (argument.kind === "float32" && !Number.isFinite(Math.fround(argument.value))) throw new Error("Source presentation float exceeds its ABI");
      else if (declaration.runtime === "qvm-scene" && argument.kind === "source" && ["player-state", "snapshot"].includes(argument.value))
        throw new Error("Scene presentation receives its records through original snapshot traps");
      else if (initializing && argument.kind === "source" && ["entity-state", "centity", "origin", "event", "parameter"].includes(argument.value))
        throw new Error("Source presentation initialization requires an event-independent context");
    }
  };
  for (const call of [...declaration.initialize, ...declaration.refresh, ...declaration.frame, ...(declaration.hud?.frame ?? [])]) checkCall(call, true);
  if (declaration.runtime === "qvm-player-events") for (const call of [...declaration.project, declaration.event]) checkCall(call, false);
  else for (const call of declaration.snapshots) checkCall(call, true);
}

/** Executes artifact-qualified original presentation with its private media and caller state. */
export class QvmModPresentation {
  readonly module: QvmModule;
  private phase: "created" | "initialized" | "failed" | "closed" = "created";
  private busy = false;
  private sequence = -1;
  private revision = -1;
  private frame = -1;
  private hudFrame = -1;
  private commandArguments: readonly string[] | null = null;
  private readonly players = new Map<number, ActorId>();
  private defaults: Uint8Array | null = null;
  private activeEvent: Q3SourcePlayerEvent | undefined;
  private readonly removals: (() => void)[] = [];
  private readonly snapshots = new Map<number, QvmSourceSnapshot>();
  private snapshotNumber = 0;
  private sceneRevision = -1;
  private readonly commands = new Map<number, readonly string[]>();
  private arguments_: readonly string[] = [];
  private readonly sceneActors = new Map<number, QvmSceneContext["actors"][number]>();
  private restoringScene = false;
  private currentGameState: SourceGameStateRecord | null = null;
  private playerScope: { readonly actor: ActorId; readonly state: number } | null = null;
  private meshScope: { readonly player: NonNullable<QvmModPresentation["playerScope"]>; readonly pointer: number; readonly shader: number } | null = null;
  constructor(private readonly options: QvmModPresentationOptions) {
    validateQvmModPresentation(options);
    this.module = new QvmModule({ artifact: options.artifact, host: call => { this.current(this.activeEvent); return this.sceneSyscall(call) ?? options.host(call); } });
    if (options.declaration.runtime === "qvm-scene") this.bindBody(options.declaration);
  }
  get arguments(): readonly string[] { return this.commandArguments ?? this.arguments_; }
  private async scoped(call: QvmFunctionCall, enter: () => () => void): Promise<number> {
    const leave = enter();
    try { return await call.proceedAsync(); } finally { leave(); }
  }
  private bindBody(declaration: QvmScenePresentation): void {
    const bind = (entry: number, hook: (call: QvmFunctionCall) => Promise<number>) => this.removals.push(this.module.bindInvocation({ kind: "qvm",
      module: this.module.profile.module, instructionIndex: entry }, hook));
    bind(declaration.body.player.entry, call => this.scoped(call, () => {
      const previous = this.playerScope, pointer = call.words.getInt32(declaration.body.player.centityArgument * 4, true) + declaration.storage.centities.state;
      const number = call.guest.view(pointer, 4).getInt32(0, true), row = this.sceneActors.get(number);
      this.playerScope = row !== undefined && !row.owned && this.options.actor(number)?.equals(row.actor) === true && this.options.live(row.actor)
        ? { actor: row.actor, state: pointer } : null;
      return () => { this.playerScope = previous; };
    }));
    bind(declaration.body.mesh.entry, call => this.scoped(call, () => {
      const previous = this.meshScope, player = this.playerScope, mesh = declaration.body.mesh;
      const pointer = call.words.getInt32(mesh.entityArgument * 4, true), state = call.words.getInt32(mesh.stateArgument * 4, true);
      this.meshScope = player !== null && state === player.state ? { player, pointer, shader: call.guest.view(pointer + mesh.shaderOffset, 4).getInt32(0, true) } : null;
      return () => { this.meshScope = previous; };
    }));
    bind(declaration.eventCheck.entry, call => {
      if (this.restoringScene) {
        const pointer = call.words.getInt32(declaration.eventCheck.centityArgument * 4, true), fields = declaration.storage.centities;
        const state = call.guest.view(pointer + fields.state, qvmEntityStateBytes(declaration.cgame.abiProfile));
        const previous = state.getInt32(4, true) > declaration.eventEntityType ? 1 : state.getInt32(180, true);
        call.guest.view(pointer + fields.previousEvent, 4).setInt32(0, previous, true);
      }
      return call.proceedAsync();
    });
  }
  private sceneSyscall(call: QvmHostCall): QvmHostResult | null {
    if (this.options.declaration.runtime !== "qvm-scene" || call.kind !== "engine" || call.role !== "cgame") return null;
    const { words, guest } = call, profile = this.options.declaration.cgame.abiProfile;
    if (call.code === QvmCgameImport.CG_GETGAMESTATE) {
      if (this.currentGameState === null) throw new Error("Component cgame has no active source gameState");
      writeSourceQvmGameState(guest, guest.view(words.getInt32(4, true), QVM_GAME_STATE_BYTES), this.currentGameState); return 0;
    }
    if (call.code === QvmCgameImport.CG_R_ADDREFENTITYTOSCENE) {
      const mesh = this.meshScope;
      if (mesh !== null && mesh.player === this.playerScope && this.options.live(mesh.player.actor)
        && this.options.actor(guest.view(mesh.player.state, 4).getInt32(0, true))?.equals(mesh.player.actor) === true
        && words.getInt32(4, true) === mesh.pointer && guest.view(mesh.pointer + this.options.declaration.body.mesh.shaderOffset, 4).getInt32(0, true) === mesh.shader) return 0;
      return null;
    }
    if (call.code === QvmCgameImport.CG_GETCURRENTSNAPSHOTNUMBER) {
      guest.view(words.getInt32(4, true), 4).setInt32(0, this.snapshotNumber, true);
      guest.view(words.getInt32(8, true), 4).setInt32(0, this.snapshots.get(this.snapshotNumber)?.serverTime ?? 0, true); return 0;
    }
    if (call.code === QvmCgameImport.CG_GETSNAPSHOT) {
      const number = words.getInt32(4, true);
      if (number > this.snapshotNumber) throw new Error("Component cgame requested a future snapshot");
      const snapshot = this.snapshots.get(number); if (snapshot === undefined) return 0;
      writeSourceQvmSnapshot(guest, guest.view(words.getInt32(8, true), qvmSnapshotBytes(profile)), snapshot, profile); return 1;
    }
    if (call.code === QvmCgameImport.CG_GETSERVERCOMMAND) {
      const arguments_ = this.commands.get(words.getInt32(4, true));
      if (arguments_ === undefined) throw new Error("Component cgame server command fell outside retained source history");
      this.arguments_ = arguments_; return Number(arguments_.length !== 0);
    }
    return null;
  }
  private acceptScene(scene: QvmSceneContext, baseline = false): boolean {
    if (scene.revision < this.sceneRevision) throw new Error("Component scene publication moved backward");
    if (scene.revision === this.sceneRevision) return false;
    const declaration = this.options.declaration;
    if (declaration.runtime !== "qvm-scene" || this.defaults === null) throw new Error("Component scene has no initialized caller storage");
    const entities = declaration.storage.centities;
    this.sceneActors.clear();
    for (const row of scene.actors) {
      if (!Number.isInteger(row.slot) || row.slot < 0 || row.slot >= entities.capacity) throw new Error("Component source actor exceeds cgame centities");
      const previous = this.players.get(row.slot);
      if (previous !== undefined && !previous.equals(row.actor)) this.module.memory.writeBytes(entities.address + row.slot * entities.stride,
        this.defaults.subarray(row.slot * entities.stride, (row.slot + 1) * entities.stride));
      this.players.set(row.slot, row.actor);
      this.sceneActors.set(row.slot, row);
    }
    if (baseline) for (const state of scene.snapshot.entities) {
      const view = this.module.memory.dataView(entities.address + state.number * entities.stride, entities.stride);
      view.setInt32(entities.previousEvent, state.eType > declaration.eventEntityType ? 1 : state.event, true);
      view.setInt32(entities.snapshotTime, scene.snapshot.serverTime, true);
    }
    this.sceneRevision = scene.revision;
    for (const command of scene.commands) this.commands.set(command.sequence, command.arguments);
    for (const number of this.commands.keys()) if (number <= scene.snapshot.serverCommandSequence - 64) this.commands.delete(number);
    const number = ++this.snapshotNumber;
    this.snapshots.set(number, { ...scene.snapshot, number }); this.snapshots.delete(number - 32);
    return true;
  }
  get lastSequence(): number { return this.sequence; }
  private current(event?: Q3SourcePlayerEvent): void {
    this.options.assertCurrent();
    if (this.phase === "closed" || this.phase === "failed") throw new Error(`Source presentation is ${this.phase}`);
    if (event !== undefined && (!this.options.live(event.actor) || this.options.actor(event.playerState.clientNumber)?.equals(event.actor) !== true))
      throw new RetiredPlayer("Source event actor no longer owns its original client slot");
  }
  private fail(error: unknown): never { if (this.phase !== "closed") this.phase = "failed"; throw error; }
  private context(scene?: QvmSceneContext): QvmPresentationContext {
    const source = this.options.context(), context = scene === undefined ? source : { ...source, scene,
      gameState: scene.gameState, gameStateRevision: scene.gameStateRevision, snapshot: scene.snapshot,
      timeMilliseconds: scene.snapshot.serverTime, frameTimeMilliseconds: 0 };
    const { storage, cgame } = this.options.declaration, memory = this.module.memory;
    if (!Number.isSafeInteger(context.gameStateRevision) || context.gameStateRevision < 0 || context.gameStateRevision < this.revision)
      throw new Error("Source gameState revision is invalid or stale");
    if (int32(context.frameTimeMilliseconds) < 0 || ![context.viewOrigin.x, context.viewOrigin.y, context.viewOrigin.z].every(value => Number.isFinite(Math.fround(value))))
      throw new Error("Source presentation frame context is invalid");
    const snapshot = context.snapshot;
    this.currentGameState = context.gameState;
    int32(snapshot.serverTime); int32(snapshot.playerState.clientNumber);
    if (context.gameStateRevision !== this.revision) writeSourceQvmGameState(memory, memory.dataView(storage.gameState, QVM_GAME_STATE_BYTES), context.gameState);
    if (this.options.declaration.runtime === "qvm-player-events") {
      const storage = this.options.declaration.storage, bytes = qvmSnapshotBytes(cgame.abiProfile), psBytes = qvmPlayerStateBytes(cgame.abiProfile);
      const view = memory.dataView(storage.snapshot.address, bytes);
      view.setInt32(0, 0, true); view.setInt32(4, snapshot.playerState.pingMilliseconds, true); view.setInt32(8, snapshot.serverTime, true);
      memory.fillBytes(storage.snapshot.address + 12, 32, 0);
      writeSourceQvmPlayerState(memory.dataView(storage.snapshot.address + 44, psBytes), snapshot.playerState, cgame.abiProfile);
      writeSourceQvmPlayerState(memory.dataView(storage.playerState, psBytes), snapshot.playerState, cgame.abiProfile);
      view.setInt32(44 + psBytes, 0, true); view.setInt32(bytes - 8, 0, true); view.setInt32(bytes - 4, 0, true);
      for (const address of storage.snapshot.pointers) memory.dataView(address, 4).setInt32(0, storage.snapshot.address, true);
    }
    for (const address of storage.time) memory.dataView(address, 4).setInt32(0, int32(context.timeMilliseconds ?? snapshot.serverTime), true);
    for (const address of storage.frameTime) memory.dataView(address, 4).setInt32(0, context.frameTimeMilliseconds, true);
    this.view(context);
    return context;
  }
  private view(context: QvmPresentationContext): void {
    const storage = this.options.declaration.storage;
    const vector = (address: number, value: Vec3): void => {
      const view = this.module.memory.dataView(address, 12);
      view.setFloat32(0, value.x, true); view.setFloat32(4, value.y, true); view.setFloat32(8, value.z, true);
    };
    for (const address of storage.viewOrigin) vector(address, context.viewOrigin);
    if ((storage.viewAngles?.length ?? 0) + (storage.viewAxis?.length ?? 0) === 0) return;
    const axis = context.viewAxis;
    if (axis === undefined) throw new Error("Declared original view storage requires the actual viewing camera axis");
    for (const address of storage.viewAxis ?? []) for (const [index, value] of axis.entries()) vector(address + index * 12, value);
    const angles = vectorToAngles(axis[0]), basis = qvmAnglesToAxis(angles);
    const roll = Math.atan2(dot3(axis[1], basis[2]), dot3(axis[1], basis[1])) * 180 / Math.PI;
    for (const address of storage.viewAngles ?? []) vector(address, { ...angles, z: roll });
  }
  private word(argument: QvmPresentationArgument, context: QvmPresentationContext, event?: Q3SourcePlayerEvent): number {
    if (argument.kind === "float32") return float32ToBits(argument.value) | 0;
    if (argument.kind !== "source") return argument.value;
    const declaration = this.options.declaration;
    switch (argument.value) {
      case "snapshot-number": return Math.max(0, this.snapshotNumber - 1);
      case "server-command-sequence": return context.scene?.snapshot.serverCommandSequence ?? 0;
      case "player-state":
        if (declaration.runtime !== "qvm-player-events") throw new Error("Scene calls cannot borrow event projection state");
        return declaration.storage.playerState;
      case "snapshot":
        if (declaration.runtime !== "qvm-player-events") throw new Error("Scene snapshots are supplied by original engine traps");
        return declaration.storage.snapshot.address;
      case "client-number": return context.snapshot.playerState.clientNumber;
      case "time": return context.timeMilliseconds ?? context.snapshot.serverTime;
      default: {
        if (event === undefined || declaration.runtime !== "qvm-player-events") throw new Error("Original call requires a source player event");
        const storage = declaration.storage;
        const entity = storage.centities.address + event.playerState.clientNumber * storage.centities.stride;
        switch (argument.value) {
          case "entity-state": return entity + storage.centities.state;
          case "centity": return entity;
          case "origin": return entity + storage.centities.origin;
          case "event": return event.event;
          case "parameter": return event.parameter;
        }
      }
    }
  }
  private async call(call: QvmPresentationCall, context: QvmPresentationContext, event?: Q3SourcePlayerEvent): Promise<void> {
    const current = () => { this.current(event ?? this.activeEvent); };
    current();
    if (call.when === "weapon-presented") {
      const selected = this.options.context().weaponPresented;
      if (selected === undefined) throw new Error("Original weapon presentation requires a current source owner");
      if (!selected) return;
    }
    this.view(context);
    await this.module.callAsync(call.arguments.map(argument => this.word(argument, context, event)), call.entry, current);
    current();
  }
  private async refresh(context: QvmPresentationContext): Promise<void> {
    if (context.gameStateRevision === this.revision) return;
    for (const call of this.options.declaration.refresh) await this.call(call, context);
    this.revision = context.gameStateRevision;
  }
  async initialize(baselineSequence = -1): Promise<void> {
    this.current();
    if (this.busy || this.phase !== "created" || !Number.isSafeInteger(baselineSequence) || baselineSequence < -1) throw new Error("Invalid source presentation initialization");
    this.busy = true; this.sequence = baselineSequence;
    try {
      let context = this.context();
      if (context.scene?.baseline !== undefined) context = this.context(context.scene.baseline);
      for (const call of this.options.declaration.initialize) await this.call(call, context);
      this.revision = context.gameStateRevision;
      const entities = this.options.declaration.storage.centities;
      this.defaults = this.module.memory.bytes.slice(entities.address, entities.address + entities.stride * entities.capacity);
      this.phase = "initialized";
      if (this.options.declaration.runtime === "qvm-scene") {
        if (context.scene === undefined) throw new Error("Scene declaration requires real source snapshots");
        this.module.memory.dataView(this.options.declaration.storage.serverCommandSequence, 4).setInt32(0, context.scene.snapshot.serverCommandSequence, true);
        const baseline = this.options.context().scene?.baseline;
        if (baseline !== undefined) {
          this.acceptScene(baseline, true);
          this.restoringScene = true;
          try { for (const call of this.options.declaration.snapshots) await this.call(call, context); }
          finally { this.restoringScene = false; }
        }
      }
    } catch (error) { this.fail(error); }
    finally { this.busy = false; }
  }
  async consume(event: Q3SourcePlayerEvent, sequence: number): Promise<void> {
    this.current();
    if (this.busy || this.phase !== "initialized") throw new Error("Source presentation event requires an idle initialized owner");
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("Invalid source event delivery sequence");
    if (sequence <= this.sequence) return;
    if (!matches(event.source.module, this.options.source) || event.source.abiProfile !== this.options.declaration.gameplay.abiProfile)
      throw new Error("Source player event belongs to a different gameplay module");
    if (this.options.declaration.runtime !== "qvm-player-events") throw new Error("Scene presentation owns events through original snapshots");
    const declaration = this.options.declaration, { storage, cgame } = declaration, slot = event.playerState.clientNumber;
    if (!Number.isInteger(slot) || slot < 0 || slot >= storage.centities.capacity) throw new Error("Source player event exceeds the declared centity array");
    int32(event.event); int32(event.parameter);
    if (![event.origin.x, event.origin.y, event.origin.z].every(value => Number.isFinite(Math.fround(value)))) throw new Error("Source player event has a nonfinite origin");
    this.sequence = sequence; this.busy = true; this.activeEvent = event;
    try {
      this.current(event);
      const memory = this.module.memory, entity = storage.centities.address + slot * storage.centities.stride;
      if (this.players.get(slot)?.equals(event.actor) !== true) {
        if (this.defaults === null) throw new Error("Source centity defaults are unavailable");
        memory.writeBytes(entity, this.defaults.subarray(slot * storage.centities.stride, (slot + 1) * storage.centities.stride));
        this.players.set(slot, event.actor);
      }
      const context = this.context();
      await this.refresh(context);
      writeSourceQvmPlayerState(memory.dataView(storage.playerState, qvmPlayerStateBytes(cgame.abiProfile)), event.playerState, cgame.abiProfile);
      for (const call of declaration.project) await this.call(call, context, event);
      const state = memory.dataView(entity + storage.centities.state, qvmEntityStateBytes(cgame.abiProfile));
      state.setInt32(180, event.event, true); state.setInt32(184, event.parameter, true);
      const origin = memory.dataView(entity + storage.centities.origin, 12);
      origin.setFloat32(0, event.origin.x, true); origin.setFloat32(4, event.origin.y, true); origin.setFloat32(8, event.origin.z, true);
      await this.call(declaration.event, context, event);
    } catch (error) {
      if (error instanceof RetiredPlayer) return;
      this.fail(error);
    } finally { this.busy = false; this.activeEvent = undefined; }
  }
  async advance(frameSequence: number): Promise<void> {
    this.current();
    if (this.busy || this.phase !== "initialized") throw new Error("Source presentation frame requires an idle initialized owner");
    if (!Number.isSafeInteger(frameSequence) || frameSequence < 0) throw new Error("Invalid source presentation frame sequence");
    if (frameSequence <= this.frame) return;
    this.frame = frameSequence; this.busy = true;
    try {
      const context = this.context(); await this.refresh(context);
      if (this.options.declaration.runtime === "qvm-scene") {
        if (context.scene === undefined) throw new Error("Scene declaration requires real source snapshots");
        if (this.acceptScene(context.scene)) for (const call of this.options.declaration.snapshots) await this.call(call, context);
      }
      for (const call of this.options.declaration.frame) await this.call(call, context);
    } catch (error) { this.fail(error); }
    finally { this.busy = false; }
  }
  async consoleCommand(arguments_: readonly string[]): Promise<boolean> {
    this.current();
    if (this.busy || this.phase !== "initialized") throw new Error("Source console command requires an idle initialized owner");
    this.busy = true; this.commandArguments = [...arguments_];
    try {
      const result = await this.module.commandAsync([QvmCgameExport.CG_CONSOLE_COMMAND], arguments_, () => this.current());
      this.current(); return result !== 0;
    } catch (error) { this.fail(error); }
    finally { this.commandArguments = null; this.busy = false; }
  }
  async drawHud(frameSequence: number): Promise<void> {
    this.current();
    if (this.busy || this.phase !== "initialized" || this.frame !== frameSequence)
      throw new Error("Source HUD requires its completed scene frame");
    if (frameSequence <= this.hudFrame) return;
    const hud = this.options.declaration.hud;
    if (hud === undefined) throw new Error("Source presentation has no HUD admission");
    this.hudFrame = frameSequence; this.busy = true;
    try {
      const context = this.context();
      for (const call of hud.frame) await this.call(call, context);
    } catch (error) { this.fail(error); }
    finally { this.busy = false; }
  }
  release(actor: ActorId): void { for (const [slot, player] of this.players) if (player.equals(actor)) this.players.delete(slot); }
  close(): void { if (this.phase === "closed") return; this.phase = "closed";
    for (const remove of this.removals) remove(); this.removals.length = 0;
    this.players.clear(); this.sceneActors.clear(); this.snapshots.clear(); this.commands.clear(); this.defaults = null; this.currentGameState = null; this.module.retire(); }
}
