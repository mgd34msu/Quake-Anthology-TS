export class SaveFormatError extends Error {
  constructor(readonly path: string, message: string) { super(`${path}: ${message}`); this.name = "SaveFormatError"; }
}

type JsonValue = null | boolean | string | number | readonly JsonValue[] | { readonly [key: string]: JsonValue };
function unknownArray(value: unknown): value is readonly unknown[] { return Array.isArray(value); }

/** The envelope accepts plain checkpoint records only. Live classes, Maps and functions require their owner's codec. */
function pack(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value) && !Object.is(value, -0)) return value;
    return { $qts: "number", value: Object.is(value, -0) ? "-0" : String(value) };
  }
  if (typeof value === "bigint") return { $qts: "bigint", value: value.toString() };
  if (value instanceof Uint8Array) return { $qts: "bytes", value: Buffer.from(value).toString("base64") };
  if (unknownArray(value)) {
    return value.map((entry, index) => pack(entry, `${path}[${index}]`));
  }
  if (typeof value !== "object") throw new SaveFormatError(path, "checkpoint contains a non-data value");
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new SaveFormatError(path, "live objects require an explicit checkpoint codec");
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new SaveFormatError(path, "checkpoint contains a live symbol identity");
  const result: { [key: string]: JsonValue } = {};
  if (Object.hasOwn(value, "$qts")) throw new SaveFormatError(path, "$qts is reserved by the save envelope");
  for (const key of Object.keys(value)) {
    const entry: unknown = Reflect.get(value, key);
    Object.defineProperty(result, key, { value: pack(entry, `${path}.${key}`), enumerable: true });
  }
  return result;
}

function unpack(value: unknown, path: string): unknown {
  if (value === null || typeof value !== "object") return value;
  if (unknownArray(value)) {
    return value.map((entry, index) => unpack(entry, `${path}[${index}]`));
  }
  const tag: unknown = Reflect.get(value, "$qts");
  if (tag !== undefined) {
    const encoded: unknown = Reflect.get(value, "value");
    if (typeof encoded !== "string" || Object.keys(value).length !== 2) throw new SaveFormatError(path, "invalid tagged checkpoint value");
    if (tag === "bigint" && /^-?(0|[1-9][0-9]*)$/.test(encoded)) return BigInt(encoded);
    if (tag === "bytes" && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return new Uint8Array(Buffer.from(encoded, "base64"));
    if (tag === "number") {
      if (encoded === "-0") return -0;
      if (encoded === "NaN") return NaN;
      if (encoded === "Infinity") return Infinity;
      if (encoded === "-Infinity") return -Infinity;
    }
    throw new SaveFormatError(path, "unknown tagged checkpoint value");
  }
  const result: { [key: string]: unknown } = {};
  for (const key of Object.keys(value)) {
    const entry: unknown = Reflect.get(value, key);
    Object.defineProperty(result, key, { value: unpack(entry, `${path}.${key}`), enumerable: true });
  }
  return result;
}

export function encodeCheckpointValue(value: unknown): Uint8Array { return new TextEncoder().encode(JSON.stringify(pack(value, "checkpoint"))); }
export function decodeCheckpointValue(bytes: Uint8Array): unknown {
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  return unpack(parsed, "checkpoint");
}

/** Small boundary reader used by the save schemas; every returned type is constructed from checked fields. */
export class SaveReader {
  constructor(readonly value: unknown, readonly path = "save") {}
  field(name: string): SaveReader {
    if (this.value === null || typeof this.value !== "object" || Array.isArray(this.value) || this.value instanceof Uint8Array) this.fail("expected a record");
    const value: unknown = Reflect.get(this.value, name);
    return new SaveReader(value, `${this.path}.${name}`);
  }
  string(): string { if (typeof this.value !== "string") this.fail("expected a string"); return this.value; }
  boolean(): boolean { if (typeof this.value !== "boolean") this.fail("expected a boolean"); return this.value; }
  number(): number { if (typeof this.value !== "number") this.fail("expected a number"); return this.value; }
  finite(): number { const value = this.number(); if (!Number.isFinite(value)) this.fail("expected a finite number"); return value; }
  integer(minimum = Number.MIN_SAFE_INTEGER): number { const value = this.number(); if (!Number.isSafeInteger(value) || value < minimum) this.fail("expected an integer in range"); return value; }
  bigint(): bigint { if (typeof this.value !== "bigint") this.fail("expected a bigint"); return this.value; }
  bytes(): Uint8Array { if (!(this.value instanceof Uint8Array)) this.fail("expected raw checkpoint bytes"); return this.value; }
  literal<T extends string | number | boolean>(expected: T): T { if (this.value !== expected) this.fail(`expected ${String(expected)}`); return expected; }
  choice<T extends string | number>(...choices: readonly T[]): T {
    const match = choices.find(choice => choice === this.value);
    if (match === undefined) this.fail(`expected ${choices.join(" or ")}`);
    return match;
  }
  list<T>(read: (item: SaveReader) => T): readonly T[] {
    if (!unknownArray(this.value)) this.fail("expected an array");
    return this.value.map((entry, index) => read(new SaveReader(entry, `${this.path}[${index}]`)));
  }
  nullable<T>(read: (item: SaveReader) => T): T | null { return this.value === null ? null : read(this); }
  fail(message: string): never { throw new SaveFormatError(this.path, message); }
}

export function namespaced(reader: SaveReader): `${string}:${string}` {
  const value = reader.string();
  const colon = value.indexOf(":");
  if (colon < 1 || colon === value.length - 1) return reader.fail("expected a namespaced identity");
  return `${value.slice(0, colon)}:${value.slice(colon + 1)}`;
}
