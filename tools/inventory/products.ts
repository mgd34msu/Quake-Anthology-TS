import { closeSync, fstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, extname, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { constants, inflateRawSync } from "node:zlib";

export interface ExpectedProduct {
  readonly id: string;
  readonly family: "q1" | "q2" | "q3";
  readonly edition: "classic" | "rerelease" | "quakeworld";
  readonly campaign: string;
  readonly title: string;
  readonly scope: "required";
  readonly contentDirectory: string;
  readonly baseProduct: string | null;
  readonly requiredArchive: string | null;
  readonly requiredPrograms: readonly string[];
  readonly mapWitness: string | null;
  readonly protocols: readonly string[];
}

export function expectedProducts(): ExpectedProduct[] {
  const products: ExpectedProduct[] = [];
  const q1Titles: Readonly<Record<string, string>> = { id1: "Quake", hipnotic: "Scourge of Armagon", rogue: "Dissolution of Eternity", dopa: "Dimension of the Past", mg1: "Dimension of the Machine", mg3: "Dawn of the Machine", ctf: "Capture the Flag" };
  for (const edition of ["classic", "rerelease"] satisfies readonly ExpectedProduct["edition"][]) {
    for (const campaign of edition === "classic" ? ["id1", "hipnotic", "rogue"] : ["id1", "hipnotic", "rogue", "dopa", "mg1", "mg3", "ctf"]) {
      const directory = `q1/${edition === "rerelease" ? "rerelease/" : ""}${campaign}`;
      products.push({ id: `q1-${edition}-${campaign}`, family: "q1", edition, campaign, title: q1Titles[campaign] ?? campaign, scope: "required", contentDirectory: directory, baseProduct: campaign === "id1" ? null : `q1-${edition}-id1`, requiredArchive: `${directory}/pak0.pak`, requiredPrograms: ["progs.dat"], mapWitness: null, protocols: ["netquake"] });
    }
  }
  products.push({ id: "q1-quakeworld", family: "q1", edition: "quakeworld", campaign: "id1", title: "QuakeWorld", scope: "required", contentDirectory: "q1/qw", baseProduct: "q1-classic-id1", requiredArchive: null, requiredPrograms: ["qwprogs.dat"], mapWitness: null, protocols: ["quakeworld"] });
  products.push({ id: "q1-rerelease-quake64", family: "q1", edition: "rerelease", campaign: "quake64", title: "Quake 64 (unresolved content identity)", scope: "required", contentDirectory: "q1/rerelease/quake64", baseProduct: "q1-rerelease-id1", requiredArchive: null, requiredPrograms: [], mapWitness: null, protocols: ["netquake"] });
  const q2Campaigns = [
    { campaign: "baseq2", title: "Quake II", map: "base1" },
    { campaign: "xatrix", title: "The Reckoning", map: "xswamp" },
    { campaign: "rogue", title: "Ground Zero", map: "rmine1" },
    { campaign: "ctf", title: "Capture the Flag", map: "q2ctf1" },
    { campaign: "lmctf", title: "Loki's Minions CTF", map: "lmctf09" },
    { campaign: "mg2", title: "Call of the Machine", map: "mguhub" },
    { campaign: "n64", title: "Quake II 64", map: "q64/rtest" },
  ];
  for (const edition of ["classic", "rerelease"] satisfies readonly ExpectedProduct["edition"][]) {
    for (const row of q2Campaigns) {
      if (edition === "classic" ? ["mg2", "n64"].includes(row.campaign) : row.campaign === "lmctf") continue;
      const directory = edition === "rerelease" ? "q2/rerelease/baseq2" : `q2/${row.campaign}`;
      products.push({ id: `q2-${edition}-${row.campaign}`, family: "q2", edition, campaign: row.campaign, title: row.title, scope: "required", contentDirectory: directory, baseProduct: row.campaign === "baseq2" ? null : `q2-${edition}-baseq2`, requiredArchive: `${directory}/pak0.pak`, requiredPrograms: [edition === "rerelease" ? "game_x64.dll" : "gamex86.dll"], mapWitness: `maps/${row.map}.bsp`, protocols: edition === "rerelease" ? ["q2-rerelease"] : ["q2-34", "q2repro-1038", "private-4038"] });
    }
  }
  for (const campaign of ["baseq3", "missionpack"]) {
    const directory = `q3a/${campaign}`;
    products.push({ id: `q3-${campaign}`, family: "q3", edition: "classic", campaign, title: campaign === "baseq3" ? "Quake III Arena" : "Team Arena", scope: "required", contentDirectory: directory, baseProduct: campaign === "baseq3" ? null : "q3-baseq3", requiredArchive: `${directory}/pak0.pk3`, requiredPrograms: ["vm/qagame.qvm", "vm/cgame.qvm", "vm/ui.qvm"], mapWitness: null, protocols: ["q3-68"] });
  }
  return products;
}

const limits = { directoryBytes: 32 * 1024 * 1024, archiveEntries: 100_000, files: 20_000, depth: 16, headerCompressedBytes: 4096, headerInflatedBytes: 8 * 1024 * 1024, programBytes: 64 * 1024 * 1024, outputBytes: 64 * 1024 * 1024 };
type Entry = { ordinal: number; path: string; offset: number; bytes: number; compressedBytes: number; compression: number; flags: number; crc32: string | null };
type Observation = { kind: "header"; format: string; headerHex: string } | { kind: "extension"; format: string } | { kind: "uninspected"; reason: string };
type Occurrence = Entry & { observation: Observation; programSha256: string | null };
type Archive = { path: string; scope: "product-content" | "provenance-only"; bytes: number; sha256: string; container: "pak" | "zip"; entries: Occurrence[]; duplicatePaths: { path: string; ordinals: number[] }[] };
type Program = { path: string; bytes: number; sha256: string; observation: Observation };

function readRange(fd: number, offset: number, length: number, fileBytes: number): Buffer {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > fileBytes) throw new Error(`Invalid file range ${offset}+${length}/${fileBytes}`);
  const bytes = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const count = readSync(fd, bytes, done, length - done, offset + done);
    if (count === 0) throw new Error("File shortened during inspection");
    done += count;
  }
  return bytes;
}

