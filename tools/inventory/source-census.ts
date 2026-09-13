import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readlink, rename, rm } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import ts from "typescript";

export interface RepositorySpec {
  readonly id: string;
  readonly role: "implementation-candidate" | "original-reference";
  readonly path: string;
  readonly expectedRevision: string;
}

export interface SourceFunction {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly line: number;
  readonly endLine: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly hasBody: boolean;
}

export interface SourceFileRecord {
  readonly path: string;
  readonly tracking: "tracked" | "untracked";
  readonly kind: "runtime" | "test" | "tool" | "declaration" | "reference-code" | "document" | "configuration" | "other" | "symlink";
  readonly bytes: number;
  readonly sha256: string;
  readonly lineCount: number;
  readonly functions: readonly SourceFunction[];
}

export interface SourceRepository extends RepositorySpec {
  readonly revision: string;
  readonly sourceSetSha256: string;
  readonly submodules: readonly { readonly path: string; readonly revision: string; readonly repository: string }[];
  readonly files: readonly SourceFileRecord[];
}

export interface SourceManifest {
  readonly schemaVersion: 1;
  readonly generator: "tools/inventory/source-census.ts";
  readonly hashAlgorithm: "sha256";
  readonly functionInventory: {
    readonly parser: string;
    readonly includes: readonly string[];
    readonly limits: readonly string[];
  };
  readonly repositories: readonly SourceRepository[];
  readonly totals: {
    readonly repositories: number;
    readonly files: number;
    readonly untrackedFiles: number;
    readonly bytes: number;
    readonly typescriptFunctions: number;
  };
}

export const repositories: readonly RepositorySpec[] = [
  { id: "q1-ts", role: "implementation-candidate", path: "../quake-1-re-ts", expectedRevision: "6bc6a8bf29b66981e3b6ce7251ebbc6413120270" },
  { id: "q2-ts", role: "implementation-candidate", path: "../quake-2-re-ts", expectedRevision: "0d73750cbe5683c7411934d0a5d4eb5acd4da676" },
  { id: "q3-ts", role: "implementation-candidate", path: "../quake-3-ts", expectedRevision: "8453c49824eb7a5ed5aee452f74e19336965d1f8" },
  { id: "q1-original", role: "original-reference", path: "../qsrc/quake", expectedRevision: "bf4ac424ce754894ac8f1dae6a3981954bc9852d" },
  { id: "q1-rerelease-qc", role: "original-reference", path: "../qsrc/quake-rerelease-qc", expectedRevision: "634eefab09a77eb7b5f5ca7078ba3d8784a91142" },
  { id: "q1-ironwail", role: "original-reference", path: "../qsrc/ironwail", expectedRevision: "faeda400e3aeee6ec7da5e36c036653e0d201f94" },
  { id: "q2-lmctf-original", role: "original-reference", path: "../qsrc/lmctf60", expectedRevision: "c518031380d2b59a41667c164353033aaa309e90" },
  { id: "q2-original", role: "original-reference", path: "../qsrc/quake-2", expectedRevision: "372afde46e7defc9dd2d719a1732b8ace1fa096e" },
  { id: "q2-rerelease-game", role: "original-reference", path: "../qsrc/quake2-rerelease-dll", expectedRevision: "8dc1fc9794c01ece06881e703851b768fb3994de" },
  { id: "q2-repro", role: "original-reference", path: "../qsrc/q2repro", expectedRevision: "dafa004c6f0a3218f426dc661412ffdc1ed2a523" },
  { id: "q2-proto", role: "original-reference", path: "../qsrc/q2repro/q2proto", expectedRevision: "a4f2c507c1f78c50bfabdad18e2715ed172a8210" },
  { id: "q2-repro-game", role: "original-reference", path: "../qsrc/q2repro/subprojects/rerelease-game", expectedRevision: "e4e233a5f38bd0a7c2c143916723386051241091" },
  { id: "q3-original", role: "original-reference", path: "../qsrc/quake-iii-arena", expectedRevision: "dbe4ddb10315479fc00086f08e25d968b4b43c49" },
];

export function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function git(root: string, args: readonly string[]): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`Git failed in ${root}: ${new TextDecoder().decode(result.stderr).trim()}`);
  return new TextDecoder().decode(result.stdout);
}

