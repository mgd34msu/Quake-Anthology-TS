import { expect, test } from "bun:test";
import { teamArenaDemo } from "../../src/app/bootstrap/team-arena-demo.ts";

test("postgame demo availability follows the mounted exact map/mode/protocol file", async () => {
  const paths: string[] = [];
  const exists = async (path: string): Promise<boolean> => { paths.push(path); return path === "demos/mpteam1_4.dm_68"; };
  expect(await teamArenaDemo("mpteam1", 4, 68, exists)).toEqual({ name: "mpteam1_4", path: "demos/mpteam1_4.dm_68" });
  expect(await teamArenaDemo("mpteam1", 3, 68, exists)).toBeNull();
  expect(await teamArenaDemo("mpteam1", 4, 67, exists)).toBeNull();
  expect(paths).toEqual(["demos/mpteam1_4.dm_68", "demos/mpteam1_3.dm_68", "demos/mpteam1_4.dm_67"]);
  await expect(teamArenaDemo("../escape", 4, 68, exists)).rejects.toThrow();
});
