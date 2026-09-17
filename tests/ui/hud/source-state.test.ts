import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { SeatSourceHud } from "../../../src/app/bootstrap/seat-hud-state.ts";
import type { SimulationPresentationEvent } from "../../../src/app/bootstrap/simulation/types.ts";

const identity = createIdentityOwner("hud-source-state"), actor = identity.actor(1, 0), other = identity.actor(2, 0);
const stamp = { sequence: 1, content: "q2:classic:baseq2:test", seconds: 2 } satisfies Pick<SimulationPresentationEvent, "sequence" | "content" | "seconds">;
test("guardian bars stay on their addressed seat, update by slot and clear on source hide", () => {
  const hud = new SeatSourceHud(actor);
  hud.receive({ ...stamp, kind: "q2-rerelease", event: { kind: "healthbar", actor: other, slot: 0, target: other, name: "Other boss", fraction: 1, visible: true } });
  expect(hud.presentation(2000).healthBars).toEqual([]);
  hud.receive({ ...stamp, kind: "q2-rerelease", event: { kind: "healthbar", actor, slot: 0, target: other, name: "Guardian", fraction: 0.7, visible: true } });
  expect(hud.presentation(2000).healthBars).toMatchObject([{ label: "Guardian", value: 0.7, maximum: 1 }]);
  hud.receive({ ...stamp, kind: "q2-rerelease", event: { kind: "healthbar", actor, slot: 0, target: other, name: "Guardian", fraction: 0, visible: false } });
  expect(hud.presentation(2000).healthBars).toEqual([]);
});
test("help and inventory reflect addressed source visibility and selected item", () => {
  const hud = new SeatSourceHud(actor);
  hud.receive({ ...stamp, kind: "q2", event: { kind: "help", slot: 1, text: "Find the reactor" } });
  hud.receive({ ...stamp, kind: "q2-player", event: { kind: "help", actor, visible: true } });
  expect(hud.presentation(2000).help?.lines).toEqual(["Find the reactor"]);
  hud.receive({ ...stamp, kind: "q2-player", event: { kind: "inventory", actor, entries: [{ item: "q2:item_quad", count: 1, capacity: 2 }], visible: true, selected: "q2:item_quad" } });
  expect(hud.presentation(2000).inventory).toMatchObject([{ id: "q2:item_quad", count: 1, selected: true }]);
  expect(hud.presentation(2000).help).toBeNull();
  hud.receive({ ...stamp, kind: "q2-player", event: { kind: "inventory", actor, entries: [], visible: false } });
  expect(hud.presentation(2000).inventory).toBeNull();
});
test("Q1 CTF source flags, runes and capture announcement reach HUD without cross-seat status", () => {
  const hud = new SeatSourceHud(actor);
  hud.receive({ ...stamp, kind: "q1-composition", event: { kind: "ctf-status", actor: other, status: { red: 8, blue: 9, flags: 0, runeItems: 0 } } });
  expect(hud.presentation(2000).prompts).toEqual([]);
  hud.receive({ ...stamp, kind: "q1-composition", event: { kind: "ctf-status", actor, status: { red: 1, blue: 2, flags: 1 | (4 << 3), runeItems: 128 } } });
  expect(hud.presentation(2000).prompts.map(prompt => prompt.action)).toEqual(["Red 1 - Blue 2", "Red flag home - Blue flag dropped", "Haste"]);
  hud.receive({ ...stamp, kind: "q1-composition", event: { kind: "ctf-capture", team: "red", total: 2 } });
  expect(hud.presentation(4999).prompts.at(-1)?.action).toBe("Red captured the flag");
  expect(hud.presentation(5000).prompts.some(prompt => prompt.action.includes("captured"))).toBe(false);
});

