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
  return Object.freeze({ ...readQcWeaponStageDeclaration(reader), client: Object.freeze({ spawn: client.field("spawn").string(), selectSpawn: client.field("selectSpawn").string(),
    objectives: kind === "none" ? Object.freeze({ kind }) : Object.freeze({ kind, function: objectives.field("function").string() }) }) });
}
