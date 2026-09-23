import { expect, test } from "bun:test";
import type { CommandContext } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { ClientCommandBindings } from "../../src/input/client-commands.ts";
import { registerInputCommands, SeatInput } from "../../src/input/seat.ts";
import { QvmCgameImport } from "../../src/compat/qvm/abi.ts";
import { qvmCommonSyscall, type QvmCommonServices } from "../../src/compat/qvm/common-syscalls.ts";
import { QvmMemory } from "../../src/compat/qvm/memory.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";

function fixture() {
  const identity = createIdentityOwner("guest-command-ownership");
  const seats = [identity.seat(0), identity.seat(1)];
  const contexts: CommandContext[] = seats.map((seat, index) => ({ session: identity.session,
    origin: { kind: "local-seat", seat, client: identity.client(0, index) } }));
  const first = contexts[0];
  if (first === undefined) throw new Error("Missing test seat");
  const commands = new CommandBuffer({ dialect: "q3", context: first });
  const calls: string[] = [];
  const bindings = new ClientCommandBindings(commands, seats, (command, seat) => {
    calls.push(`${seat.index}:${command.argv.join(" ")}`);
  });
  const send = (index: number, text: string) => {
    const context = contexts[index];
    if (context === undefined) throw new Error("Missing test seat");
    commands.append(`${text}\n`, context); commands.execute();
  };
  const owner = (index: number) => {
    const seat = seats[index];
    if (seat === undefined) throw new Error("Missing test seat");
    return bindings.createOwner(seat);
  };
  return { identity, seats, contexts, commands, bindings, calls, send, owner };
}

test("failed staged guest registration and removal cannot mutate published commands", () => {
  const f = fixture(), live = f.owner(0);
  live.register("guest"); f.bindings.activate();
  const staged = new ClientCommandBindings(f.commands, f.seats, () => { throw new Error("Staged guest dispatched"); });
  const seat = f.seats[0]; if (seat === undefined) throw new Error("Missing seat");
  const candidate = staged.createOwner(seat);
  candidate.register("guest"); candidate.remove("guest"); candidate.register("candidate"); candidate.close(); staged.deactivate();
  expect(f.commands.exists("candidate")).toBe(false);
  f.send(0, "guest"); expect(f.calls).toEqual(["0:guest"]);
});

test("two seats and successive same-seat guests release only their own claims", () => {
  const f = fixture(), first = f.owner(0), second = f.owner(1);
  first.register("guest"); second.register("guest"); f.bindings.activate();
  f.send(0, "guest a"); f.send(1, "guest b");
  first.remove("guest");
  f.send(0, "guest ignored"); f.send(1, "guest c");
  expect(f.calls).toEqual(["0:guest a", "1:guest b", "1:guest c"]);
  const replacement = f.owner(1); replacement.register("guest"); second.close();
  f.send(1, "guest d"); expect(f.calls.at(-1)).toBe("1:guest d");
  replacement.close(); expect(f.commands.exists("guest")).toBe(false);
});

test("runtime add/remove and close protect engine collisions and replacement handlers", () => {
  const f = fixture(), owner = f.owner(0);
  let engineCalls = 0;
  f.commands.register("engine", () => { engineCalls++; });
  f.bindings.activate(); owner.register("engine"); owner.register("dynamic");
  f.send(0, "engine"); f.send(0, "dynamic");
  owner.remove("engine"); expect(f.commands.exists("engine")).toBe(true);
  f.commands.unregister("dynamic"); f.commands.register("dynamic", () => { engineCalls++; });
  owner.remove("dynamic"); owner.close(); f.bindings.deactivate();
  f.send(0, "dynamic"); expect(engineCalls).toBe(2);
  expect(f.calls).toEqual(["0:dynamic"]);
  expect(() => owner.register("late")).toThrow("retired");
});

test("publication retires old dispatchers before activating candidate claims", () => {
  const f = fixture(), old = f.owner(0);
  old.register("guest"); f.bindings.activate();
  const nextCalls: string[] = [], next = new ClientCommandBindings(f.commands, f.seats, command => { nextCalls.push(command.raw); });
  const seat = f.seats[0]; if (seat === undefined) throw new Error("Missing seat");
  const replacement = next.createOwner(seat); replacement.register("guest");
  f.bindings.deactivate(); next.activate(); old.close(); f.bindings.deactivate();
  f.send(0, "guest after"); expect(nextCalls).toEqual(["guest after"]); expect(f.calls).toEqual([]);
  next.deactivate(); expect(f.commands.exists("guest")).toBe(false);
});

test("native score input remains available per seat and after the last guest removal", () => {
  const f = fixture();
  const inputs = f.contexts.map(context => {
    if (context.origin.kind !== "local-seat") throw new Error("Expected local seat");
    return new SeatInput({ seat: context.origin.seat, dialect: "q3", context, commands: f.commands, uiEvent: () => false });
  });
  const unregister = registerInputCommands(f.commands, seat => inputs.find(input => input.seat.equals(seat)) ?? null,
    command => f.bindings.dispatch(command));
  const guest = f.owner(0); guest.register("+scores"); guest.register("-scores"); guest.register("+zoom"); guest.register("-zoom");
  f.bindings.activate();
  f.send(0, "+scores 1 10"); f.send(1, "+scores 2 10");
  expect(f.calls).toEqual(["0:+scores 1 10"]);
  expect(inputs[0]?.button("scores").active).toBe(false); expect(inputs[1]?.button("scores").active).toBe(true);
  f.send(1, "-scores 2 20"); expect(inputs[1]?.button("scores").active).toBe(false);
  f.send(0, "+zoom"); f.send(0, "-zoom"); expect(f.calls.slice(-2)).toEqual(["0:+zoom", "0:-zoom"]);
  guest.close();
  f.send(0, "+scores 3 30"); expect(inputs[0]?.button("scores").active).toBe(true);
  f.send(0, "-scores 3 40"); expect(inputs[0]?.button("scores").active).toBe(false);
  expect(f.commands.exists("+zoom")).toBe(false); expect(f.commands.exists("-zoom")).toBe(false);
  f.bindings.deactivate(); unregister();
});

