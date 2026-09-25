import type { ArmorState, DamageRequest } from "../../contracts/gameplay.ts";
import type { OwnedActor } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { SourceDamageObserver, SourceDamageResult } from "../../world/gameplay/authority.ts";
import type { QvmReactionCall } from "./game-combat.ts";
import type { QvmGame } from "./game.ts";
import type { QvmCancellationScope, QvmFunctionCall } from "./interpreter.ts";
import type { QvmCommittedWrite, QvmWriteRange } from "./memory.ts";

export interface QvmDamageFrame {
  readonly actor: OwnedActor;
  readonly pointer: number;
  readonly request: DamageRequest;
  readonly call: QvmFunctionCall;
  readonly cancellation: QvmCancellationScope;
  cancelled: { readonly error: unknown } | null;
  reacting: boolean;
}
interface ScopeOptions {
  readonly game: QvmGame;
  readonly health: number;
  readonly targetArgument: number;
  readonly pointsStat: number;
  readonly tierStat: number | null;
  readonly modeWords: readonly number[];
  readonly reactions: { readonly pain: number; readonly die: number; readonly painCall: QvmReactionCall; readonly dieCall: QvmReactionCall };
  armor(slot: number): ArmorState;
  live(actor: OwnedActor): boolean;
}

function sameVector(a: Vec3, b: Vec3): boolean { return a.x === b.x && a.y === b.y && a.z === b.z; }
function sameArmor(a: ArmorState, b: ArmorState): boolean {
  return a.regular.kind === "none" ? b.regular.kind === "none" : a.regular.kind === "q3" && b.regular.kind === "q3"
    && a.regular.points === b.regular.points && a.regular.protection === b.regular.protection;
}
function touches(event: QvmCommittedWrite, range: QvmWriteRange): boolean {
  return event.ranges.some(write => write.byteOffset < range.byteOffset + range.byteLength && range.byteOffset < write.byteOffset + write.after.length);
}

/** Suspended hits follow every store, while the innermost hit alone reports it. */
export class QvmDamageScopes {
  private readonly frames: QvmDamageFrame[] = [];
  constructor(private readonly options: ScopeOptions) {}

  current(pointer: number): QvmDamageFrame | null {
    const frame = this.frames.at(-1);
    return frame !== undefined && frame.pointer === pointer && !frame.reacting ? frame : null;
  }

  cancel(frame: QvmDamageFrame, call: Pick<QvmFunctionCall, "cancelFunction">): never {
    try { return call.cancelFunction(frame.cancellation); }
    catch (error) { frame.cancelled = { error }; throw error; }
  }

  run(call: QvmFunctionCall, actor: OwnedActor, slot: number, request: DamageRequest, observer: SourceDamageObserver): SourceDamageResult {
    const { game } = this.options, entity = game.data.entityBytes(slot);
    const frame: QvmDamageFrame = { actor, request, call, pointer: call.words.getInt32(this.options.targetArgument * 4, true), cancellation: call.cancellationScope(), cancelled: null, reacting: false };
    const entityOffset = entity.byteOffset - game.module.memory.bytes.byteOffset;
    const healthRange = { byteOffset: entityOffset + this.options.health, byteLength: 4 };
    const client = slot < game.data.numClients ? game.data.clientBytes(slot) : null;
    const clientOffset = client === null ? null : client.byteOffset - game.module.memory.bytes.byteOffset;
    const armorRanges: QvmWriteRange[] = clientOffset === null ? [] : [
      { byteOffset: clientOffset + 184 + this.options.pointsStat * 4, byteLength: 4 },
      ...(this.options.tierStat === null ? [] : [{ byteOffset: clientOffset + 184 + this.options.tierStat * 4, byteLength: 4 }]),
      ...this.options.modeWords.map(byteOffset => ({ byteOffset, byteLength: 4 })),
    ];
    const velocityRange = { byteOffset: clientOffset === null ? entityOffset + 36 : clientOffset + 32, byteLength: 12 };
    const velocityView = game.module.memory.dataView(velocityRange.byteOffset, 12);
    const readVelocity = (): Vec3 => ({ x: velocityView.getFloat32(0, true), y: velocityView.getFloat32(4, true), z: velocityView.getFloat32(8, true) });
    let health = entity.getInt32(this.options.health, true), armor = this.options.armor(slot), velocity = readVelocity();
    let result: SourceDamageResult = { appliedDamage: 0, reaction: "none" };
    const removals: (() => void)[] = [];
    const current = (): boolean => {
      for (let index = this.frames.length - 1; index >= 0; index--) {
        const entry = this.frames[index];
        if (entry?.actor === actor) return entry === frame && !frame.reacting && this.options.live(actor);
      }
      return false;
    };
    this.frames.push(frame);
    try {
      removals.push(game.module.memory.observeWrites([healthRange, velocityRange, ...armorRanges], event => {
        const report = current();
        const changes: { readonly offset: number; publish(): void }[] = [];
        if (touches(event, healthRange)) {
          const before = health; health = entity.getInt32(this.options.health, true);
          const after = health;
          if (report && before !== after) changes.push({ offset: healthRange.byteOffset, publish: () => {
            observer.stored({ kind: "health", before, after }); result = { ...result, appliedDamage: result.appliedDamage + before - after };
          } });
        }
        if (armorRanges.some(range => touches(event, range))) {
          const before = armor; armor = this.options.armor(slot);
          const after = armor;
          if (report && !sameArmor(before, after)) changes.push({ offset: armorRanges.find(range => touches(event, range))?.byteOffset ?? 0,
            publish: () => { observer.stored({ kind: "armor", before, after }); } });
        }
        if (touches(event, velocityRange)) {
          const before = velocity; velocity = readVelocity();
          const after = velocity;
          if (report && !sameVector(before, after)) changes.push({ offset: velocityRange.byteOffset,
            publish: () => { observer.stored({ kind: "source-velocity", before, after, movementProvider: request.attack.movementProvider }); } });
        }
        for (const change of changes.sort((a, b) => a.offset - b.offset)) change.publish();
        return undefined;
      }));
      for (const reaction of ["pain", "death"] satisfies readonly ("pain" | "death")[]) {
        const offset = reaction === "pain" ? this.options.reactions.pain : this.options.reactions.die;
        const roles = (reaction === "pain" ? this.options.reactions.painCall : this.options.reactions.dieCall).roles;
        let entry = 0, removeReaction: (() => void) | null = null;
        const refresh = (): undefined => {
          const next = entity.getInt32(offset, true);
          if (next === entry) return undefined;
          removeReaction?.(); removeReaction = null; entry = next;
          if (next !== 0) removeReaction = game.module.observeFunction({ kind: "qvm", module: game.module.profile.module, instructionIndex: next }, reactionCall => {
            if (entity.getInt32(offset, true) !== next || !current() || reactionCall.argument(roles.target) !== frame.pointer) return undefined;
            frame.reacting = true;
            result = { reaction, appliedDamage: reactionCall.argument(roles.amount) };
            observer.beforeReaction(result);
            if (!this.options.live(actor)) this.cancel(frame, reactionCall);
            return undefined;
          });
          return undefined;
        };
        removals.push(() => { removeReaction?.(); });
        removals.push(game.module.memory.observeWrites([{ byteOffset: entityOffset + offset, byteLength: 4 }], refresh));
        refresh();
      }
      try { call.proceed(); }
      catch (error) { if (frame.cancelled?.error !== error) throw error; }
      return result;
    } finally {
      for (const remove of removals) remove();
      this.frames.pop();
    }
  }
}
