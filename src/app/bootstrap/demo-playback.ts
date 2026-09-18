import { normalizeResourcePath } from "../../content/mounts/paths.ts";

export type DemoFamily = "q1" | "qw" | "q2" | "q3";
export interface DemoRequest {
  readonly family: DemoFamily;
  readonly name: string;
  readonly timedemo: boolean;
}
export type DemoResource =
  | { readonly kind: "q1" | "qw" | "q2"; readonly path: string; readonly bytes: Uint8Array }
  | { readonly kind: "q3"; readonly path: string; readonly bytes: Uint8Array; readonly protocol: 66 | 67 | 68 };

function hasExtension(path: string): boolean {
  return path.lastIndexOf(".") > path.lastIndexOf("/");
}

/** Explicit recording suffixes select the packet family independently of the current world. */
export function demoFamily(name: string, fallback: DemoFamily): DemoFamily {
  if (/\.qwd$/i.test(name)) return "qw";
  if (/\.dem$/i.test(name)) return "q1";
  if (/\.(dm2|mvd)$/i.test(name)) return "q2";
  if (/\.dm_\d+$/i.test(name)) return "q3";
  return fallback;
}

/** The caller supplies the existing mounted-file lookup, including its mod precedence. */
export async function openDemoResource(request: DemoRequest, read: (path: string) => Promise<Uint8Array | undefined>,
  print: (text: string) => void): Promise<DemoResource> {
  const name = normalizeResourcePath(request.name);
  if (request.family !== "q3") {
    const extension = request.family === "q1" ? ".dem" : request.family === "qw" ? ".qwd" : ".dm2";
    const filename = hasExtension(name) ? name : `${name}${extension}`;
    const path = request.family === "q2" && !filename.startsWith("demos/") ? `demos/${filename}` : filename;
    const bytes = await read(path);
    if (bytes === undefined) throw new Error(`Couldn't open demo ${path}`);
    return { kind: request.family, path, bytes };
  }

  const filename = name.startsWith("demos/") ? name.slice(6) : name;
  const suffix = /\.dm_(\d+)$/i.exec(filename);
  const requestedProtocol = suffix === null ? null : Number(suffix[1]);
  const nativeProtocols = [66, 67, 68];
  const supportedSuffix = requestedProtocol !== null && nativeProtocols.includes(requestedProtocol);
  const stem = suffix === null ? filename : filename.slice(0, suffix.index);
  if (requestedProtocol !== null && !supportedSuffix) print(`Protocol ${requestedProtocol} not supported for demos\n`);
  const candidates = supportedSuffix ? [{ path: `demos/${filename}`, protocol: requestedProtocol }]
    : nativeProtocols.map(protocol => ({ path: `demos/${stem}.dm_${protocol}`, protocol }));
  for (const candidate of candidates) {
    const bytes = await read(candidate.path);
    if (bytes === undefined) {
      if (!supportedSuffix) print(`Not found: ${candidate.path}\n`);
      continue;
    }
    if (candidate.protocol !== 66 && candidate.protocol !== 67 && candidate.protocol !== 68) throw new Error('Invalid Quake III demo protocol selection');
    return { kind: "q3", path: candidate.path, bytes, protocol: candidate.protocol };
  }
  throw new Error(`Couldn't open demo ${name}`);
}
