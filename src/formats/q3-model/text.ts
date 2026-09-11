/* MD5 token grammar derived from q2repro models.c. GPL-2.0-or-later. */
import type { Vec3 } from "../../contracts/math.ts";

export class ModelTextError extends Error {
  constructor(source: string, offset: number, message: string) {
    super(`${source}:${offset}: ${message}`);
    this.name = "ModelTextError";
  }
}

export class ModelTokens {
  private offset = 0;
  constructor(private readonly text: string, readonly source: string) {}

  fail(message: string): never { throw new ModelTextError(this.source, this.offset, message); }

  next(): string | null {
    while (this.offset < this.text.length) {
      const character = this.text.charAt(this.offset);
      if (/\s/.test(character)) { this.offset++; continue; }
      if (this.text.startsWith("//", this.offset)) {
        const end = this.text.indexOf("\n", this.offset + 2);
        this.offset = end < 0 ? this.text.length : end + 1;
        continue;
      }
      if (this.text.startsWith("/*", this.offset)) {
        const end = this.text.indexOf("*/", this.offset + 2);
        if (end < 0) this.fail("unterminated comment");
        this.offset = end + 2;
        continue;
      }
      break;
    }
    if (this.offset === this.text.length) return null;
    const start = this.offset++;
    const first = this.text.charAt(start);
    if (first === '"') {
      const end = this.text.indexOf('"', this.offset);
      if (end < 0) this.fail("unterminated quoted token");
      this.offset = end + 1;
      return this.text.slice(start + 1, end);
    }
    if ("{}()".includes(first)) return first;
    while (this.offset < this.text.length && !/[\s{}()]/.test(this.text.charAt(this.offset))) this.offset++;
    return this.text.slice(start, this.offset);
  }

  token(): string { return this.next() ?? this.fail("unexpected end of model text"); }
  expect(expected: string): void {
    const actual = this.token();
    if (actual !== expected) this.fail(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  number(): number {
    const token = this.token();
    const value = Number(token);
    if (token.length === 0 || !Number.isFinite(value)) this.fail(`invalid number ${JSON.stringify(token)}`);
    return value;
  }
  float(): number {
    const value = Math.fround(this.number());
    if (!Number.isFinite(value)) this.fail("number exceeds binary32");
    return value;
  }
  integer(minimum = 0, maximum = 0x7fffffff): number {
    const value = this.number();
    if (!Number.isInteger(value) || value < minimum || value > maximum) this.fail(`integer ${value} outside ${minimum}..${maximum}`);
    return value;
  }
  vector(): Vec3 {
    this.expect("(");
    const result = { x: this.float(), y: this.float(), z: this.float() };
    this.expect(")");
    return result;
  }
  end(): void { if (this.next() !== null) this.fail("unexpected trailing token"); }
}

export function at<T>(values: readonly T[], index: number, label: string): T {
  const value = values[index];
  if (value === undefined) throw new RangeError(`Missing ${label} ${index}`);
  return value;
}

export function indexedRecords<T>(tokens: ModelTokens, count: number, kind: string, read: () => T): T[] {
  const records = new Map<number, T>();
  for (let i = 0; i < count; i++) {
    tokens.expect(kind);
    const index = tokens.integer(0, count - 1);
    if (records.has(index)) tokens.fail(`duplicate ${kind} ${index}`);
    records.set(index, read());
  }
  return Array.from({ length: count }, (_, index) => records.get(index) ?? tokens.fail(`missing ${kind} ${index}`));
}
