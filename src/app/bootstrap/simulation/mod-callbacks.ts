import type { ActorId } from "../../../contracts/identity.ts";
import type { ModCallbackBinding, ModCallbackInput, ModRuntimeValue } from "../../../contracts/mod-callbacks.ts";
import type { SourceTime } from "../../../contracts/time.ts";
import type { ModRegistrations } from "../../../world/session/mods.ts";
import type { ModOperation } from "../../../world/gameplay/mod-composition.ts";

const scalar = (value: number): ModRuntimeValue => ({ kind: "float", value });
const actor = (value: ActorId | null): ModRuntimeValue => ({ kind: "actor", value });
const seconds = (time: SourceTime): number => time.kind === "seconds" ? time.value : time.value / 1000;
type Input = readonly [ModCallbackInput, ModRuntimeValue];

export function registerModCallbacks<Callback extends ModCallbackBinding>(callbacks: readonly Callback[], registrations: ModRegistrations,
  time: () => SourceTime, execute: (callback: Callback, inputs: ReadonlyMap<ModCallbackInput, ModRuntimeValue>) => number): undefined {
  const invoke = (callback: Callback, values: readonly Input[], result?: number): number => {
    const inputs = new Map<ModCallbackInput, ModRuntimeValue>([["time", scalar(seconds(time()))], ...values]);
    if (result !== undefined) inputs.set("result", scalar(result));
    return execute(callback, inputs);
  };
  const actors = <Request>(callback: Callback,
    operation: ModOperation<Request, boolean>, inputs: (request: Request) => readonly Input[]): void => {
    if (callback.stage === "observe") registrations.register(operation, { id: callback.id, kind: "observe", observe: (request, result) => { invoke(callback, inputs(request), result ? 1 : 0); return undefined; } });
    else if (callback.stage === "replace") registrations.register(operation, { id: callback.id, kind: "replace", replace: request => invoke(callback, inputs(request)) !== 0 });
  };
  for (const callback of callbacks) {
    switch (callback.operation) {
      case "damage": {
        const inputs = (request: import("../../../contracts/gameplay.ts").DamageRequest): readonly Input[] => [
          ["self", actor(request.target)], ["attacker", actor(request.attack.attacker)], ["inflictor", actor(request.attack.inflictor)],
          ["amount", scalar(request.amount)], ["knockback", scalar(request.knockback)], ["direction", { kind: "vector", value: request.direction }],
          ["point", { kind: "vector", value: request.point }], ["normal", { kind: "vector", value: request.normal }],
        ];
        if (callback.stage === "transform") registrations.register(registrations.operations.damage, { id: callback.id, kind: "transform", transform: request => ({ ...request, [callback.result]: invoke(callback, inputs(request)) }) });
        else registrations.register(registrations.operations.damage, { id: callback.id, kind: "observe", observe: (request, result) => {
          invoke(callback, inputs(request), result.kind === "committed" ? result.decision.appliedDamage : 0); return undefined;
        } });
        break;
      }
      case "inventory.give": {
        const operation = registrations.operations.inventory.give;
        if (callback.stage === "transform") registrations.register(operation, { id: callback.id, kind: "transform", transform: ([owner, item, amount]) =>
          [owner, item, invoke(callback, [["self", actor(owner.id)], ["item", { kind: "string", value: item }], ["amount", scalar(amount)]])] });
        else registrations.register(operation, { id: callback.id, kind: "observe", observe: ([owner, item, amount], result) => {
          invoke(callback, [["self", actor(owner.id)], ["item", { kind: "string", value: item }], ["amount", scalar(amount)]], result); return undefined;
        } });
        break;
      }
      case "inventory.consume": {
        const operation = registrations.operations.inventory.consume;
        if (callback.stage === "transform") registrations.register(operation, { id: callback.id, kind: "transform", transform: ([owner, item, amount]) =>
          [owner, item, invoke(callback, [["self", actor(owner.id)], ["item", { kind: "string", value: item }], ["amount", scalar(amount)]])] });
        else registrations.register(operation, { id: callback.id, kind: "observe", observe: ([owner, item, amount], result) => {
          invoke(callback, [["self", actor(owner.id)], ["item", { kind: "string", value: item }], ["amount", scalar(amount)]], result ? 1 : 0); return undefined;
        } });
        break;
      }
      case "actor.think": actors(callback, registrations.operations.actors.think, ([owner, frame]) => [["self", actor(owner.id)], ["time", scalar(seconds(frame.time))], ["elapsed", scalar(seconds(frame.elapsed))]]); break;
      case "actor.touch": actors(callback, registrations.operations.actors.touch, ([contact]) => [["self", actor(contact.self.id)], ["other", actor(contact.other)]]); break;
      case "actor.use": actors(callback, registrations.operations.actors.use, ([owner, other, activator]) => [["self", actor(owner.id)], ["other", actor(other)], ["activator", actor(activator)]]); break;
      case "actor.pain": actors(callback, registrations.operations.actors.pain, ([reaction]) => [["self", actor(reaction.self.id)], ["attacker", actor(reaction.attacker)], ["amount", scalar(reaction.damage)], ["knockback", scalar(reaction.kick)]]); break;
      case "actor.die": actors(callback, registrations.operations.actors.die, ([reaction]) => [["self", actor(reaction.self.id)], ["attacker", actor(reaction.attacker)], ["inflictor", actor(reaction.inflictor)], ["amount", scalar(reaction.damage)], ["knockback", scalar(reaction.kick)], ["point", { kind: "vector", value: reaction.point }]]); break;
    }
  }
  return undefined;
}
