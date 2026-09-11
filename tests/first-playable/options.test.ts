import { expect, test } from "bun:test";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";

test("mixed launch selections remain independent of the renderer", () => {
  const command = parseApplicationCommand(["--preset", "q1-q2", "--renderer", "cpu", "--seats", "2"]);
  expect(command.kind).toBe("run");
  if (command.kind !== "run") throw new Error("Expected a runnable command");
  expect(command.options.product).toBe("q1-rerelease-id1");
  expect(command.options.map).toBe("maps/e1m1.bsp");
  expect(command.options.movement).toBe("q2");
  expect(command.options.character).toBe("q2");
  expect(command.options.renderer).toBe("cpu");
  expect(command.options.mode).toBe("coop");
  expect(() => parseApplicationCommand(["--map", "../base1"])).toThrow();
});