function sha256(fd: number, fileBytes: number): string {
  const hash = createHash("sha256");
  for (let offset = 0; offset < fileBytes; offset += 1024 * 1024) hash.update(readRange(fd, offset, Math.min(1024 * 1024, fileBytes - offset), fileBytes));
  return hash.digest("hex");
}

function pakDirectory(fd: number, size: number): Entry[] {
  const header = readRange(fd, 0, 12, size);
  const offset = header.readUInt32LE(4), length = header.readUInt32LE(8);
  if (length % 64 !== 0 || length > limits.directoryBytes || length / 64 > limits.archiveEntries) throw new Error("PAK directory exceeds bounds or has partial records");
  const directory = readRange(fd, offset, length, size);
  const entries: Entry[] = [];
  for (let index = 0; index < length; index += 64) {
    const name = directory.subarray(index, index + 56);
    const end = name.indexOf(0);
    const entry = { ordinal: index / 64, path: name.toString("utf8", 0, end < 0 ? name.length : end), offset: directory.readUInt32LE(index + 56), bytes: directory.readUInt32LE(index + 60), compressedBytes: directory.readUInt32LE(index + 60), compression: 0, flags: 0, crc32: null };
    if (entry.offset + entry.bytes > size) throw new Error(`PAK entry outside archive: ${entry.path}`);
    entries.push(entry);
  }
  return entries;
}

