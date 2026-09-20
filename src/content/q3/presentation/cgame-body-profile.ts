import type { QvmModuleOptions } from "../../../compat/qvm/module.ts";
import type { QvmBodySubmission } from "../../../compat/qvm/cgame-body.ts";
import type { MountedContent } from "../../mounts/index.ts";
import { normalizeResourcePath } from "../../mounts/paths.ts";
import { SaveReader } from "../../../persistence/value.ts";

function locals(entries: readonly number[]): readonly QvmBodySubmission[] {
  return entries.map(entry => ({ entry, actorArgument: 0, entityNumberOffset: 0, reference: { kind: "locals" } }));
}

/** Entries verified from each artifact's CG_AddCEntity dispatch and local refEntity allocations. */
export async function readCgameBodyProfile(artifact: QvmModuleOptions["artifact"], mounts: Pick<MountedContent, "open">): Promise<readonly QvmBodySubmission[] | null> {
  if (artifact.role !== "cgame") return null;
  const opened = await mounts.open("cgame-presentation.json");
  if (opened !== null) {
    const value: unknown = JSON.parse(new TextDecoder().decode(opened.bytes));
    const reader = new SaveReader(value, "cgame-presentation.json");
    reader.field("version").literal(1);
    if (normalizeResourcePath(reader.field("artifactPath").string()) !== artifact.module.artifactPath || reader.field("artifactDigest").string() !== artifact.module.digest)
      return reader.fail("presentation declaration belongs to different cgame bytes");
    return reader.field("bodySubmissions").list(item => {
      const storage = item.field("reference"), kind = storage.field("kind").choice("locals", "argument"), condition = item.field("when");
      return { entry: item.field("entry").integer(0), actorArgument: item.field("actorArgument").integer(0), entityNumberOffset: item.field("entityNumberOffset").integer(0),
        reference: kind === "locals" ? { kind } : { kind, index: storage.field("index").integer(0) },
        ...(condition.value === undefined ? {} : { when: { argument: condition.field("argument").integer(0), equals: condition.field("equals").integer() } }) };
    });
  }
  switch (artifact.module.digest) {
    case "sha256:a4744482c9b93852cc71f4d7ce03b3e4337e5d89844d27d272c2c16d74df07fa":
      return locals([45608, 81284, 46022, 47069, 47502, 47708, 47822, 48149, 47699, 45882, 45800]);
    case "sha256:14858804fb98609ed8b3b3c3b825f0a7cb544063f7e43735c884cd5e4a51157c":
      return locals([36612, 62937, 36804, 38561, 39712, 39826, 39870, 39534, 40520]);
    default: return null;
  }
}
