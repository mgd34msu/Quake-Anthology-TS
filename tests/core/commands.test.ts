import { SharedCvarMirror } from "../../src/core/cvars/mirror.ts";
import { q3ClientCollision } from "../../src/app/bootstrap/q3-client/collision.ts";
import type { SceneQueries, TracePolicy } from "../../src/contracts/scene.ts";
import { registerQ3ServerCvars } from "../../src/app/bootstrap/simulation/q3/server-state.ts";
import { CollisionMapSettings, collisionMapCvarDefinitions } from "../../src/world/collision/q3/world.ts";
import { q3GameCvarDefinitions } from "../../src/content/q3/base/settings.ts";
import { cvarTable } from "../../src/content/q3/presentation/config.ts";
import { expect, test } from "bun:test";
import { ApplicationConsoleRouting } from "../../src/app/bootstrap/console.ts";
import { SeatConsole } from "../../src/console/session.ts";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer, tokenizeCommand } from "../../src/core/commands/index.ts";
import { CvarRegistry, CvarFlag, Q2CvarFlag } from "../../src/core/cvars/index.ts";

const owner = createIdentityOwner("commands-smoke");
function context(index = 0): CommandContext {
  return { session: owner.session, origin: { kind: "local-seat", seat: owner.seat(index), client: owner.client(index, 0) } };
}

test("source command tokenization keeps family punctuation, comments and byte bounds", () => {
  expect(tokenizeCommand('echo "a;b" {x:y} // ignored', "q1-netquake").argv).toEqual(["echo", "a;b", "{", "x", ":", "y", "}"]);
  expect(tokenizeCommand('echo a/*comment*/b "x"\0ignored', "q3").argv).toEqual(["echo", "a", "b", "x"]);
  expect(tokenizeCommand('echo {x:y}', "q2-classic").argv).toEqual(["echo", "{x:y}"]);
  expect(tokenizeCommand(`echo ${"x".repeat(128)}`, "q2-classic").argv).toEqual(["echo", ""]);
  expect(() => tokenizeCommand("echo \u0100", "q3")).toThrow("source bytes");
});

test("registration completion is newest first and Q3 touches dispatched entries", () => {
  const commands = new CommandBuffer({ dialect: "q3", context: context(), builtins: false });
  const calls: string[] = [];
  commands.register("Choice", () => { calls.push("old"); });
  commands.register("choice", () => { calls.push("new"); });
  commands.register("other", () => {});
  expect(commands.register("choice", () => {})).toBe(false);
  expect(commands.complete("ch")).toBe("choice");
  commands.executeNow("CHOICE");
  expect(calls).toEqual(["new"]);
  expect(commands.registeredNames()).toEqual(["choice", "other", "Choice"]);
});

test("alternating seat buffers retain script source through insertion, wait and nested execution", () => {
  const calls: string[] = [];
  function make(index: number): CommandBuffer {
    const buffer = new CommandBuffer({ dialect: "q1-quakeworld", context: context(index), readScript: () => "note script;wait;note resumed" });
    buffer.register("note", command => {
      const origin = command.source.origin, caller = origin.kind === "script" ? origin.caller : origin;
      calls.push(`${caller.kind === "local-seat" ? caller.seat.index : -1}:${command.args[0] ?? ""}:${origin.kind}`);
      if (command.args[0] === "nested") { command.executeNow("note child"); command.assertActive(); }
    });
    return buffer;
  }
  const first = make(0), second = make(1);
  first.append("exec script.cfg;note nested\n");
  second.append("note second\n");
  first.execute(); second.execute(); first.execute();
  expect(calls).toEqual(["0:script:script", "1:second:local-seat", "0:resumed:script", "0:nested:local-seat", "0:child:local-seat"]);
});

test("insertion, aliases, macros, deferred text and waits retain family behavior", () => {
  for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q3"] satisfies readonly CommandDialect[]) {
    const buffer = new CommandBuffer({ dialect, context: context(), builtins: false });
    buffer.append("tail"); buffer.insert("head");
    expect(buffer.pendingText).toBe(dialect === "q1-quakeworld" || dialect === "q3" ? "head\ntail" : "headtail");
  }
  const cvars = new CvarRegistry({ dialect: "q2-classic", context: context() });
  cvars.register("word", "expanded");
  const calls: string[] = [];
  const buffer = new CommandBuffer({ dialect: "q2-classic", context: context(), cvars });
  buffer.register("note", command => { calls.push(command.args.join(" ")); });
  buffer.append('alias old "note old";alias newer "note $word";newer;wait 20;note "$word"\n');
  buffer.copyToDefer(); buffer.append("note tail\n"); buffer.insertFromDefer();
  buffer.execute(); expect(calls).toEqual(["expanded"]);
  expect(buffer.complete("n")).toBe("note"); expect(buffer.aliasNames()).toEqual(["newer", "old"]);
  buffer.execute(); expect(calls).toEqual(["expanded", "$word", "tail"]);
});

test("Q3 numeric wait and null callback use cvar then client/server/UI fallback order", () => {
  const cvars = new CvarRegistry({ dialect: "q3", context: context() });
  cvars.register("rate", "1");
  const calls: string[] = [];
  const buffer = new CommandBuffer({ dialect: "q3", context: context(), cvars,
    clientGame: () => { calls.push("client"); return false; }, serverGame: () => { calls.push("server"); return false; },
    ui: () => { calls.push("ui"); return false; }, forwardToServer: () => { calls.push("forward"); } });
  buffer.registerFallbackName("rate");
  buffer.append("rate 2;wait 2;unknown\n");
  buffer.execute(); expect(cvars.variableString("rate")).toBe("2"); expect(calls).toEqual([]);
  buffer.execute(); expect(calls).toEqual([]);
  buffer.execute(); expect(calls).toEqual(["client", "server", "ui", "forward"]);
});

test("buffer limits retain source append rejection and insertion bounds", () => {
  const output: string[] = [];
  const buffer = new CommandBuffer({ dialect: "q3", context: context(), builtins: false, maxBufferLength: 8, print: text => { output.push(text); } });
  buffer.append("12345678"); expect(buffer.pendingText).toBe("");
  buffer.append("123456"); buffer.insert("x"); expect(buffer.pendingText).toBe("x\n123456");
  buffer.insert("y"); expect(buffer.pendingText).toBe("x\n123456"); expect(output).toHaveLength(2);
});

