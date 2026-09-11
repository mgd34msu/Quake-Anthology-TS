// SPDX-License-Identifier: GPL-2.0-or-later
import type { ResolvedResourceReference } from "../../contracts/content.ts";
import type { MountedContent } from "../../content/mounts/index.ts";
import { blockChecksum } from "../../core/md4.ts";
import { parseAas } from "./aas.ts";
import { constructNavigation } from "./construct.ts";
import type { NavigationConstruction } from "./construct.ts";
import { navigationFromAsset } from "./graph.ts";
import { parseKexNavigation } from "./nav.ts";
import { NavigationRuntime } from "./runtime.ts";

export interface NavigationLoadOptions extends NavigationConstruction {
  /** Geometry content's mounted resources, independently of presentation/arsenal content. */
  readonly resources: Pick<MountedContent, "open">;
  readonly mapBytes: Uint8Array;
}
export interface LoadedNavigation {
  readonly runtime: NavigationRuntime;
  readonly resource: ResolvedResourceReference | null;
}

/** Supplied navigation wins; absent assets construct through the selected shared collision world. */
export async function loadNavigation(options: NavigationLoadOptions): Promise<LoadedNavigation> {
  const { map, geometry, profile, world } = options;
  if (map.format !== geometry.kind) throw new TypeError("Navigation map identity and decoded geometry disagree");
  const relative = map.name.replace(/^maps\//i, "").replace(/\.bsp$/i, "");
  if (relative.length === 0 || relative.split("/").some(part => part.length === 0 || part === "." || part === "..")) throw new RangeError("Invalid navigation map resource path");
  const paths = geometry.kind === "q3-bsp" ? [`maps/${relative}.aas`, `bots/navigation/${relative}.nav`]
    : [`bots/navigation/${relative}.nav`, `maps/${relative}.aas`];
  for (const path of paths) {
    const opened = await options.resources.open(path);
    if (opened === null) continue;
    const asset = path.endsWith(".aas") ? parseAas(opened.bytes, path, blockChecksum(options.mapBytes)) : parseKexNavigation(opened.bytes, path);
    return { runtime: new NavigationRuntime(navigationFromAsset(map, asset, profile, world), world), resource: opened.reference };
  }
  return { runtime: new NavigationRuntime(constructNavigation(options), world), resource: null };
}