export function safeRelativePath(path: string): string {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === ".." || part === "." || part.length === 0)) {
    throw new Error(`Invalid repository-relative path: ${path}`);
  }
  return path;
}

function classifyFile(path: string, role: RepositorySpec["role"]): SourceFileRecord["kind"] {
  if (path.endsWith(".d.ts")) return "declaration";
  if (/\.(?:ts|tsx)$/u.test(path)) {
    if (/(?:^|\/)(?:tests?|__tests__)(?:\/|\.)|\.(?:test|spec)\.[^.]+$/u.test(path)) return "test";
    return path.startsWith("src/") ? "runtime" : "tool";
  }
  if (role === "original-reference" && /\.(?:c|h|cc|cpp|cxx|hpp|qc|asm|s)$/iu.test(path)) return "reference-code";
  if (/\.(?:md|rst|txt)$/iu.test(path) || /(?:^|\/)(?:LICENSE|COPYING|NOTICE|README)(?:\.|$)/u.test(path)) return "document";
  if (/\.(?:json|jsonc|yaml|yml|toml|ini|cfg|lock)$/iu.test(path) || path.startsWith(".")) return "configuration";
  return "other";
}

function inferredName(node: ts.Node): string {
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name !== undefined) return node.name.text;
  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) return node.name.getText();
  if (ts.isConstructorDeclaration(node)) return "constructor";
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent)) return parent.name.getText();
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) return parent.left.getText();
  if (ts.isCallExpression(parent)) return `${parent.expression.getText().slice(0, 120)} callback`;
  return "anonymous";
}

