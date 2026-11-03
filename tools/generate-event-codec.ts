// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Regenerates the reader/writer pairs of src/app/bootstrap/network/unified-event-codec.ts from the
 * SimulationEvent and SimulationPresentationEvent types (TypeScript compiler API).
 *
 * The `type Event… = …` alias lines in the codec are the schema: each names a node by its path through the event
 * types. For every alias that has a generated `read…`/`write…` pair, the pair is rebuilt from the checker's view of
 * the alias. Pairs listed in tools/event-codec-rules.ts are hand-written; their type shape is fingerprinted so a type
 * change fails the check until the hand-written code is reviewed.
 *
 *   bun tools/generate-event-codec.ts            rewrite the codec
 *   bun tools/generate-event-codec.ts --check    exit 1 when the codec differs from the derived output
 */
import * as ts from "typescript";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { handWritten, keptCases, ranges } from "./event-codec-rules.ts";

function isTypeReference(type: ts.Type): type is ts.TypeReference {
  return (
    (type.flags & ts.TypeFlags.Object) !== 0 &&
    "objectFlags" in type &&
    typeof type.objectFlags === "number" &&
    (type.objectFlags & ts.ObjectFlags.Reference) !== 0
  );
}

const root = new URL("..", import.meta.url).pathname;
export const codecPath = `${root}src/app/bootstrap/network/unified-event-codec.ts`;

const identities = new Map([
  ["ActorIdentity", "ActorId"],
  ["ActorId", "ActorId"],
  ["ClientIdentity", "ClientId"],
  ["ClientId", "ClientId"],
  ["SeatIdentity", "SeatId"],
  ["SeatId", "SeatId"],
  ["ProviderId", "ProviderId"],
  ["ItemId", "ItemId"],
  ["ObjectiveId", "ObjectiveId"],
  ["ResourceId", "ResourceId"],
  ["ContentId", "ContentId"],
  ["EntityState", "EntityState"],
]);

