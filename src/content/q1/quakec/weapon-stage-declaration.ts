import { readModSourceCall } from "../../mods/source-call.ts";
import type { QcPrimaryWeaponStageDeclaration, QcWeaponStageDeclaration } from "../../../contracts/qc-weapon-stage.ts";
import type { SaveReader } from "../../../persistence/value.ts";

export function readQcWeaponStageDeclaration(reader: SaveReader): QcWeaponStageDeclaration {
  return Object.freeze({ dispatcher: reader.field("dispatcher").string(), continuations: Object.freeze(reader.field("continuations").list(value => value.string())),
    repeats: Object.freeze(reader.field("repeats").list(value => Object.freeze({ function: value.field("function").string(), entry: value.field("entry").integer(0), exit: value.field("exit").integer(0),
      result: Object.freeze({ word: value.field("result").field("word").integer(28), value: value.field("result").field("value").choice(0, 1) }),
      statements: Object.freeze(value.field("statements").list(statement => Object.freeze({ opcode: statement.field("opcode").integer(0), a: statement.field("a").integer(), b: statement.field("b").integer(), c: statement.field("c").integer() }))) }))) });
}
export function readQcPrimaryWeaponStage(reader: SaveReader): QcPrimaryWeaponStageDeclaration {
  const client = reader.field("client"), objectives = client.field("objectives"), kind = objectives.field("kind").choice("none", "call");
  const call = (value: SaveReader) => typeof value.value === "string" ? value.string() : readModSourceCall(value);
  if (kind === "call" && objectives.field("call").value !== undefined && objectives.field("function").value !== undefined)
    return objectives.fail("client objectives must declare one original call");
  return Object.freeze({ ...readQcWeaponStageDeclaration(reader), client: Object.freeze({ spawn: call(client.field("spawn")), selectSpawn: call(client.field("selectSpawn")),
    objectives: kind === "none" ? Object.freeze({ kind }) : objectives.field("call").value === undefined ? Object.freeze({ kind, function: objectives.field("function").string() })
      : Object.freeze({ kind, call: readModSourceCall(objectives.field("call")) }) }) });
}
