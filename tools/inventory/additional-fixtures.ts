import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readdirSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

const limits = { depth: 12, visitedEntries: 150_000, archiveBytes: 64 * 1024 ** 3, directoryBytes: 64 * 1024 ** 2, metadataBytes: 8 * 1024 ** 2, archiveMembers: 300_000, reportedMembers: 3000, outputBytes: 32 * 1024 ** 2 };
const projectRoot = resolve(import.meta.dir, "../..");
const downloads = join(homedir(), "Downloads");
const steamQuake = join(homedir(), ".local/share/Steam/steamapps/common/Quake");
const relevantName = /quake|^q[123](?:[a-z0-9_-]|source)|^pak(?:\d|explr)|^glad|^lmctf/i;
const sensitiveName = /(?:^|\/)(?:config|configs|save|saves|savedgames|accounts?|credentials?|secrets?)(?:\/|$)|(?:cdkey|q3key|qzconfig|steam_autocloud|\.cfg$|\.ini$|\.vdf$|\.acf$)/i;
const wantedMember = /(?:quake.?64|q1.?n64|quake.?n64)|\.md4$|(?:^|\/)gamex86\.dll$/i;
type Member = { ordinal: number; path: string; bytes: number; compressedBytes: number; offset: number; compression: number; flags: number; crc32: string | null };
type Directory = { kind: "pak" | "zip" | "zip64"; sha256: string; members: Member[] };
type Inspection = { kind: "inspected"; container: Directory["kind"]; directorySha256: string; memberCount: number; sensitiveNamesOmitted: number; extensionCounts: Record<string, number>; targetedMemberCount: number; targetedMembers: Member[]; reportedMembers: Member[]; omittedMembers: number }
  | { kind: "unsupported"; reason: string } | { kind: "error"; reason: string };
