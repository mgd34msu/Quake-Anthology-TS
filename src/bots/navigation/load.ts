// SPDX-License-Identifier: GPL-2.0-or-later
import type { ContentId, ResolvedResourceReference } from "../../contracts/content.ts";
import type { MountedContent } from "../../content/mounts/index.ts";
import { blockChecksum } from "../../core/md4.ts";
import { parseAas } from "./aas.ts";
import { constructNavigation } from "./construct.ts";
import type { NavigationConstruction } from "./construct.ts";
import { navigationFromAsset } from "./graph.ts";
import { parseKexNavigation } from "./nav.ts";
import type { NavigationMapIdentity } from "./types.ts";
import type { AasAsset } from "./aas.ts";
import type { KexNavigationAsset } from "./nav.ts";
import { NavigationRuntime } from "./runtime.ts";

export interface NavigationLoadOptions extends NavigationConstruction {
  /** Geometry content's mounted resources, independently of presentation/arsenal content. */
  readonly resources: Pick<MountedContent, "open">;
  readonly mapBytes: Uint8Array;
  /** Checksumless NAV must belong to the selected geometry content, not an inherited namesake. */
  readonly navigationContent?: ContentId;
}
export interface LoadedNavigation {
  readonly runtime: NavigationRuntime;
  readonly resource: ResolvedResourceReference | null;
}

export interface PreparedNavigation {
  readonly map: NavigationMapIdentity;
  readonly asset: AasAsset | KexNavigationAsset | null;
  readonly resource: ResolvedResourceReference | null;
}

export async function preloadNavigation(options: Pick<NavigationLoadOptions, "map" | "resources" | "mapBytes" | "navigationContent">): Promise<PreparedNavigation> {
  const { map } = options;
  const relative = map.name.replace(/^maps\//i, "").replace(/\.bsp$/i, "");
  if (relative.length === 0 || relative.split("/").some(part => part.length === 0 || part === "." || part === "..")) throw new RangeError("Invalid navigation map resource path");
  const paths = map.format === "q3-bsp" ? [`maps/${relative}.aas`, `bots/navigation/${relative}.nav`]
    : [`bots/navigation/${relative}.nav`, `maps/${relative}.aas`];
  for (const path of paths) {
    const opened = await options.resources.open(path);
    if (opened === null) continue;
    if (path.endsWith(".nav") && options.navigationContent !== undefined && opened.reference.provenance.mount.identity.content !== options.navigationContent) continue;
    const asset = path.endsWith(".aas") ? parseAas(opened.bytes, path, blockChecksum(options.mapBytes)) : parseKexNavigation(opened.bytes, path);
    return { map, asset, resource: opened.reference };
  }
  return { map, asset: null, resource: null };
}

export function loadPreparedNavigation(options: NavigationConstruction, prepared: PreparedNavigation): LoadedNavigation {
  const { map, geometry, profile, world } = options;
  if (map.format !== geometry.kind || map.digest !== prepared.map.digest || map.name !== prepared.map.name || map.format !== prepared.map.format)
    throw new TypeError("Navigation map identity and prepared geometry disagree");
  return { runtime: new NavigationRuntime(prepared.asset === null ? constructNavigation(options)
    : navigationFromAsset(map, prepared.asset, profile, world), world), resource: prepared.resource };
}

/** Supplied navigation wins; absent assets construct through the selected shared collision world. */
export async function loadNavigation(options: NavigationLoadOptions): Promise<LoadedNavigation> {
  if (options.map.format !== options.geometry.kind) throw new TypeError("Navigation map identity and decoded geometry disagree");
  return loadPreparedNavigation(options, await preloadNavigation(options));
}
