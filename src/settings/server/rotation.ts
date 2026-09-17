import { serverToggle } from "./common.ts";
import type { ServerSettingCollection } from "./types.ts";

export function q2RotationSettings(rerelease: boolean): ServerSettingCollection {
  return { id: "q2:rotation", definitions: [
    { id: "server:map-rotation", label: "Map rotation", description: "Ordered map names. An empty list follows each map's authored exit.", kind: "text-entry", maximumLength: 2048,
      defaultValue: "", applyAt: "live", target: { kind: "value", name: rerelease ? "g_map_list" : "sv_maplist" } },
    ...rerelease ? [serverToggle("server:map-rotation-shuffle", { kind: "value", name: "g_map_list_shuffle" }, "Shuffle after last map", false,
      "Reshuffle at the end of the rotation and keep the new order for the next cycle.")] : [],
  ] };
}

export function rotationMapName(value: string): string {
  const name = value.trim().replace(/^maps\//, "").replace(/\.bsp$/i, "");
  if (name === "" || name.length > 127 || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(name)) throw new Error("Enter a map name, such as q2dm1 or q64/outpost");
  return name;
}

export function moveRotationMap(maps: readonly string[], index: number, direction: -1 | 1): readonly string[] {
  const destination = index + direction, selected = maps[index], replaced = maps[destination];
  if (!Number.isInteger(index) || selected === undefined || replaced === undefined) return maps;
  const result = [...maps]; result[index] = replaced; result[destination] = selected; return result;
}
