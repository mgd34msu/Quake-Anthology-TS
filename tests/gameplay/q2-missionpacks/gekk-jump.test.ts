// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createGekkDefinition } from "../../../src/content/q2/missionpacks/monsters/gekk.ts";
import { partialStub } from "../../support/stub.ts";
import type { Q2Monsters } from "../../../src/content/q2/foundation/monsters/index.ts";

test("the rerelease gekk carries game_x64.dll's two blocked jump moves and callbacks", () => {
  const definition = createGekkDefinition(partialStub<Q2Monsters>());
  const jump = definition.moves.find(move => move.name === "gekk_move_jump"),
    jump2 = definition.moves.find(move => move.name === "gekk_move_jump2");
  for (const move of [jump, jump2]) {
    expect(move?.firstFrame).toBe(74);
    expect(move?.lastFrame).toBe(81);
    expect(move?.end).toBe("gekk_run");
    expect(move?.frames).toHaveLength(8);
    expect(move?.frames[6]?.actions).toEqual(["gekk_jump_wait_land"]);
  }
  expect(jump?.frames[0]?.actions).toEqual(["gekk_jump_down"]);
  expect(jump2?.frames[0]?.actions).toEqual(["gekk_jump_up"]);
  expect(jump2?.frames.map(frame => frame.distance)).toEqual([-8, -8, 0, 0, 0, 0, 0, 0]);
  expect(definition.blocked).toBeDefined();
  for (const name of ["gekk_jump_up", "gekk_jump_down", "gekk_jump_wait_land"]) expect(definition.callbacks?.[name]).toBeDefined();
});
