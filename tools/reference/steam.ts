import { homedir } from "node:os";
import { join } from "node:path";
import { lstat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { CommandObservation, FileIdentity, ReadObservation, SteamObservation } from "./schema.ts";

export interface SteamTitle {
  readonly name: string;
  readonly family: "q1" | "q2" | "q3";
  readonly path: string;
}

export const steamCommonPath = join(homedir(), ".local/share/Steam/steamapps/common");
export const steamTitles: readonly SteamTitle[] = [
  { name: "Quake", family: "q1", path: join(steamCommonPath, "Quake") },
  { name: "Quake 2", family: "q2", path: join(steamCommonPath, "Quake 2") },
  { name: "Quake 3 Arena", family: "q3", path: join(steamCommonPath, "Quake 3 Arena") },
];

export function isCorpusBinaryCandidate(name: string): boolean {
  return /\.(?:exe|dll|so(?:\.[a-z0-9_-]+)*)$/i.test(name) || name === "q1rets" || name === "quake3-ts";
}

export function steamTitleForPath(path: string): SteamTitle | undefined {
  return steamTitles.find((title) => path.startsWith(`${title.path}/`));
}

export async function steamTitleAvailability(title: SteamTitle): Promise<SteamObservation["titles"][number]> {
  try {
    const details = await lstat(title.path);
    return {
      name: title.name,
      family: title.family,
      path: title.path,
      availability: details.isDirectory()
        ? { kind: "present" }
        : { kind: "unavailable", reason: "Expected an actual title directory; inventory does not follow directory symlinks." },
    };
  } catch (error) {
    return {
      name: title.name, family: title.family, path: title.path,
      availability: { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) },
    };
  }
}

async function readVersion(path: string): Promise<ReadObservation> {
  try {
    const text = await readFile(path, "utf8");
    return { path, value: { kind: "read", text, sha256: createHash("sha256").update(text).digest("hex") } };
  } catch (error) {
    return { path, value: { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) } };
  }
}

export async function observeSteam(
  identifyFile: (path: string) => Promise<FileIdentity>,
  observeCommand: (command: readonly [string, ...string[]], cwd: string, timeoutMs?: number) => Promise<CommandObservation>,
  cwd: string,
): Promise<SteamObservation> {
  const titles = await Promise.all(steamTitles.map(steamTitleAvailability));
  const path = join(steamCommonPath, "Proton - Experimental");
  let compatibilityRuntime: SteamObservation["compatibilityRuntime"];
  try {
    const selectedFiles = [
      "proton", "version", "files/bin/wine", "files/bin/wineserver",
      "files/lib/wine/x86_64-unix/wine", "files/lib/wine/x86_64-unix/wine64",
      "files/lib/wine/x86_64-unix/wine-preloader", "files/lib/wine/x86_64-unix/wine64-preloader",
    ];
    compatibilityRuntime = {
      kind: "present",
      path,
      files: await Promise.all(selectedFiles.map((file) => identifyFile(join(path, file)))),
      version: await readVersion(join(path, "version")),
      wineVersion: await observeCommand([join(path, "files/bin/wine"), "--version"], cwd),
      steamRuntimeVersions: await Promise.all([
        "SteamLinuxRuntime", "SteamLinuxRuntime_soldier", "SteamLinuxRuntime_4",
      ].map((name) => readVersion(join(steamCommonPath, name, "VERSIONS.txt")))),
      launchPolicy: [
        "Only wine --version was executed by this inventory. Each title requires a separate observed game launch.",
        "Classic launch candidate: execute the recorded files/bin/wine with a fresh isolated WINEPREFIX, private profile/output directories, a private DISPLAY when required, and the copied game executable/modules with explicitly selected external data.",
        "Do not use the user's existing Steam compatdata or account configuration as a reference profile.",
        "The installed proton launcher performs installation fixups and may create a default prefix before launching. Inventory hashes that launcher but does not execute it in the Steam installation.",
        "The existing Proton launcher is an external reference runtime, not first-party implementation code. First-party launch and capture tooling remains TypeScript.",
      ],
    };
  } catch (error) {
    compatibilityRuntime = { kind: "unavailable", path, reason: error instanceof Error ? error.message : String(error) };
  }
  return {
    commonPath: steamCommonPath,
    titles,
    compatibilityRuntime,
    provenanceBasis: "Installed title directories and executable filenames determine candidate family and edition; hashes identify local bytes. No vendor-integrity or depot-authenticity claim is made. Unrelated Steam titles, app/account manifests, config files and real compatdata are excluded.",
  };
}