test("common cvar commands preserve numeric formatting and native toggle policies", () => {
  for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
    const cvars = new CvarRegistry({ dialect, context: context() }), output: string[] = [];
    const commands = new CommandBuffer({ dialect, context: context(), cvars, print: text => { output.push(text); } });
    cvars.register("amount", "0"); cvars.register("cycle", "Red"); cvars.register("truth", "0.0");
    commands.executeNow("inc amount 0.5"); expect(cvars.variableString("amount")).toBe("0.500000");
    commands.executeNow("inc amount 0.5"); expect(cvars.variableString("amount")).toBe("1");
    commands.executeNow("dec amount"); expect(cvars.variableString("amount")).toBe("0");
    commands.executeNow("toggle truth"); expect(cvars.variableString("truth")).toBe(dialect === "q3" ? "1" : "0.0");
    commands.executeNow("toggle cycle red BLUE"); expect(cvars.variableString("cycle")).toBe("BLUE");
    commands.executeNow("toggle cycle red BLUE"); expect(cvars.variableString("cycle")).toBe("red");
    cvars.set("amount", "1e3"); commands.executeNow("inc amount"); expect(cvars.variableString("amount")).toBe("1e3");
    commands.executeNow("reset amount"); expect(cvars.variableString("amount")).toBe("0");
    commands.executeNow("inc absent"); expect(cvars.find("absent")).toBeUndefined();
    cvars.set("amount", "."); commands.executeNow("inc amount"); expect(cvars.variableString("amount")).toBe("1");
    cvars.set("amount", "16777216"); commands.executeNow("inc amount"); expect(cvars.variableString("amount")).toBe("16777216");
    cvars.set("amount", "1"); commands.executeNow("inc amount inf"); expect(cvars.variableString("amount")).toBe("inf");
    expect(output.join("")).toContain("can't inc");
  }
});

test("Q2 extended commands retain source flags, protection, latches and info retransmission", () => {
  const cvars = new CvarRegistry({ dialect: "q2-classic", context: context() });
  const commands = new CommandBuffer({ dialect: "q2-classic", context: context(), cvars });
  for (const [name, flag] of [["rom", Q2CvarFlag.ReadOnly], ["noset", Q2CvarFlag.NoSet], ["cheat", Q2CvarFlag.Cheat],
    ["private", Q2CvarFlag.Private], ["noarchive", Q2CvarFlag.NoArchive]] satisfies readonly (readonly [string, number])[]) {
    cvars.register(name, "1", flag); commands.executeNow(`seta ${name} 2`);
    expect((cvars.find(name)?.flags ?? 0) & Q2CvarFlag.Archive).toBe(0);
  }
  cvars.setCheatsEnabled(false); commands.executeNow("inc cheat");
  expect(cvars.variableString("cheat")).toBe("2");
  expect(cvars.variableString("rom")).toBe("1"); expect(cvars.variableString("noset")).toBe("1");
  cvars.set("rom", "3", true); expect(cvars.variableString("rom")).toBe("3");
  cvars.register("game", "baseq2", Q2CvarFlag.Latch); cvars.set("game", "ctf", true);
  cvars.register("latched", "1", Q2CvarFlag.Latch); cvars.setServerActive(true);
  commands.executeNow("inc latched"); expect(cvars.find("latched")?.latchedValue).toBe("2");
  commands.executeNow("inc latched 0"); expect(cvars.find("latched")?.latchedValue).toBeUndefined();
  commands.executeNow("seta latched 4"); expect(cvars.find("latched")?.latchedValue).toBe("4");
  expect(cvars.find("latched")?.flags).toBe(Q2CvarFlag.Latch | Q2CvarFlag.Archive);
  commands.executeNow("resetall"); expect(cvars.variableString("game")).toBe("ctf");
  expect(cvars.variableString("rom")).toBe("3"); expect(cvars.variableString("cheat")).toBe("2");
  expect(cvars.find("latched")?.latchedValue).toBeUndefined();
  commands.executeNow("seta nick old"); commands.executeNow("setu nick new name");
  expect(cvars.variableString("nick")).toBe("new name"); expect(cvars.userinfoModified).toBe(true);
  expect(cvars.find("nick")?.flags).toBe(Q2CvarFlag.Custom | Q2CvarFlag.Archive | Q2CvarFlag.UserInfo);
  cvars.clearUserinfoModified(); commands.executeNow("setu nick new name"); expect(cvars.userinfoModified).toBe(true);
  cvars.clearUserinfoModified(); commands.executeNow("sets nick server"); expect(cvars.userinfoModified).toBe(true);
  expect(cvars.find("nick")?.flags).toBe(Q2CvarFlag.Custom | Q2CvarFlag.Archive | Q2CvarFlag.ServerInfo);
  commands.executeNow('setu nick "bad;value"'); expect(cvars.variableString("nick")).toBe("server");
  expect(cvars.find("nick")?.flags).toBe(Q2CvarFlag.Custom | Q2CvarFlag.Archive | Q2CvarFlag.ServerInfo);
  commands.executeNow('setu "bad;name" value'); expect(cvars.find("bad;name")).toBeUndefined();
  commands.executeNow("seta engine 9"); cvars.register("engine", "2", Q2CvarFlag.ReadOnly);
  expect(cvars.variableString("engine")).toBe("2"); expect(cvars.find("engine")?.resetValue).toBe("2");
  expect((cvars.find("engine")?.flags ?? 0) & (Q2CvarFlag.Custom | Q2CvarFlag.Archive)).toBe(0);
});

test("Q1 custom archived variables restore through their own emitted commands", () => {
  for (const dialect of ["q1-netquake", "q1-quakeworld"] satisfies readonly CommandDialect[]) {
    const cvars = new CvarRegistry({ dialect, context: context() });
    const commands = new CommandBuffer({ dialect, context: context(), cvars });
    commands.executeNow("seta custom original"); commands.executeNow("seta custom changed");
    const lines = cvars.archiveCommands(); expect(lines).toEqual(['seta custom "changed"']);
    const restored = new CvarRegistry({ dialect, context: context() });
    const next = new CommandBuffer({ dialect, context: context(), cvars: restored });
    next.append(`${lines.join("\n")}\n`); next.execute(); expect(restored.variableString("custom")).toBe("changed");
    commands.executeNow("reset custom"); expect(cvars.variableString("custom")).toBe("original");
    restored.register("custom", "authored", CvarFlag.ServerInfo);
    expect(restored.variableString("custom")).toBe("changed");
    expect(restored.find("custom")?.resetValue).toBe("authored");
    expect(restored.find("custom")?.flags).toBe(CvarFlag.Archive | CvarFlag.ServerInfo);
    if (dialect === "q1-quakeworld") expect(restored.propagatedInfo("server-info")).toBe("\\custom\\changed");
    restored.register("custom", "duplicate", CvarFlag.UserInfo);
    expect(restored.find("custom")?.resetValue).toBe("authored");
    expect(restored.find("custom")?.flags).toBe(CvarFlag.Archive | CvarFlag.ServerInfo);
    next.executeNow("reset custom"); expect(restored.variableString("custom")).toBe("authored");
  }
});

test("resetall respects Q3 protected and no-restart values without force or deletion", () => {
  const cvars = new CvarRegistry({ dialect: "q3", context: context() });
  const commands = new CommandBuffer({ dialect: "q3", context: context(), cvars });
  cvars.register("protected", "1", CvarFlag.ReadOnly); cvars.set("protected", "2", true);
  cvars.register("persistent", "1", CvarFlag.NoRestart); cvars.set("persistent", "2");
  cvars.register("cheat", "1", CvarFlag.Cheat); cvars.set("cheat", "2", true);
  cvars.register("sv_cheats", "0"); cvars.set("custom", "3");
  cvars.register("ordinary", "1"); cvars.set("ordinary", "2");
  commands.executeNow("resetall");
  expect(cvars.variableString("protected")).toBe("2"); expect(cvars.variableString("persistent")).toBe("2");
  expect(cvars.variableString("cheat")).toBe("2"); expect(cvars.variableString("custom")).toBe("3");
  expect(cvars.variableString("ordinary")).toBe("1");
});

