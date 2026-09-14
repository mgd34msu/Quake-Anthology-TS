import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function clean(source: string): string { return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""); }
function split(source: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === "{" || char === "(" || char === "[") depth++;
    if (char === "}" || char === ")" || char === "]") depth--;
    if (char === "," && depth === 0) { parts.push(source.slice(start, index).trim()); start = index + 1; }
  }
  const last = source.slice(start).trim();
  if (last !== "") parts.push(last);
  return parts;
}
function body(source: string, start: number): string {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}" && --depth === 0) return source.slice(start + 1, index);
  }
  throw new Error("Unclosed source initializer");
}
function numeric(source: string, values: ReadonlyMap<string, number>): number {
  const text = source.trim().replace(/(?<=[\d.])f\b/g, "");
  const found = values.get(text);
  if (found !== undefined) return found;
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return Number(text);
  const binary = /^(.*?)\s*([+*-])\s*(-?(?:\d+(?:\.\d*)?|\.\d+))$/.exec(text);
  const left = binary?.[1], op = binary?.[2], right = binary?.[3];
  if (left !== undefined && op !== undefined && right !== undefined) {
    const a = numeric(left, values), b = Number(right);
    return op === "+" ? a + b : op === "-" ? a - b : a * b;
  }
  throw new Error(`Unsupported source number ${source}`);
}
function constants(source: string): Map<string, number> {
  const result = new Map<string, number>();
  for (const match of source.matchAll(/#define\s+(\w+)\s+([^\n]+)/g)) {
    const name = match[1], value = match[2];
    if (name !== undefined && value !== undefined && /^(?:FRAME_|MODEL_SCALE)/.test(name)) result.set(name, numeric(value, result));
  }
  for (const match of source.matchAll(/enum[^{}]*\{([^}]+)\}/g)) {
    let next = 0;
    for (const field of split(match[1] ?? "")) {
      const [name, value] = field.split("=").map(part => part.trim());
      if (name === undefined || !/^(FRAME_|MZ2_)\w+$/.test(name)) continue;
      if (value !== undefined) next = numeric(value, result);
      result.set(name, next++);
    }
  }
  return result;
}
function actions(source: string | undefined, values: ReadonlyMap<string, number>): string {
  if (source === undefined || source === "nullptr" || source === "NULL") return "[]";
  if (/^\w+$/.test(source)) return JSON.stringify([source]);
  if (source.startsWith("[]")) {
    const result: (string | { kind: "nextframe"; frame: number })[] = [];
    for (const statement of body(source, source.indexOf("{")).split(";").map(part => part.trim()).filter(part => part !== "")) {
      const callback = /^(\w+)\(self\)$/.exec(statement)?.[1];
      const frame = /^self->monsterinfo\.nextframe\s*=\s*(\w+)$/.exec(statement)?.[1];
      if (callback !== undefined) result.push(callback);
      else if (frame !== undefined) result.push({ kind: "nextframe", frame: numeric(frame, values) });
      else throw new Error(`Unsupported source frame statement ${statement}`);
    }
    return JSON.stringify(result);
  }
  throw new Error(`Unsupported source frame action ${source}`);
}
function generate(root: string, species: string): void {
  const source = clean(readFileSync(resolve(root, `m_${species}.cpp`), "utf8"));
  const header = /#include "(m_\w+\.h)"/.exec(source)?.[1];
  if (header === undefined) throw new Error(`${species}: missing frame header`);
  const values = constants(clean(readFileSync(resolve(root, header), "utf8")));
  for (const match of source.matchAll(/constexpr\s+(?:float|int|int32_t)\s+(\w+)\s*=\s*([^;]+);/g)) {
    const name = match[1], value = match[2];
    if (name !== undefined && value !== undefined && /^[-\d.]+f?$/.test(value.trim())) values.set(name, numeric(value, values));
  }
  const arrays = new Map<string, readonly string[]>();
  for (const match of source.matchAll(/mframe_t\s+(\w+)\[[^\]]*\]\s*=\s*\{/g)) {
    const name = match[1];
    if (name === undefined) throw new Error("Missing frame array name");
    const rows = split(body(source, match.index + match[0].length - 1));
    arrays.set(name, rows.map(row => {
      const [ai = "nullptr", distance = "0", callback, lerp = "-1"] = split(body(row, row.indexOf("{")));
      const kind = ai === "nullptr" || ai === "NULL" ? "none" : ai.replace(/^ai_/, "");
      if (!/^\w+$/.test(ai)) throw new Error(`Unsupported frame AI ${ai}`);
      const encodedAi = ["stand", "walk", "run", "charge", "move", "soldier_move", "turn", "none"].includes(kind) ? JSON.stringify(kind) : JSON.stringify({ kind: "source", name: ai });
      return `    { ai: ${encodedAi}, distance: Math.fround(${numeric(distance, values)}), actions: ${actions(callback, values)}, lerpFrame: ${numeric(lerp, values)} },`;
    }));
  }
  const moves: string[] = [];
  for (const match of source.matchAll(/MMOVE_T\((\w+)\)\s*=\s*\{/g)) {
    const name = match[1];
    const [first, last, frames, end = "nullptr", ...rest] = split(body(source, match.index + match[0].length - 1));
    if (name === undefined || first === undefined || last === undefined || frames === undefined) throw new Error("Incomplete source move");
    const table = arrays.get(frames);
    if (table === undefined) throw new Error(`${name}: unknown frame array ${frames}`);
    const start = numeric(first, values), finish = numeric(last, values);
    if (table.length < finish - start + 1) throw new Error(`${name}: incomplete frame table`);
    const scale = rest.find(field => field.startsWith(".sidestep_scale"))?.split("=")[1] ?? "0";
    moves.push(`  { name: ${JSON.stringify(name)}, firstFrame: ${start}, lastFrame: ${finish}, end: ${end === "nullptr" ? "null" : JSON.stringify(end)}, sidestepScale: ${numeric(scale, values)}, frames: [\n${table.join("\n")}\n  ] },`);
  }
  if (moves.length === 0) throw new Error(`${species}: no source moves`);
  const output = resolve(import.meta.dir, "tables");
  mkdirSync(output, { recursive: true });
  const fields = [...values].filter(([name]) => name.startsWith("FRAME_")).map(([name, value]) => `  ${name.slice(6)}: ${value},`).join("\n");
  writeFileSync(resolve(output, `${species}.ts`), `// Generated from rerelease/m_${species}.cpp and ${header}. ZeniMax Media, GPL-2.0.\nimport type { MonsterMove } from "../../../foundation/monsters/types.ts";\n\nexport const ${species}Frame = {\n${fields}\n};\n\nexport const ${species}Moves: readonly MonsterMove[] = [\n${moves.join("\n")}\n];\n`);
  process.stdout.write(`${species}: ${moves.length} original moves\n`);
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "../../../../../../qsrc/quake2-rerelease-dll/rerelease");
  for (const species of process.argv.slice(2)) generate(root, species);
  const flashes = [...constants(clean(readFileSync(resolve(root, "game.h"), "utf8")))].filter(([name]) => name.startsWith("MZ2_"));
  writeFileSync(resolve(import.meta.dir, "tables/flashes.ts"), `// Original rerelease/game.h muzzle-flash enum. ZeniMax Media, GPL-2.0.\nexport const rereleaseFlash = {\n${flashes.map(([name, value]) => `  ${name.slice(4)}: ${value},`).join("\n")}\n};\n`);
}