function zipDirectory(fd: number, size: number): Entry[] {
  const tailOffset = Math.max(0, size - 65_557), tail = readRange(fd, tailOffset, size - tailOffset, size);
  let end = -1;
  for (let position = tail.length - 22; position >= 0; position--) {
    if (tail.readUInt32LE(position) === 0x06054b50 && position + 22 + tail.readUInt16LE(position + 20) === tail.length) { end = position; break; }
  }
  if (end < 0) throw new Error("ZIP end directory not found");
  const count = tail.readUInt16LE(end + 10), length = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
  if (tail.readUInt16LE(end + 4) !== 0 || tail.readUInt16LE(end + 6) !== 0 || tail.readUInt16LE(end + 8) !== count || count === 0xffff || length === 0xffffffff || offset === 0xffffffff) throw new Error("Multi-disk/ZIP64 archives require a separate bounded reader");
  if (count > limits.archiveEntries || length > limits.directoryBytes || offset + length > tailOffset + end) throw new Error("ZIP directory exceeds bounds");
  const directory = readRange(fd, offset, length, size), entries: Entry[] = [];
  let position = 0;
  for (let ordinal = 0; ordinal < count; ordinal++) {
    if (position + 46 > length || directory.readUInt32LE(position) !== 0x02014b50) throw new Error("Invalid ZIP central directory record");
    const nameBytes = directory.readUInt16LE(position + 28), extraBytes = directory.readUInt16LE(position + 30), commentBytes = directory.readUInt16LE(position + 32);
    const next = position + 46 + nameBytes + extraBytes + commentBytes;
    if (next > length) throw new Error("ZIP directory record exceeds directory bounds");
    entries.push({ ordinal, path: directory.toString("utf8", position + 46, position + 46 + nameBytes), offset: directory.readUInt32LE(position + 42), bytes: directory.readUInt32LE(position + 24), compressedBytes: directory.readUInt32LE(position + 20), compression: directory.readUInt16LE(position + 10), flags: directory.readUInt16LE(position + 8), crc32: directory.readUInt32LE(position + 16).toString(16).padStart(8, "0") });
    position = next;
  }
  if (position !== length) throw new Error("Unconsumed ZIP directory bytes");
  return entries;
}

function entryBytes(fd: number, size: number, container: Archive["container"], entry: Entry, full: boolean): Buffer {
  if ((entry.flags & 1) !== 0) throw new Error("Encrypted archive entry");
  let offset = entry.offset;
  if (container === "zip") {
    const local = readRange(fd, offset, 30, size);
    if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(8) !== entry.compression) throw new Error("ZIP local header disagrees with directory");
    offset += 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  }
  if (offset + entry.compressedBytes > size) throw new Error("Entry outside archive");
  if (full && (entry.bytes > limits.programBytes || entry.compressedBytes > limits.programBytes)) throw new Error("Program exceeds bounded hash/decode limit");
  if (entry.compression === 0) return readRange(fd, offset, full ? entry.bytes : Math.min(64, entry.bytes), size);
  if (entry.compression !== 8) throw new Error(`Unsupported ZIP compression ${entry.compression}`);
  const compressed = readRange(fd, offset, full ? entry.compressedBytes : Math.min(limits.headerCompressedBytes, entry.compressedBytes), size);
  const decoded = inflateRawSync(compressed, { finishFlush: full ? constants.Z_FINISH : constants.Z_SYNC_FLUSH, maxOutputLength: full ? limits.programBytes : limits.headerInflatedBytes });
  if (full && decoded.length !== entry.bytes) throw new Error("Decoded program size disagrees with directory");
  return full ? decoded : decoded.subarray(0, 64);
}

