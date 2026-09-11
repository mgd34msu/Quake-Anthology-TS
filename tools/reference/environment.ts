import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, readlink, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repositories } from "../inventory/source-census.ts";
import type { RepositorySpec } from "../inventory/source-census.ts";
import { isCorpusBinaryCandidate, observeSteam, steamTitleForPath } from "./steam.ts";
import type {
  BinaryObservation,
  CommandObservation,
  FileIdentity,
  PathObservation,
  ReadObservation,
  ReferenceEnvironment,
  SourceIdentity,
  ToolObservation,
} from "./schema.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const projectsRoot = dirname(projectRoot);
const sourceRoot = join(projectsRoot, "qsrc");
const corpusRoot = join(projectsRoot, "qfiles");

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function identifyFile(path: string): Promise<FileIdentity> {
  const absolute = await realpath(path);
  const before = await stat(absolute);
  if (!before.isFile()) throw new Error(`Expected a regular file: ${absolute}`);
  const hash = createHash("sha256");
  const reader = Bun.file(absolute).stream().getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      hash.update(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const after = await stat(absolute);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) {
    throw new Error(`Input changed during capture: ${absolute}`);
  }
  return { path: absolute, size: after.size, sha256: hash.digest("hex") };
}

export async function observeCommand(
  command: readonly [string, ...string[]],
  cwd: string,
  timeoutMs = 15_000,
): Promise<CommandObservation> {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const environment = { LC_ALL: "C" };
  const child = Bun.spawn([...command], {
    cwd,
    env: { ...process.env, ...environment },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return {
      command,
      cwd,
      environment,
      startedAt,
      durationMs: performance.now() - start,
      outcome: timedOut ? { kind: "timed-out", timeoutMs } : { kind: "exited", exitCode },
      stdout,
      stderr,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function successfulOutput(observation: CommandObservation): string {
  if (observation.outcome.kind !== "exited" || observation.outcome.exitCode !== 0) {
    throw new Error(`Command failed: ${observation.command.join(" ")}: ${observation.stderr}`);
  }
  return observation.stdout;
}

async function observePath(path: string): Promise<PathObservation> {
  const details = await lstat(path).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (details === null) return { kind: "deleted", path };
  if (details.isSymbolicLink()) return { kind: "symlink", path, target: await readlink(path) };
  if (details.isDirectory()) return { kind: "directory", path };
  return { kind: "file", identity: await identifyFile(path) };
}

async function identifySource(repository: RepositorySpec): Promise<SourceIdentity> {
  const path = resolve(projectRoot, repository.path);
  const observations = await Promise.all([
    observeCommand(["git", "rev-parse", "HEAD"], path),
    observeCommand(["git", "rev-parse", "HEAD^{tree}"], path),
    observeCommand(["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"], path),
    observeCommand(["git", "diff", "--name-only", "-z", "HEAD"], path),
    observeCommand(["git", "ls-files", "--others", "--exclude-standard", "-z"], path),
  ]);
  const [head, tree, status, changed, untracked] = observations;
  if (head === undefined || tree === undefined || status === undefined || changed === undefined || untracked === undefined) {
    throw new Error("Incomplete source identity probes");
  }
  const changedPaths = new Set([
    ...successfulOutput(changed).split("\0").filter(Boolean),
    ...successfulOutput(untracked).split("\0").filter(Boolean),
  ]);
  const changes: PathObservation[] = [];
  for (const relative of [...changedPaths].sort()) changes.push(await observePath(join(path, relative)));
  const finalStatus = await observeCommand(["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"], path);
  if (successfulOutput(finalStatus) !== successfulOutput(status)) throw new Error(`Source state changed: ${path}`);
  if (successfulOutput(head).trim() !== repository.expectedRevision) throw new Error(`Source revision differs from census: ${path}`);
  return {
    sourceId: repository.id,
    path,
    role: repository.role === "original-reference" ? "original-source" : "typescript-donor",
    expectedHead: repository.expectedRevision,
    head: successfulOutput(head).trim(),
    tree: successfulOutput(tree).trim(),
    state: successfulOutput(status).length === 0 ? "clean" : "modified",
    changes,
    observations: [...observations, finalStatus],
  };
}

async function observeTool(name: string, argumentsList: readonly (readonly string[])[]): Promise<ToolObservation> {
  const path = Bun.which(name);
  if (path === null) return { kind: "unavailable", name };
  const observations: CommandObservation[] = [];
  for (const args of argumentsList) observations.push(await observeCommand([path, ...args], projectRoot));
  return { kind: "available", name, executable: await identifyFile(path), observations };
}

async function readSystem(path: string): Promise<ReadObservation> {
  try {
    const text = await readFile(path, "utf8");
    return { path, value: { kind: "read", text, sha256: createHash("sha256").update(text).digest("hex") } };
  } catch (error) {
    return { path, value: { kind: "unavailable", reason: errorText(error) } };
  }
}

async function discoverBinaries(roots: readonly string[]): Promise<{ binaries: BinaryObservation[]; errors: string[] }> {
  const binaries: BinaryObservation[] = [];
  const errors: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        const inSourceTree = path.startsWith(`${sourceRoot}/`);
        if (!inSourceTree && !isCorpusBinaryCandidate(entry.name)) continue;
        const details = await stat(path);
        const executablePermission = (details.mode & 0o111) !== 0;
        if (!executablePermission && !isCorpusBinaryCandidate(entry.name)) continue;
        const bytes = new Uint8Array(await Bun.file(path).slice(0, 64).arrayBuffer());
        const format = bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46
          ? "elf"
          : bytes[0] === 0x4d && bytes[1] === 0x5a ? await mzFormat(path, bytes) : null;
        if (format === null) continue;
        const purpose = entry.name === "q1rets" || entry.name === "quake3-ts"
          ? "typescript-donor-executable"
          : path.startsWith(`${sourceRoot}/`)
            ? "source-tree-binary"
            : /^(?:winquake|glquake|(?:gl)?qwcl|quake.*)\.exe$/i.test(entry.name)
              ? format === "dos-mz" ? "retail-dos-engine" : "retail-windows-engine"
              : "other-corpus-binary";
        binaries.push({
          identity: await identifyFile(path),
          format,
          purpose,
          executablePermission,
          provenance: binaryProvenance(path),
          header: await observeCommand(["file", "--brief", path], projectRoot),
          execution: {
            kind: "not-run",
            reason: purpose === "typescript-donor-executable"
              ? "A compiled TypeScript donor is not an independent original-engine reference."
              : "Discovery establishes file presence and identity only; execution needs a reviewed workload and isolated output/display.",
          },
        });
      }
    }
  }
  for (const root of roots) {
    try {
      await visit(root);
    } catch (error) {
      errors.push(`${root}: ${errorText(error)}`);
    }
  }
  return { binaries, errors };
}

function binaryProvenance(path: string): BinaryObservation["provenance"] {
  const title = steamTitleForPath(path);
  if (title !== undefined) {
    return {
      kind: "steam-installation",
      installationPath: title.path,
      family: title.family,
      edition: path.startsWith(`${title.path}/rerelease/`) ? "rerelease" : "classic",
    };
  }
  return { kind: path.startsWith(`${sourceRoot}/`) ? "source-tree" : "supplied-corpus" };
}

async function mzFormat(path: string, header: Uint8Array): Promise<"pe" | "dos-mz"> {
  if (header.length < 64) return "dos-mz";
  const offset = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(0x3c, true);
  const signature = new Uint8Array(await Bun.file(path).slice(offset, offset + 4).arrayBuffer());
  return signature[0] === 0x50 && signature[1] === 0x45 && signature[2] === 0 && signature[3] === 0 ? "pe" : "dos-mz";
}

async function systemFiles(): Promise<ReadObservation[]> {
  const paths = [
    "/etc/os-release", "/proc/sys/kernel/osrelease", "/proc/cpuinfo", "/proc/meminfo",
    "/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor",
    "/sys/devices/system/cpu/intel_pstate/status", "/sys/firmware/acpi/platform_profile",
  ];
  for (const root of ["/sys/class/thermal", "/sys/class/drm"]) {
    try {
      for (const name of await readdir(root)) {
        if (name.startsWith("thermal_zone")) {
          paths.push(join(root, name, "type"), join(root, name, "temp"));
        } else if (/^card\d+-/.test(name)) {
          paths.push(join(root, name, "status"), join(root, name, "modes"));
        }
      }
    } catch {
      paths.push(root);
    }
  }
  return Promise.all(paths.map(readSystem));
}

async function identifyAvailableLibraries(tools: readonly ToolObservation[]): Promise<FileIdentity[]> {
  const ldconfig = tools.find((tool) => tool.name === "ldconfig");
  if (ldconfig === undefined || ldconfig.kind === "unavailable") return [];
  const paths = new Set<string>();
  for (const observation of ldconfig.observations) {
    if (observation.outcome.kind !== "exited" || observation.outcome.exitCode !== 0) continue;
    for (const line of observation.stdout.split("\n")) {
      if (!/^\s+lib(?:SDL2-2\.0|GL|GLX|GLX_nvidia|OpenGL|EGL|vorbisfile|vorbis|ogg|freetype|c|m|stdc\+\+)\.so/.test(line)) continue;
      const path = line.split(" => ")[1]?.trim();
      if (path !== undefined) paths.add(await realpath(path));
    }
  }
  return Promise.all([...paths].sort().map(identifyFile));
}

export async function captureEnvironment(): Promise<ReferenceEnvironment> {
  const steam = await observeSteam(identifyFile, observeCommand, projectRoot);
  const roots = [sourceRoot, corpusRoot, ...steam.titles.filter((title) => title.availability.kind === "present").map((title) => title.path)];
  const [sources, tools, system, discovery] = await Promise.all([
    Promise.all(repositories.map(identifySource)),
    Promise.all([
      observeTool("bun", [["--version"]]),
      observeTool("git", [["--version"]]),
      observeTool("file", [["--version"]]),
      observeTool("lscpu", [[]]),
      observeTool("ldconfig", [["-p"]]),
      observeTool("nvidia-smi", [["--query-gpu=name,driver_version,memory.total,pstate,temperature.gpu,power.draw,power.limit", "--format=csv,noheader"]]),
      observeTool("Xvfb", []),
      observeTool("xvfb-run", []),
      observeTool("glxinfo", []),
      observeTool("eglinfo", []),
      observeTool("vulkaninfo", []),
      observeTool("wine", [["--version"]]),
      observeTool("wine64", [["--version"]]),
      ...["quake", "quake2", "quake3", "quakespasm", "vkquake", "ioquake3", "q2pro", "yamagi-quake2", "q2ded", "q3ded"]
        .map((name) => observeTool(name, [])),
    ]),
    systemFiles(),
    discoverBinaries(roots),
  ]);
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    command: [process.execPath, "tools/reference/environment.ts"],
    runtime: await identifyFile(process.execPath),
    platform: process.platform,
    architecture: process.arch,
    bunVersion: Bun.version,
    locale: "C",
    identityHashAlgorithm: "sha256",
    captureProgram: await Promise.all([
      identifyFile(fileURLToPath(import.meta.url)),
      identifyFile(join(projectRoot, "tools/reference/schema.ts")),
      identifyFile(join(projectRoot, "tools/reference/steam.ts")),
    ]),
    sourceCensus: {
      definition: await identifyFile(join(projectRoot, "tools/inventory/source-census.ts")),
      manifest: await Bun.file(join(projectRoot, "verification/source-manifest.json")).exists()
        ? await identifyFile(join(projectRoot, "verification/source-manifest.json"))
        : null,
    },
    sources,
    tools,
    availableLibraryFiles: await identifyAvailableLibraries(tools),
    system,
    binaries: discovery.binaries,
    steam,
    discovery: {
      roots,
      method: "In source trees, inspect regular executable-permission files and .exe files for ELF/MZ headers. In qfiles and the three selected Steam titles, inspect only .exe/.dll/.so names and known donor executables, excluding account/config/data files before opening them. Skip .git and node_modules and do not follow directory symlinks. Runtime inventory hashes a fixed set of Proton launch files and reads only runtime version metadata; unrelated Steam titles and account state are excluded. PATH probes are explicitly listed in tools.",
      errors: discovery.errors,
    },
    limits: [
      "This capture inventories availability and hardware. It does not execute gameplay or establish rendering, wire, image-tolerance, or performance acceptance.",
      "Git commits and tree IDs identify tracked source content; all changed and untracked paths exposed by Git are separately SHA-256 identified. Ignored source files are not included.",
      "CPU frequencies, memory, thermal and GPU power readings are capture-time observations. They do not establish controlled benchmark conditions.",
      "availableLibraryFiles identifies selected ldconfig candidates, including installed architectures. These are available libraries, not proof of which libraries a future reference process actually loads.",
      "DRM connector modes are advertised modes; no desktop display was queried or changed and no active reference viewport is claimed.",
      "Binary discovery is limited to the recorded roots and PATH names. An undiscovered executable elsewhere may exist.",
      "Steam installation metadata records family/edition associations, not vendor authenticity. Runtime availability and wine --version success do not establish a working game launch.",
      "Retail data stays external. This environment manifest contains executable identities; each behavioral capture must separately identify its actual archive entries and selected mount order.",
    ],
  };
}

async function main(): Promise<void> {
  if (process.argv.length > 2) throw new Error("Usage: bun tools/reference/environment.ts");
  const environment = await captureEnvironment();
  const destination = join(projectRoot, "verification/reference-environment.json");
  await mkdir(dirname(destination), { recursive: true });
  await Bun.write(destination, `${JSON.stringify(environment, null, 2)}\n`);
  process.stdout.write(`${destination}\n${environment.sources.length} source trees; ${environment.binaries.length} candidate binaries; ${environment.discovery.errors.length} discovery errors\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${errorText(error)}\n`);
    process.exitCode = 1;
  });
}
