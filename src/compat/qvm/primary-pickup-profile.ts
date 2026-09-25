import type { SaveReader } from "../../persistence/value.ts";
import type { QvmPickupGrant, QvmPickupProfile } from "./game-pickups.ts";
import { QvmOpcode } from "./image.ts";
import { parseQvmItemLayout } from "./item-catalog.ts";
import type { QvmModuleOptions } from "./module.ts";
import { qualifyQvmRegion, qualifyQvmRegionEvaluation, type QvmRegionEvaluation } from "./regions.ts";

export function readQvmPrimaryPickupProfile(reader: SaveReader, artifact: QvmModuleOptions["artifact"]): QvmPickupProfile {
  const abiProfile = artifact.abiProfile ?? "q3-modern";
  if (artifact.role !== "qagame" || abiProfile !== "q3-modern") reader.fail("primary pickup declarations require a modern qagame ABI");
  const instructions = artifact.image.instructions;
  const entry = (at: SaveReader): number => {
    const value = at.integer(0);
    if (instructions[value]?.opcode !== QvmOpcode.OP_ENTER) at.fail("pickup requires an original function entry");
    return value;
  };
  const ownerEnd = (owner: number): number => {
    let end = owner + 1; while (end < instructions.length && instructions[end]?.opcode !== QvmOpcode.OP_ENTER) end++;
    return end;
  };
  const calls = (at: SaveReader, owner: number): readonly number[] => at.list(value => {
    const index = value.integer(1), target = instructions[index - 1];
    if (instructions[index]?.opcode !== QvmOpcode.OP_CALL || target?.opcode !== QvmOpcode.OP_CONST || target.operand !== owner)
      value.fail("pickup call differs from its declared original target");
    return index;
  });
  const functionCalls = (at: SaveReader) => { const target = entry(at.field("entry")); return { entry: target, calls: calls(at.field("calls"), target) }; };
  const argument = (at: SaveReader): number => { const index = at.integer(0); if (index >= 10) at.fail("pickup argument is outside the source ABI"); return index; };
  const gateReader = reader.field("gate"), gate = { ...functionCalls(gateReader), itemArgument: argument(gateReader.field("itemArgument")), playerArgument: argument(gateReader.field("playerArgument")) };
  const evaluation = (at: SaveReader, owner: number): QvmRegionEvaluation => {
    const result = { entry: at.field("entry").integer(0), join: at.field("join").integer(0),
      inputs: at.field("inputs").list(value => value.integer(8)), result: at.field("result").nullable(value => value.integer(8)) };
    qualifyQvmRegionEvaluation(instructions, owner, result); return result;
  };
  const grants = reader.field("grants").list((at): QvmPickupGrant => {
    const source = functionCalls(at), op = at.field("operation"), kind = op.field("kind").choice("return", "region");
    let operation: QvmPickupGrant["operation"];
    if (kind === "return") {
      const acceptedReturn = op.field("acceptedReturn").integer(source.entry + 1), value = instructions[acceptedReturn];
      if (acceptedReturn + 1 >= ownerEnd(source.entry) || value?.opcode !== QvmOpcode.OP_CONST || value.operand === 0
        || instructions[acceptedReturn + 1]?.opcode !== QvmOpcode.OP_LEAVE) op.fail("pickup accepted return must be original nonzero CONST/LEAVE in its owning function");
      operation = { kind, acceptedReturn };
    } else {
      const region = { entry: op.field("entry").integer(0), join: op.field("join").integer(0), quantity: op.field("quantity").integer(8) };
      const frame = qualifyQvmRegion(instructions, source.entry, region.entry, region.join);
      if (region.quantity % 4 !== 0 || region.quantity + 4 > frame) op.fail("pickup quantity is outside the original local frame");
      const weapon = op.field("weapon");
      operation = { kind, ...region, ...(weapon.value === undefined ? {} : { weapon: { bitsOffset: weapon.field("bitsOffset").integer(0),
        ammoOffset: weapon.field("ammoOffset").integer(0), quantity: evaluation(weapon.field("quantity"), source.entry) } }) };
    }
    const seen = new Set<number>();
    const branches = at.field("eligibility").field("branches").list(value => {
      const instructionIndex = value.field("instructionIndex").integer(gate.entry + 1), instruction = instructions[instructionIndex];
      if (instructionIndex >= ownerEnd(gate.entry) || instruction === undefined || instruction.opcode < QvmOpcode.OP_EQ || instruction.opcode > QvmOpcode.OP_GEF
        || seen.has(instructionIndex)) value.fail("eligibility override must name a distinct original conditional inside the gate");
      seen.add(instructionIndex);
      const taken = value.field("taken").boolean();
      return { instructionIndex, decide: () => taken };
    });
    return { ...source, itemType: at.field("itemType").integer(0), operation, eligible: ({ call }) => {
      call.branches(branches);
      const result = call.execution === "asynchronous" ? call.proceedAsync() : call.proceed();
      return typeof result === "number" ? result !== 0 : result.then(value => value !== 0);
    } };
  });
  const entityStride = reader.field("entityStride").integer(4), clientStride = reader.field("clientStride").integer(4), fields = reader.field("fields");
  const field = (name: string): number => {
    const value = fields.field(name).integer(0); if (value % 4 !== 0 || value + 4 > entityStride) fields.field(name).fail("pickup field is outside its aligned entity record"); return value;
  };
  return { module: artifact.module, abiProfile, entityStride, clientStride,
    fields: { inuse: field("inuse"), client: field("client"), health: field("health"), item: field("item"), count: field("count"), flags: field("flags") },
    droppedFlag: reader.field("droppedFlag").integer(0), items: parseQvmItemLayout(reader.field("items")), touch: entry(reader.field("touch")), gate,
    targets: functionCalls(reader.field("targets")), free: entry(reader.field("free")), objectiveTypes: reader.field("objectiveTypes").list(at => at.integer(0)), grants };
}
