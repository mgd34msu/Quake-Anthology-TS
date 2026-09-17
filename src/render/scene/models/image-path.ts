import { normalizeResourcePath } from "../../../content/mounts/paths.ts";

/** Embedded model image names are content-root relative, including sibling-directory references. */
export function modelImagePath(name: string): string {
  const path = name.replaceAll("\\", "/");
  if (path.includes("\0") || /^[a-z]:/i.test(path)) throw new RangeError(`Invalid model image path: ${name}`);
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "") throw new RangeError(`Invalid model image path: ${name}`);
    if (part === ".") continue;
    if (part === "..") {
      if (parts.pop() === undefined) throw new RangeError(`Model image escapes content root: ${name}`);
    } else parts.push(part);
  }
  return normalizeResourcePath(parts.join("/"));
}