test("application console submits common cvar operations to the invoking seat and live server", () => {
  for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
    const first = new CvarRegistry({ dialect, context: context(0) }), second = new CvarRegistry({ dialect, context: context(1) });
    const serverContext: CommandContext = { session: owner.session, origin: { kind: "server-console" } };
    const server = new CvarRegistry({ dialect, context: serverContext }), fallback = new CvarRegistry({ dialect, context: serverContext });
    first.register("local", "1"); second.register("local", "1"); server.register("shared", "1");
    first.register("shared", "100"); second.register("shared", "100");
    const routing = new ApplicationConsoleRouting({ fallback, sourceDialect: () => dialect,
      server: () => ({ cvars: server, sharedNames: ["shared"] }),
      seat: seat => seat.equals(owner.seat(0)) ? first : seat.equals(owner.seat(1)) ? second : null });
    const commands = new CommandBuffer({ dialect, context: context(), cvarRouting: routing });
    const console = new SeatConsole({ seat: owner.seat(0), dialect, context: context(), commands, cvars: fallback,
      now: () => 0, connected: () => true, clipboard: () => null, focus: () => {}, chat: () => { throw new Error("command became chat"); } });
    console.field.setText("/inc shared; inc local; seta saved first; wait; dec local 0.5"); console.submit();
    commands.append("inc local 4; seta saved second\n", context(1));
    commands.execute(); commands.execute();
    expect(first.variableString("local")).toBe("1.500000"); expect(second.variableString("local")).toBe("5");
    expect(first.variableString("saved")).toBe("first"); expect(second.variableString("saved")).toBe("second");
    expect(server.variableString("shared")).toBe("2"); expect(first.variableString("shared")).toBe("100");
    console.field.setText("/resetall"); console.submit(); commands.execute();
    expect(first.variableString("local")).toBe("1"); expect(second.variableString("local")).toBe("5");
    expect(server.variableString("shared")).toBe("1"); expect(first.variableString("shared")).toBe("100");
    expect(fallback.snapshots()).toHaveLength(0);
    expect(() => commands.append("inc local\n", { session: createIdentityOwner("foreign").session, origin: { kind: "server-console" } })).toThrow("another session");
    routing.close();
  }
});

test("Q2 private data stays out of macros, info and archives, and custom archives keep their flag", () => {
  const cvars = new CvarRegistry({ dialect: "q2-classic", context: context() }), output: string[] = [];
  const commands = new CommandBuffer({ dialect: "q2-classic", context: context(), cvars, print: text => { output.push(text); } });
  cvars.register("secret", "hidden", Q2CvarFlag.Private | Q2CvarFlag.UserInfo | Q2CvarFlag.Archive);
  commands.executeNow("echo $secret"); expect(output.join("")).not.toContain("hidden");
  expect(cvars.infoString(Q2CvarFlag.UserInfo)).toBe(""); expect(cvars.archiveCommands()).toEqual([]);
  commands.executeNow("seta custom value");
  const archived = cvars.archiveCommands(); expect(archived).toEqual(['seta custom "value"']);
  const restored = new CvarRegistry({ dialect: "q2-classic", context: context() });
  const next = new CommandBuffer({ dialect: "q2-classic", context: context(), cvars: restored });
  next.append(`${archived.join("\n")}\n`); next.execute(); expect(restored.archiveCommands()).toEqual(archived);
  cvars.register("repair", "bad;old"); commands.executeNow("setu repair valid");
  expect(cvars.infoString(Q2CvarFlag.UserInfo)).toContain("\\repair\\valid");
  cvars.register("pending", "bad;old", Q2CvarFlag.Latch); cvars.setServerActive(true);
  commands.executeNow("setu pending valid"); expect((cvars.find("pending")?.flags ?? 0) & Q2CvarFlag.UserInfo).toBe(0);
});

test("awaitable command drain waits between guest fallback and later cvar dispatch", async () => {
  const cvars = new CvarRegistry({ dialect: "q3", context: context() }); cvars.register("g_x", "1");
  const gate = Promise.withResolvers<void>(), calls: string[] = []; let pending = false;
  const commands = new CommandBuffer({ dialect: "q3", context: context(), cvars,
    serverGame: command => { calls.push(`${command.argv.join(" ")}:${cvars.variableString("g_x")}`); pending = true; return true; } });
  commands.append("guest first;set g_x 2;guest second\n");
  const executing = commands.executeAsync(async () => { if (pending) { pending = false; await gate.promise; } });
  expect(calls).toEqual(["guest first:1"]); expect(cvars.variableString("g_x")).toBe("1");
  expect(() => commands.execute()).toThrow("already draining");
  await expect(commands.executeAsync(async () => {})).rejects.toThrow("already executing");
  gate.resolve(); expect(await executing).toBe(3);
  expect(calls).toEqual(["guest first:1", "guest second:2"]); expect(commands.pendingText).toBe("");
});

test("awaited script insertion precedes the remaining buffer and keeps script provenance", async () => {
  const script = Promise.withResolvers<string>(), calls: string[] = [];
  const commands = new CommandBuffer({ dialect: "q3", context: context() });
  let request: CommandContext | null = null;
  commands.unregister("exec");
  commands.register("exec", invocation => { request = invocation.source; return undefined; });
  commands.register("note", invocation => {
    calls.push(`${invocation.args[0]}:${invocation.source.origin.kind}:${invocation.direct}`);
    if (invocation.args[0] === "script") invocation.executeNow("note nested");
    return undefined;
  });
  commands.append("exec fixture;note tail\n");
  const executing = commands.executeAsync(async () => {
    const caller = request; request = null;
    if (caller !== null) commands.insert(await script.promise, { session: caller.session, origin: { kind: "script", name: "fixture.cfg", caller: caller.origin } });
  });
  expect(calls).toEqual([]); expect(commands.pendingText).toBe("note tail\n");
  script.resolve("note script"); expect(await executing).toBe(3);
  expect(calls).toEqual(["script:script:false", "nested:script:false", "tail:local-seat:true"]);
  expect(commands.executionContext).toBeUndefined(); expect(commands.tokenizedArguments).toEqual(["note", "tail"]);
});

test("awaitable drains preserve family wait and Q2 alias limits", async () => {
  for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
    const syncCalls: string[] = [], asyncCalls: string[] = [];
    const sync = new CommandBuffer({ dialect, context: context() }), asynchronous = new CommandBuffer({ dialect, context: context() });
    sync.register("note", invocation => { syncCalls.push(invocation.args.join(" ")); return undefined; });
    asynchronous.register("note", invocation => { asyncCalls.push(invocation.args.join(" ")); return undefined; });
    const text = "note first;wait 2;note last\n"; sync.append(text); asynchronous.append(text);
    for (let frame = 0; frame < 3; frame++) {
      expect(await asynchronous.executeAsync(async () => {})).toBe(sync.execute());
      expect(asyncCalls).toEqual(syncCalls); expect(asynchronous.pendingText).toBe(sync.pendingText);
    }
  }
  const output: string[] = [], commands = new CommandBuffer({ dialect: "q2-classic", context: context(), print: text => { output.push(text); } });
  commands.defineAlias("cycle", "cycle\n"); commands.append("cycle\n");
  expect(await commands.executeAsync(async () => {})).toBe(16); expect(output).toEqual(["ALIAS_LOOP_COUNT\n"]);
});

