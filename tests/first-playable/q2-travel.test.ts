import { expect, test } from "bun:test";
import { parseQ2Travel, q2NextServerCommand } from "../../src/app/bootstrap/q2-travel.ts";

test("Q2 unit movie retains the authored next-unit destination", () => {
  expect(parseQ2Travel("eou1_.cin+*bunk1")).toEqual({ kind: "cinematic", name: "eou1_.cin", spawnPoint: "", newUnit: false,
    next: { kind: "map", name: "bunk1", spawnPoint: "", newUnit: true, next: null } });
});
test("Q2 parses continuation before spawn point and unit marker", () => {
  const target = parseQ2Travel("*base1$start+tram.cin+jail_e3$tram");
  expect(target.name).toBe("base1"); expect(target.newUnit).toBe(true); expect(target.spawnPoint).toBe("start");
  expect(target.next?.kind).toBe("cinematic"); expect(target.next?.next?.spawnPoint).toBe("tram");
  expect(parseQ2Travel("victory.pcx").kind).toBe("picture");
  expect(parseQ2Travel("demo1.dm2").kind).toBe("demo");
});
test("Q2 rejects malformed travel before changing the published world", () => {
  for (const value of ["", "a+", "+b", "../a", "a;quit", "a$start$other", "a++b"]) expect(() => parseQ2Travel(value)).toThrow();
});

test("Q2 nextserver preserves the complete authored chain and clears absent continuation", () => {
  expect(q2NextServerCommand(parseQ2Travel("*base1$start+tram.cin+*jail_e3$tram"))).toBe('gamemap "tram.cin+*jail_e3$tram"');
  expect(q2NextServerCommand(parseQ2Travel("base1"))).toBe("");
});