export function enumerateFunctions(repository: string, path: string, source: string, inspect?: (node: ts.Node, sourceFile: ts.SourceFile) => void): SourceFunction[] {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: SourceFunction[] = [];
  function visit(node: ts.Node): void {
    inspect?.(node, sourceFile);
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
      || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isConstructorDeclaration(node)) {
      const startOffset = node.getStart(sourceFile);
      const endOffset = node.getEnd();
      found.push({
        id: `${repository}:${path}#${startOffset}`,
        name: inferredName(node),
        kind: ts.SyntaxKind[node.kind] ?? "UnknownFunctionKind",
        line: sourceFile.getLineAndCharacterOfPosition(startOffset).line + 1,
        endLine: sourceFile.getLineAndCharacterOfPosition(Math.max(startOffset, endOffset - 1)).line + 1,
        startOffset,
        endOffset,
        hasBody: node.body !== undefined,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

async function captureRepository(spec: RepositorySpec, projectRoot: string): Promise<SourceRepository> {
  const repositoryRoot = resolve(projectRoot, spec.path);
  const revision = git(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  if (revision !== spec.expectedRevision) throw new Error(`${spec.id}: HEAD ${revision} differs from reviewed revision ${spec.expectedRevision}`);
  const trackedChanges = git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=no"]);
  if (trackedChanges.length > 0) throw new Error(`${spec.id}: tracked source files changed; review and repin before generating the census`);
  const tracked = new Set(git(repositoryRoot, ["ls-files", "--cached", "-z"]).split("\0").filter((path) => path.length > 0));
  const submodules: { readonly path: string; readonly revision: string; readonly repository: string }[] = [];
  for (const entry of git(repositoryRoot, ["ls-files", "--stage", "-z"]).split("\0")) {
    if (!entry.startsWith("160000 ")) continue;
    const tab = entry.indexOf("\t");
    const metadata = entry.slice(0, tab).split(" ");
    const submoduleRevision = metadata[1];
    const path = safeRelativePath(entry.slice(tab + 1));
    const child = repositories.find((candidate) => resolve(projectRoot, candidate.path) === resolve(repositoryRoot, path));
    if (child === undefined || child.expectedRevision !== submoduleRevision) throw new Error(`${spec.id}:${path} needs an explicitly pinned submodule source`);
    submodules.push({ path, revision: child.expectedRevision, repository: child.id });
    tracked.delete(path);
  }
  const untracked = git(repositoryRoot, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter((path) => path.length > 0);
  const paths = [...new Set([...tracked, ...untracked])].sort(compareText);
  const files: SourceFileRecord[] = [];
  for (const path of paths) {
    safeRelativePath(path);
    const fullPath = resolve(repositoryRoot, path);
    const stat = await lstat(fullPath);
    if (stat.isSymbolicLink()) {
      const target = await readlink(fullPath);
      files.push({ path, tracking: tracked.has(path) ? "tracked" : "untracked", kind: "symlink", bytes: Buffer.byteLength(target), sha256: sha256(target), lineCount: 0, functions: [] });
      continue;
    }
    if (!stat.isFile()) throw new Error(`${spec.id}:${path} is not a regular source file`);
    const bytes = await readFile(fullPath);
    const kind = classifyFile(path, spec.role);
    const source = bytes.toString("utf8");
    const isTypescript = extname(path) === ".ts" || extname(path) === ".tsx";
    files.push({
      path,
      tracking: tracked.has(path) ? "tracked" : "untracked",
      kind,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      lineCount: source.split("\n").length,
      functions: isTypescript ? enumerateFunctions(spec.id, path, source) : [],
    });
  }
  if (git(repositoryRoot, ["rev-parse", "HEAD"]).trim() !== revision || git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=no"]).length > 0) {
    throw new Error(`${spec.id}: source changed during the census`);
  }
  const sourceSetSha256 = sha256(JSON.stringify({ revision, submodules, files: files.map((file) => ({ path: file.path, tracking: file.tracking, sha256: file.sha256 })) }));
  return { ...spec, revision, sourceSetSha256, submodules, files };
}

export async function buildSourceManifest(projectRoot: string): Promise<SourceManifest> {
  const captured: SourceRepository[] = [];
  for (const spec of repositories) captured.push(await captureRepository(spec, projectRoot));
  const files = captured.flatMap((repository) => repository.files);
  return {
    schemaVersion: 1,
    generator: "tools/inventory/source-census.ts",
    hashAlgorithm: "sha256",
    functionInventory: {
      parser: `typescript@${ts.version}`,
      includes: ["Every tracked file and non-ignored untracked file in the listed source checkouts is hashed.", "TypeScript function declarations, expressions, arrows, methods, accessors and constructors retain source locations and body presence.", "Tests, tools, declarations and runtime functions remain distinct; nested callbacks remain separate records."],
      limits: ["File hashing proves input identity, not behavior or completed implementation.", "Original C, C++, QuakeC and assembly are pinned as files; their functions are not parsed by the TypeScript compiler.", "Function IDs use offsets within the pinned file and change when source moves.", "Ignored worktree files, Git metadata and external commercial content are outside this source census. Product fixtures have a separate manifest."],
    },
    repositories: captured,
    totals: {
      repositories: captured.length,
      files: files.length,
      untrackedFiles: files.filter((file) => file.tracking === "untracked").length,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      typescriptFunctions: files.reduce((sum, file) => sum + file.functions.length, 0),
    },
  };
}

export interface InventoryArguments {
  readonly root: string;
  readonly check: boolean;
}

export function inventoryArguments(args: readonly string[]): InventoryArguments {
  let root = resolve(import.meta.dir, "../..");
  let check = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check") check = true;
    else if (argument === "--root") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("--root requires a project directory");
      root = resolve(value);
      index += 1;
    } else throw new Error(`Unknown argument: ${argument ?? "missing"}`);
  }
  return { root, check };
}

export async function writeOrCheck(path: string, value: unknown, check: boolean): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (check) {
    if (await readFile(path, "utf8") !== text) throw new Error(`Generated inventory differs: ${path}`);
  } else {
    await mkdir(dirname(path), { recursive: true });
    const temporary = await mkdtemp(join(dirname(path), ".inventory-"));
    try {
      const staged = join(temporary, "manifest.json");
      await Bun.write(staged, text);
      await rename(staged, path);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

if (import.meta.main) {
  try {
    const options = inventoryArguments(process.argv.slice(2));
    const manifest = await buildSourceManifest(options.root);
    const output = resolve(options.root, "verification/source-manifest.json");
    await writeOrCheck(output, manifest, options.check);
    process.stdout.write(`${options.check ? "Verified" : "Wrote"} ${relative(options.root, output)}: ${manifest.totals.repositories} repositories, ${manifest.totals.files} files, ${manifest.totals.typescriptFunctions} TypeScript functions.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
