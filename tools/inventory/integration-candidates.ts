import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import ts from "typescript";
import { enumerateFunctions, sha256 } from "./source-census.ts";

const baseline = "3dc9ca6ca404dc4522ab9e9669fff458805b0993";
const donors = { q1: "quake-1-re-ts", q2: "quake-2-re-ts", q3: "quake-3-ts" };
type Game = keyof typeof donors;
interface Declaration {
  id: string; path: string; name: string; kind: string; line: number; endLine: number;
  startOffset: number; endOffset: number; signature: string; signatureTokenHash: string;
  bodyTokenHash: string | null; enclosing: string[]; exports: string[]; evidenceIds: string[];
}
interface FileRecord {
  path: string; sha256: string; bytes: number; kind: string; imports: string[];
  declarations: Declaration[]; censusFunctions: number; diagnostics: string[]; skipped: string | null;
}
interface Anchor { id: string; repository: string; path: string; line: number; endLine: number }
function git(root: string, args: string[]): Buffer {
  const result = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
  return Buffer.from(result.stdout);
}
function tokenHash(source: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
  const tokens: [number, string][] = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) tokens.push([token, scanner.getTokenText()]);
  return sha256(JSON.stringify(tokens));
}
function functionNode(node: ts.Node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
    || ts.isConstructorDeclaration(node) || ts.isMethodSignature(node) || ts.isCallSignatureDeclaration(node)
    || ts.isConstructSignatureDeclaration(node) || ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node);
}
function namedNode(node: ts.Node) {
  return ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isEnumMember(node)
    || ts.isModuleDeclaration(node) || ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)
    || ts.isPropertySignature(node) || ts.isParameter(node) || ts.isTypeParameterDeclaration(node)
    || ts.isImportClause(node) || ts.isImportSpecifier(node) || ts.isNamespaceImport(node)
    || ts.isExportSpecifier(node) || ts.isBindingElement(node);
}
function nodeName(node: ts.Node): string {
  if (ts.isConstructorDeclaration(node) || ts.isConstructSignatureDeclaration(node) || ts.isConstructorTypeNode(node)) return "constructor";
  if (ts.isCallSignatureDeclaration(node)) return "call";
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isModuleDeclaration(node)) && node.name !== undefined) return node.name.getText();
  if (namedNode(node) && node.name !== undefined) return node.name.getText();
  const parent = node.parent;
  if (parent !== undefined && (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isTypeAliasDeclaration(parent))) return parent.name.getText();
  if (parent !== undefined && ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) return parent.left.getText();
  if (parent !== undefined && ts.isCallExpression(parent)) return `${parent.expression.getText()} callback`;
  return "anonymous";
}
function unknownArray(value: unknown): value is unknown[] { return Array.isArray(value); }
function anchors(root: string) {
  const result: Anchor[] = [];
  const rejected: { featureId: string; evidence: unknown; reason: string }[] = [];
  for (const game of Object.keys(donors)) {
    const value: unknown = JSON.parse(git(root, ["show", `${baseline}:verification/features/${game}.json`]).toString("utf8"));
    if (typeof value !== "object" || value === null || !("features" in value) || !unknownArray(value.features)) throw new Error("Invalid feature inventory");
    for (const feature of value.features) {
      if (typeof feature !== "object" || feature === null || !("id" in feature) || typeof feature.id !== "string" || !("evidence" in feature) || !unknownArray(feature.evidence)) throw new Error("Invalid feature");
      for (const evidence of feature.evidence) {
        if (typeof evidence !== "object" || evidence === null || !("repository" in evidence) || typeof evidence.repository !== "string" || !("path" in evidence) || typeof evidence.path !== "string" || !("line" in evidence) || typeof evidence.line !== "number" || !("endLine" in evidence) || typeof evidence.endLine !== "number") { rejected.push({ featureId: feature.id, evidence, reason: "Not a numeric source-location anchor" }); continue; }
        result.push({ id: feature.id, repository: evidence.repository, path: evidence.path, line: evidence.line, endLine: evidence.endLine });
      }
    }
  }
  return { accepted: result, rejected };
}
function capture(root: string, id: string, revision: string, evidence: Anchor[]) {
  const entries = git(root, ["ls-tree", "-r", "-z", revision]).toString("utf8").split("\0").filter(Boolean);
  const files: FileRecord[] = [];
  for (const entry of entries) {
    const tab = entry.indexOf("\t");
    const path = entry.slice(tab + 1);
    if (!/\.(?:ts|tsx|mts|cts)$/u.test(path)) continue;
    const bytes = git(root, ["show", `${revision}:${path}`]);
    const source = bytes.toString("utf8");
    const file: FileRecord = { path, sha256: sha256(bytes), bytes: bytes.length,
      kind: /\.d\.(?:ts|mts|cts)$/u.test(path) ? "declaration" : /(?:^|\/)(?:tests?|__tests__)(?:\/|\.)|\.(?:test|spec)\./u.test(path) ? "test" : path.startsWith("src/") ? "runtime" : "tool",
      imports: [], declarations: [], censusFunctions: 0, diagnostics: [], skipped: entry.startsWith("120000 ") ? "symlink Git blob is a link target, not TypeScript source" : null };
    files.push(file);
    if (file.skipped !== null) continue;
    const census = enumerateFunctions(id, path, source, (node, sourceFile) => {
      if (ts.isSourceFile(node)) {
        const host = ts.createCompilerHost({ noLib: true });
        host.getSourceFile = (name) => name === path ? sourceFile : undefined;
        const program = ts.createProgram([path], { noLib: true }, host);
        file.diagnostics = program.getSyntacticDiagnostics(sourceFile).map((diagnostic) => `${diagnostic.start ?? 0}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`);
      }
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier !== undefined) file.imports.push(node.moduleSpecifier.getText(sourceFile));
      }
      if (!functionNode(node) && !namedNode(node)) return;
      const startOffset = node.getStart(sourceFile);
      const endOffset = node.getEnd();
      const body = "body" in node ? node.body : undefined;
      const signatureEnd = body !== undefined ? body.getStart(sourceFile)
        : ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node) ? node.members.pos
        : "initializer" in node && node.initializer !== undefined ? node.initializer.getStart(sourceFile)
        : endOffset;
      const signature = source.slice(startOffset, signatureEnd).trim();
      const enclosing: string[] = [];
      const exports: string[] = [];
      for (let parent: ts.Node | undefined = node; parent !== undefined && !ts.isSourceFile(parent); parent = parent.parent) {
        if (parent !== node && (ts.isClassDeclaration(parent) || ts.isClassExpression(parent) || ts.isModuleDeclaration(parent) || functionNode(parent))) enclosing.unshift(nodeName(parent));
        if (ts.canHaveModifiers(parent)) for (const modifier of ts.getModifiers(parent) ?? []) if (modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword) exports.push(modifier.getText(sourceFile));
      }
      const line = sourceFile.getLineAndCharacterOfPosition(startOffset).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(endOffset - 1).line + 1;
      file.declarations.push({ id: `${id}:${path}#${startOffset}:${endOffset}:${ts.SyntaxKind[node.kind]}`, path, name: nodeName(node), kind: ts.SyntaxKind[node.kind] ?? "Unknown", line, endLine, startOffset, endOffset, signature, signatureTokenHash: tokenHash(signature), bodyTokenHash: body === undefined ? null : tokenHash(body.getText(sourceFile)), enclosing, exports, evidenceIds: evidence.filter((anchor) => anchor.repository === id && anchor.path === path && anchor.line <= endLine && anchor.endLine >= line).map((anchor) => anchor.id) });
    });
    if (new Set(file.declarations.map((declaration) => declaration.id)).size !== file.declarations.length) throw new Error(`Duplicate declaration IDs in ${id}:${path}`);
    file.censusFunctions = census.length;
    for (const declaration of census) if (!file.declarations.some((candidate) => candidate.startOffset === declaration.startOffset)) throw new Error(`Lost census declaration ${declaration.id}`);
  }
  return { id, root, revision, sourceSetSha256: sha256(JSON.stringify(files.map((file) => ({ path: file.path, sha256: file.sha256 })))), files };
}
function options() {
  let game: Game = "q1";
  let out = "/tmp/quake-integration-q1";
  let donorRevision = "HEAD";
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]; const value = args[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${key}`);
    if (key === "--game" && (value === "q1" || value === "q2" || value === "q3")) game = value;
    else if (key === "--out") out = resolve(value);
    else if (key === "--donor-revision") donorRevision = value;
    else throw new Error(`Unknown argument ${key} ${value}`);
  }
  return { game, out, donorRevision };
}
async function main(): Promise<void> {
  const { game, out, donorRevision } = options();
  const root = resolve(import.meta.dir, "../..");
  const donorRoot = resolve(root, "..", donors[game]);
  const anchorInventory = anchors(root);
  const evidence = anchorInventory.accepted;
  const donor = capture(donorRoot, `${game}-ts`, git(donorRoot, ["rev-parse", `${donorRevision}^{commit}`]).toString("utf8").trim(), evidence);
  const unified = capture(root, "unified", baseline, evidence);
  const indexes = new Map<string, string[]>();
  for (const file of unified.files) for (const declaration of file.declarations) {
    const keys = [`name:${declaration.name}`, `signature:${declaration.signatureTokenHash}`, ...(declaration.bodyTokenHash === null ? [] : [`body:${declaration.bodyTokenHash}`]), `path-basename:${basename(file.path)}`, ...file.imports.map((specifier) => `import-specifier:${specifier}`)];
    for (const key of new Set(keys)) {
      const values = indexes.get(key) ?? []; values.push(declaration.id); indexes.set(key, values);
    }
  }
  const candidates = donor.files.flatMap((file) => file.declarations.map((declaration) => {
    const keys = [`name:${declaration.name}`, `signature:${declaration.signatureTokenHash}`, ...(declaration.bodyTokenHash === null ? [] : [`body:${declaration.bodyTokenHash}`]), `path-basename:${basename(file.path)}`, ...file.imports.map((specifier) => `import-specifier:${specifier}`)];
    const groupIds = [...new Set(keys)].filter((key) => indexes.has(key));
    const witnesses = new Set<string>();
    for (const key of groupIds) {
      for (const id of indexes.get(key) ?? []) { witnesses.add(id); if (witnesses.size > 1) break; }
      if (witnesses.size > 1) break;
    }
    return { donorId: declaration.id, status: witnesses.size === 0 ? "unmatched" : witnesses.size === 1 ? "single-candidate" : "ambiguous", groupIds };
  }));
  const summary = {
    game, donorRevision: donor.revision, unifiedRevision: baseline,
    limits: ["All matches are review candidates, never behavioral verdicts.", "Current worktree and post-baseline integration are outside this snapshot.", "Export modifiers are lexical; re-export resolution is not attempted.", "Signatures retain written syntax; inferred return/parameter types are not synthesized.", "Import and basename matches are intentionally broad hints. All are retained."],
    repositories: [donor, unified].map((repo) => ({ id: repo.id, revision: repo.revision, sourceSetSha256: repo.sourceSetSha256, files: repo.files.length, declarations: repo.files.reduce((sum, file) => sum + file.declarations.length, 0), censusFunctions: repo.files.reduce((sum, file) => sum + file.censusFunctions, 0), unanchored: repo.files.flatMap((file) => file.declarations).filter((declaration) => declaration.evidenceIds.length === 0).length, classifications: Object.fromEntries(["runtime", "test", "tool", "declaration"].map((kind) => [kind, repo.files.filter((file) => file.kind === kind).length])), unparseable: repo.files.filter((file) => file.diagnostics.length > 0).map((file) => ({ path: file.path, diagnostics: file.diagnostics })), skipped: repo.files.filter((file) => file.skipped !== null).map((file) => ({ path: file.path, reason: file.skipped })) })),
    statuses: Object.fromEntries(["unmatched", "single-candidate", "ambiguous"].map((status) => [status, candidates.filter((candidate) => candidate.status === status).length])),
  };
  const featureInventories = Object.keys(donors).map((family) => {
    const path = `verification/features/${family}.json`;
    const bytes = git(root, ["show", `${baseline}:${path}`]);
    const inventory: unknown = JSON.parse(bytes.toString("utf8"));
    if (typeof inventory !== "object" || inventory === null || !("features" in inventory) || !unknownArray(inventory.features)) throw new Error("Invalid feature inventory");
    return { path, sha256: sha256(bytes), inventory, joins: inventory.features.map((feature: unknown) => {
      if (typeof feature !== "object" || feature === null || !("id" in feature) || typeof feature.id !== "string") throw new Error("Invalid feature ID");
      const id = feature.id;
      return { id, declarationIds: [donor, unified].flatMap((repo) => repo.files.flatMap((file) => file.declarations.filter((declaration) => declaration.evidenceIds.includes(id)).map((declaration) => declaration.id))) };
    }) };
  });
  const completionBytes = git(root, ["show", `${baseline}:docs/completion-status.json`]);
  const historicalCompletion: unknown = JSON.parse(completionBytes.toString("utf8"));
  await mkdir(out, { recursive: true });
  await Bun.write(resolve(out, "anchor-inventory.json"), JSON.stringify(anchorInventory));
  await Bun.write(resolve(out, "historical-completion.json"), JSON.stringify({ capturedAtRevision: baseline, path: "docs/completion-status.json", sha256: sha256(completionBytes), note: "Historical verdicts retain their own sourceCutoff; not current candidate conclusions.", inventory: historicalCompletion }));
  await Bun.write(resolve(out, "feature-join.json"), JSON.stringify({ revision: baseline, inventories: featureInventories }));
  await Bun.write(resolve(out, "inventory.json"), JSON.stringify({ schemaVersion: 1, parser: ts.version, repositories: [donor, unified] }));
  await Bun.write(resolve(out, "candidates.json"), JSON.stringify({ groups: Object.fromEntries(indexes), candidates }));
  await Bun.write(resolve(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
if (import.meta.main) await main();