type MetadataManifest = { member: Member; sha256: string; lineCount: number; header: string; targetedLineCount: number; targetedLines: string[] };
type FileEvidence = { path: string; bytes: number; sha256: string; headerHex: string; qfilesHashMatches: string[]; inspection: Inspection; metadataManifests: MetadataManifest[] };
const errors: { path: string; reason: string }[] = [];
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function isUnknownArray(value: unknown): value is readonly unknown[] { return Array.isArray(value); }
function read(fd: number, offset: number, length: number, size: number): Buffer {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > size) throw new Error(`Invalid file range ${offset}+${length}/${size}`);
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const count = readSync(fd, buffer, done, length - done, offset + done);
    if (count === 0) throw new Error("File shortened while reading");
    done += count;
  }
  return buffer;
}
function hash(fd: number, size: number): string {
  const result = createHash("sha256");
  for (let offset = 0; offset < size; offset += 4 * 1024 ** 2) result.update(read(fd, offset, Math.min(size - offset, 4 * 1024 ** 2), size));
  return result.digest("hex");
}
function safe64(buffer: Buffer, offset: number): number {
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("ZIP64 integer exceeds safe range");
  return Number(value);
}
function directory(fd: number, size: number, magic: string): Directory {
  if (magic === "PACK") {
    const header = read(fd, 0, 12, size), length = header.readUInt32LE(8), offset = header.readUInt32LE(4);
    if (length > limits.directoryBytes || length % 64 !== 0 || length / 64 > limits.archiveMembers) throw new Error("PAK directory exceeds bounds");
    const data = read(fd, offset, length, size), members: Member[] = [];
    for (let i = 0; i < length; i += 64) {
      const name = data.subarray(i, i + 56), zero = name.indexOf(0), bytes = data.readUInt32LE(i + 60), position = data.readUInt32LE(i + 56);
      if (position + bytes > size) throw new Error("PAK member exceeds file bounds");
      members.push({ ordinal: i / 64, path: name.toString("utf8", 0, zero < 0 ? 56 : zero), bytes, compressedBytes: bytes, offset: position, compression: 0, flags: 0, crc32: null });
    }
    return { kind: "pak", sha256: createHash("sha256").update(data).digest("hex"), members };
  }
  const tailStart = Math.max(0, size - 65_557), tail = read(fd, tailStart, size - tailStart, size);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break; }
  }
  if (end < 0) throw new Error("ZIP end directory absent");
  if (tail.readUInt16LE(end + 4) !== 0 || tail.readUInt16LE(end + 6) !== 0 || tail.readUInt16LE(end + 8) !== tail.readUInt16LE(end + 10)) throw new Error("Multi-disk ZIP unsupported");
  let count = tail.readUInt16LE(end + 10), length = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
  let kind: Directory["kind"] = "zip";
  if (count === 0xffff || length === 0xffffffff || offset === 0xffffffff) {
    const locator = read(fd, tailStart + end - 20, 20, size);
    if (locator.readUInt32LE(0) !== 0x07064b50 || locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) !== 1) throw new Error("Invalid ZIP64 locator");
    const extended = read(fd, safe64(locator, 8), 56, size);
    if (extended.readUInt32LE(0) !== 0x06064b50 || extended.readUInt32LE(16) !== 0 || extended.readUInt32LE(20) !== 0 || safe64(extended, 24) !== safe64(extended, 32)) throw new Error("Invalid ZIP64 end directory");
    count = safe64(extended, 32); length = safe64(extended, 40); offset = safe64(extended, 48); kind = "zip64";
  }
  if (length > limits.directoryBytes || count > limits.archiveMembers || offset + length > tailStart + end) throw new Error("ZIP directory exceeds bounds");
  const data = read(fd, offset, length, size), members: Member[] = [];
  let position = 0;
  for (let ordinal = 0; ordinal < count; ordinal++) {
    if (position + 46 > length || data.readUInt32LE(position) !== 0x02014b50) throw new Error("Invalid ZIP directory member");
    const nameBytes = data.readUInt16LE(position + 28), extraBytes = data.readUInt16LE(position + 30), next = position + 46 + nameBytes + extraBytes + data.readUInt16LE(position + 32);
    if (next > length) throw new Error("ZIP member metadata exceeds directory");
    let bytes = data.readUInt32LE(position + 24), compressedBytes = data.readUInt32LE(position + 20), localOffset = data.readUInt32LE(position + 42), disk = data.readUInt16LE(position + 34);
    const extraEnd = position + 46 + nameBytes + extraBytes;
    for (let extra = position + 46 + nameBytes; extra < extraEnd;) {
      if (extra + 4 > extraEnd) throw new Error("Truncated ZIP extra field");
      const id = data.readUInt16LE(extra), fieldEnd = extra + 4 + data.readUInt16LE(extra + 2);
      if (fieldEnd > extraEnd) throw new Error("ZIP extra field exceeds record");
      if (id === 1) {
        let cursor = extra + 4;
        function next64(): number { if (cursor + 8 > fieldEnd) throw new Error("Truncated ZIP64 value"); const value = safe64(data, cursor); cursor += 8; return value; }
        if (bytes === 0xffffffff) bytes = next64();
        if (compressedBytes === 0xffffffff) compressedBytes = next64();
        if (localOffset === 0xffffffff) localOffset = next64();
        if (disk === 0xffff) { if (cursor + 4 > fieldEnd) throw new Error("Truncated ZIP64 disk"); disk = data.readUInt32LE(cursor); }
      }
      extra = fieldEnd;
    }
    if (disk !== 0 || localOffset === 0xffffffff || bytes === 0xffffffff || compressedBytes === 0xffffffff || localOffset + 30 + compressedBytes > size) throw new Error("ZIP member range/disk invalid or unresolved");
    members.push({ ordinal, path: data.toString("utf8", position + 46, position + 46 + nameBytes), bytes, compressedBytes, offset: localOffset, compression: data.readUInt16LE(position + 10), flags: data.readUInt16LE(position + 8), crc32: data.readUInt32LE(position + 16).toString(16).padStart(8, "0") });
    position = next;
  }
  if (position !== length) throw new Error("Unconsumed ZIP directory data");
  return { kind, sha256: createHash("sha256").update(data).digest("hex"), members };
}
function knownHashes(): Map<string, string[]> {
  const value: unknown = JSON.parse(readFileSync(join(projectRoot, "verification/product-manifest.json"), "utf8"));
  const result = new Map<string, string[]>();
  if (typeof value !== "object" || value === null || !("archives" in value) || !isUnknownArray(value.archives)) throw new Error("Product manifest lacks archive evidence");
  const archives: readonly unknown[] = value.archives;
  for (const item of archives) {
    if (typeof item !== "object" || item === null || !("path" in item) || typeof item.path !== "string" || !("sha256" in item) || typeof item.sha256 !== "string") throw new Error("Invalid known archive identity");
    const paths = result.get(item.sha256) ?? []; paths.push(item.path); result.set(item.sha256, paths);
  }
  return result;
}
let visitedEntries = 0;
function walk(root: string, depth: number, files: string[]): void {
  if (depth > limits.depth) { errors.push({ path: root, reason: "Directory depth bound reached" }); return; }
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (++visitedEntries > limits.visitedEntries) throw new Error("Discovery entry bound reached");
    const path = join(root, entry.name);
    if (sensitiveName.test(path)) continue;
    if (entry.isDirectory() && ![".git", "node_modules"].includes(entry.name)) walk(path, depth + 1, files);
    else if (entry.isFile() && /(?:\.(?:pak|pk3|md4)$|^gamex86\.dll$)/i.test(entry.name)) files.push(path);
  }
}
function inspect(path: string, known: Map<string, string[]>): FileEvidence {
  const fd = openSync(path, "r");
  try {
    const bytes = fstatSync(fd).size;
    if (bytes > limits.archiveBytes) throw new Error("File exceeds hashing limit");
    const header = read(fd, 0, Math.min(64, bytes), bytes), sha256 = hash(fd, bytes);
    let inspection: Inspection;
    const metadataManifests: MetadataManifest[] = [];
    if (header.toString("ascii", 0, 4) === "PACK" || [".zip", ".pk3"].includes(extname(path).toLowerCase())) {
      try {
        const observed = directory(fd, bytes, header.toString("ascii", 0, 4)), extensionCounts: Record<string, number> = {};
        if (basename(path) === "planetquake_ftp.zip") {
          const member = observed.members.find(item => item.path === "planetquake_ftp.csv");
          if (member !== undefined) {
            if (member.compression !== 0 || member.bytes !== member.compressedBytes || member.bytes > limits.metadataBytes || (member.flags & 1) !== 0) throw new Error("FTP manifest exceeds stored metadata bounds");
            const local = read(fd, member.offset, 30, bytes);
            if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(8) !== 0) throw new Error("Invalid stored manifest local header");
            const payload = read(fd, member.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28), member.bytes, bytes);
            const lines = payload.toString("utf8").split(/\r?\n/), targetedLines = lines.filter(line => /quake.?64|q1.?n64|quake.?n64|\.md4(?:[";,\s]|$)|gamex86\.dll/i.test(line) && !sensitiveName.test(line));
            metadataManifests.push({ member, sha256: createHash("sha256").update(payload).digest("hex"), lineCount: lines.length, header: (lines[0] ?? "").slice(0, 256), targetedLineCount: targetedLines.length, targetedLines: targetedLines.slice(0, limits.reportedMembers) });
          }
        }
        const publicMembers = observed.members.filter(member => !sensitiveName.test(member.path));
        for (const member of publicMembers) { const extension = extname(member.path).toLowerCase() || "[none]"; extensionCounts[extension] = (extensionCounts[extension] ?? 0) + 1; }
        inspection = { kind: "inspected", container: observed.kind, directorySha256: observed.sha256, memberCount: observed.members.length, sensitiveNamesOmitted: observed.members.length - publicMembers.length, extensionCounts, targetedMemberCount: publicMembers.filter(member => wantedMember.test(member.path)).length, targetedMembers: publicMembers.filter(member => wantedMember.test(member.path)).slice(0, limits.reportedMembers), reportedMembers: publicMembers.slice(0, limits.reportedMembers), omittedMembers: Math.max(0, publicMembers.length - limits.reportedMembers) };
      } catch (error) { inspection = { kind: "error", reason: message(error) }; }
    } else inspection = { kind: "unsupported", reason: "Hash and header only; this discovery reader parses PAK and ZIP/ZIP64 directories" };
    return { path, bytes, sha256, headerHex: header.toString("hex"), qfilesHashMatches: known.get(sha256) ?? [], inspection, metadataManifests };
  } finally { closeSync(fd); }
}
function main(): void {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--write", "--check"].includes(args[0] ?? "")) throw new Error("Usage: bun tools/inventory/additional-fixtures.ts --write|--check");
  const files: string[] = [], candidates: { path: string; kind: string }[] = [];
  for (const entry of readdirSync(downloads, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!relevantName.test(entry.name)) continue;
    const path = join(downloads, entry.name);
    candidates.push({ path, kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "unfollowed-special-file" });
    if (entry.isDirectory()) walk(path, 1, files);
    else if (entry.isFile() && /\.(?:zip|pk3|pak|7z|gz|bundle)$/i.test(entry.name)) files.push(path);
  }
  if (lstatSync(steamQuake).isDirectory()) walk(steamQuake, 0, files);
  const known = knownHashes(), evidence: FileEvidence[] = [];
  for (const path of [...new Set(files)].sort()) {
    process.stderr.write(`Inspecting ${basename(path)}\n`);
    try { evidence.push(inspect(path, known)); } catch (error) { errors.push({ path, reason: message(error) }); }
  }
  const targetMatches = evidence.flatMap(file => file.inspection.kind === "inspected" ? file.inspection.targetedMembers.map(member => ({ archive: file.path, archiveSha256: file.sha256, member })) : []);
  const unresolvedFixtures = [
    { id: "q1-rerelease-quake64", status: "unresolved", reason: "No confirmed Quake 64 content identity in this bounded discovery. Nested archive payloads remain uninspected." },
    { id: "md4-v1", status: "no-confirmed-header-fixture", reason: "This additional discovery did not establish an MD4 header fixture." },
    { id: "q2-classic-baseq2/gamex86.dll", status: "no-confirmed-retail-base-fixture", reason: "Gladiator DLLs and q2test archive members are provenance candidates; they do not establish the retail baseQ2 guest identity." },
  ];
  const report = { schemaVersion: 1, generator: "bun tools/inventory/additional-fixtures.ts --write", roots: { downloads, steamQuake, knownCorpusManifest: "verification/product-manifest.json" }, limits, evidenceLimits: ["Downloads discovery starts with Quake-related top-level filenames. Unrelated directories and personal file contents are not searched.", "Archive hashing reads raw container bytes only. The bounded PlanetQuake CSV member manifest is read in memory; assets and executables are not extracted or executed, and account/config/save/key names are omitted from reported directories.", "Nested archives are manifest candidates only. Filename matches do not establish a campaign or model format identity.", "Steam scope is Quake title content archives only. Steam executable inventory is owned by W02.", "PAK/ZIP/ZIP64 directories are range-bounded. Unsupported archive formats retain only whole-file hash and header evidence.", "Known qfiles duplicate identities are compared against the recorded product manifest hashes, not rehashed from qfiles in this command.", "Directory details are capped per archive; complete directory byte hashes and member counts permit reproducible verification. No runtime compatibility is inferred."], unresolvedFixtures, candidates, visitedEntries, summary: { files: evidence.length, bytesHashed: evidence.reduce((total, file) => total + file.bytes, 0), inspectedArchives: evidence.filter(file => file.inspection.kind === "inspected").length, duplicateQfilesArchives: evidence.filter(file => file.qfilesHashMatches.length > 0).length, targetMatches: targetMatches.length }, targetMatches, evidence, errors };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(output) > limits.outputBytes) throw new Error("Report exceeds output bound");
  const destination = join(projectRoot, "verification/additional-fixtures.json");
  if (args[0] === "--write") writeFileSync(destination, output);
  else if (readFileSync(destination, "utf8") !== output) throw new Error("Additional fixture report differs; rerun --write");
  process.stdout.write(`${JSON.stringify(report.summary)}\n`);
}
try { main(); } catch (error) { process.stderr.write(`${message(error)}\n`); process.exitCode = 1; }