const inspectedExtensions = new Set([".bsp", ".mdl", ".spr", ".md2", ".sp2", ".md3", ".md4", ".md5mesh", ".md5anim", ".cin", ".ogv", ".roq", ".wav", ".ogg", ".mp3", ".flac", ".qvm", ".dll", ".so"]);
function isProgram(path: string): boolean { return /(?:^|\/)(?:qwprogs|progs)\.dat$/i.test(path) || /\.(?:qvm|dll|so)$/i.test(path); }
function observe(path: string, header: Buffer): Observation {
  const magic = header.toString("ascii", 0, 4), version = header.length >= 8 ? header.readUInt32LE(4) : -1;
  let format: string | null = null;
  if (extname(path).toLowerCase() === ".bsp" && header.length >= 4) {
    format = header.readUInt32LE(0) === 29 ? "bsp29" : magic === "BSP2" ? "bsp2" : magic === "2PSB" ? "bsp2-rmq" : magic === "IBSP" ? `ibsp${version}` : magic === "QBSP" ? `qbsp${version}` : "unknown-bsp";
  } else if (magic === "IDPO") format = `mdl${version}`;
  else if (magic === "IDSP") format = `spr${version}`;
  else if (magic === "IDP2") format = `md2-v${version}`;
  else if (magic === "IDS2") format = `sp2-v${version}`;
  else if (magic === "IDP3") format = `md3-v${version}`;
  else if (magic === "IDP4") format = `md4-v${version}`;
  else if (header.toString("ascii", 0, 10) === "MD5Version") format = "md5";
  else if (magic === "OggS") format = "ogg-container";
  else if (magic === "RIFF" && header.toString("ascii", 8, 12) === "WAVE") format = "wav";
  else if (magic === "fLaC") format = "flac";
  else if (header.length >= 4 && [0x12721444, 0x12721445].includes(header.readUInt32LE(0))) format = "qvm";
  else if (header.length >= 4 && header.readUInt32BE(0) === 0x7f454c46) format = `elf${header[4] === 1 ? "32" : header[4] === 2 ? "64" : "-unknown"}`;
  else if (header.toString("ascii", 0, 2) === "MZ") {
    const peOffset = header.length >= 64 ? header.readUInt32LE(60) : header.length;
    if (peOffset + 26 <= header.length && header.readUInt32LE(peOffset) === 0x00004550) {
      const machine = header.readUInt16LE(peOffset + 4), optionalMagic = header.readUInt16LE(peOffset + 24);
      format = `pe${optionalMagic === 0x10b ? "32" : optionalMagic === 0x20b ? "32+" : "-unknown"}-${machine === 0x14c ? "i386" : machine === 0x8664 ? "x86-64" : `machine-${machine}`}`;
    } else format = "pe-dos-header";
  }
  else if (header.length >= 4 && /(?:qwprogs|progs)\.dat$/i.test(path)) format = `quakec-v${header.readUInt32LE(0)}`;
  else if (header.length >= 2 && header.readUInt16LE(0) === 0x1084) format = "roq";
  return format === null ? { kind: "extension", format: extname(path).toLowerCase().slice(1) || "no-extension" } : { kind: "header", format, headerHex: header.subarray(0, 16).toString("hex") };
}

function inspectArchive(path: string, absolute: string): Archive {
  const fd = openSync(absolute, "r");
  try {
    const before = fstatSync(fd), magic = readRange(fd, 0, Math.min(4, before.size), before.size).toString("ascii");
    const container = magic === "PACK" ? "pak" : "zip";
    const directory = container === "pak" ? pakDirectory(fd, before.size) : zipDirectory(fd, before.size);
    const entries: Occurrence[] = directory.map(entry => {
      const program = isProgram(entry.path);
      let observation: Observation = { kind: "extension", format: extname(entry.path).toLowerCase().slice(1) || "no-extension" };
      let programSha256: string | null = null;
      if (program || inspectedExtensions.has(extname(entry.path).toLowerCase())) {
        try {
          const bytes = entryBytes(fd, before.size, container, entry, program);
          observation = observe(entry.path, bytes);
          if (program) programSha256 = createHash("sha256").update(bytes).digest("hex");
        } catch (error) { observation = { kind: "uninspected", reason: error instanceof Error ? error.message : String(error) }; }
      }
      return { ...entry, observation, programSha256 };
    });
    const names = new Map<string, number[]>();
    for (const entry of entries) {
      const previous = names.get(entry.path);
      if (previous === undefined) names.set(entry.path, [entry.ordinal]); else previous.push(entry.ordinal);
    }
    const hash = sha256(fd, before.size), after = fstatSync(fd);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error(`Archive changed during inspection: ${path}`);
    return { path, scope: path.startsWith("quakelive/") || path === "q1-paks.zip" ? "provenance-only" : "product-content", bytes: before.size, sha256: hash, container, entries, duplicatePaths: [...names].filter(([, ordinals]) => ordinals.length > 1).map(([name, ordinals]) => ({ path: name, ordinals })) };
  } finally { closeSync(fd); }
}

function discover(root: string): string[] {
  const selected: string[] = [];
  let count = 0;
  function walk(directory: string, depth: number): void {
    if (depth > limits.depth) throw new Error("Inventory traversal depth exceeded");
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (++count > limits.files) throw new Error("Inventory file count exceeded");
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(path, depth + 1);
      else if (entry.isFile() && (/\.(?:pak|pk3|kpf|zip)$/i.test(entry.name) || /^(?:qwprogs|progs)\.dat$/i.test(entry.name) || /^game.*\.(?:dll|so)$/i.test(entry.name))) selected.push(relative(root, path));
    }
  }
  walk(root, 0);
  return selected.sort();
}

