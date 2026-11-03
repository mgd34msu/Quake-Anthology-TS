// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { filterGuestConsole } from "../../../src/compat/q2/guest-console.ts";

test("game modules keep level and moderation commands and lose console authority", () => {
  expect(filterGuestConsole("gamemap \"base1\"\n")).toEqual({ text: "gamemap \"base1\"\n", refused: [] });
  expect(filterGuestConsole("kick 3; quit")).toEqual({ text: "kick 3\n", refused: ["quit"] });
  expect(filterGuestConsole("say \"a;quit\"\nset rcon_password x")).toEqual({ text: "say \"a;quit\"\n", refused: ["set"] });
  expect(filterGuestConsole("MAP q2dm1").text).toBe("MAP q2dm1\n");
});
