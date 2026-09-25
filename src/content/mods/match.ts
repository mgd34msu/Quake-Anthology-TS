import { namespaced } from "../../persistence/value.ts";
import type { SourceTeamValue } from "../../contracts/source-match.ts";
import { validateSourceMatchField } from "../../contracts/source-match.ts";
import type { SaveReader } from "../../persistence/value.ts";

export function readSourceTeamValues(reader: SaveReader): readonly SourceTeamValue[] {
  const values = reader.list(entry => ({ value: entry.field("value").finite(), team: entry.field("team").nullable(value => value.string()) }));
  try { validateSourceMatchField({ binding: "team", values }); }
  catch (error) { return reader.fail(error instanceof Error ? error.message : "invalid source team mapping"); }
  return values;
}

export function readSourceTeamAliases(reader: SaveReader): readonly import("../../contracts/source-match.ts").SourceTeamAlias[] {
  const values = reader.list(value => ({ source: value.field("source").nullable(value => value.string()), team: value.field("team").nullable(value => value.string()) }));
  if (new Set(values.map(value => value.source)).size !== values.length || new Set(values.map(value => value.team)).size !== values.length
    || values.some(value => value.source === "" || value.team === "")) reader.fail("team aliases require distinct original and shared identities");
  return values;
}

export function readSourcePrimaryMatch(reader: SaveReader, clientBytes: number): import("../../contracts/source-match.ts").SourcePrimaryMatch {
  const score = reader.field("score").integer(0), teams = reader.field("teams").list(value => ({ source: value.field("source").nullable(value => value.string()), team: value.field("team").nullable(value => value.string()), arguments: value.field("arguments").list(value => value.string()) }));
  if (score % 4 !== 0 || score + 4 > clientBytes) reader.field("score").fail("score is outside the original client record");
  if (new Set(teams.map(value => value.source)).size !== teams.length || new Set(teams.map(value => value.team)).size !== teams.length || teams.some(value => value.arguments.length === 0 || value.arguments.some(argument => argument.length === 0 || /[\0\r\n]/.test(argument))))
    reader.field("teams").fail("team changes require distinct identities and complete original command arguments");
  return { score, teams };
}

export function readSourceObjectives<Scalar, Reference, Call>(reader: SaveReader, scalar: (value: SaveReader) => Scalar,
  reference: (value: SaveReader) => Reference, call: (value: SaveReader) => Call): readonly import("../../contracts/source-match.ts").SourceObjectiveDeclaration<Scalar, Reference, Call>[] {
  const declarations = reader.list(value => {
    const state = value.field("state"), values = state.field("values").list(entry => ({ value: entry.field("value").finite(), stage: entry.field("stage").string(), complete: entry.field("complete").boolean() }));
    if (values.length === 0 || new Set(values.map(value => value.value)).size !== values.length || new Set(values.map(value => value.stage)).size !== values.length || values.some(value => value.stage.length === 0))
      state.fail("objective stages require distinct source values and shared names");
    const common = { id: namespaced(value.field("id")), state: { storage: scalar(state.field("storage")), values }, carrier: value.field("carrier").nullable(reference), target: value.field("target").nullable(reference) };
    return value.field("role").choice("owned", "borrowed") === "owned"
      ? { ...common, role: "owned", campaignGate: value.field("campaignGate").boolean(), botGoal: value.field("botGoal").boolean(), change: value.field("change").nullable(call) } satisfies import("../../contracts/source-match.ts").SourceObjectiveDeclaration<Scalar, Reference, Call>
      : { ...common, role: "borrowed", writable: value.field("writable").boolean() } satisfies import("../../contracts/source-match.ts").SourceObjectiveDeclaration<Scalar, Reference, Call>;
  });
  if (new Set(declarations.map(value => value.id)).size !== declarations.length) reader.fail("duplicate objective channel");
  return declarations;
}