test("failed awaited action leaves later commands pending and releases drain ownership", async () => {
  const calls: string[] = [], commands = new CommandBuffer({ dialect: "q3", context: context() });
  commands.register("note", invocation => { calls.push(invocation.args[0] ?? ""); return undefined; });
  commands.append("note first;note second\n");
  await expect(commands.executeAsync(async () => { throw new Error("mounted read failed"); })).rejects.toThrow("mounted read failed");
  expect(calls).toEqual(["first"]); expect(commands.pendingText).toBe("note second\n");
  expect(commands.execute()).toBe(1); expect(calls).toEqual(["first", "second"]);
});

test("replacement command buffers retain deferred source context, aliases and waits without consuming the old buffer", () => {
  const before = new CommandBuffer({ dialect: "q2-classic", context: context(0) });
  before.executeNow('alias saved "note alias"');
  before.append("note deferred\n", context(1));
  before.copyToDefer();
  before.append("wait;note queued;saved\n", context(0));
  before.execute();
  const after = new CommandBuffer({ dialect: "q2-classic", context: context(0) });
  const calls: { readonly text: string; readonly source: CommandContext }[] = [];
  after.register("note", command => { calls.push({ text: command.args[0] ?? "", source: command.source }); });
  after.copyPendingFrom(before);
  expect(after.pendingText).toBe(before.pendingText);
  expect(after.deferredText).toBe(before.deferredText);
  after.insertFromDefer();
  after.execute();
  expect(calls.map(call => call.text)).toEqual(["deferred", "queued", "alias"]);
  expect(calls[0]?.source).toEqual(context(1));
  expect(calls[1]?.source).toEqual(context(0));
  expect(before.pendingText).toContain("note queued");
  expect(before.deferredText).toBe("note deferred\n");
});

test("local Q3 console keeps source globals and SystemInfo mirrors under server authority", () => {
  const server = new CvarRegistry({ dialect: "q3", context: { session: owner.session, origin: { kind: "server-console" } } });
  const first = new CvarRegistry({ dialect: "q3", context: context(0) }), second = new CvarRegistry({ dialect: "q3", context: context(1) });
  const fallback = new CvarRegistry({ dialect: "q3", context: context() });
  for (const definition of q3GameCvarDefinitions("missionpack")) server.register(definition.name, definition.value, definition.flags);
  registerQ3ServerCvars(server, { maxClients: 8, mapName: "test" });
  for (const client of [first, second]) {
    for (const definition of cvarTable("missionpack")) client.register(definition.name, definition.defaultValue, definition.flags);
    new CollisionMapSettings(client).registerMap();
    client.register("sv_allowDownload", "0");
    client.register("mod_movement_scale", "1");
    client.register("local_only", "1", CvarFlag.Archive);
  }
  server.register("mod_movement_scale", "2", CvarFlag.SystemInfo);
  const routing = new ApplicationConsoleRouting({ fallback, sourceDialect: () => "q3",
    server: () => ({ cvars: server, sharedNames: q3GameCvarDefinitions("missionpack").map(definition => definition.name) }),
    seat: id => id.equals(owner.seat(0)) ? first : second });
  const commands = new CommandBuffer({ dialect: "q3", context: context(), cvarRouting: routing });
  const snapshots = commands.cvarSnapshots();
  for (const name of ["pmove_msec", "pmove_fixed", "g_synchronousClients", "com_blood", "g_redteam", "g_blueteam", "mod_movement_scale"])
    expect(snapshots.filter(value => value.name === name)).toHaveLength(1);
  expect(routing.owner("MOD_MOVEMENT_SCALE", context(1))).toBe(server);
  for (const definition of collisionMapCvarDefinitions) {
    expect(routing.owner(definition.name.toUpperCase(), context(1))).toBe(server);
    expect(server.find(definition.name)?.flags).toBe(definition.flags);
    expect(snapshots.filter(value => value.name.toLowerCase() === definition.name.toLowerCase())).toHaveLength(1);
  }
  expect(routing.owner("sv_allowDownload", context(1))).toBe(server);
  server.set("sv_cheats", "1", true);
  for (const text of ["set cm_playerCurveClip 0", "set cm_noCurves 1", "set sv_allowDownload 1"]) commands.executeNow(text, context(1));
  expect(server.variableString("cm_playerCurveClip")).toBe("0");
  expect(server.variableString("cm_noCurves")).toBe("1");
  expect(server.variableString("sv_allowDownload")).toBe("1");
  expect(first.variableString("cm_playerCurveClip")).toBe("1");
  expect(second.variableString("cm_playerCurveClip")).toBe("1");
  expect(commands.archiveCommands().filter(value => value.startsWith("seta cm_playerCurveClip "))).toEqual(['seta cm_playerCurveClip "0"']);
  server.set("sv_cheats", "0", true);
  commands.executeNow("set cm_playerCurveClip 1");
  expect(server.variableString("cm_playerCurveClip")).toBe("0");
  registerQ3ServerCvars(server, { maxClients: 8, mapName: "test" });
  expect(server.variableString("cm_playerCurveClip")).toBe("0");

  commands.append("seta pmove_msec 16; set mod_movement_scale 3; set com_blood 0; set local_only first"); commands.execute();
  commands.executeNow("set local_only second", context(1));
  expect(server.variableString("pmove_msec")).toBe("16");
  expect(server.variableString("mod_movement_scale")).toBe("3");
  expect(server.variableString("com_blood")).toBe("0");
  expect(first.variableString("pmove_msec")).toBe("8");
  expect(second.variableString("pmove_msec")).toBe("8");
  expect(first.variableString("local_only")).toBe("first");
  expect(second.variableString("local_only")).toBe("second");
  expect(commands.archiveCommands().filter(value => value.startsWith("seta pmove_msec "))).toEqual(['seta pmove_msec "16"']);
  server.register("undeclared_mirror", "server"); first.register("undeclared_mirror", "client");
  expect(commands.cvarSnapshots().filter(value => value.name === "undeclared_mirror")).toMatchObject([{ value: "server" }]);
  expect(first.variableString("undeclared_mirror")).toBe("client");
});

test("Q2 world declaration wins without treating NoSet as a Q3 mirror flag", () => {
  const server = new CvarRegistry({ dialect: "q2-classic", context: { session: owner.session, origin: { kind: "server-console" } } });
  const seat = new CvarRegistry({ dialect: "q2-classic", context: context() });
  server.register("duplicate", "server", Q2CvarFlag.NoSet); seat.register("duplicate", "client");
  const routing = new ApplicationConsoleRouting({ fallback: seat, sourceDialect: () => "q2-classic",
    server: () => ({ cvars: server, sharedNames: [] }), seat: () => seat });
  expect(routing.owner("duplicate", context())).toBe(server);
  expect(seat.variableString("duplicate")).toBe("client");
});


