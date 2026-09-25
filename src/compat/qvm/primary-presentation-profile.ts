import type { MountedContent } from "../../content/mounts/index.ts";
import { q3EquipmentPresentationProfile, type QvmEquipmentPresentationProfile } from "../../content/q3/equipment/cgame-weapon-hud.ts";
import type { QvmModuleOptions } from "./module.ts";
import { QvmOpcode } from "./image.ts";
import { qualifyQvmRegion } from "./regions.ts";
import { readQvmCompatibilityDeclaration } from "./compatibility.ts";
import type { SaveReader } from "../../persistence/value.ts";
import { QVM_REF_ENTITY_BYTES } from "./render-record.ts";

export async function readQvmEquipmentPresentation(artifact: QvmModuleOptions["artifact"], mounts: Pick<MountedContent, "open">): Promise<QvmEquipmentPresentationProfile | null> {
  const declaration = await readQvmCompatibilityDeclaration(mounts, artifact.module, "cgame"), reader = declaration.equipmentPresentation;
  if (reader === null) return q3EquipmentPresentationProfile(artifact);
  if (artifact.role !== "cgame" || declaration.profile !== (artifact.abiProfile ?? "q3-modern"))
    return reader.fail("equipment presentation requires the declared cgame ABI");
  const instructions = artifact.image.instructions;
  const entry = (value: SaveReader): number => { const pc = value.integer(0); if (instructions[pc]?.opcode !== QvmOpcode.OP_ENTER) return value.fail("not an original function entry"); return pc; };
  const decision = (value: SaveReader, owner: number): number => {
    const pc = value.integer(0), instruction = instructions[pc]; let functionEntry = pc;
    while (functionEntry >= 0 && instructions[functionEntry]?.opcode !== QvmOpcode.OP_ENTER) functionEntry--;
    if (functionEntry !== owner || instruction === undefined || instruction.opcode < QvmOpcode.OP_EQ || instruction.opcode > QvmOpcode.OP_GEF)
      return value.fail("visibility decision is outside its original function");
    return pc;
  };
  const argument = (value: SaveReader): number => { const index = value.integer(0); if (index > 9) return value.fail("source argument exceeds the public invocation extent"); return index; };
  const word = (value: SaveReader, bytes: number): number => { const offset = value.integer(0); if (offset % 4 !== 0 || offset + 4 > bytes) return value.fail("source word exceeds its record or is unaligned"); return offset; };
  const integer = (value: SaveReader): number => { const result = value.integer(-0x80000000); if (result > 0x7fffffff) return value.fail("expected original int32"); return result; };
  const view = reader.field("view"), viewEntry = entry(view.field("entry")), warning = reader.field("warning"), states = warning.field("states"), held = reader.field("held");
  const heldEntry = entry(held.field("entry")), instruction = instructions[heldEntry];
  if (instruction?.opcode !== QvmOpcode.OP_ENTER) return held.fail("held weapon entry disappeared");
  const frame = instruction.operand, gun = word(held.field("gun"), frame);
  if (gun < 8 || gun + QVM_REF_ENTITY_BYTES > frame) return held.fail("held weapon refEntity exceeds the original local frame");
  const status = reader.field("status"), kind = status.field("kind").choice("regions", "functions");
  const profile: QvmEquipmentPresentationProfile = { hud: entry(reader.field("hud")),
    view: { entry: viewEntry, decision: decision(view.field("decision"), viewEntry), taken: view.field("taken").boolean() },
    warning: { entry: entry(warning.field("entry")), state: word(warning.field("state"), artifact.image.dataLength + artifact.image.literalLength + artifact.image.bssLength),
      states: { none: integer(states.field("none")), low: integer(states.field("low")), empty: integer(states.field("empty")) } },
    held: { entry: heldEntry, gun, parentArgument: argument(held.field("parentArgument")), stateArgument: argument(held.field("stateArgument")), entityArgument: argument(held.field("entityArgument")), entityNumberOffset: word(held.field("entityNumberOffset"), artifact.image.allocatedDataLength) },
    status: kind === "functions" ? { kind, entries: status.field("entries").list(entry) } : { kind, entries: status.field("entries").list(value => {
      const owner = entry(value.field("entry"));
      return { entry: owner, decision: decision(value.field("decision"), owner), taken: value.field("taken").boolean(), ammo: value.field("ammo").list(region => {
        const start = region.field("entry").integer(0), join = region.field("join").integer(0); qualifyQvmRegion(instructions, owner, start, join); return { entry: start, join };
      }) };
    }) } };
  const entries = [profile.hud, profile.warning.entry, profile.held.entry, profile.view.entry, ...profile.status.entries.map(value => typeof value === "number" ? value : value.entry)];
  if (new Set(entries).size !== entries.length || profile.status.entries.length === 0) return reader.fail("equipment interfaces overlap original function ownership or omit status");
  return profile;
}
