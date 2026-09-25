import type { ActorId } from "../../contracts/identity.ts";
import type { ModuleIdentity } from "../../contracts/execution.ts";
import type { FrameContext } from "../../contracts/time.ts";
import type { UserCommand } from "../../contracts/protocol.ts";
import type { ModClientApplication, ModClientCommand, ModClientIdentity } from "../../world/session/mod-clients.ts";
import type { ModClientApplications } from "../../world/session/mod-client-applications.ts";
import { q3ViewAngles } from "../../movement/q3/view.ts";
import { readQvmUserCommand, writeQvmUserCommand, QVM_USER_COMMAND_BYTES } from "./client-state-record.ts";
import type { QvmCancellationScope, QvmFunctionCall, QvmSystemCallResult } from "./interpreter.ts";
import type { QvmGame } from "./game.ts";

export interface QvmInputDefinition {
  readonly module: ModuleIdentity;
  readonly entityStride: number;
  readonly clientStride: number;
  readonly clientPointer: number;
  readonly intermission: readonly number[];
  readonly entries: { readonly clientThink: number; readonly runClient: number; readonly clientSpawn: number;
    readonly move: number; readonly slice: number };
}
export interface QvmInputServices {
  readonly applications: ModClientApplications;
  identity(slot: number): ModClientIdentity | null;
  live(identity: ModClientIdentity): boolean;
  accepted(actor: ActorId): ModClientCommand | null;
  frame(): FrameContext;
  spawned?(identity: ModClientIdentity): void;
  onRelease(listener: (actor: ActorId) => undefined): () => void;
}
export interface QvmInputSource {
  readonly game: QvmGame;
  readonly definition: QvmInputDefinition;
  retiring(slot: number, identity: ModClientIdentity): void;
  retired(slot: number): boolean;
  disconnect(slot: number, identity: ModClientIdentity, call: QvmFunctionCall): QvmSystemCallResult;
  movement(slot: number, run: () => QvmSystemCallResult): QvmSystemCallResult;
}
interface ClientScope { readonly slot: number; readonly identity: ModClientIdentity; readonly cancellation: QvmCancellationScope; }
function proceed(call: QvmFunctionCall): QvmSystemCallResult { return call.execution === "synchronous" ? call.proceed() : call.proceedAsync(); }
function completed(result: QvmSystemCallResult, finish: () => void): QvmSystemCallResult {
  if (typeof result === "number") { finish(); return result; }
  return result.finally(finish);
}