interface Region {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}
const boundary = /^(type |function |export |const |interface |import |\/\*\*|$)/;
const readHead = /^function read(\w+)\(reader: SaveReader, identity: UnifiedIdentityDecoder\): (\w+) \{ void identity; /;
const writeHead = /^function write(\w+)\(value: (\w+)\): unknown \{ /;
const anyRead = /^function read(\w+)\(reader: SaveReader, identity: UnifiedIdentityDecoder\): (\w+)/;
const anyWrite = /^function write(\w+)\(value: (\w+)\): unknown/;
const tail = " default: return reader.fail('unknown event variant'); } }";

function regions(lines: readonly string[], head: RegExp): Map<string, Region> {
  const found = new Map<string, Region>();
  lines.forEach((line, index) => {
    const match = head.exec(line);
    if (match === null || match[1] !== match[2]) return;
    let end = index + 1;
    while (end < lines.length && !boundary.test(lines[end] ?? "")) end += 1;
    found.set(match[1] ?? "", { name: match[1] ?? "", start: index, end });
  });
  return found;
}

interface Ctx {
  readonly self?: ts.Type | undefined;
  readonly field?: string | undefined;
  readonly node?: ts.TypeNode | undefined;
  readonly scope: string;
}

function capital(text: string): string {
  return text.slice(0, 1).toUpperCase() + text.slice(1);
}

export class Deriver {
  readonly declared = new Map<string, string[]>();
  readonly aliases = new Map<string, ts.Type>();
  private readonly aliasNodes = new Map<string, ts.TypeNode>();
  readonly nodes: ReadonlySet<string>;
  private readonly keys = new Map<ts.Type, string>();
  constructor(
    readonly checker: ts.TypeChecker,
    program: ts.Program,
    file: string,
    nodeNames: ReadonlySet<string>,
  ) {
    this.nodes = nodeNames;
    const source = program.getSourceFile(file);
    if (source === undefined) throw new Error("codec source missing from program");
    ts.forEachChild(source, node => {
      if (!ts.isTypeAliasDeclaration(node) || !node.name.text.startsWith("Event")) return;
      const type = checker.getTypeFromTypeNode(node.type);
      this.aliases.set(node.name.text, type);
      this.aliasNodes.set(node.name.text, node.type);
      const key = this.canonical(type);
      this.declared.set(key, [...(this.declared.get(key) ?? []), node.name.text]);
    });
  }

  type(name: string): ts.Type {
    const type = this.aliases.get(name);
    if (type === undefined) throw new Error(`no type alias ${name}`);
    return type;
  }

  /** Types compare structurally once `undefined` (an optional property's extra member) is ignored. */
  canonical(type: ts.Type): string {
    const cached = this.keys.get(type);
    if (cached !== undefined) return cached;
    const key = this.structure(type, []);
    this.keys.set(type, key);
    return key;
  }
  private leaf(type: ts.Type): string {
    return this.checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
  }
  private structure(type: ts.Type, stack: ts.Type[]): string {
    if (type.isUnion())
      return type.types
        .filter(member => !(member.flags & ts.TypeFlags.Undefined))
        .map(member => this.structure(member, stack))
        .sort()
        .join("|");
    const identity = this.identityOf(type);
    if (identity !== undefined) return `id:${identity}`;
    const depth = stack.indexOf(type);
    if (depth >= 0) return `~${depth}`;
    if (this.checker.isArrayType(type) && isTypeReference(type)) return `[${this.structure(this.checker.getTypeArguments(type)[0] ?? type, stack)}]`;
    // Well-known symbol members (`__@iterator@115`) carry compiler-assigned ids that shift whenever the program changes.
    const props = this.props(type).filter(prop => !prop.name.startsWith("__@"));
    if (props.length === 0 || type.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike)) return this.leaf(type);
    stack.push(type);
    const text = `{${props.map(prop => `${prop.name}${this.optional(prop) ? "?" : ""}:${this.structure(this.propType(prop), stack)}`).join(";")}}`;
    stack.pop();
    return text;
  }

  private identityOf(type: ts.Type): string | undefined {
    const name = type.aliasSymbol?.name ?? type.symbol?.name;
    return name === undefined ? undefined : identities.get(name);
  }
  private identityOfNode(node: ts.TypeNode | undefined): string | undefined {
    if (node === undefined) return undefined;
    if (ts.isParenthesizedTypeNode(node)) return this.identityOfNode(node.type);
    if (ts.isUnionTypeNode(node)) {
      const rest = node.types.filter(member => !(ts.isLiteralTypeNode(member) && member.literal.kind === ts.SyntaxKind.NullKeyword));
      return rest.length === 1 ? this.identityOfNode(rest[0]) : undefined;
    }
    return ts.isTypeReferenceNode(node) ? identities.get(node.typeName.getText()) : undefined;
  }
  private identity(type: ts.Type, ctx: Ctx): string | undefined {
    if (this.parts(type).nullable) return undefined;
    const named = this.identityOf(type) ?? this.identityOfNode(ctx.node);
    if (named !== undefined) return named;
    // An unnamed `${string}:${string}` is a namespaced id, which ProviderId reads.
    return type.flags & ts.TypeFlags.TemplateLiteral && this.leaf(type) === "`${string}:${string}`" ? "ProviderId" : undefined;
  }

  private parts(type: ts.Type): { readonly members: readonly ts.Type[]; readonly nullable: boolean } {
    const members = type.isUnion() ? type.types : [type];
    const nullable = members.some(member => member.flags & ts.TypeFlags.Null);
    return { members: members.filter(member => !(member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined))), nullable };
  }
  private isBoolean(members: readonly ts.Type[]): boolean {
    return members.length > 0 && members.every(member => member.flags & ts.TypeFlags.BooleanLike);
  }
  private props(type: ts.Type): readonly ts.Symbol[] {
    return this.checker.getPropertiesOfType(type);
  }
  private propType(prop: ts.Symbol): ts.Type {
    return this.checker.getTypeOfSymbol(prop);
  }
  private optional(prop: ts.Symbol): boolean {
    return (prop.flags & ts.SymbolFlags.Optional) !== 0;
  }
  private quote(value: string | number): string {
    return typeof value === "string" ? JSON.stringify(value) : String(value);
  }
  private declaredNode(prop: ts.Symbol): ts.TypeNode | undefined {
    const declaration = prop.valueDeclaration ?? prop.declarations?.[0];
    return declaration !== undefined && ts.isPropertySignature(declaration) ? declaration.type : undefined;
  }
  private elementNode(node: ts.TypeNode | undefined): ts.TypeNode | undefined {
    if (node === undefined) return undefined;
    if (ts.isParenthesizedTypeNode(node)) return this.elementNode(node.type);
    if (ts.isTypeOperatorNode(node)) return this.elementNode(node.type);
    if (ts.isArrayTypeNode(node)) return node.elementType;
    if (ts.isTypeReferenceNode(node)) return node.typeArguments?.[0];
    return undefined;
  }
  private nonNullNode(node: ts.TypeNode | undefined): ts.TypeNode | undefined {
    if (node === undefined || !ts.isUnionTypeNode(node)) return node;
    const rest = node.types.filter(member => !(ts.isLiteralTypeNode(member) && member.literal.kind === ts.SyntaxKind.NullKeyword));
    return rest.length === 1 ? rest[0] : node;
  }

  /** Literal members in declaration order: the checker sorts union members by type id, the wire order follows the source. */
  private literals(members: readonly ts.Type[], whole: ts.Type | undefined, node: ts.TypeNode | undefined): readonly (string | number)[] | undefined {
    const values: (string | number)[] = [];
    for (const member of members) {
      if (member.isStringLiteral() || member.isNumberLiteral()) values.push(member.value);
      else return undefined;
    }
    if (values.length < 2) return values.length === 0 ? undefined : values;
    const nodes: (ts.TypeNode | undefined)[] = [node];
    const aliasDeclaration = whole?.aliasSymbol?.declarations?.[0];
    if (aliasDeclaration !== undefined && ts.isTypeAliasDeclaration(aliasDeclaration)) nodes.push(aliasDeclaration.type);
    for (const candidate of nodes) {
      const ordered = candidate === undefined ? [] : this.nodeLiterals(candidate);
      if (ordered.length === values.length && values.every(value => ordered.includes(value))) return ordered;
    }
    return values;
  }
  private nodeLiterals(node: ts.TypeNode): (string | number)[] {
    if (ts.isLiteralTypeNode(node)) {
      const literal = node.literal;
      if (ts.isStringLiteral(literal)) return [literal.text];
      if (ts.isNumericLiteral(literal)) return [Number(literal.text)];
      if (ts.isPrefixUnaryExpression(literal) && ts.isNumericLiteral(literal.operand)) return [-Number(literal.operand.text)];
      return [];
    }
    if (ts.isUnionTypeNode(node)) return node.types.flatMap(member => this.nodeLiterals(member));
    if (ts.isParenthesizedTypeNode(node)) return this.nodeLiterals(node.type);
    if (ts.isTypeReferenceNode(node)) {
      const declaration = this.declarationOf(node.typeName);
      return declaration !== undefined && ts.isTypeAliasDeclaration(declaration) ? this.nodeLiterals(declaration.type) : [];
    }
    return [];
  }
  private choice(values: readonly (string | number)[], expr: string): string {
    return `${expr}.choice<${values.map(value => this.quote(value)).join(" | ")}>(${values.map(value => this.quote(value)).join(", ")})`;
  }
  /** The first declaration behind a type reference, following import aliases. */
  private declarationOf(name: ts.EntityName): ts.Declaration | undefined {
    const symbol = this.checker.getSymbolAtLocation(name);
    const target = symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias ? this.checker.getAliasedSymbol(symbol) : symbol;
    return target?.declarations?.[0];
  }
  private leaves(node: ts.TypeNode): ts.TypeNode[] {
    if (ts.isParenthesizedTypeNode(node)) return this.leaves(node.type);
    if (ts.isUnionTypeNode(node)) return node.types.flatMap(member => this.leaves(member));
    if (ts.isTypeReferenceNode(node)) {
      const declaration = this.declarationOf(node.typeName);
      if (declaration !== undefined && ts.isTypeAliasDeclaration(declaration) && ts.isUnionTypeNode(declaration.type)) return this.leaves(declaration.type);
    }
    return [node];
  }
  /** Union variants in declaration order (the checker orders by type id). */
  private ordered(members: readonly ts.Type[], node: ts.TypeNode | undefined): readonly ts.Type[] {
    const keys = node === undefined ? [] : this.leaves(node).map(leaf => this.canonical(this.checker.getTypeFromTypeNode(leaf)));
    const rank = (type: ts.Type): number => {
      const index = keys.indexOf(this.canonical(type));
      return index < 0 ? keys.length : index;
    };
    return members
      .map((member, index) => ({ member, index }))
      .sort((a, b) => rank(a.member) - rank(b.member) || a.index - b.index)
      .map(entry => entry.member);
  }
  named(type: ts.Type, ctx: Ctx): string | undefined {
    const key = this.canonical(type);
    if (ctx.self !== undefined && this.canonical(ctx.self) === key) return undefined;
    const candidates = (this.declared.get(key) ?? []).filter(name => this.nodes.has(name));
    if (candidates.length < 2) return candidates[0];
    const suffix = ctx.field === undefined ? undefined : capital(ctx.field);
    return candidates.find(name => suffix !== undefined && name.endsWith(suffix)) ?? candidates[0];
  }
  private unsupported(type: ts.Type): void {
    if (this.checker.isTupleType(type)) throw new Error("tuple");
    if (type.getCallSignatures().length > 0 || this.props(type).some(prop => this.checker.getTypeOfSymbol(prop).getCallSignatures().length > 0)) {
      throw new Error("object with methods");
    }
  }

  kindsOf(member: ts.Type): readonly string[] {
    const kind = this.props(member).find(prop => prop.name === "kind");
    if (kind === undefined) throw new Error("variant without kind");
    const lits = this.literals(this.parts(this.propType(kind)).members, undefined, this.declaredNode(kind));
    return (lits ?? []).map(String);
  }

  read(type: ts.Type, expr: string, ctx: Ctx): string {
    const identity = this.identity(type, ctx);
    if (identity !== undefined) return `read${identity}(${expr}, identity)`;
    const declared = this.named(type, ctx);
    if (declared !== undefined) return `read${declared}(${expr}, identity)`;
    const { members, nullable } = this.parts(type);
    const lits = this.literals(members, type, ctx.node);
    if (nullable) {
      const core = this.checker.getNonNullableType(type);
      const inner = this.read(core, expr, { ...ctx, self: undefined, node: this.nonNullNode(ctx.node) });
      return lits === undefined ? `${expr}.value === null ? null : ${inner}` : `(${expr}.value === null ? null : ${inner})`;
    }
    if (this.isBoolean(members)) return `${expr}.boolean()`;
    if (lits !== undefined) return lits.length === 1 ? `${expr}.literal(${this.quote(lits[0] ?? "")})` : this.choice(lits, expr);
    if (members.length === 1 && members[0] !== undefined) {
      const only = members[0];
      if (only.flags & ts.TypeFlags.String) return `${expr}.string()`;
      if (only.flags & ts.TypeFlags.Number) return `${expr}.finite()`;
      if (this.checker.isArrayType(only) && isTypeReference(only)) {
        const element = this.checker.getTypeArguments(only)[0];
        if (element === undefined) throw new Error("array without element type");
        return `boundedList(${expr}, item => ${this.read(element, "item", { scope: ctx.scope, node: this.elementNode(ctx.node) })})`;
      }
      this.unsupported(only);
      if (!(only.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))) throw new Error(`unrecognized type ${this.leaf(only)}`);
      return this.readFields(only, expr, ctx.scope);
    }
    if (members.every(member => member.flags & (ts.TypeFlags.String | ts.TypeFlags.Number))) {
      return `(typeof ${expr}.value === 'string' ? ${expr}.string() : ${expr}.finite())`;
    }
    return this.readUnion(members, expr, ctx);
  }
  private readFields(type: ts.Type, expr: string, scope: string): string {
    const fields: string[] = [];
    for (const prop of this.props(type)) {
      const field = `${expr}.field(${JSON.stringify(prop.name)})`;
      const wrapper = ranges[`${scope}.${prop.name}`];
      const body =
        wrapper !== undefined ? `${wrapper}(${field})` : this.read(this.propType(prop), field, { field: prop.name, node: this.declaredNode(prop), scope });
      fields.push(
        this.optional(prop) ? `...(${field}.value === undefined ? {} : { ${JSON.stringify(prop.name)}: ${body} })` : `${JSON.stringify(prop.name)}: ${body}`,
      );
    }
    return `{ ${fields.join(", ")} }`;
  }
  private readUnion(members: readonly ts.Type[], expr: string, ctx: Ctx): string {
    const scope = ctx.scope;
    const cases = this.ordered(members, ctx.node).map(member => {
      const kinds = this.kindsOf(member);
      const named = this.named(member, { scope });
      if (keptCases[scope]?.[kinds[0] ?? ""] !== undefined) return `case ${JSON.stringify(kinds[0])}: return null;`;
      const body = named !== undefined ? `read${named}(${expr}, identity)` : `(${this.readFields(member, expr, `${scope}/${kinds.join("/")}`)})`;
      return `${kinds.map(kind => `case ${JSON.stringify(kind)}:`).join(" ")} return ${body};`;
    });
    return `switch (${expr}.field('kind').string()) { ${cases.join("\n")}${tail}`;
  }

  write(type: ts.Type, acc: string, ctx: Ctx): string {
    const identity = this.identity(type, ctx);
    if (identity !== undefined) return `write${identity}(${acc})`;
    const declared = this.named(type, ctx);
    if (declared !== undefined) return `write${declared}(${acc})`;
    const { members, nullable } = this.parts(type);
    const lits = this.literals(members, type, ctx.node);
    if (nullable) {
      if (lits !== undefined) return acc;
      const core = this.checker.getNonNullableType(type);
      return `${acc} === null ? null : ${this.write(core, acc, { ...ctx, self: undefined, node: this.nonNullNode(ctx.node) })}`;
    }
    if (this.isBoolean(members) || lits !== undefined) return acc;
    if (members.length === 1 && members[0] !== undefined) {
      const only = members[0];
      if (only.flags & (ts.TypeFlags.String | ts.TypeFlags.Number)) return acc;
      if (this.checker.isArrayType(only) && isTypeReference(only)) {
        const element = this.checker.getTypeArguments(only)[0];
        if (element === undefined) throw new Error("array without element type");
        return `${acc}.map(item => ${this.write(element, "item", { scope: ctx.scope, node: this.elementNode(ctx.node) })})`;
      }
      this.unsupported(only);
      if (!(only.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))) throw new Error(`unrecognized type ${this.leaf(only)}`);
      return this.writeFields(only, acc, ctx.scope);
    }
    if (members.every(member => member.flags & (ts.TypeFlags.String | ts.TypeFlags.Number))) return acc;
    return this.writeUnion(members, acc, ctx);
  }
  private writeFields(type: ts.Type, acc: string, scope: string): string {
    const fields: string[] = [];
    for (const prop of this.props(type)) {
      const access = `${acc}[${JSON.stringify(prop.name)}]`;
      const body = this.write(this.propType(prop), access, { field: prop.name, node: this.declaredNode(prop), scope });
      fields.push(
        this.optional(prop) ? `...(${access} === undefined ? {} : { ${JSON.stringify(prop.name)}: ${body} })` : `${JSON.stringify(prop.name)}: ${body}`,
      );
    }
    return `{ ${fields.join(", ")} }`;
  }
  private writeUnion(members: readonly ts.Type[], acc: string, ctx: Ctx): string {
    const scope = ctx.scope;
    const cases = this.ordered(members, ctx.node).map(member => {
      const kinds = this.kindsOf(member);
      const named = this.named(member, { scope });
      if (keptCases[scope]?.[kinds[0] ?? ""] !== undefined) return `case ${JSON.stringify(kinds[0])}: return null;`;
      const body = named !== undefined ? `write${named}(${acc})` : `(${this.writeFields(member, acc, `${scope}/${kinds.join("/")}`)})`;
      return `${kinds.map(kind => `case ${JSON.stringify(kind)}:`).join(" ")} return ${body};`;
    });
    return `switch (${acc}.kind) { ${cases.join("\n")} } }`;
  }

  /** Follows `X["field"]`, `X[number]`, `Exclude<X, undefined>` and `NonNullable<X>` back to the property declaration that owns the type. */
  private resolveNode(node: ts.TypeNode | undefined): ts.TypeNode | undefined {
    if (node === undefined) return undefined;
    if (ts.isParenthesizedTypeNode(node)) return this.resolveNode(node.type);
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText();
      if ((name === "Exclude" || name === "NonNullable") && node.typeArguments?.[0] !== undefined) return this.resolveNode(node.typeArguments[0]);
      return node;
    }
    if (!ts.isIndexedAccessTypeNode(node)) return node;
    if (ts.isLiteralTypeNode(node.indexType) && ts.isStringLiteral(node.indexType.literal)) {
      const owner = this.checker.getNonNullableType(this.checker.getTypeFromTypeNode(node.objectType));
      const prop = this.checker.getPropertyOfType(owner, node.indexType.literal.text);
      return this.resolveNode(prop === undefined ? undefined : this.declaredNode(prop));
    }
    return this.resolveNode(this.elementNode(this.resolveNode(node.objectType)));
  }
  private ctxOf(name: string, type: ts.Type): Ctx {
    const aliasNode = this.aliasNodes.get(name);
    const resolved = this.resolveNode(aliasNode);
    const alias = type.aliasSymbol?.declarations?.[0];
    const fallback = alias !== undefined && ts.isTypeAliasDeclaration(alias) ? alias.type : undefined;
    const node = resolved ?? fallback;
    return { self: type, scope: name, ...(node !== undefined ? { node } : {}) };
  }
  readFunction(name: string): string {
    const type = this.type(name);
    const head = `function read${name}(reader: SaveReader, identity: UnifiedIdentityDecoder): ${name} { void identity; `;
    const body = this.read(type, "reader", this.ctxOf(name, type));
    return body.startsWith("switch") ? `${head}${body}` : `${head}return ${body}; }`;
  }
  writeFunction(name: string): string {
    const type = this.type(name);
    const head = `function write${name}(value: ${name}): unknown { `;
    const body = this.write(type, "value", this.ctxOf(name, type));
    return body.startsWith("switch") ? `${head}${body}` : `${head}return ${body}; }`;
  }
  /** Canonical structural description of an alias, used to detect type drift behind hand-written code. */
  shape(name: string): string {
    return this.canonical(this.type(name));
  }
  /** Shape of one union variant, used to detect drift behind a hand-written case. */
  caseShape(name: string, kind: string): string {
    const type = this.type(name);
    const member = (type.isUnion() ? type.types : [type]).find(candidate => this.kindsOf(candidate).includes(kind));
    if (member === undefined) throw new Error(`${name} has no variant ${kind}`);
    return this.canonical(member);
  }
}

