import type { SaveReader } from "../../persistence/value.ts";
import type { QvmInventoryProfile } from "./game-inventory.ts";
import { QvmOpcode } from "./image.ts";
import type { QvmModuleOptions } from "./module.ts";
import { qualifyQvmRegionEvaluation, type QvmRegionEvaluation } from "./regions.ts";

type Context = Parameters<QvmInventoryProfile["capacity"]>[2];
type SourceWord = { readonly kind: "constant"; readonly value: number } | { readonly kind: "weapon" | "client" | "entity" | "client-number" };

export function readQvmPrimaryInventoryProfile(reader: SaveReader, artifact: QvmModuleOptions["artifact"]): QvmInventoryProfile {
  const abiProfile = artifact.abiProfile ?? "q3-modern";
  if (artifact.role !== "qagame" || abiProfile !== "q3-modern") reader.fail("primary inventory declarations require a modern qagame ABI");
  const constant = (at: SaveReader): number => {
    const instruction = artifact.image.instructions[at.integer(0)];
    if (instruction?.opcode !== QvmOpcode.OP_CONST) return at.fail("capacity operand must be an original OP_CONST");
    return instruction.operand;
  };
  const word = (at: SaveReader): SourceWord => {
    const kind = at.field("kind").choice("constant", "weapon", "client", "entity", "client-number");
    return kind === "constant" ? { kind, value: constant(at.field("instruction")) } : { kind };
  };
  const value = (source: SourceWord, weapon: number, context: Context): number => {
    switch (source.kind) {
      case "constant": return source.value;
      case "weapon": return weapon;
      case "client": return context.client;
      case "entity": return context.entity;
      case "client-number": return context.clientNumber;
    }
  };
  const capacity = reader.field("capacity"), kind = capacity.field("kind").choice("constant", "global", "region", "counter");
  const stackReader = capacity.field("stack"), stack = stackReader.value === undefined ? undefined
    : { start: stackReader.field("start").integer(0), end: stackReader.field("end").integer(0) };
  if (stack !== undefined && (kind !== "counter" && kind !== "region" || stack.start % 4 !== 0 || stack.end % 4 !== 0
    || stack.start < artifact.image.dataLength + artifact.image.literalLength || stack.start >= stack.end || stack.end > artifact.image.allocatedDataLength))
    stackReader.fail("capacity stack must declare an aligned original BSS reservation for a source query");
  let evaluate: QvmInventoryProfile["capacity"];
  if (kind === "constant") {
    const limit = constant(capacity.field("instruction"));
    if (limit < 0) capacity.fail("source ammo capacity cannot be negative");
    evaluate = () => limit;
  } else if (kind === "global") {
    const address = constant(capacity.field("addressInstruction"));
    if (address < 0 || address % 4 !== 0 || address + 4 > artifact.image.allocatedDataLength) capacity.fail("source capacity word is outside aligned module data");
    evaluate = memory => memory.dataView(address, 4).getInt32(0, true);
  } else if (kind === "counter") {
    const owner = capacity.field("function").integer(0), functions = capacity.field("functions").list(at => {
      const index = at.integer(0); if (artifact.image.instructions[index]?.opcode !== QvmOpcode.OP_ENTER) at.fail("counter operation requires original function entries"); return index;
    });
    if (!functions.includes(owner) || new Set(functions).size !== functions.length) capacity.fail("counter operation must include its entry and distinct helpers");
    const arguments_ = capacity.field("arguments").list(at => at.field("kind").value === "maximum-grant" ? { kind: at.field("kind").literal("maximum-grant") } : word(at));
    if (arguments_.length > 10) capacity.fail("counter arguments exceed the public source invocation");
    const ammoOffset = reader.field("ammoOffset").integer(0);
    evaluate = (_memory, weapon, context) => context.module.evaluateCounter(arguments_.map(source => source.kind === "maximum-grant" ? 0x7fffffff : value(source, weapon, context)), owner,
      context.client + ammoOffset + weapon * 4, functions, stack);
  } else {
    const owner = capacity.field("function").integer(0), source = capacity.field("region");
    const region: QvmRegionEvaluation = { entry: source.field("entry").integer(0), join: source.field("join").integer(0),
      inputs: source.field("inputs").list(at => at.integer(8)), result: source.field("result").integer(8) };
    qualifyQvmRegionEvaluation(artifact.image.instructions, owner, region, "read-only");
    const arguments_ = capacity.field("arguments").list(word), inputs = capacity.field("inputs").list(word);
    if (arguments_.length > 10 || inputs.length !== region.inputs.length) capacity.fail("capacity arguments and live-ins differ from the original source frame");
    evaluate = (_memory, weapon, context) => context.module.evaluateRegion(arguments_.map(source => value(source, weapon, context)), owner, region,
      inputs.map(source => value(source, weapon, context)), stack);
  }
  const offset = (name: string): number => {
    const at = reader.field(name), result = at.integer(0);
    if (result % 4 !== 0) at.fail("inventory field must be aligned");
    return result;
  };
  return { module: artifact.module, abiProfile, weaponsOffset: offset("weaponsOffset"), ammoOffset: offset("ammoOffset"), capacity: evaluate };
}