/** Exact authored wrappers own cancellation; Pmove owns application, including retained bot input. */
export class QvmInputBinding {
  private readonly removals: (() => void)[] = [];
  private readonly clients: ClientScope[] = [];
  private readonly spawning: number[] = [];
  private readonly commandFrames: { readonly scope: ClientScope; readonly address: number }[] = [];
  private current: ModClientApplication | null = null;
  constructor(private readonly source: QvmInputSource, private readonly services: QvmInputServices) {
    const { game, definition } = source;
    if (game.module.abiProfile !== "q3-modern") throw new Error("QVM input requires its declared modern public player ABI");
    const bind = (entry: number, hook: (call: QvmFunctionCall) => QvmSystemCallResult): void => {
      this.removals.push(game.module.bindFunction({ kind: "qvm", module: definition.module, instructionIndex: entry }, hook));
    };
    try {
      bind(definition.entries.clientSpawn, call => {
        if (!services.applications.active && services.spawned === undefined) return proceed(call);
        const slot = game.data.numberFromPointer(call.words.getInt32(0, true));
        this.spawning.push(slot);
        const finish = (result: number): number => {
          call.effect(() => {
            const identity = services.identity(slot);
            if (identity !== null && services.live(identity)) services.spawned?.(identity);
            return undefined;
          });
          return result;
        };
        try {
          const result = proceed(call);
          if (typeof result !== "number") return result.then(finish).finally(() => { this.spawning.pop(); });
          const value = finish(result); this.spawning.pop(); return value;
        } catch (error) { this.spawning.pop(); throw error; }
      });
      bind(definition.entries.clientThink, call => this.envelope(call, call.words.getInt32(0, true)));
      bind(definition.entries.runClient, call => this.envelope(call, game.data.numberFromPointer(call.words.getInt32(0, true))));
      bind(definition.entries.move, call => this.movement(call, "client-command"));
      bind(definition.entries.slice, call => this.movement(call, "movement-slice"));
      this.removals.push(services.onRelease(actor => {
        for (const scope of this.clients) if (scope.identity.actor.equals(actor)) source.retiring(scope.slot, scope.identity);
        return undefined;
      }));
    } catch (error) { this.close(); throw error; }
  }
  private clientPointer(slot: number): number {
    const { game, definition } = this.source, located = game.data.checkpoint();
    if (located.entityStride !== definition.entityStride || located.clientStride !== definition.clientStride)
      throw new Error("Located QVM input records differ from their artifact declaration");
    const client = game.data.entityBytes(slot).getInt32(definition.clientPointer, true);
    const expected = located.clientsWord + slot * located.clientStride;
    game.data.publicPlayerBytes(slot);
    if (client !== expected) throw new Error("QVM input entity does not own its located public player state");
    return client;
  }
  private envelope(call: QvmFunctionCall, slot: number): QvmSystemCallResult {
    if (this.source.retired(slot)) return 0;
    if (!this.services.applications.active || this.spawning.includes(slot)) return proceed(call);
    const identity = this.services.identity(slot);
    if (identity === null || !this.services.live(identity)) return proceed(call);
    this.clientPointer(slot);
    const scope = { slot, identity, cancellation: call.cancellationScope() };
    this.clients.push(scope);
    try { return completed(proceed(call), () => { this.clients.pop(); }); }
    catch (error) { this.clients.pop(); throw error; }
  }
  private cancellation(scope: ClientScope): QvmCancellationScope {
    return this.clients.find(entry => entry.identity.actor.equals(scope.identity.actor))?.cancellation ?? scope.cancellation;
  }
  private checkLive(call: QvmFunctionCall, scope: ClientScope): QvmSystemCallResult {
    if (this.services.live(scope.identity)) return 0;
    this.source.retiring(scope.slot, scope.identity);
    const result = this.source.disconnect(scope.slot, scope.identity, call);
    if (typeof result === "number") return call.cancelFunction(this.cancellation(scope));
    return result.then(() => call.cancelFunction(this.cancellation(scope)));
  }
  private movement(call: QvmFunctionCall, kind: ModClientApplication["scope"]): QvmSystemCallResult {
    if (!this.services.applications.active || this.clients.length === 0) return proceed(call);
    const { game } = this.source, movement = call.words.getInt32(0, true), pointer = game.module.memory.view(movement, 4).getInt32(0, true);
    const scope = [...this.clients].reverse().find(entry => this.clientPointer(entry.slot) === pointer);
    if (scope === undefined || this.spawning.includes(scope.slot)) return proceed(call);
    return this.source.movement(scope.slot, () => this.apply(call, scope, movement, kind));
  }
  private apply(call: QvmFunctionCall, scope: ClientScope, movement: number, kind: ModClientApplication["scope"]): QvmSystemCallResult {
    const { game, definition } = this.source, state = game.data.copyPlayerState(scope.slot);
    const address = movement + 4;
    const command = readQvmUserCommand(game.module.memory.view(address, QVM_USER_COMMAND_BYTES));
    const input: UserCommand = { kind: "q3", serverTimeMilliseconds: command.serverTime, angleWords: command.angles, buttons: command.buttons,
      weapon: command.weapon, forwardMove: command.forwardmove, rightMove: command.rightmove, upMove: command.upmove };
    const overlapping = this.commandFrames.some(frame => frame.address === address && frame.scope !== scope);
    const suspended = overlapping ? game.module.memory.bytes.slice(address, address + QVM_USER_COMMAND_BYTES) : null;
    const commandFrame = { scope, address };
    this.commandFrames.push(commandFrame);
    const remaining = command.serverTime - state.commandTimeMilliseconds;
    const milliseconds = kind === "client-command" ? Math.max(0, Math.min(1000, remaining)) : Math.max(1, Math.min(200, remaining));
    const previous = this.current;
    let application: ModClientApplication | null = null, failed = true, finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      try { this.services.applications.finish(application, failed); }
      finally {
        this.current = previous;
        const index = this.commandFrames.lastIndexOf(commandFrame);
        if (index !== -1) this.commandFrames.splice(index, 1);
        if (suspended !== null) game.module.memory.writeBytes(address, suspended);
      }
    };
    const applyOutput = (): void => {
      const effective = application?.command;
      if (effective === undefined || effective === input) return;
      if (effective.kind !== "q3") throw new Error("QVM input output changed the source command dialect");
      writeQvmUserCommand(game.module.memory.view(address, QVM_USER_COMMAND_BYTES), {
        serverTime: effective.serverTimeMilliseconds, angles: effective.angleWords, buttons: effective.buttons, weapon: effective.weapon,
        forwardmove: effective.forwardMove, rightmove: effective.rightMove, upmove: effective.upMove,
      });
    };
    try {
      const aim = q3ViewAngles({ x: command.angles[0], y: command.angles[1], z: command.angles[2] },
        { x: state.deltaAngleWords[0], y: state.deltaAngleWords[1], z: state.deltaAngleWords[2] },
        state.viewAngles, state.stats[0] ?? 0, state.movementType, definition.intermission).angles;
      application = this.services.applications.begin({ identity: scope.identity, scope: kind,
        command: input,
        arsenal: kind === "movement-slice" && previous?.identity.actor.equals(scope.identity.actor) ? previous.arsenal ?? null : null,
        controls: { impulse: kind === "movement-slice" && previous?.identity.actor.equals(scope.identity.actor) ? previous.controls?.impulse ?? 0 : 0 },
        angleSpace: "source-relative", absoluteAim: aim, frame: { ...this.services.frame(), phase: "client-command", elapsed: { kind: "milliseconds", value: milliseconds } },
        accepted: this.services.accepted(scope.identity.actor), parentInvocation: previous?.invocation ?? null }, (aim, effective) => {
          if (effective.kind !== "q3") throw new Error("QVM aim output changed the source command dialect");
          const current = game.data.copyPlayerState(scope.slot);
          const word = (degrees: number, delta: number): number => (Math.trunc(degrees * 65536 / 360) & 65535) - delta;
          return { ...effective, angleWords: [word(aim.x, current.deltaAngleWords[0]), word(aim.y, current.deltaAngleWords[1]), word(aim.z, current.deltaAngleWords[2])] };
        });
      this.current = application;
      if (call.execution === "asynchronous") return (async () => {
        await this.checkLive(call, scope);
        applyOutput();
        const result = await call.proceedAsync(); failed = false;
        call.effect(() => { this.services.applications.finish(application); application = null; return undefined; });
        await this.checkLive(call, scope); return result;
      })().finally(finish);
      const before = this.checkLive(call, scope);
      if (typeof before !== "number") throw new Error("Synchronous QVM input cannot await disconnect");
      applyOutput();
      const result = call.proceed(); failed = false;
      call.effect(() => { this.services.applications.finish(application); application = null; return undefined; });
      const after = this.checkLive(call, scope);
      if (typeof after !== "number") throw new Error("Synchronous QVM input cannot await disconnect");
      finish(); return result;
    } catch (error) { finish(); throw error; }
  }
  close(): void { for (const remove of this.removals.splice(0).reverse()) remove(); }
}
