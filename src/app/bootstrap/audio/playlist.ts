import { validMenuTrack } from "./playlist-settings.ts";
import type { MountedContent } from "../../../content/mounts/index.ts";

/** List only supported music from the already mounted VFS, including nested loose directories. */
export async function mountedMusicTracks(mounts: Pick<MountedContent, "listFiles">): Promise<readonly string[]> {
  const tracks = new Set<string>(), directories = ["music"], seen = new Set<string>();
  for (let index = 0; index < directories.length && index < 4095 && tracks.size < 4095; index++) {
    const directory = directories[index];
    if (directory === undefined || directory.length >= 256 || seen.has(directory)) continue;
    seen.add(directory);
    for (const extension of [".ogg", ".wav"]) for (const name of await mounts.listFiles(directory, extension)) {
      if (tracks.size === 4095) break;
      const path = `${directory}/${name}`;
      if (validMenuTrack(path)) tracks.add(path);
    }
    if (directory.split("/").length < 16) for (const name of await mounts.listFiles(directory, "/")) {
      if (directories.length === 4095) break;
      directories.push(`${directory}/${name}`);
    }
  }
  return [...tracks].sort();
}

export function musicFileCue(path: string): string { return /\s/.test(path) ? `"${path}"` : path; }

export function shuffledTracks(tracks: readonly string[], previous: string, random: () => number): string[] {
  const bag = [...new Set(tracks)];
  for (let index = bag.length - 1; index > 0; index--) {
    const selected = Math.floor(random() * (index + 1)), left = bag[index], right = bag[selected];
    if (left !== undefined && right !== undefined) { bag[index] = right; bag[selected] = left; }
  }
  if (bag.length > 1 && musicFileCue(bag[0] ?? "") === previous) { const first = bag.shift(); if (first !== undefined) bag.push(first); }
  return bag;
}