export function inventoryProducts(root: string) {
  const archives: Archive[] = [], programs: Program[] = [], inspectionErrors: { path: string; reason: string }[] = [];
  const opaqueFixtures: { path: string; bytes: number; sha256: string; headerHex: string; reason: string }[] = [];
  const paths = discover(root), snapshots = paths.map(path => ({ path, before: statSync(resolve(root, path)) }));
  for (const path of paths) {
    const absolute = resolve(root, path);
    try {
      if (path === "quakelive/web.pak") {
        const fd = openSync(absolute, "r");
        try {
          const size = fstatSync(fd).size;
          opaqueFixtures.push({ path, bytes: size, sha256: sha256(fd, size), headerHex: readRange(fd, 0, Math.min(16, size), size).toString("hex"), reason: "Quake Live web resource bundle; observed header is neither PACK nor ZIP. Opaque provenance only; no game archive directory claimed." });
        } finally { closeSync(fd); }
      } else if (/\.(?:pak|pk3|kpf|zip)$/i.test(path)) archives.push(inspectArchive(path, absolute));
      else {
        const fd = openSync(absolute, "r");
        try {
          const before = fstatSync(fd);
          const row = { path, bytes: before.size, sha256: sha256(fd, before.size), observation: observe(path, readRange(fd, 0, Math.min(65_536, before.size), before.size)) };
          const after = fstatSync(fd);
          if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("Program changed during inspection");
          programs.push(row);
        } finally { closeSync(fd); }
      }
    } catch (error) { inspectionErrors.push({ path, reason: error instanceof Error ? error.message : String(error) }); }
  }
  if (JSON.stringify(paths) !== JSON.stringify(discover(root))) throw new Error("Selected corpus paths changed during inventory");
  for (const { path, before } of snapshots) {
    const after = statSync(resolve(root, path));
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error(`Corpus input changed during inventory: ${path}`);
  }
  const expected = expectedProducts();
  const requiredArchives = (product: ExpectedProduct): string[] => [
    ...(product.requiredArchive === null ? [] : [product.requiredArchive]),
    ...(product.id === "q1-classic-id1" ? ["q1/id1/pak1.pak"] : []),
  ];
  const products = expected.map(product => {
    const ownArchives = archives.filter(archive => dirname(archive.path) === product.contentDirectory);
    const base = expected.find(candidate => candidate.id === product.baseProduct);
    const requiredContentArchives = [...requiredArchives(product), ...(base === undefined ? [] : requiredArchives(base))];
    const baseArchiveEvidence = base === undefined ? [] : archives.filter(archive => dirname(archive.path) === base.contentDirectory).map(archive => archive.path);
    const archiveEvidence = ownArchives.map(archive => archive.path);
    const programEvidence = product.requiredPrograms.map(name => ({ name, occurrences: [
      ...programs.filter(program => program.path === `${product.contentDirectory}/${name}`).map(program => ({ source: program.path, ordinal: null, sha256: program.sha256 })),
      ...ownArchives.flatMap(archive => archive.entries.filter(entry => entry.path.toLowerCase() === name.toLowerCase() && entry.programSha256 !== null).map(entry => ({ source: archive.path, ordinal: entry.ordinal, sha256: entry.programSha256 }))),
    ] }));
    const mapEvidence = ownArchives.flatMap(archive => archive.entries.filter(entry => product.mapWitness === null ? entry.path.toLowerCase().endsWith(".bsp") : entry.path.toLowerCase() === product.mapWitness.toLowerCase()).map(entry => ({ source: archive.path, ordinal: entry.ordinal, path: entry.path })));
    const missing = [
      ...requiredContentArchives.filter(path => !archives.some(archive => archive.path.toLowerCase() === path.toLowerCase())).map(path => `archive:${path}`),
      ...(product.mapWitness !== null && mapEvidence.length === 0 ? [`map:${product.mapWitness}`] : []),
    ];
    const missingProgramFixtures = programEvidence.filter(program => program.occurrences.length === 0).map(program => program.name);
    return { ...product, status: product.campaign === "quake64" ? "unresolved" : missing.length > 0 ? "missing-evidence" : "observed", missing, requiredContentArchives, archiveEvidence, baseArchiveEvidence, programFixtureStatus: product.campaign === "quake64" ? "unresolved" : missingProgramFixtures.length > 0 ? "missing-reference-fixture" : "observed", missingProgramFixtures, programEvidence, mapEvidence,
      mount: { contentDirectory: product.contentDirectory, baseProduct: product.baseProduct, archiveOrder: "inventory-path-order-only; runtime precedence remains profile-specific", campaignProgram: product.family === "q1" ? product.requiredPrograms : [], crossEditionMapOverride: product.family === "q2" ? "When rerelease gameplay uses classic maps, classic maps/ takes precedence while rerelease assets retain priority; do not merge filenames globally." : null } };
  });
  const formats = new Map<string, { headerOccurrences: number; extensionOccurrences: number; examples: { source: string; ordinal: number; path: string }[] }>();
  for (const archive of archives.filter(item => item.scope === "product-content")) for (const entry of archive.entries) {
    if (entry.observation.kind === "uninspected") continue;
    const format = entry.observation.format, counts = formats.get(format) ?? { headerOccurrences: 0, extensionOccurrences: 0, examples: [] };
    if (entry.observation.kind === "header") counts.headerOccurrences++; else counts.extensionOccurrences++;
    if (counts.examples.length < 3) counts.examples.push({ source: archive.path, ordinal: entry.ordinal, path: entry.path });
    formats.set(format, counts);
  }
  return { schemaVersion: 1, generator: "bun run tools/inventory/products.ts --write", corpusRoot: "../qfiles", expectationSources: ["docs/work-packages.json#W01", "docs/source-assessment.md#data-coverage-and-provenance", "../quake-1-re-ts/src/client/menu_content.ts", "../quake-2-re-ts/src/client/menu_content.ts"], limits,
    evidenceLimits: ["Static directories and bounded headers do not prove runtime compatibility or campaign completion.", "Product status describes installed content evidence only. requiredPrograms and programFixtureStatus describe separate guest/reference fixtures; missing native binaries do not block official TypeScript gameplay.", "Entry ordinals preserve duplicate names. Counts include overridden content and are not counts of unique playable maps.", "Inventory path order is not mount precedence. Product/base identities and all source occurrences remain separate.", "ZIP64, multi-disk, encrypted entries, and compression other than store/deflate are explicit inspection gaps.", "Nested archives are listed but not recursively decoded. q1-paks.zip is backup provenance, not an installed mount.", "Loose assets other than selected gameplay programs are not read. Configurations, saves, credentials, CD keys, OS libraries, and executables are not inspected.", "Header classification identifies observed magic only; extensions alone do not verify format variants. SHA256 covers complete archives and selected gameplay programs.", "Only three example occurrences per format are repeated in the summary; complete archive directories remain below."],
    products, fixtures: [...archives.filter(archive => archive.scope === "provenance-only").map(archive => ({ source: archive.path, sha256: archive.sha256, scope: "provenance-only", reason: archive.path.startsWith("quakelive/") ? "Quake Live data and native ABI fixtures; outside required product scope" : "Backup archive; nested PAKs are not installed mounts" })), ...opaqueFixtures.map(fixture => ({ source: fixture.path, sha256: fixture.sha256, scope: "provenance-only", reason: fixture.reason }))],
    requiredFixtureGaps: ["bsp2", "md4-v1"].filter(format => (formats.get(format)?.headerOccurrences ?? 0) === 0).map(format => ({ format, status: "no-confirmed-header-fixture", owner: "W07", required: true })),
    formatCounts: [...formats].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([format, counts]) => ({ format, ...counts })),
    summary: { expectedProducts: products.length, observedProducts: products.filter(product => product.status === "observed").length, unresolvedProducts: products.filter(product => product.status === "unresolved").length, archives: archives.length, archiveEntries: archives.reduce((count, archive) => count + archive.entries.length, 0), standalonePrograms: programs.length, uninspectedEntries: archives.reduce((count, archive) => count + archive.entries.filter(entry => entry.observation.kind === "uninspected").length, 0), duplicateNamesWithinArchives: archives.reduce((count, archive) => count + archive.duplicatePaths.length, 0) },
    archives, programs, opaqueFixtures, inspectionErrors };
}

