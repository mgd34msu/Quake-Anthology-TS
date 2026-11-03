// SPDX-License-Identifier: GPL-2.0-or-later
// Derives each MG3 monster's resource list from the shipped MG3 progs.dat: every model, sprite and sound string constant
// in a function reachable from the monster's spawn function through function constants, plus the declared precaches
// already recorded in src/content/monsters/mg3-resources.ts (the source module precache declarations).
// Usage: bun tools/content/generate-mg3-monster-resources.ts <mg3 pak0.pak>
import { resolve } from "node:path";
import { openArchive } from "../../src/content/archive/index.ts";
import { loadQcProgram, qcByteString } from "../../src/compat/qc/program.ts";
import type { QcProgram } from "../../src/compat/qc/program.ts";
import { mg3MonsterResources } from "../../src/content/monsters/mg3-resources.ts";

const pakPath = process.argv[2];
if (pakPath === undefined) throw new Error("Pass the MG3 pak0.pak path");
const archive = await openArchive(pakPath, "pak");
const entry = archive.findEntries("progs.dat")[0];
if (entry === undefined) throw new Error("MG3 pak has no progs.dat");
const program = loadQcProgram(await archive.readEntry(entry));
const globals = new DataView(program.initialGlobals.buffer, program.initialGlobals.byteOffset, program.initialGlobals.byteLength);
const functionOffsets = new Set(program.globals.filter(definition => definition.type === "function").map(definition => definition.offset));
const stringOffsets = new Set(program.globals.filter(definition => definition.type === "string").map(definition => definition.offset));

function reachable(program: QcProgram, spawn: string): Set<string> {
  const seen = new Set<number>(),
    stack = [program.functionNamed(spawn).index],
    paths = new Set<string>();
  while (stack.length > 0) {
    const index = stack.pop();
    if (index === undefined || seen.has(index)) continue;
    seen.add(index);
    const fn = program.functionAt(index);
    if (fn.firstStatement <= 0) continue;
    for (let at = fn.firstStatement; at < program.functionEnd(fn); at++) {
      const statement = program.statements[at];
      if (statement === undefined) continue;
      for (const operand of [statement.a, statement.b, statement.c]) {
        if (operand * 4 + 4 > program.initialGlobals.length) continue;
        const value = globals.getInt32(operand * 4, true);
        if (functionOffsets.has(operand) && value > 0 && value < program.functions.length) stack.push(value);
        if (stringOffsets.has(operand) && value > 0) {
          const text = qcByteString(program.strings, value);
          if (/\.(mdl|spr|wav)$/i.test(text)) paths.add(/\.wav$/i.test(text) && !text.startsWith("sound/") ? `sound/${text}` : text);
        }
      }
    }
  }
  return paths;
}

const result: Record<string, { readonly resources: readonly string[] }> = {};
for (const [classname, declared] of Object.entries(mg3MonsterResources)) {
  result[classname] = { resources: [...new Set([...declared.resources.filter(path => !path.endsWith(".bsp")), ...reachable(program, classname)])].sort() };
}
await Bun.write(
  resolve(import.meta.dir, "../../src/content/monsters/mg3-resources.ts"),
  `// SPDX-License-Identifier: GPL-2.0-or-later\n// Generated from the MG3 progs.dat spawn-function closure plus the module precache declarations.\n// Regenerate with tools/content/generate-mg3-monster-resources.ts.\nexport const mg3MonsterResources: Readonly<Record<string, { readonly resources: readonly string[] }>> = ${JSON.stringify(result, null, 2)};\n`,
);