test("shared collision cvars reach server settings and both cgame trace consumers without merging seat preferences", () => {
  const server = new CvarRegistry({ dialect: "q3", context: { session: owner.session, origin: { kind: "server-console" } } });
  registerQ3ServerCvars(server, { maxClients: 8, mapName: "test" });
  server.register("sv_cheats", "1");
  const seats = [0, 1].map(index => new CvarRegistry({ dialect: "q3", context: context(index) }));
  const names = collisionMapCvarDefinitions.map(definition => definition.name);
  const mirrors = seats.map(seat => new SharedCvarMirror(server, seat, names, () => {}));
  const policies: TracePolicy[] = [];
  const queries: SceneQueries = {
    trace: query => { policies.push(query.policy); return { kind: "q3", fraction: 1, end: query.end, startSolid: false, allSolid: false,
      contact: { kind: "none" }, hit: { kind: "none" }, contents: 0, surfaceFlags: 0,
      sourcePlane: { normal: { x: 0, y: 0, z: 1 }, distance: 0, type: 2, signbits: 0 } }; },
    pointContents: query => { policies.push(query.policy); return { kind: "q3", contents: 0 }; },
    boxLeaves: () => ({ leaves: [], topnode: null, overflow: false }), areasConnected: () => true, clusterVisible: () => true,
  };
  const routing = new ApplicationConsoleRouting({ fallback: server, sourceDialect: () => "q3", server: () => ({ cvars: server, sharedNames: [] }),
    seat: id => seats[id.index] ?? null });
  const commands = new CommandBuffer({ dialect: "q3", context: context(), cvarRouting: routing });
  try {
    for (const [index, seat] of seats.entries()) seat.register("cg_fov", String(90 + index * 10));
    commands.append("set cm_noCurves 1; set cm_playerCurveClip 0; set cm_noAreas 1"); commands.execute();
    const authoritative = new CollisionMapSettings(server);
    expect([authoritative.noCurves, authoritative.playerCurveClip, authoritative.noAreas]).toEqual([true, false, true]);
    for (const seat of seats) {
      const settings = new CollisionMapSettings(seat);
      expect([settings.noCurves, settings.playerCurveClip, settings.noAreas]).toEqual([true, false, true]);
      const collision = q3ClientCollision(queries, settings), point = { x: 0, y: 0, z: 0 };
      collision.trace({ start: point, end: point, shape: { kind: "point" }, mask: 1 }); collision.pointContents(point);
    }
    expect(policies).toHaveLength(4);
    for (const policy of policies) expect(policy).toMatchObject({ kind: "q3", curves: false, playerCurveClip: false });
    expect(seats.map(seat => seat.variableString("cg_fov"))).toEqual(["90", "100"]);
    seats[0]?.set("cm_noCurves", "0");
    expect(server.variableString("cm_noCurves")).toBe("0");
    expect(seats[1]?.variableString("cm_noCurves")).toBe("0");
    server.set("sv_cheats", "0", true);
    commands.executeNow("set cm_playerCurveClip 1");
    expect(seats.map(seat => seat.variableString("cm_playerCurveClip"))).toEqual(["0", "0"]);
    const foreign = new CvarRegistry({ dialect: "q3", context: { session: createIdentityOwner("foreign").session, origin: { kind: "server-console" } } });
    expect(() => new SharedCvarMirror(server, foreign, names, () => {})).toThrow("same session and dialect");
    expect(() => new SharedCvarMirror(server, seats[0] ?? server, ["not_declared"], () => {})).toThrow("not declared");
  } finally { for (const mirror of mirrors) mirror.close(); }
  server.set("cm_noCurves", "1", true);
  expect(seats.map(seat => seat.variableString("cm_noCurves"))).toEqual(["0", "0"]);
});


test("one command owner changes profiles with fresh native builtin, parser and wait behavior", async () => {
  const source = context(), calls: string[] = [], reads: string[] = [];
  const persistent = new CommandBuffer({ dialect: "q2-classic", context: source, print: text => calls.push(text), readScript: name => { reads.push(name); return "record file\n"; } });
  persistent.register("record", command => { calls.push(command.args.join(" ")); return undefined; });
  persistent.executeNow('alias retained "record retained"');
  const identity = persistent;
  for (const dialect of ["q3", "q2-classic", "q3"] satisfies readonly CommandDialect[]) {
    const registry = new CvarRegistry({ dialect, context: source }), expected: string[] = [], expectedReads: string[] = [];
    const fresh = new CommandBuffer({ dialect, context: source, cvars: new CvarRegistry({ dialect, context: source }), print: text => expected.push(text),
      readScript: name => { expectedReads.push(name); return "record file\n"; } });
    fresh.register("record", command => { expected.push(command.args.join(" ")); return undefined; });
    persistent.setProfile(dialect, registry); calls.length = 0; reads.length = 0;
    expect(persistent).toBe(identity); expect(persistent.maximumBufferLength).toBe(fresh.maximumBufferLength);
    expect([...persistent.registeredNames()].sort()).toEqual([...fresh.registeredNames()].sort());
    if (dialect === "q3") expect(persistent.aliasNames()).toEqual([]);
    else { expect(persistent.aliasNames()).toContain("retained"); persistent.executeNow("retained"); await persistent.advanceProgramFrame(); expect(calls).toEqual(["retained"]); calls.length = 0; }
    const script = dialect === "q3" ? 'set program "record vstr"; vstr program; exec fragment; wait 2; record end\n'
      : 'alias invoke "record alias"; invoke; exec fragment; wait 2; record end\n';
    persistent.append(script, source); fresh.append(script, source);
    for (let frame = 0; frame < 6 && (!persistent.programComplete || !fresh.programComplete); frame++) {
      await persistent.advanceProgramFrame(); await fresh.advanceProgramFrame(); expect(calls).toEqual(expected); expect(persistent.programComplete).toBe(fresh.programComplete);
    }
    expect(persistent.programComplete).toBe(true); expect(reads).toEqual(expectedReads); expect(calls).toContain("end");
  }
});

test("profile boundary retains deferred nested scripts, completion callers and trailing waits", async () => {
  const source = context(1), reads = Promise.withResolvers<string>(), calls: string[] = [], completed: CommandContext[] = [];
  const commands = new CommandBuffer({ dialect: "q2-classic", context: source, readScript: () => reads.promise, onScriptComplete: event => completed.push(event.source), print: text => calls.push(text) });
  commands.append("exec outer.cfg; echo tail\n", source); commands.copyToDefer();
  expect(commands.programComplete).toBe(false); commands.setProfile("q3", undefined);
  expect(commands.deferredText).toBe("exec outer.cfg; echo tail\n"); commands.setProfile("q2-classic", undefined);
  const first = commands.advanceProgramFrame();
  await Promise.resolve(); await Promise.resolve();
  expect(() => commands.setProfile("q3", undefined)).toThrow("completed program");
  reads.resolve("echo nested; wait; echo afterwait\n"); await first;
  expect(calls.join("")).toContain("nested"); expect(calls.join("")).not.toContain("afterwait");
  commands.setProfile("q3", undefined);
  await commands.advanceProgramFrame(); expect(commands.programComplete).toBe(true);
  expect(calls.join("")).toContain("afterwait"); expect(calls.join("")).toContain("tail");
  expect(completed).toEqual([{ session: source.session, origin: { kind: "script", name: "outer.cfg", caller: source.origin } }]);
  commands.setProfile("q3", undefined); commands.append("wait 2\n", source); await commands.advanceProgramFrame();
  expect(commands.programComplete).toBe(false); await commands.advanceProgramFrame(); expect(commands.programComplete).toBe(false);
  await commands.advanceProgramFrame(); expect(commands.programComplete).toBe(true);
  commands.setProfile("q2-classic", undefined); expect(commands.dialect).toBe("q2-classic");
});

