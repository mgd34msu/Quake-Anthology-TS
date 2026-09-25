import { validateQcSourceCall, qcSourceValueType } from "./source-call.ts";
import { qcEmptyArmor } from "../../content/q1/quakec/armor-points.ts";
import type { ModuleIdentity } from "../../contracts/execution.ts";
import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { ArmorState, DamageOutcome, DamageRequest } from "../../contracts/gameplay.ts";
import type { ModCallbackDeclaration, ModCallbackInput, ModRuntimeValue, ModSourceCall } from "../../contracts/mod-callbacks.ts";
import type { DeathReaction, PainReaction } from "../../contracts/world.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import type { SourceActorSlots } from "../../world/actors/source-slots.ts";
import type { SourceDamageResult } from "../../world/gameplay/authority.ts";
import { Id1DamageBinding } from "../../content/q1/quakec/id1-damage.ts";
import type { Id1DamageCall } from "../../content/q1/quakec/id1-damage.ts";
import { id1ProgramBinding } from "../../content/q1/quakec/id1-program.ts";
import { qcArmorStage } from "../../content/q1/quakec/armor-stage.ts";
import type { QcFunctionExecution, QcMachine } from "./machine.ts";
import type { QcProgram } from "./program.ts";

type Declaration = NonNullable<ModCallbackDeclaration["combat"]>;
export function validateQcModCombat(program: QcProgram, declaration: Declaration): void {
  const call = declaration.damage;
  if (call.function !== "T_Damage") throw new Error("QC combat requires the verified source T_Damage ABI");
  for (const [index, name] of ["self", "inflictor", "attacker", "amount"].entries()) {
    const value = call.arguments[index];
    if (value?.kind !== "input" || value.name !== name) throw new Error(`QC damage argument ${index} must lower ${name}`);
  }
  const damage = id1ProgramBinding(program).damage;
  validateQcSourceCall(program, call, new Set<ModCallbackInput>(["self", "attacker", "inflictor", "amount", "knockback", "point", "direction", "normal", "time"]), "combat damage");
  if (damage.kind === "calls" && call.arguments.some((value, index) => qcSourceValueType(value) !== damage.parameters[index])) throw new Error("QC damage arguments differ from original source parameter types");
  qcEmptyArmor(program, declaration.emptyArmor);
  qcArmorStage(program, declaration.armorStage);
  for (const name of ["health", "takedamage", "flags", "invincible_finished", "armorvalue", "armortype"])
    if (program.fieldsByName.get(name)?.type !== "float") throw new Error(`QC combat requires float field ${name}`);
}

export function qcDamageInputs(request: DamageRequest, seconds: number): ReadonlyMap<ModCallbackInput, ModRuntimeValue> {
  return new Map<ModCallbackInput, ModRuntimeValue>([
    ["self", { kind: "actor", value: request.target }], ["attacker", { kind: "actor", value: request.attack.attacker }],
    ["inflictor", { kind: "actor", value: request.attack.inflictor }], ["amount", { kind: "float", value: request.amount }],
    ["knockback", { kind: "float", value: request.knockback }], ["point", { kind: "vector", value: request.point }],
    ["direction", { kind: "vector", value: request.direction }], ["normal", { kind: "vector", value: request.normal }],
    ["time", { kind: "float", value: seconds }],
  ]);
}

interface QcModCombatOptions {
  readonly program: QcProgram;
  readonly module: ModuleIdentity;
  readonly declaration: Declaration;
  readonly services: ModHostServices;
  readonly machine: QcMachine;
  readonly slots: SourceActorSlots;
  actor(reference: number): ActorId;
  reference(actor: ActorId | null): number;
  invoke(call: ModSourceCall, inputs: ReadonlyMap<ModCallbackInput, ModRuntimeValue>): number;
}
interface IncomingDamage { readonly request: DamageRequest; entered: boolean; outcome: DamageOutcome | null; }