function verifyReader(): void {
  const root = mkdtempSync(resolve(tmpdir(), "quake-product-inventory-"));
  try {
    const directory = resolve(root, "q2/baseq2");
    mkdirSync(directory, { recursive: true });
    const pak = Buffer.alloc(148);
    pak.write("PACK", 0, "ascii"); pak.writeUInt32LE(20, 4); pak.writeUInt32LE(128, 8);
    pak.write("IBSP", 12, "ascii"); pak.writeUInt32LE(38, 16);
    for (const offset of [20, 84]) {
      pak.write("maps/base1.bsp", offset, "ascii"); pak.writeUInt32LE(12, offset + 56); pak.writeUInt32LE(8, offset + 60);
    }
    const path = resolve(directory, "pak0.pak");
    writeFileSync(path, pak);
    const manifest = inventoryProducts(root), archive = manifest.archives[0];
    if (archive?.entries.length !== 2 || archive.duplicatePaths[0]?.ordinals.join(",") !== "0,1") throw new Error("Duplicate archive occurrences were lost");
    if (archive.sha256 !== createHash("sha256").update(pak).digest("hex")) throw new Error("Archive hash mismatch");
    const product = manifest.products.find(row => row.id === "q2-classic-baseq2");
    if (product?.status !== "observed" || product.programFixtureStatus !== "missing-reference-fixture" || product.mapEvidence.length !== 2) throw new Error("Content availability was conflated with guest program fixtures");
    if (manifest.products.length !== expectedProducts().length || manifest.products.find(row => row.id === "q1-rerelease-quake64")?.status !== "unresolved") throw new Error("Missing content reduced the expected product domain");
    if (manifest.products.find(row => row.id === "q1-quakeworld")?.status !== "missing-evidence") throw new Error("An absent base mount was reported available");
    if (manifest.formatCounts.find(row => row.format === "ibsp38")?.headerOccurrences !== 2) throw new Error("Map headers were not independently classified");
    pak.writeUInt32LE(limits.directoryBytes + 64, 8);
    writeFileSync(path, pak);
    const invalid = inventoryProducts(root);
    if (invalid.inspectionErrors.length !== 1 || invalid.archives.length !== 0) throw new Error("Oversized archive directory was accepted");
    process.stdout.write("Product inventory reader checks passed: duplicates, hashes, headers, finite expected domain, content/program separation, bounded directory rejection.\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.some(argument => !["--write", "--check", "--self-test"].includes(argument)) || args.length > 1) throw new Error("Usage: bun run tools/inventory/products.ts [--write|--check|--self-test]");
    if (args.includes("--self-test")) {
      verifyReader();
    } else {
      const projectRoot = resolve(import.meta.dir, "../.."), root = resolve(projectRoot, "../qfiles"), output = resolve(projectRoot, "verification/product-manifest.json");
      if (!statSync(root).isDirectory()) throw new Error("Reference corpus is not a directory");
      const manifest = inventoryProducts(root), serialized = `${JSON.stringify(manifest, null, 2)}\n`;
      if (Buffer.byteLength(serialized) > limits.outputBytes) throw new Error("Manifest exceeds output limit");
      if (args.includes("--write")) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, serialized); }
      else if (args.includes("--check") && readFileSync(output, "utf8") !== serialized) throw new Error("Product manifest differs from current corpus; run --write to regenerate");
      process.stdout.write(`${JSON.stringify({ ...manifest.summary, manifestBytes: Buffer.byteLength(serialized), inspectionErrors: manifest.inspectionErrors, missing: manifest.products.filter(product => product.status !== "observed").map(product => ({ id: product.id, status: product.status, missing: product.missing })), missingProgramFixtures: manifest.products.filter(product => product.missingProgramFixtures.length > 0).map(product => ({ id: product.id, missing: product.missingProgramFixtures })), requiredFixtureGaps: manifest.requiredFixtureGaps })}\n`);
      if (manifest.inspectionErrors.length > 0 || manifest.summary.uninspectedEntries > 0) process.exitCode = 1;
    }
  } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
