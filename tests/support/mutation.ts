// Seeded byte-level mutation for hostile-input tests. Every mutant is reproducible
// from (seed, index); a failing case reports both so it can be replayed.

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function mutate(source: Uint8Array, random: () => number): Uint8Array {
  const pick = (limit: number): number => Math.floor(random() * limit);
  const bytes = Uint8Array.from(source);
  switch (pick(6)) {
    case 0: { if (bytes.length > 0) { const at = pick(bytes.length); bytes[at] = (bytes[at] ?? 0) ^ (1 << pick(8)); } return bytes; }
    case 1: { for (let count = 1 + pick(4); count > 0 && bytes.length > 0; count--) bytes[pick(bytes.length)] = pick(256); return bytes; }
    case 2: return bytes.subarray(0, pick(bytes.length + 1)).slice();
    case 3: { const at = pick(bytes.length + 1), extra = Uint8Array.from({ length: 1 + pick(8) }, () => pick(256)); return Uint8Array.from([...bytes.subarray(0, at), ...extra, ...bytes.subarray(at)]); }
    case 4: { const at = pick(bytes.length + 1), cut = pick(Math.min(8, bytes.length - at) + 1); return Uint8Array.from([...bytes.subarray(0, at), ...bytes.subarray(at + cut)]); }
    default: { // saturate a little-endian word with an extreme value, the usual length/count overflow
      if (bytes.length >= 4) { const at = pick(bytes.length - 3), word = [0xffffffff, 0x7fffffff, 0x80000000, 0, 0x00010000][pick(5)] ?? 0; new DataView(bytes.buffer).setUint32(at, word, true); }
      return bytes;
    }
  }
}

export interface MutationReport { readonly accepted: number; readonly rejected: number; readonly foreign: readonly string[] }

// Runs `count` seeded mutants through `parse`. A parser may accept a mutant or throw an
// Error, but a non-Error throw or an internal TypeError (a missed bounds/shape check) is
// reported in `foreign`.
export function runMutations(seed: number, count: number, valid: Uint8Array, parse: (bytes: Uint8Array) => unknown): MutationReport {
  const random = seededRandom(seed), foreign: string[] = [];
  let accepted = 0, rejected = 0;
  for (let index = 0; index < count; index++) {
    const mutant = mutate(valid, random);
    try { parse(mutant); accepted++; }
    catch (error) {
      rejected++;
      if (!(error instanceof Error) || error instanceof TypeError) foreign.push(`seed ${seed} mutant ${index}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    }
  }
  return { accepted, rejected, foreign };
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function toJson(value: unknown): Json {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((entry: unknown) => toJson(entry));
  const out: { [key: string]: Json } = {};
  if (typeof value === "object") for (const key of Object.keys(value)) { const entry: unknown = Reflect.get(value, key); out[key] = toJson(entry); }
  return out;
}

function jsonPaths(value: Json, path: (string | number)[] = [], found: (string | number)[][] = []): (string | number)[][] {
  found.push(path);
  if (Array.isArray(value)) value.forEach((entry, index) => { jsonPaths(entry, [...path, index], found); });
  else if (value !== null && typeof value === "object") for (const key of Object.keys(value)) jsonPaths(value[key] ?? null, [...path, key], found);
  return found;
}

/** One structural edit of a JSON document: delete, retype, replace with an extreme number or duplicate a list entry. */
export function mutateJson(source: unknown, random: () => number): unknown {
  const parsed: unknown = JSON.parse(JSON.stringify(source)), clone = toJson(parsed);
  const paths = jsonPaths(clone).filter(path => path.length > 0), pick = (limit: number): number => Math.floor(random() * limit);
  const path = paths[pick(paths.length)];
  if (path === undefined) return clone;
  let parent: Json = clone;
  for (const step of path.slice(0, -1)) parent = Array.isArray(parent) ? parent[Number(step)] ?? null : (parent !== null && typeof parent === "object" ? parent[String(step)] ?? null : null);
  const last = path[path.length - 1];
  if (last === undefined || parent === null || typeof parent !== "object") return clone;
  const replacements: Json[] = [-1, 0, 0.5, 2 ** 53, 1e308, 4294967296, "", "x", "\u0000", null, true, [], {}, [1, 2, 3], { kind: "x" }];
  switch (pick(4)) {
    case 0: if (Array.isArray(parent)) parent.splice(Number(last), 1); else delete parent[String(last)]; break;
    case 1: if (Array.isArray(parent)) parent.push(parent[Number(last)] ?? null); else parent[`${String(last)}2`] = parent[String(last)] ?? null; break;
    default: { const replacement = replacements[pick(replacements.length)] ?? null; if (Array.isArray(parent)) parent[Number(last)] = replacement; else parent[String(last)] = replacement; }
  }
  return clone;
}

/** Same contract as {@link runMutations}, for parsers that take a JSON document. */
export function runJsonMutations(seed: number, count: number, valid: unknown, parse: (bytes: Uint8Array) => unknown): MutationReport {
  const random = seededRandom(seed), foreign: string[] = [];
  let accepted = 0, rejected = 0;
  for (let index = 0; index < count; index++) {
    const bytes = new TextEncoder().encode(JSON.stringify(mutateJson(valid, random)));
    try { parse(bytes); accepted++; }
    catch (error) {
      rejected++;
      if (!(error instanceof Error) || error instanceof TypeError) foreign.push(`seed ${seed} mutant ${index}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    }
  }
  return { accepted, rejected, foreign };
}