test("profile validation is atomic and builtin retirement preserves a newer command registration", () => {
  const source = context(), calls: string[] = [];
  const commands = new CommandBuffer({ dialect: "q2-classic", context: source, maxBufferLength: 20000 });
  commands.unregister("echo"); commands.register("echo", () => { calls.push("replacement"); return undefined; });
  const wrong = new CvarRegistry({ dialect: "q2-classic", context: source });
  expect(() => commands.setProfile("q3", wrong)).toThrow("session or dialect"); expect(commands.dialect).toBe("q2-classic");
  commands.setProfile("q3", new CvarRegistry({ dialect: "q3", context: source })); commands.executeNow("echo");
  expect(calls).toEqual(["replacement"]); expect(commands.maximumBufferLength).toBe(20000);
});

for (const [origin, destination] of [["q2-classic", "q3"], ["q3", "q2-classic"]] satisfies readonly (readonly [CommandDialect, CommandDialect])[]) {
  test(`${origin} queued program retains syntax and caller across ${destination} publication`, async () => {
    const first = context(0), second = context(1), calls: { argv: readonly string[]; dialect: CommandDialect; source: CommandContext; world: string }[] = [];
    const output: { text: string; source: CommandContext | undefined }[] = [];
    let world = "old", publish = false;
    const commands = new CommandBuffer({ dialect: origin, context: first, print: (text, source) => output.push({ text, source }) });
    commands.register("load", () => { publish = true; });
    commands.register("probe", command => { calls.push({ argv: command.argv, dialect: command.dialect, source: command.source, world }); });
    commands.append('load; probe a/*comment*/b; echo retained\n', first);
    await commands.executeAsync(async () => {
      if (!publish) return;
      publish = false;
      expect(commands.pendingText).toBe(' probe a/*comment*/b; echo retained\n');
      commands.setProfile(destination, undefined); world = "new";
      commands.append('probe a/*comment*/b; echo fresh\n', second);
      expect(commands.dialect).toBe(destination);
    });
    expect(calls).toEqual([
      { argv: tokenizeCommand('probe a/*comment*/b', origin, 'console').argv, dialect: origin, source: first, world: "new" },
      { argv: tokenizeCommand('probe a/*comment*/b', destination, 'console').argv, dialect: destination, source: second, world: "new" },
    ]);
    expect(output).toEqual([{ text: 'retained \n', source: first }, { text: 'fresh \n', source: second }]);
    expect(commands.programComplete).toBe(true);
  });

  test(`${origin} native wait remains independent of ${destination} default`, async () => {
    const calls: string[] = [], expected: string[] = [];
    const commands = new CommandBuffer({ dialect: origin, context: context(), print: text => calls.push(text) });
    const fresh = new CommandBuffer({ dialect: origin, context: context(), print: text => expected.push(text) });
    commands.append('wait 2; echo tail\n'); fresh.append('wait 2; echo tail\n');
    let published = false;
    await commands.executeAsync(async () => { if (!published) { commands.setProfile(destination, undefined); published = true; } });
    fresh.execute(); expect(calls).toEqual(expected);
    for (let frame = 0; frame < 4; frame++) {
      commands.execute(); fresh.execute(); expect(calls).toEqual(expected); expect(commands.programComplete).toBe(fresh.programComplete);
    }
  });
}

test('origin boundaries prevent one seat or dialect consuming another fragment', async () => {
  const calls: { argv: readonly string[]; source: CommandContext; dialect: CommandDialect }[] = [];
  const commands = new CommandBuffer({ dialect: 'q2-classic', context: context() });
  let publish = false;
  commands.register('load', () => { publish = true; });
  commands.register('probe', command => { calls.push({ argv: command.argv, source: command.source, dialect: command.dialect }); });
  commands.append('load;probe old', context(0));
  await commands.executeAsync(async () => {
    if (!publish) return; publish = false; commands.setProfile('q3', undefined);
    commands.append('probe new', context(1)); commands.append(' joined\n', context(1));
  });
  expect(calls).toEqual([
    { argv: ['probe', 'old'], source: context(0), dialect: 'q2-classic' },
    { argv: ['probe', 'new', 'joined'], source: context(1), dialect: 'q3' },
  ]);
});

test('deferred alias and delayed script preserve program dialect, mode and completion caller', async () => {
  const source = context(1), read = Promise.withResolvers<string>();
  const calls: { argv: readonly string[]; source: CommandContext; dialect: CommandDialect }[] = [];
  const completed: CommandContext[] = [];
  const commands = new CommandBuffer({ dialect: 'q2-classic', context: source, readScript: () => read.promise,
    onScriptComplete: event => { completed.push(event.source); commands.insert('probe completion/*kept*/text\n'); } });
  commands.register('probe', command => { calls.push({ argv: command.argv, source: command.source, dialect: command.dialect }); });
  commands.executeNow('alias retained "probe alias/*kept*/text"', source);
  commands.append('exec pending.cfg; retained; probe tail\n', source); commands.copyToDefer(); commands.insertFromDefer();
  let published = false;
  await commands.executeAsync(async () => { if (!published) { commands.setProfile('q3', undefined); published = true; } });
  expect(calls).toEqual([]); expect(commands.dialect).toBe('q3');
  read.resolve('probe script/*kept*/text; wait; probe afterwait\n'); await read.promise;
  await commands.executeAsync(async () => {});
  expect(calls.map(call => call.argv)).toEqual([['probe', 'script/*kept*/text']]);
  await commands.executeAsync(async () => {});
  const script: CommandContext = { session: source.session, origin: { kind: 'script', name: 'pending.cfg', caller: source.origin } };
  expect(calls).toEqual([
    { argv: ['probe', 'script/*kept*/text'], source: script, dialect: 'q2-classic' },
    { argv: ['probe', 'afterwait'], source: script, dialect: 'q2-classic' },
    { argv: ['probe', 'completion/*kept*/text'], source: script, dialect: 'q2-classic' },
    { argv: ['probe', 'alias/*kept*/text'], source, dialect: 'q2-classic' },
    { argv: ['probe', 'tail'], source, dialect: 'q2-classic' },
  ]);
  expect(completed).toEqual([script]); expect(commands.programComplete).toBe(true);
  expect(commands.exists('alias')).toBe(false); expect(commands.exists('vstr')).toBe(true);
});

test('publication rejects an active command and preserves overridden builtins across retained programs', async () => {
  const calls: string[] = [], commands = new CommandBuffer({ dialect: 'q2-classic', context: context() });
  commands.unregister('echo'); commands.register('echo', command => { calls.push(command.dialect); });
  commands.register('load', () => { expect(() => commands.setProfile('q3', undefined)).toThrow('boundary'); });
  commands.append('load; echo old\n');
  let publish = true;
  await commands.executeAsync(async () => { if (publish) { publish = false; commands.setProfile('q3', undefined); commands.append('echo new\n'); } });
  expect(calls).toEqual(['q2-classic', 'q3']);
});

