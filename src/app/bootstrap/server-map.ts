// SPDX-License-Identifier: GPL-2.0-or-later
import { normalizeResourcePath } from "../../content/mounts/paths.ts";

/** A map name supplied by a server: any contained relative path is looked up; a missing map fails at the mount, not in the CLI's name check. */
export function serverMapPath(name: string): string {
  const normalized = normalizeResourcePath(name);
  const prefixed = normalized.startsWith("maps/") ? normalized : `maps/${normalized}`;
  return prefixed.endsWith(".bsp") ? prefixed : `${prefixed}.bsp`;
}
