import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { Q2MatchUi } from "../../src/app/bootstrap/q2-match-ui.ts";
import { NativeUiController, defaultUiSkin } from "../../src/ui/common/index.ts";
import { SeatInput } from "../../src/input/seat.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { KeyCode } from "../../src/input/key-codes.ts";
import { SessionActorRegistry } from "../../src/world/actors/registry.ts";

test("CTF HUD and menu commands stay on the recipient seat", () => {
  const owner = createIdentityOwner("match-ui"), actors = new SessionActorRegistry(owner);
  const first = actors.allocate("q2:player", "q2:player"), second = actors.allocate("q2:player", "q2:player");
  const issued: string[][] = [];
  const make = (index: number, actor: typeof first.id) => {
    const seat = owner.seat(index), context = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(index, 0) } } satisfies import("../../src/contracts/common.ts").CommandContext;
    const buffer = new CommandBuffer({ dialect: "q2-classic", context });
    const input = new SeatInput({ seat, dialect: "q2-classic", context, commands: buffer, uiEvent: () => false });
    const controller = new NativeUiController({ seat, skin: () => defaultUiSkin("resource:test:font"), bindings: () => input.bindings,
      now: () => 0, focus: () => undefined, sound: () => undefined, executeScript: () => undefined });
    const ui = new Q2MatchUi(actor, controller, (name, args) => { issued.push([name, ...args]); return undefined; }, () => undefined);
    return { seat, controller, ui };
  };
  const one = make(0, first.id), two = make(1, second.id);
  const hud = { kind: "ctf", event: { kind: "hud", actor: first.id, team: 1, captures: [2, 3], flagStates: ["base", "taken"],
    carriedFlag: 2, tech: null, idTarget: null, blinkTeam: null, match: "Match in progress" } } satisfies Parameters<Q2MatchUi["receive"]>[0];
  one.ui.receive(hud); two.ui.receive(hud);
  expect(one.ui.prompts.map(prompt => prompt.action)).toContain("Red 2 (base)"); expect(two.ui.prompts).toEqual([]);
  const menu = { kind: "ctf", event: { kind: "menu", actor: first.id, title: "Join team", entries: [{ label: "Join Red", action: "join-red" }] } } satisfies Parameters<Q2MatchUi["receive"]>[0];
  one.ui.receive(menu); two.ui.receive(menu);
  expect(two.controller.activeMenu).toBeNull();
  one.controller.input({ seat: one.seat, timeMilliseconds: 0, kind: "key", code: KeyCode.Enter, down: true, repeat: false });
  expect(issued).toEqual([["ctf-menu", "join-red"]]);
  expect(one.controller.activeMenu).toBeNull(); one.ui.close(); two.ui.close();
});
