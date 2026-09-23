import type { ActorId } from "../../contracts/identity.ts";
import type { ModuleIdentity } from "../../contracts/execution.ts";
import type { Q3PlayerState } from "../../contracts/protocol.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { QvmModPresentationDeclaration, QvmPresentationArgument, QvmPresentationCall } from "../../contracts/qvm-mod-presentation.ts";
import type { Q3SourcePlayerEvent } from "../../app/bootstrap/simulation/q3/types.ts";
import type { SourceGameStateRecord } from "../../network/q3/game-state.ts";
import { float32ToBits } from "../../core/numeric.ts";
import { QvmModule, type QvmModuleOptions } from "./module.ts";
import { QvmOpcode } from "./image.ts";
import { qvmPlayerStateBytes, writeSourceQvmPlayerState } from "./player-record.ts";
import { qvmEntityStateBytes } from "./entity-record.ts";
import { QVM_GAME_STATE_BYTES, qvmSnapshotBytes, writeSourceQvmGameState } from "./client-state-record.ts";

export interface QvmPresentationContext {
  readonly gameState: SourceGameStateRecord;
  readonly gameStateRevision: number;
  readonly frameTimeMilliseconds: number;
  readonly viewOrigin: Vec3;
  readonly snapshot: { readonly serverTime: number; readonly playerState: Q3PlayerState };
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
  const psBytes = qvmPlayerStateBytes(declaration.cgame.abiProfile), snapshotBytes = qvmSnapshotBytes(declaration.cgame.abiProfile);
  range(storage.gameState, QVM_GAME_STATE_BYTES); range(storage.playerState, psBytes); range(storage.snapshot.address, snapshotBytes);
  for (const address of [...storage.time, ...storage.frameTime, ...storage.snapshot.pointers]) range(address, 4);
  for (const address of storage.viewOrigin) range(address, 12);
  const entities = storage.centities;
  range(entities.address, entities.stride * entities.capacity);
  if (!Number.isSafeInteger(entities.capacity) || entities.capacity < 1 || !Number.isSafeInteger(entities.stride)
    || !Number.isSafeInteger(entities.state) || entities.state < 0 || entities.state + qvmEntityStateBytes(declaration.cgame.abiProfile) > entities.stride
    || !Number.isSafeInteger(entities.origin) || entities.origin < 0 || entities.origin + 12 > entities.stride)
    throw new Error("Source presentation centity layout is invalid");
  if (storage.playerState < storage.snapshot.address + snapshotBytes && storage.snapshot.address < storage.playerState + psBytes)
    throw new Error("Event projection state must be separate from the viewing player's snapshot");
  const checkCall = (call: QvmPresentationCall, initializing: boolean): void => {
    if (!Number.isInteger(call.entry) || artifact.image.instructions[call.entry]?.opcode !== QvmOpcode.OP_ENTER || call.arguments.length > 10)
      throw new Error("Source presentation call has no original function entry");
    for (const argument of call.arguments) {
      if (argument.kind === "address") range(argument.value, 1);
      else if (argument.kind === "int32") int32(argument.value);
      else if (argument.kind === "float32" && !Number.isFinite(Math.fround(argument.value))) throw new Error("Source presentation float exceeds its ABI");
      else if (initializing && argument.kind === "source" && ["entity-state", "centity", "origin", "event", "parameter"].includes(argument.value))
        throw new Error("Source presentation initialization requires an event-independent context");
    }
  };
  if (storage.snapshot.kind !== "synthetic-player-event") throw new Error("Unsupported source presentation snapshot caller");
  for (const call of [...declaration.initialize, ...declaration.refresh, ...declaration.frame]) checkCall(call, true);
  for (const call of [...declaration.project, declaration.event]) checkCall(call, false);
}