test('retained Q3 vstr and wait use Q3 grammar after Q2 default publication', async () => {
  const source = context(), cvars = new CvarRegistry({ dialect: 'q3', context: source });
  cvars.register('body', 'probe a/*comment*/b; wait 2; probe end', 0);
  const calls: (readonly string[])[] = [], commands = new CommandBuffer({ dialect: 'q3', context: source, cvarRouting: { owner: () => cvars, visible: () => [cvars] } });
  commands.register('load', () => {});
  commands.register('probe', command => { calls.push(command.argv); expect(command.dialect).toBe('q3'); });
  commands.append('load; vstr body\n');
  let publish = true;
  await commands.executeAsync(async () => { if (publish) { publish = false; commands.setProfile('q2-classic', undefined); } });
  expect(calls).toEqual([['probe', 'a', 'b']]);
  commands.execute(); expect(calls).toHaveLength(1);
  commands.execute(); expect(calls).toEqual([['probe', 'a', 'b'], ['probe', 'end']]);
  expect(commands.dialect).toBe('q2-classic'); expect(commands.exists('vstr')).toBe(false);
});

test("world command disposal cannot remove a later handler with the same name", () => {
  const calls: string[] = [], commands = new CommandBuffer({ dialect: "q3", context: context() });
  const old = (): undefined => { calls.push("old"); }, next = (): undefined => { calls.push("next"); };
  commands.register("worldcmd", old);
  expect(commands.unregister("worldcmd", old)).toBe(true);
  commands.register("worldcmd", next);
  expect(commands.unregister("worldcmd", old)).toBe(false);
  commands.executeNow("worldcmd"); expect(calls).toEqual(["next"]);
  expect(commands.unregister("worldcmd", next)).toBe(true);
});

test("client publication changes idle authority default without dispatching its retained program", async () => {
  const client = new CommandBuffer({ dialect: "q2-classic", context: context() });
  const authority = new CommandBuffer({ dialect: "q2-classic", context: { session: owner.session, origin: { kind: "server-console" } } });
  let world = "old"; const calls: string[] = [];
  client.register("load", () => {});
  authority.register("probe", command => { calls.push(world + ":" + command.dialect + ":" + command.args.join("|")); });
  authority.append("probe a/*kept*/b\n"); client.append("load\n");
  await client.executeAsync(async () => {
    authority.setProfile("q3", undefined); client.setProfile("q3", undefined); world = "new";
    expect(calls).toEqual([]);
  });
  authority.append("probe a/*split*/b\n"); authority.execute();
  expect(calls).toEqual(["new:q2-classic:a/*kept*/b", "new:q3:a|b"]);
});

test("same-profile guest retirement restores native exec and preserves another custom handler", async () => {
  const output: string[] = [], commands = new CommandBuffer({ dialect: "q3", context: context(), readScript: () => "echo restored\n", print: text => output.push(text) });
  const guest = (): undefined => {};
  commands.unregister("exec"); commands.register("exec", guest);
  commands.unregister("echo"); commands.register("echo", command => { output.push("custom:" + command.args.join(" ")); });
  expect(commands.unregister("exec", guest)).toBe(true);
  commands.setProfile("q3", undefined);
  expect(commands.exists("exec")).toBe(true);
  commands.append("exec restored.cfg\n"); await commands.executeScriptsAsync(async () => {});
  expect(output).toEqual(["execing restored.cfg\n", "custom:restored"]);
});

test("profile configuration runs separately from an in-flight originating command tail", async () => {
  const source = context(), output: string[] = [];
  const live = new CommandBuffer({ dialect: "q2-classic", context: source, print: text => output.push(`live:${text}`) });
  const cvars = new CvarRegistry({ dialect: "q1-netquake", context: source });
  cvars.register("profile", "0");
  live.register("load", () => {});
  live.append("load; echo tail\n");
  let configured = false;
  await live.executeAsync(async () => {
    if (configured) return;
    configured = true;
    const pending = live.pendingText;
    const program = live.prepareProgram({ dialect: "q1-netquake", context: source, cvars,
      readScript: async () => 'alias selected "echo configured"; profile 7; wait; selected\n',
      print: text => output.push(`candidate:${text}`) });
    await program.preparePrefix(async () => {
      expect(() => program.publish()).toThrow("preparing");
      program.commands.appendPreparation("exec profile.cfg\n");
      while (!program.commands.preparationComplete) await program.commands.advanceProgramFrame();
      return true;
    });
    expect(live.pendingText).toBe(pending);
    expect(program.commands.pendingText).toBe(pending);
    expect(output.join("")).not.toContain("tail");
    expect(cvars.variableString("profile")).toBe("7");
    expect(live.aliasValue("selected")).toBeUndefined();
    expect(program.commands.aliasValue("selected")).toContain("configured");
    await expect(program.commands.executeScriptsAsync(async () => {})).rejects.toThrow("already executing");
    program.publish();
  });
  expect(output.filter(line => line.includes("tail"))).toEqual(["live:tail \n"]);
  expect(output.join("")).toContain("candidate:configured");
  expect(live.aliasValue("selected")).toContain("configured");
});

test("failed or unfinished prepared configuration cannot publish partial state", async () => {
  const live = new CommandBuffer({ dialect: "q2-classic", context: context() });
  live.append("echo retained\n");
  const program = live.prepareProgram({ dialect: "q2-classic", context: context() });
  await expect(program.preparePrefix(async () => { program.commands.appendPreparation("echo unexecuted\n"); return true; })).rejects.toThrow("unfinished");
  expect(program.commands.pendingText).toBe(live.pendingText);
  expect(() => program.publish()).toThrow("failed");
});

test("candidate program applies INSERT APPEND and immediate vstr around the inherited tail", () => {
  const source = context(), live = new CommandBuffer({ dialect: "q3", context: source });
  const cvars = new CvarRegistry({ dialect: "q3", context: source }); cvars.register("body", "echo captured\n");
  live.append("echo T\n");
  const output: string[] = [], prepared = live.prepareProgram({ dialect: "q3", context: source, cvars, print: text => output.push(text) });
  prepared.commands.append("echo A\n"); prepared.commands.insert("echo I\n"); prepared.commands.append("echo B\n");
  prepared.commands.executeNow('set marker 2'); expect(cvars.variableString("marker")).toBe("2");
  prepared.commands.executeNow("vstr body"); cvars.set("body", "echo changed\n");
  expect(live.pendingText).toBe("echo T\n");
  prepared.commands.insert("echo J\n");
  prepared.publish(); expect(live.pendingText).toBe(prepared.commands.pendingText);
  const calls: string[] = []; live.unregister("echo"); live.register("echo", command => { calls.push(command.args[0] ?? ""); });
  live.execute(); expect(calls).toEqual(["J", "captured", "I", "T", "A", "B"]);
  expect(() => prepared.publish()).toThrow("already published");
});