test("typewriter messages queue with a five second hold after Unicode text is revealed", async () => {
  const { SeatHudMessages } = await import("../../../src/ui/hud/index.ts");
  const seat = identity.seat(0), messages = new SeatHudMessages(seat);
  messages.centerPrint(seat, "A😀", { kind: "milliseconds", value: 100 }, { kind: "seconds", value: 5 }, false, 40);
  messages.centerPrint(seat, "Next", { kind: "milliseconds", value: 110 }, { kind: "seconds", value: 5 }, false, 40);
  expect(messages.active(5179).centerPrint?.text).toBe("A😀");
  expect(messages.active(5180).centerPrint?.text).toBe("Next");
  expect(messages.active(10340).centerPrint).toBeNull();
  messages.centerPrint(seat, "queued", { kind: "milliseconds", value: 11000 }, { kind: "seconds", value: 5 }, false, 40);
  messages.centerPrint(seat, "replace", { kind: "milliseconds", value: 11000 }, { kind: "seconds", value: 5 }, true);
  expect(messages.active(11000).centerPrint?.text).toBe("replace");
  expect(messages.active(16000).centerPrint).toBeNull();
});

test("scoreboards retain source ordering, spectators and seat filtering", () => {
  const hud = new SeatSourceHud(actor);
  hud.receive({ ...stamp, kind: "q2-player", event: { kind: "scoreboard", actor: other, killer: null, reliable: true, rows: [] } });
  expect(hud.presentation(2000).help).toBeNull();
  hud.receive({ ...stamp, kind: "q2-player", event: { kind: "scoreboard", actor, killer: null, reliable: true,
    rows: [{ slot: 1, name: "Ranger", score: 9, ping: 40, minutes: 3, spectator: false }] } });
  expect(hud.presentation(2000).help?.lines).toEqual(["9  Ranger  40ms  3m"]);
  const q1 = new SeatSourceHud(actor);
  q1.receive({ ...stamp, kind: "q1-composition", event: { kind: "client", client: { actor, slot: 0, name: "Ranger", frags: 4, shirt: 0, pants: 0, team: 1, observer: false, noTarget: false, userinfo: [] } } });
  expect(q1.presentation(2000).help).toBeNull();
  q1.scores(true); expect(q1.presentation(2000).help?.lines).toEqual(["4  Ranger  Team 1"]);
  q1.receive({ ...stamp, kind: "q1-composition", event: { kind: "client-left", actor, slot: 0 } });
  expect(q1.presentation(2000).help).toBeNull();
});
test("damage and compass lifetime use source event time; report retains source button gate", () => {
  const hud = new SeatSourceHud(actor), origin = { x: 1, y: 2, z: 3 };
  hud.receive({ ...stamp, kind: "q2", event: { kind: "damage-indicator", actor, origin, amount: 12 } });
  expect(hud.presentation(2799).damageIndicators).toHaveLength(1);
  expect(hud.presentation(2800).damageIndicators).toHaveLength(0);
  hud.receive({ ...stamp, kind: "q2-rerelease", event: { kind: "help-path", actor, position: origin, direction: { x: 1, y: 0, z: 0 }, first: true } });
  expect(hud.presentation(11999).helpPath?.origin).toEqual(origin);
  expect(hud.presentation(12000).helpPath).toBeNull();
  hud.receive({ ...stamp, kind: "q2-rerelease", event: { kind: "end-of-unit", buttonTime: 7,
    levels: [{ map: "base1", name: "Outer Base", visitOrder: 1, totalSecrets: 3, foundSecrets: 2, totalMonsters: 10, killedMonsters: 9, time: 125 }] } });
  expect(hud.presentation(6000).help?.lines).toEqual(["Outer Base: 9/10 kills  2/3 secrets  2:05"]);
  expect(hud.presentation(7000).help?.objectives[0]?.text).toBe("Press attack to continue");
});

test("source mission objectives queue explicit typewriter messages once per addressed event", () => {
  const hud = new SeatSourceHud(actor);
  hud.receive({ ...stamp, kind: "q2-rerelease", event: { kind: "mission-objective", actor: other, text: "Other mission", args: [], talkSound: false } });
  hud.receive({ ...stamp, kind: "q2-rerelease", event: { kind: "mission-objective", actor, text: "Disable reactor", args: [], talkSound: false } });
  expect(hud.drainObjectivePrints()).toEqual([{ text: "Disable reactor", seconds: 2 }]);
  expect(hud.drainObjectivePrints()).toEqual([]);
});