/** Executes artifact-qualified original event code with its original private media and caller state. */
export class QvmModPresentation {
  readonly module: QvmModule;
  private phase: "created" | "initialized" | "failed" | "closed" = "created";
  private busy = false;
  private sequence = -1;
  private revision = -1;
  private frame = -1;
  private readonly players = new Map<number, ActorId>();
  private defaults: Uint8Array | null = null;
  private activeEvent: Q3SourcePlayerEvent | undefined;
  constructor(private readonly options: QvmModPresentationOptions) {
    validateQvmModPresentation(options);
    this.module = new QvmModule({ artifact: options.artifact, host: call => { this.current(this.activeEvent); return options.host(call); } });
  }
  get lastSequence(): number { return this.sequence; }
  private current(event?: Q3SourcePlayerEvent): void {
    this.options.assertCurrent();
    if (this.phase === "closed" || this.phase === "failed") throw new Error(`Source presentation is ${this.phase}`);
    if (event !== undefined && (!this.options.live(event.actor) || this.options.actor(event.playerState.clientNumber)?.equals(event.actor) !== true))
      throw new RetiredPlayer("Source event actor no longer owns its original client slot");
  }
  private fail(error: unknown): never { if (this.phase !== "closed") this.phase = "failed"; throw error; }
  private context(): QvmPresentationContext {
    const context = this.options.context(), { storage, cgame } = this.options.declaration, memory = this.module.memory;
    if (!Number.isSafeInteger(context.gameStateRevision) || context.gameStateRevision < 0 || context.gameStateRevision < this.revision)
      throw new Error("Source gameState revision is invalid or stale");
    if (int32(context.frameTimeMilliseconds) < 0 || ![context.viewOrigin.x, context.viewOrigin.y, context.viewOrigin.z].every(value => Number.isFinite(Math.fround(value))))
      throw new Error("Source presentation frame context is invalid");
    const snapshot = context.snapshot, bytes = qvmSnapshotBytes(cgame.abiProfile), psBytes = qvmPlayerStateBytes(cgame.abiProfile);
    const view = memory.dataView(storage.snapshot.address, bytes);
    int32(snapshot.serverTime); int32(snapshot.playerState.clientNumber);
    if (context.gameStateRevision !== this.revision) writeSourceQvmGameState(memory, memory.dataView(storage.gameState, QVM_GAME_STATE_BYTES), context.gameState);
    // These are the source snapshot header and original viewing player, independent of the event actor.
    view.setInt32(0, 0, true); view.setInt32(4, snapshot.playerState.pingMilliseconds, true); view.setInt32(8, snapshot.serverTime, true);
    memory.fillBytes(storage.snapshot.address + 12, 32, 0);
    writeSourceQvmPlayerState(memory.dataView(storage.snapshot.address + 44, psBytes), snapshot.playerState, cgame.abiProfile);
    writeSourceQvmPlayerState(memory.dataView(storage.playerState, psBytes), snapshot.playerState, cgame.abiProfile);
    view.setInt32(44 + psBytes, 0, true); view.setInt32(bytes - 8, 0, true); view.setInt32(bytes - 4, 0, true);
    for (const address of storage.snapshot.pointers) memory.dataView(address, 4).setInt32(0, storage.snapshot.address, true);
    for (const address of storage.time) memory.dataView(address, 4).setInt32(0, snapshot.serverTime, true);
    for (const address of storage.frameTime) memory.dataView(address, 4).setInt32(0, context.frameTimeMilliseconds, true);
    for (const address of storage.viewOrigin) {
      const view = memory.dataView(address, 12);
      view.setFloat32(0, context.viewOrigin.x, true); view.setFloat32(4, context.viewOrigin.y, true); view.setFloat32(8, context.viewOrigin.z, true);
    }
    return context;
  }
  private word(argument: QvmPresentationArgument, context: QvmPresentationContext, event?: Q3SourcePlayerEvent): number {
    if (argument.kind === "float32") return float32ToBits(argument.value) | 0;
    if (argument.kind !== "source") return argument.value;
    const storage = this.options.declaration.storage;
    switch (argument.value) {
      case "player-state": return storage.playerState;
      case "snapshot": return storage.snapshot.address;
      case "client-number": return context.snapshot.playerState.clientNumber;
      case "time": return context.snapshot.serverTime;
      default: {
        if (event === undefined) throw new Error("Original call requires a source player event");
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
      const context = this.context();
      for (const call of this.options.declaration.initialize) await this.call(call, context);
      this.revision = context.gameStateRevision;
      const entities = this.options.declaration.storage.centities;
      this.defaults = this.module.memory.bytes.slice(entities.address, entities.address + entities.stride * entities.capacity);
      this.phase = "initialized";
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
    const { storage, cgame } = this.options.declaration, slot = event.playerState.clientNumber;
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
      for (const call of this.options.declaration.project) await this.call(call, context, event);
      const state = memory.dataView(entity + storage.centities.state, qvmEntityStateBytes(cgame.abiProfile));
      state.setInt32(180, event.event, true); state.setInt32(184, event.parameter, true);
      const origin = memory.dataView(entity + storage.centities.origin, 12);
      origin.setFloat32(0, event.origin.x, true); origin.setFloat32(4, event.origin.y, true); origin.setFloat32(8, event.origin.z, true);
      await this.call(this.options.declaration.event, context, event);
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
      for (const call of this.options.declaration.frame) await this.call(call, context);
    } catch (error) { this.fail(error); }
    finally { this.busy = false; }
  }
  release(actor: ActorId): void { for (const [slot, player] of this.players) if (player.equals(actor)) this.players.delete(slot); }
  close(): void { if (this.phase === "closed") return; this.phase = "closed"; this.players.clear(); this.defaults = null; this.module.retire(); }
}