test("failed candidate and unexpected late authority input preserve the original program", () => {
  const live = new CommandBuffer({ dialect: "q2-classic", context: context() });
  live.defineAlias("kept", "echo original\n"); live.append("kept\n");
  const prepared = live.prepareProgram({ dialect: "q2-classic", context: context() });
  prepared.commands.defineAlias("kept", "echo changed\n"); prepared.commands.executeNow("wait"); prepared.commands.insert("echo candidate\n");
  expect(live.aliasValue("kept")).toBe("echo original\n"); expect(live.pendingText).toBe("kept\n");
  live.append("echo late\n"); expect(() => prepared.validatePublication()).toThrow("changed during preparation");
  expect(() => prepared.publish()).toThrow("changed during preparation"); expect(live.pendingText).toBe("kept\necho late\n");
});

test("fork shares one pending script settlement and emits one completion after publication", async () => {
  const read = Promise.withResolvers<string>(), complete: string[] = [], calls: string[] = [];
  const live = new CommandBuffer({ dialect: "q2-classic", context: context(), readScript: () => read.promise,
    onScriptComplete: event => complete.push(event.name), print: text => calls.push(text) });
  live.append("exec original.cfg; echo tail\n"); live.execute();
  const prepared = live.prepareProgram({ dialect: "q3", context: context() });
  read.resolve("echo script; wait; echo end\n"); await read.promise;
  prepared.validatePublication(); live.setProfile("q3", undefined); prepared.publish();
  await live.executeAsync(async () => {}); expect(calls.join("")).not.toContain("end");
  await live.executeAsync(async () => {}); expect(complete).toEqual(["original.cfg"]);
  expect(calls.join("")).toContain("script"); expect(calls.join("")).toContain("end"); expect(calls.join("")).toContain("tail");
});

test("after-dispatch fork keeps nonempty NOW immediate and empty NOW rejected", async () => {
  const live = new CommandBuffer({ dialect: "q3", context: context() }), cvars = new CvarRegistry({ dialect: "q3", context: context() });
  live.register("load", () => {}); live.append("load; echo tail\n");
  let first = true;
  await live.executeAsync(async () => {
    if (!first) return; first = false;
    const prepared = live.prepareProgram({ dialect: "q3", context: context(), cvars });
    prepared.commands.executeNow("set marker 2"); expect(cvars.variableString("marker")).toBe("2");
    expect(() => prepared.commands.executeNow("")).toThrow("already draining asynchronously");
    prepared.commands.executeNow("wait 2"); prepared.publish();
  });
  expect(live.pendingText).toContain("echo tail"); live.execute(); expect(live.pendingText).toContain("echo tail");
  live.execute(); expect(live.programComplete).toBe(true);
});

for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
  test(`async host barrier preserves the ordered command tail for ${dialect}`, async () => {
    const events: string[] = [], commands = new CommandBuffer({ dialect, context: context() });
    let readback = false, travel = false;
    commands.register("captureframe", () => { readback = true; events.push("capture"); });
    commands.register("travelworld", () => { travel = true; events.push("travel queued"); });
    commands.register("tail", () => { events.push("tail"); });
    const publish = async (): Promise<void> => { if (travel && !readback) { travel = false; events.push("world published"); } };
    commands.append("captureframe; travelworld; tail\n");
    await commands.executeAsync(publish, () => !(travel && readback));
    expect(events).toEqual(["capture", "travel queued"]);
    expect(commands.pendingText).toContain("tail");
    await commands.executeAsync(publish, () => !(travel && readback));
    expect(events).toEqual(["capture", "travel queued"]);
    events.push("old frame presented"); readback = false; await publish();
    await commands.executeAsync(publish, () => !(travel && readback));
    expect(events).toEqual(["capture", "travel queued", "old frame presented", "world published", "tail"]);
    expect(commands.pendingText).toBe("");
  });
}

test("async script barrier preserves nested exec and outer tail until publication", async () => {
  const events: string[] = [];
  let blocked = false;
  const commands = new CommandBuffer({ dialect: "q2-classic", context: context(), readScript: async () => "pausehost; note inside\n" });
  commands.register("pausehost", () => { blocked = true; events.push("queued"); });
  commands.register("note", command => { events.push(command.args[0] ?? ""); });
  commands.append("exec barrier.cfg; note outside\n");
  await commands.executeScriptsAsync(async () => {}, () => !blocked);
  expect(events).toEqual(["queued"]);
  await commands.executeScriptsAsync(async () => {}, () => !blocked);
  expect(events).toEqual(["queued"]);
  events.push("old frame captured", "new world published"); blocked = false;
  await commands.executeScriptsAsync(async () => {}, () => !blocked);
  expect(events).toEqual(["queued", "old frame captured", "new world published", "inside", "outside"]);
  expect(commands.hasPendingCommands).toBe(false);
});


test("paused profile prefix publishes at a dispatch boundary ahead of inherited and new input", async () => {
  const source = context(), effects: string[] = [], completed: string[] = [];
  const live = new CommandBuffer({ dialect: "q2-classic", context: source,
    onScriptComplete: event => completed.push(event.name) });
  live.register("mark", command => { effects.push(command.args[0] ?? ""); });
  live.register("load", () => {});
  live.append("load; mark inherited\n");
  await live.executeAsync(async () => {
    if (live.tokenizedArguments[0] !== "load") return;
    const program = live.prepareProgram({ dialect: "q1-netquake", context: source,
      readScript: async () => 'mark first; map A; wait; mark second\n' });
    let stopped = false;
    program.commands.register("mark", command => { effects.push(command.args[0] ?? ""); });
    program.commands.register("map", () => { stopped = true; });
    expect(await program.preparePrefix(async () => {
      program.commands.appendPreparation("exec profile.cfg\n");
      await program.commands.executeScriptsAsync(async () => {}, () => !stopped);
      return false;
    })).toBe(false);
    expect(effects).toEqual(["first"]);
    program.publish();
  });
  expect(effects).toEqual(["first"]);
  live.append("mark newly-typed\n");
  await live.advanceProgramFrame();
  expect(effects).toEqual(["first"]);
  await live.advanceProgramFrame();
  expect(effects).toEqual(["first", "second"]);
  expect(completed).toEqual(["profile.cfg"]);
  expect(live.programComplete).toBe(false);
  live.finishPreparation();
  await live.advanceProgramFrame();
  expect(effects).toEqual(["first", "second", "inherited", "newly-typed"]);
  expect(live.programComplete).toBe(true);
});

test("nested profile prefixes keep native deferred state and caller append order", async () => {
  const source = context(), effects: string[] = [];
  const live = new CommandBuffer({ dialect: "q2-classic", context: source });
  live.register("mark", command => { effects.push(command.args[0] ?? ""); });
  live.append("mark inherited\n"); live.copyToDefer();
  const outer = live.prepareProgram({ dialect: "q2-classic", context: source });
  await outer.preparePrefix(async () => { outer.commands.appendPreparation("mark outer\n"); return false; });
  outer.publish();
  const inner = live.prepareProgram({ dialect: "q2-classic", context: source });
  await inner.preparePrefix(async () => { inner.commands.appendPreparation("mark inner\n"); return false; });
  inner.publish(); live.append("mark new\n");
  live.executeBatch("mark immediate", source);
  expect(effects).toEqual(["immediate"]);
  await live.advanceProgramFrame(); live.finishPreparation();
  await live.advanceProgramFrame(); live.finishPreparation();
  await live.advanceProgramFrame();
  expect(effects).toEqual(["immediate", "inner", "outer", "inherited", "new"]);
});