test("guest removal preserves preexisting zoom handlers and rejects foreign seat owners", () => {
  const f = fixture(); let zoom = 0;
  f.commands.register("+zoom", () => { zoom++; });
  const guest = f.owner(0); guest.register("+zoom"); f.bindings.activate();
  guest.remove("+zoom"); f.send(0, "+zoom"); expect(zoom).toBe(1);
  expect(() => f.bindings.createOwner(createIdentityOwner("foreign").seat(0))).toThrow("local seat");
});

test("actual cgame add/remove syscalls update runtime claims without removing another guest", () => {
  const f = fixture(), first = f.owner(0), second = f.owner(1);
  const context = f.contexts[0]; if (context === undefined) throw new Error("Missing context");
  const guest = new QvmMemory(new Uint8Array(1024)); guest.writeString(512, "vmcommand", 64);
  const services: QvmCommonServices = { role: "cgame", cvars: new CvarRegistry({ dialect: "q3", context }),
    print: () => {}, milliseconds: () => 0, arguments: () => [], commands: {
      register: first.register, remove: first.remove, append: text => f.commands.append(text, context), reliable: () => {},
    } };
  const invoke = (code: QvmCgameImport) => {
    const words = new DataView(new ArrayBuffer(8)); words.setInt32(0, code, true); words.setInt32(4, 512, true);
    return qvmCommonSyscall({ kind: "engine", role: "cgame", code, words, memory: guest.bytes, guest, commandArguments: null,
      cancelFunction: () => { throw new Error("Unexpected VM cancellation"); }, invoke: () => { throw new Error("Unexpected VM reentry"); }, invokeAsync: async () => { throw new Error("Unexpected VM reentry"); } }, services);
  };
  f.bindings.activate();
  expect(invoke(QvmCgameImport.CG_ADDCOMMAND)).toBe(0);
  second.register("vmcommand"); f.send(0, "vmcommand");
  expect(invoke(QvmCgameImport.CG_REMOVECOMMAND)).toBe(0);
  f.send(1, "vmcommand"); expect(f.calls).toEqual(["0:vmcommand", "1:vmcommand"]);
  expect(f.commands.exists("vmcommand")).toBe(true);
  second.close(); expect(f.commands.exists("vmcommand")).toBe(false);
});

test("default local console and its queued scripts address the first local client without granting server or remote origins", () => {
  const identity = createIdentityOwner("default-local-console");
  const seats = [identity.seat(0), identity.seat(1)];
  const first = seats[0], second = seats[1];
  if (first === undefined || second === undefined) throw new Error("Missing test seats");
  const context: CommandContext = { session: identity.session, origin: { kind: "local-console" } };
  const cvars = new CvarRegistry({ dialect: "q3", context });
  const commands = new CommandBuffer({ dialect: "q3", context, cvars });
  const called: number[] = [];
  const bindings = new ClientCommandBindings(commands, seats, (_command, seat) => { called.push(seat.index); });
  bindings.createOwner(second).register("guest"); bindings.createOwner(first).register("guest"); bindings.activate();
  cvars.register("script", "guest;wait;guest");
  commands.append("vstr script\n"); commands.execute(); expect(called).toEqual([0]);
  commands.execute(); expect(called).toEqual([0, 0]);
  for (const origin of [{ kind: "server-console" }, { kind: "remote-client", client: identity.client(0, 1) }] satisfies readonly CommandContext["origin"][]) {
    commands.append("guest\n", { session: identity.session, origin }); commands.execute();
  }
  expect(called).toEqual([0, 0]);
  commands.append("guest\n", { session: identity.session, origin: { kind: "script", name: "key-binding", caller: { kind: "local-seat", seat: second, client: identity.client(0, 1) } } });
  commands.execute(); expect(called).toEqual([0, 0, 1]);
});


test("component command claims preserve primary precedence and reject ambiguous unscoped owners", () => {
  const f=fixture(), seat=f.seats[0], source=f.contexts[0];
  if(seat===undefined || source===undefined) throw Error("Missing seat");
  const primary=f.owner(0), firstInstance=Symbol("first"), secondInstance=Symbol("second"), received:string[]=[];
  const first=f.bindings.createOwner(seat,{instance:firstInstance,label:"mod:first",execute:command=>{received.push(`first:${command.raw}`);}});
  const second=f.bindings.createOwner(seat,{instance:secondInstance,label:"mod:second",execute:command=>{received.push(`second:${command.raw}`);}});
  first.register("scores");second.register("scores");primary.register("scores");f.bindings.activate();
  f.send(0,"scores");expect(f.calls).toEqual(["0:scores"]);expect(received).toEqual([]);
  const context:CommandContext={...source,producer:{kind:"client-module",module:{id:"mod:first",artifactPath:"vm/cgame.qvm",digest:"sha256:abc",revision:"fixture"},instance:firstInstance}};
  f.commands.append("scores\n",context);f.commands.execute();expect(received).toEqual(["first:scores"]);
  primary.close();expect(()=>f.send(0,"scores")).toThrow("Ambiguous component client command scores");
  second.close();f.send(0,"scores");expect(received.at(-1)).toBe("first:scores");
  f.commands.append("scores\n",context);f.commands.discardProducer(firstInstance);first.close();f.commands.execute();
  expect(received).toHaveLength(2);expect(f.commands.exists("scores")).toBe(false);
});
