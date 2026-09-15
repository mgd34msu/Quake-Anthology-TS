import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { registerQ1ClientCommands, resolveQ1HostCommandActor } from "../../src/app/bootstrap/q1-client-commands.ts";
import type { CommandContext } from "../../src/contracts/common.ts";

test("Q1 host target selection preserves server, client and script authority", () => {
  const identity = createIdentityOwner("qc-host-authority"), client = identity.client(0, 0), other = identity.client(1, 0);
  const actor = identity.actor(1, 0), otherActor = identity.actor(2, 0), players = [{ actor, client }, { actor: otherActor, client: other }];
  const local = () => actor, server: CommandContext = { session: identity.session, origin: { kind: "server-console" } };
  const remote: CommandContext = { session: identity.session, origin: { kind: "remote-client", client } };
  expect(resolveQ1HostCommandActor("god", ["1"], server, players, local)).toBe(otherActor);
  expect(resolveQ1HostCommandActor("god", [], remote, players, local)).toBe(actor);
  expect(() => resolveQ1HostCommandActor("god", ["1"], remote, players, local)).toThrow("only the server console");
  expect(() => resolveQ1HostCommandActor("god", [], server, players, local)).toThrow("connected slots: 0, 1");
  expect(() => resolveQ1HostCommandActor("god", ["2"], server, players, local)).toThrow("not on the server");
  const script: CommandContext = { session: identity.session, origin: { kind: "script", name: "remote.cfg", caller: remote.origin } };
  expect(() => resolveQ1HostCommandActor("god", ["1"], script, players, local)).toThrow("only the server console");
  let received: CommandContext | undefined;
  const commands = new CommandBuffer({ dialect: "q1-netquake", context: script });
  registerQ1ClientCommands(commands, "q1-netquake", (_name, _args, _seat, source) => { received = source; return undefined; });
  commands.append("god\n"); commands.execute(); expect(received).toEqual(script);
});
