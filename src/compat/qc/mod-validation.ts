// SPDX-License-Identifier: GPL-2.0-or-later
import { modCallbackInputs } from "../../world/session/mod-callback-inputs.ts";
import { validateModClientOutputs } from "../../world/session/mod-client-outputs.ts";
import { validateQcObjectiveStorage } from "./mod-objectives.ts";
import { validateSourceMatchField } from "../../contracts/source-match.ts";
import { validateQcSourceCall as validateCall } from "./source-call.ts";
import type { ModCallbackDeclaration, ModCallbackInput } from "../../contracts/mod-callbacks.ts";
import { qcProtectionRegions } from "./mod-protection.ts";
import { validateQcModCombat } from "./mod-combat.ts";
import { qcConsoleCall } from "./mod-commands.ts";
import { asciiFold, tokenizeCommand } from "../../core/commands/index.ts";
import { validateQcItems } from "./mod-items.ts";
import type { QcProgram } from "./program.ts";

export function validateQcMod(program: QcProgram, declaration: ModCallbackDeclaration): void {
  if (program.digest !== declaration.program.digest) throw new Error("Gameplay mod program differs from its declared artifact digest");
  const outputField = (name: string, vector: boolean): void => {
    const field = program.fieldsByName.get(name), binding = declaration.actorFields.find(value => value.field === name);
    if (field === undefined || field.type !== (vector ? "vector" : "float") || binding === undefined
      || binding.binding !== "private" && !(vector && ["view-offset", "bounds-min", "bounds-max"].includes(binding.binding)) && !(!vector && binding.binding === "client-flags"))
      throw new Error("QC client outputs require declared private fields or the explicit view-offset field");
  };
  validateModClientOutputs(declaration.clients?.outputs ?? [], { scalar: field => outputField(field, false), vector: field => outputField(field, true) });
  for (const output of declaration.clients?.outputs ?? []) {
    if (output.kind === "body-shape") {
      if (declaration.actorFields.find(value => value.field === output.min)?.binding !== "bounds-min"
        || declaration.actorFields.find(value => value.field === output.max)?.binding !== "bounds-max") throw new Error("Client body shape must name its declared source mins/maxs");
      continue;
    }
    const field = "height" in output ? output.height : output.field, binding = declaration.actorFields.find(value => value.field === field);
    if (binding?.binding === "client-flags" && (output.kind === "view-offset" || output.mask === undefined || (output.mask & ~(binding.privateMask ?? 0)) !== 0))
      throw new Error("QC client flag outputs must name an explicit mask of source-private bits");
  }
  qcProtectionRegions(program, declaration);
  validateQcItems(program, declaration);
  if (declaration.items?.weapons !== undefined) for (const call of [declaration.items.weapons.select.call, ...declaration.items.weapons.resume])
    validateCall(program, call, new Set<ModCallbackInput>(["self", "time"]), "source weapon");
  for (const item of declaration.items?.definitions ?? []) for (const call of [item.actions?.use, item.actions?.drop].filter(call => call !== undefined))
    validateCall(program, call, new Set<ModCallbackInput>(["self", "time"]), "source item action");
  for (const protection of declaration.protection ?? []) validateCall(program, protection.absorb.call, new Set<ModCallbackInput>(["self", "attacker", "inflictor", "amount", "knockback", "damage-flags", "regular-protection-scale", "direction", "point", "normal", "time"]), "protection");
  const pickupIds = new Set<string>(), pickupItems = new Set<string>();
  for (const pickup of declaration.pickups ?? []) {
    if (declaration.clients === undefined || pickup.id.length === 0 || pickupIds.has(pickup.id) || pickup.offered.length === 0
      || new Set(pickup.offered).size !== pickup.offered.length || pickup.offered.some(item => pickupItems.has(item)))
      throw new Error("QC pickups require clients, unique rule ids and distinct offered items");
    pickupIds.add(pickup.id); for (const item of pickup.offered) pickupItems.add(item);
    for (const resource of pickup.writes) {
      if (resource.kind === "protection" ? !declaration.protection?.some(value => value.channel === resource.channel)
        : !(resource.fields === "count" && declaration.actorFields.some(field => field.binding === "inventory" && field.item === resource.item))
          && !declaration.items?.storage.some(storage => storage.kind === "bits" ? resource.fields === "count" && storage.items.some(item => item.item === resource.item)
            : storage.item === resource.item && (resource.fields === "count" || storage.capacity.kind === "field")))
        throw new Error("QC pickup resource requires its declared source storage");
    }
    for (const call of pickup.operation.kind === "boolean-grant" ? [pickup.operation.grant] : [pickup.operation.gate, pickup.operation.grant])
      validateCall(program, call, new Set<ModCallbackInput>(["self", "other", "item", "time", "pickup-count", "pickup-has-count", "pickup-dropped"]), "pickup");
  }
  for (const binding of ["team", "score"]) if (declaration.actorFields.filter(field => field.binding === binding).length > 1) throw new Error(`Duplicate original ${binding} authority field`);
  const fields = new Set<number>();
  const think = declaration.actorFields.filter(field => field.binding === "think"), nextthink = declaration.actorFields.filter(field => field.binding === "nextthink");
  if (think.length !== nextthink.length || think.length > 1) throw new Error("Mod source scheduling requires one think and one nextthink binding together");
  for (const entry of declaration.actorFields) {
    if (entry.binding === "team" || entry.binding === "score") validateSourceMatchField(entry);
    if (entry.binding === "client-input" && (declaration.clients?.input === undefined || declaration.clients.input.length === 0
      || entry.update === "nonzero" && entry.input === "view-angles")) throw new Error("Mod client input fields require declared applications and scalar nonzero updates");
    if (entry.binding === "client-flags" && entry.privateMask !== undefined
      && (!Number.isInteger(entry.privateMask) || entry.privateMask < 0 || entry.privateMask > 0x7fffff || (entry.privateMask & (8 | 128 | (entry.grounded ? 512 : 0))) !== 0))
      throw new Error("Mod private client flags overlap canonical flags or exceed the source flag word");
    if (entry.binding === "userinfo" && (declaration.clients === undefined || entry.key.length === 0 || /[\\\x00]/u.test(entry.key))) throw new Error("Mod userinfo field requires a declared client and valid info key");
    if (entry.binding === "client-input" && entry.scale !== undefined && (!Number.isFinite(entry.scale) || entry.scale === 0 || entry.input === "view-angles")) throw new Error("QC input scale requires a finite nonzero scalar encoding");
    const field = program.fieldsByName.get(entry.field);
    if (field === undefined) throw new Error(`Missing mod actor field ${entry.field}`);
    const type = entry.binding === "private" ? field.type : entry.binding === "constant" ? entry.value.kind
      : entry.binding === "client-input" ? entry.input === "view-angles" ? "vector" : "float"
      : entry.binding === "classname" || entry.binding === "userinfo" ? "string" : entry.binding === "think" ? "function"
      : entry.binding === "team" || entry.binding === "score" || entry.binding === "health" || entry.binding === "inventory" || entry.binding === "nextthink" || entry.binding === "client-flags" ? "float" : "vector";
    if (field.type !== type) throw new Error(`Mod actor field ${entry.field} requires ${type}, found ${field.type}`);
    for (let word = field.offset; word < field.offset + (type === "vector" ? 3 : 1); word++) {
      if (fields.has(word)) throw new Error(`Overlapping mod actor field ${entry.field}`);
      fields.add(word);
    }
  }
  if (declaration.clientPresentation !== undefined) {
    if (declaration.clients === undefined) throw new Error("QC client presentation requires declared clients");
    const names = declaration.clientPresentation.hud === "none" ? [] : ["health", "armorvalue"];
    for (const name of names) if (program.fieldsByName.get(name)?.type !== "float") throw new Error(`QC status requires original ${name}`);
    if (declaration.clientPresentation.view !== "none") for (const name of ["origin", "angles", "view_ofs"])
      if (program.fieldsByName.get(name)?.type !== "vector") throw new Error(`QC view requires original ${name}`);
  }
  if (declaration.clients !== undefined) {
    if (!Number.isInteger(declaration.clients.maximum) || declaration.clients.maximum < 1 || declaration.clients.maximum >= 8191)
      throw new Error("Mod client capacity must fit reserved QuakeC edicts");
    for (const call of [...declaration.clients.admit, ...declaration.clients.userinfo, ...declaration.clients.disconnect])
      validateCall(program, call, new Set<ModCallbackInput>(["self", "time"]), "client lifecycle");
    for (const call of declaration.clients.frame ?? [])
      validateCall(program, call, new Set<ModCallbackInput>(["self", "time", "elapsed"]), "client frame");
    for (const binding of declaration.clients.input ?? []) if (binding.phase === "before") {
      const outputs = new Set<string>();
      for (const output of binding.outputs ?? []) {
        const key = output.kind === "field" ? `field:${output.field}` : `handler:${output.function}`;
        if (outputs.has(key)) throw new Error("QC input output declaration is duplicated");
        outputs.add(key);
        if (output.kind === "field") {
          if (!declaration.actorFields.some(field => field.binding === "client-input" && field.field === output.field)) throw new Error("QC output requires declared client input storage");
        } else {
          const fn = program.functionNamed(output.function);
          if (fn.index === 0 || fn.firstStatement <= 0 || fn.namedBuiltin || program.globalsByName.get("self")?.type !== "entity"
            || output.inputs.length === 0 || new Set(output.inputs).size !== output.inputs.length) throw new Error("QC output requires an original actor handler and distinct controls");
        }
      }
    }
    for (const binding of declaration.clients.input ?? []) for (const call of binding.calls)
      validateCall(program, call, new Set<ModCallbackInput>(["self", "time", "elapsed", "view-angles", "attack", "jump", "impulse", "forward-move", "side-move", "up-move"]), "client input");
  }
  for (const objective of declaration.objectives ?? []) {
    validateQcObjectiveStorage(program, objective.state.storage, "float");
    for (const storage of [objective.carrier, objective.target]) if (storage !== null) validateQcObjectiveStorage(program, storage, "entity");
    if (objective.role === "owned" && objective.change !== null) validateCall(program, objective.change, new Set<ModCallbackInput>(["self", "other", "activator", "amount", "time"]), "objective change");
  }
  const callbacks = new Set<string>();
  const commands = new Set<string>();
  for (const command of declaration.commands ?? []) {
    const name = asciiFold(command.name), tokens = tokenizeCommand(command.name, program.api.kind).argv;
    if (tokens.length !== 1 || tokens[0] !== command.name || command.name.includes(";") || commands.has(name)) throw new Error(`Invalid or duplicate mod command ${command.name}`);
    commands.add(name);
    validateCall(program, qcConsoleCall(command, [], ""), new Set<ModCallbackInput>(), `console command ${command.name}`);
  }
  for (const call of declaration.initialize ?? []) validateCall(program, call, new Set<ModCallbackInput>(["self", "time"]), "initialization");
  if (declaration.frame !== undefined) validateCall(program, declaration.frame, new Set<ModCallbackInput>(["self", "time", "elapsed"]), "source frame");
  const cvars = new Set<string>();
  for (const variable of declaration.cvars ?? []) {
    if (cvars.has(variable.name)) throw new Error(`Duplicate mod cvar ${variable.name}`);
    cvars.add(variable.name);
  }
  for (const call of declaration.callbacks) {
    if (callbacks.has(call.id)) throw new Error(`Duplicate mod callback ${call.id}`);
    callbacks.add(call.id);
    const available = modCallbackInputs(call);
    validateCall(program, call, available, call.id);
  }
  if (declaration.combat !== undefined) {
    validateQcModCombat(program, declaration.combat);
  }
}
