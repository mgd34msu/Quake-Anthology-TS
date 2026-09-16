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
  expect(command.options.rendererSelection).toBe("explicit");
  expect(command.options.mode).toBe("coop");
  expect(() => parseApplicationCommand(["--map", "../base1"])).toThrow();
});

test("renderer persistence cannot override an explicit CLI backend", () => {
  const implicit = parseApplicationCommand([]), explicit = parseApplicationCommand(["--renderer", "gl"]);
  if (implicit.kind !== "menu" || explicit.kind !== "menu") throw new Error("Expected graphical frontend options");
  expect(implicit.options.rendererSelection).toBe("default");
  expect(explicit.options.rendererSelection).toBe("explicit");
  expect(explicit.options.renderer).toBe("gl");
});

test("native network selection preserves the requested game composition", () => {
  const server = parseApplicationCommand(["--listen-q2", "0", "--bind", "127.0.0.1"]);
  if (server.kind !== "run") throw new Error("Expected a runnable server command");
  expect(server.options.network).toEqual({ kind: "q2-server", host: "127.0.0.1", port: 0 });
  expect(server.options.mode).toBe("coop");
  expect(server.options.movement).toBe("q1");
  expect(server.options.character).toBe("q3");
  expect(() => parseApplicationCommand(["--listen-q2", "27910", "--connect-q2", "localhost"])).toThrow();
  expect(() => parseApplicationCommand(["--bind", "127.0.0.1"])).toThrow();
});


test("native listener chooses its wire from the retained game recipe", () => {
  for (const product of ["q1-classic-id1", "q2-classic-baseq2", "q3-baseq3"]) {
    const parsed = parseApplicationCommand(["--game", product, "--listen", "0", "--bind", "127.0.0.1"]);
    if (parsed.kind !== "run") throw new Error("Expected native server options");
    expect(parsed.options.product).toBe(product);
    expect(parsed.options.network).toEqual({ kind: "native-server", host: "127.0.0.1", port: 0 });
    expect(parsed.options.mode).toBe(product === "q3-baseq3" ? "deathmatch" : "coop");
    expect(parsed.options.movement).toBe("q1");
    expect(parsed.options.character).toBe("q3");
  }
  expect(() => parseApplicationCommand(["--listen", "0", "--listen-q2", "0"])).toThrow();
  expect(() => parseApplicationCommand(["--listen", "0", "--connect-q2", "localhost"])).toThrow();
});

test("display gamma is shared, neutral by default, and range checked", () => {
  const defaults = parseApplicationCommand([]), configured = parseApplicationCommand(["--renderer", "cpu", "--gamma", "1.5"]);
  if (defaults.kind !== "menu" || configured.kind !== "menu") throw new Error("Expected startup menus");
  expect(defaults.options.gamma).toBe(1); expect(configured.options.gamma).toBe(1.5);
  for (const value of ["NaN", "Infinity", "0", "0.49", "3.01"]) expect(() => parseApplicationCommand(["--gamma", value])).toThrow();
});


test("startup menu precedes implicit defaults while explicit launches remain direct", () => {
  for (const argv of [[], ["--renderer", "cpu", "--gamma", "1.3"], ["--content-root", "/tmp/qfiles", "--hidden"]])
    expect(parseApplicationCommand(argv).kind).toBe("menu");
  for (const argv of [["--game", "q1-rerelease-id1"], ["--map", "dm4"], ["--frames", "1"], ["--dedicated"], ["--connect-q2", "localhost"]])
    expect(parseApplicationCommand(argv).kind).toBe("run");
  expect(parseApplicationCommand(["--menu", "--game", "q3-baseq3"]).kind).toBe("menu");
  expect(() => parseApplicationCommand(["--menu", "--dedicated"])).toThrow("local, non-dedicated");
  expect(() => parseApplicationCommand(["--menu", "--connect-q2", "localhost"])).toThrow("local, non-dedicated");
});