export function fingerprint(shape: string): string {
  return createHash("sha256").update(shape).digest("hex").slice(0, 12);
}

export interface Derivation {
  readonly deriver: Deriver;
  readonly output: string;
  readonly handWritten: readonly string[];
  readonly drift: readonly string[];
  readonly failures: readonly string[];
  readonly derivedCount: number;
}

interface CaseChunk {
  readonly key: string;
  readonly text: string;
}
function splitCases(text: string, closing: string): { readonly header: string; readonly chunks: readonly CaseChunk[] } {
  const starts = [...text.matchAll(/(?<=\{ |\n)case "/g)].map(match => match.index);
  const first = starts[0];
  if (first === undefined) throw new Error("no cases");
  const body = text.endsWith(closing) ? text.slice(0, -closing.length) : text;
  const chunks = starts.map((start, index) => {
    const chunk = body.slice(start, starts[index + 1] ?? body.length).replace(/\n$/, "");
    return { key: /^case "([^"]*)"/.exec(chunk)?.[1] ?? "", text: chunk };
  });
  return { header: text.slice(0, first), chunks };
}
/**
 * Cases keep the order they already have in the codec (new variants are appended, removed ones dropped), and kept cases
 * keep their hand-written text.
 */
function mergeCases(existing: string, derived: string, kept: readonly string[], closing: string): string {
  const old = splitCases(existing, closing);
  const next = splitCases(derived, closing);
  const rank = (key: string): number => {
    const index = old.chunks.findIndex(chunk => chunk.key === key);
    return index < 0 ? old.chunks.length : index;
  };
  const chunks = [...next.chunks]
    .map((chunk, index) => ({ chunk, index }))
    .sort((a, b) => rank(a.chunk.key) - rank(b.chunk.key) || a.index - b.index)
    .map(({ chunk }) => (kept.includes(chunk.key) ? (old.chunks.find(candidate => candidate.key === chunk.key)?.text ?? chunk.text) : chunk.text));
  return `${next.header}${chunks.join("\n")}${closing}`;
}

const spdx = "// SPDX-License-Identifier: GPL-2.0-or-later";

export function derive(input: string): Derivation {
  const source = input.startsWith(`${spdx}\n`) ? input : `${spdx}\n${input}`;
  const lines = source.split("\n");
  const readRegions = regions(lines, readHead);
  const writeRegions = regions(lines, writeHead);
  const declared = (head: RegExp): Set<string> =>
    new Set(
      lines.flatMap(line => {
        const match = head.exec(line);
        return match === null ? [] : [match[1] ?? ""];
      }),
    );
  const writes = declared(anyWrite);
  const names = new Set([...declared(anyRead)].filter(name => writes.has(name) && /\btype Event/.test(source) && source.includes(`type ${name} =`)));
  const config = ts.readConfigFile(`${root}tsconfig.json`, ts.sys.readFile);
  const tsconfigJson: unknown = config.config;
  const parsed = ts.parseJsonConfigFileContent(tsconfigJson, ts.sys, root);
  const host = ts.createCompilerHost(parsed.options);
  const defaultRead = host.readFile.bind(host);
  host.readFile = file => (file === codecPath ? source : defaultRead(file));
  const originalSource = host.getSourceFile.bind(host);
  host.getSourceFile = (file, options, onError) => (file === codecPath ? ts.createSourceFile(file, source, options) : originalSource(file, options, onError));
  const program = ts.createProgram([codecPath], parsed.options, host);
  const deriver = new Deriver(program.getTypeChecker(), program, codecPath, names);
  const replacements: { start: number; end: number; text: string }[] = [];
  const hand: string[] = [];
  const drift: string[] = [];
  const failures: string[] = [];
  let derivedCount = 0;
  for (const name of [...names].sort()) {
    const rule = handWritten[name];
    const read = readRegions.get(name);
    const write = writeRegions.get(name);
    if (rule !== undefined) {
      hand.push(name);
      const current = fingerprint(deriver.shape(name));
      if (current !== rule.shape)
        drift.push(`${name}: type shape changed (${rule.shape} -> ${current}); review the hand-written reader/writer (${rule.reason})`);
      continue;
    }
    if (read === undefined || write === undefined) {
      failures.push(`${name}: reader/writer is not in the generated form and is not listed in tools/event-codec-rules.ts`);
      continue;
    }
    try {
      let readText = deriver.readFunction(name);
      let writeText = deriver.writeFunction(name);
      const kept = keptCases[name] ?? {};
      if (readText.includes("switch (reader.field('kind').string())")) {
        const kinds = Object.keys(kept);
        readText = mergeCases(lines.slice(read.start, read.end).join("\n"), readText, kinds, tail);
        writeText = mergeCases(lines.slice(write.start, write.end).join("\n"), writeText, kinds, " } }");
        for (const [kind, rule] of Object.entries(kept)) {
          const current = fingerprint(deriver.caseShape(name, kind));
          if (current !== rule.shape)
            drift.push(`${name}/${kind}: variant shape changed (${rule.shape} -> ${current}); review the hand-written case (${rule.reason})`);
        }
      }
      replacements.push({ start: read.start, end: read.end, text: readText });
      replacements.push({ start: write.start, end: write.end, text: writeText });
      derivedCount += 1;
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  replacements.sort((a, b) => b.start - a.start);
  const next = [...lines];
  for (const edit of replacements) next.splice(edit.start, edit.end - edit.start, ...edit.text.split("\n"));
  return { deriver, output: next.join("\n"), handWritten: hand, drift, failures, derivedCount };
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const source = readFileSync(codecPath, "utf8");
  const result = derive(source);
  const asked = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
  if (process.argv.includes("--shapes")) {
    for (const spec of asked) {
      const [name = "", kind] = spec.split("/");
      process.stdout.write(`${spec} ${fingerprint(kind === undefined ? result.deriver.shape(name) : result.deriver.caseShape(name, kind))}\n`);
    }
    process.exit(0);
  }
  for (const message of [...result.drift, ...result.failures]) process.stderr.write(`${message}\n`);
  if (check) {
    if (result.output !== source || result.drift.length > 0 || result.failures.length > 0) {
      process.stderr.write("unified-event-codec.ts differs from the derived output; run bun tools/generate-event-codec.ts\n");
      process.exit(1);
    }
    process.stdout.write(`unified-event-codec.ts matches (${result.derivedCount} derived pairs, ${result.handWritten.length} hand-written)\n`);
  } else {
    if (result.output !== source) writeFileSync(codecPath, result.output);
    process.stdout.write(`${result.derivedCount} derived pairs, ${result.handWritten.length} hand-written\n`);
  }
}
