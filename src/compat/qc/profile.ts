import type { ResolvedResourceReference } from "../../contracts/content.ts";
import type { GuestFieldLayout, GuestLayout, QuakeCApiIdentity, QuakeCHostProfile } from "../../contracts/execution.ts";
import type { MountedContent } from "../../content/mounts/index.ts";
import type { QcBuiltinRegistry } from "./machine.ts";
import type { QcEntityLayout } from "./memory.ts";
import type { QcHostKind } from "./builtins.ts";
import { loadQcProgram, QcProgramError } from "./program.ts";
import type { QcDefinition, QcProgram } from "./program.ts";

export function qcProgramSearchOrder(kind: QcHostKind): readonly string[] {
  return kind === "quakeworld" ? ["qwprogs.dat", "progs.dat"] : ["progs.dat"];
}
export async function loadMountedQcProgram(content: Pick<MountedContent, "open">, kind: QcHostKind): Promise<{ readonly program: QcProgram; readonly resource: ResolvedResourceReference }> {
  const api: QuakeCApiIdentity = kind === "quakeworld"
    ? { kind: "q1-quakeworld", programVersion: 6, systemCrc: 54730 }
    : { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 };
  for (const path of qcProgramSearchOrder(kind)) {
    const opened = await content.open(path);
    if (opened !== null) return { program: loadQcProgram(opened.bytes, api, path), resource: opened.reference };
  }
  throw new QcProgramError(`missing ${qcProgramSearchOrder(kind).join(" or ")}`);
}
/** WinQuake/QW i386 edict_t: prefix includes free, links, leaves, baseline and freetime. */
export function classicQcEntityLayout(program: QcProgram): QcEntityLayout {
  const variablesOffsetBytes = program.api.kind === "q1-quakeworld" ? 104 : 96;
  return { strideBytes: variablesOffsetBytes + program.entityFieldWords * 4, variablesOffsetBytes, fieldWords: program.entityFieldWords };
}
function fieldLayout(definition: QcDefinition, base: number): GuestFieldLayout {
  return { name: definition.name, byteOffset: base + definition.offset * 4,
    storage: definition.type === "vector" || definition.type === "float" ? "float32" : "int32", count: definition.type === "vector" ? 3 : 1 };
}
export function describeQcHost(program: QcProgram, kind: QcHostKind, entities: QcEntityLayout, registry: QcBuiltinRegistry, extensions: readonly string[] = []): QuakeCHostProfile {
  if ((kind === "quakeworld") !== (program.api.kind === "q1-quakeworld")) throw new QcProgramError("host kind disagrees with program API");
  const globalsLayout: GuestLayout = { id: `quakec:${program.api.systemCrc}-globals`, byteLength: program.initialGlobals.length,
    alignment: 4, pointerBytes: 4, byteOrder: "little-endian", fields: program.globals.map(definition => fieldLayout(definition, 0)) };
  const entityVariablesLayout: GuestLayout = { id: `quakec:${program.api.systemCrc}-entity-variables`, byteLength: entities.fieldWords * 4,
    alignment: 4, pointerBytes: 4, byteOrder: "little-endian", fields: program.fields.map(definition => fieldLayout(definition, 0)) };
  return { api: program.api, programSearchOrder: qcProgramSearchOrder(kind), globalsLayout, entityVariablesLayout,
    builtins: [ ...[...registry.numbered].map(([number]) => ({ kind: "numbered", number, name: program.functions.find(fn => fn.firstStatement === -number)?.name ?? `builtin_${number}`, callback: `quakec:numbered-${number}` } satisfies QuakeCHostProfile["builtins"][number])),
      ...[...registry.named].map(([name]) => ({ kind: "named", number: 0, name, callback: `quakec:named-${name}` } satisfies QuakeCHostProfile["builtins"][number])) ], extensions };
}