/** Original bytecode owns combat fields; the shared authority observes each native mutation once. */
export class QcModCombat {
  readonly damage: Id1DamageBinding;
  private readonly incoming: IncomingDamage[] = [];
  constructor(private readonly options: QcModCombatOptions) {
    const { program, machine, slots, services } = options;
    this.damage = new Id1DamageBinding({ program, entities: machine.entities, actors: services.actors, slots }, services.combat, () => machine,
      call => this.request(call), { actor: reference => options.actor(reference), reference: actor => options.reference(actor),
        reaction: (request, result, execute) => this.reaction(request, result, execute), completed: (request, outcome) => {
          const incoming = this.incoming.at(-1); if (incoming?.request === request) incoming.outcome = outcome; return undefined;
        } }, options.declaration.armorStage);
  }
  private seconds(): number { const time = this.options.services.time(); return time.kind === "seconds" ? time.value : time.value / 1000; }
  private field(name: string): number { return this.options.machine.fieldOffset(name); }
  admit(actor: OwnedActor): undefined {
    const { machine, services, slots } = this.options, slot = services.actors.sourceOf(actor.id);
    if (slot?.provider !== slots.options.provider) throw new Error("QC combat admission requires its own source actor");
    const words = machine.entities.at(slot.slot), binding = id1ProgramBinding(this.options.program);
    const writeArmor = (armor: ArmorState): undefined => {
      if (armor.powered.kind !== "none" || armor.regular.kind !== "none" && armor.regular.kind !== "q1") throw new Error("Cannot store foreign armor in source QC fields");
      const [green, yellow, red] = binding.armorMasks, mask = green | yellow | red;
      const bit = armor.regular.kind === "none" ? 0 : armor.regular.item === "q1:item_armorInv" ? red : armor.regular.item === "q1:item_armor2" ? yellow : green;
      words.setFloat(this.field("armorvalue"), armor.regular.kind === "none" ? 0 : armor.regular.points);
      words.setFloat(this.field("armortype"), armor.regular.kind === "none" ? 0 : armor.regular.absorption);
      words.setFloat(this.field(binding.armorField), (Math.trunc(words.float(this.field(binding.armorField))) & ~mask) | bit);
      return undefined;
    };
    const poweredStage = this.damage.protectionStage(actor, "powered"), regularStage = this.damage.protectionStage(actor, "regular");
    const emptyRegularArmor = qcEmptyArmor(this.options.program, this.options.declaration.emptyArmor);
    const state = { ...(emptyRegularArmor === undefined ? {} : { emptyRegularArmor }), sourceDamage: (request: DamageRequest) => this.apply(request), protection: { regular: { owner: actor.owner, ...(regularStage === null ? {} : { stage: regularStage }) }, powered: { owner: null, ...(poweredStage === null ? {} : { stage: poweredStage }) } },
      read: () => ({ health: words.float(this.field("health")), armor: this.damage.readArmor(words), mass: 200,
        canTakeDamage: words.float(this.field("takedamage")) !== 0, invulnerable: words.float(this.field("invincible_finished")) > this.seconds(), team: null }),
      validateArmor: (armor: ArmorState): undefined => {
        if (armor.powered.kind !== "none" || armor.regular.kind !== "none" && armor.regular.kind !== "q1") throw new Error("Cannot store foreign armor in source QC fields");
        return undefined;
      },
      writeHealth: (health: number): undefined => { words.setFloat(this.field("health"), health); return undefined; }, writeArmor };
    // A full save admitted copied canonical state before restoring this guest's exact words.
    if (services.combat.read(actor.id) === null) services.combat.bind(actor, state); else services.combat.rebind(actor, state);
    return undefined;
  }
  private apply(request: DamageRequest): DamageOutcome {
    const entry: IncomingDamage = { request, entered: false, outcome: null }; this.incoming.push(entry);
    try {
      this.options.invoke(this.options.declaration.damage, qcDamageInputs(request, this.seconds()));
      if (entry.outcome === null) throw new Error("QC damage did not complete its shared authority boundary");
      return entry.outcome;
    } finally { this.incoming.pop(); }
  }
  private request(call: Id1DamageCall): DamageRequest {
    const incoming = this.incoming.at(-1);
    if (incoming !== undefined && !incoming.entered) { incoming.entered = true; return incoming.request; }
    const { services, machine, module } = this.options, context = services.damageContext?.(module.id);
    if (context === undefined) throw new Error("Authored QC damage requires canonical attack provenance");
    const deathType = this.options.program.fieldsByName.get("deathtype"), words = machine.entities.fromReference(this.options.reference(call.target));
    return { target: call.target, amount: call.amount, knockback: 0, direction: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 },
      point: services.bodies.read(call.target)?.origin ?? { x: 0, y: 0, z: 0 }, delivery: "direct",
      attack: { ...context, time: { kind: "seconds", value: machine.globals.float(machine.globalOffset("time")) }, attacker: call.attacker,
        inflictor: call.inflictor, weapon: null, cause: { kind: "q1", deathType: deathType === undefined ? "" : machine.strings.get(words.int(deathType.offset)) } } };
  }
  private reaction(request: DamageRequest, result: SourceDamageResult, execute: QcFunctionExecution): undefined {
    const { services } = this.options, owner = services.actors.resolveOwned(request.target), callbacks = services.callbacks;
    if (owner === null) return execute.skip([0, 0, 0]);
    if (callbacks === undefined) throw new Error("QC damage reactions require shared actor callbacks");
    const reaction: PainReaction = { self: owner, attack: request.attack, attacker: request.attack.attacker, damage: result.appliedDamage, kick: request.knockback };
    let entered = false;
    if (result.reaction === "pain") callbacks.sourcePain(reaction, effective => {
      if (!effective.self.id.equals(owner.id)) throw new Error("Source pain target changes require callback replacement");
      entered = true;
      return execute(vm => { vm.globals.setInt(4, this.options.reference(effective.attacker)); vm.globals.setFloat(7, effective.damage); return undefined; });
    });
    else if (result.reaction === "death") callbacks.sourceDie({ ...reaction, inflictor: request.attack.inflictor, point: request.point }, effective => {
      if (!effective.self.id.equals(owner.id) || effective.attacker !== reaction.attacker || effective.damage !== reaction.damage)
        throw new Error("Source death argument changes require callback replacement");
      entered = true; return execute();
    });
    else throw new Error("QC reaction boundary has no source reaction");
    if (!entered) execute.skip([0, 0, 0]);
    return undefined;
  }
  pain(reaction: PainReaction): undefined { return this.actorReaction(reaction, "th_pain", [{ kind: "input", name: "attacker" }, { kind: "input", name: "amount" }]); }
  die(reaction: DeathReaction): undefined { return this.actorReaction(reaction, "th_die", []); }
  private actorReaction(reaction: PainReaction, field: string, args: ModSourceCall["arguments"]): undefined {
    const { machine } = this.options, reference = this.options.reference(reaction.self.id), index = machine.entities.fromReference(reference).int(this.field(field));
    if (index === 0) return undefined;
    this.options.invoke({ function: this.options.program.functionAt(index).name, arguments: args,
      globals: [{ name: "self", value: { kind: "input", name: "self" } }, { name: "time", value: { kind: "input", name: "time" } }] },
      new Map<ModCallbackInput, ModRuntimeValue>([["self", { kind: "actor", value: reaction.self.id }], ["attacker", { kind: "actor", value: reaction.attacker }],
        ["amount", { kind: "float", value: reaction.damage }], ["time", { kind: "float", value: this.seconds() }]]));
    return undefined;
  }
}
