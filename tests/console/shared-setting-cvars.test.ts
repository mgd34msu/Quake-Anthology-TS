import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { SeatConsole } from "../../src/console/session.ts";
import { findConsoleEntries, registerDiscoveryCommands } from "../../src/console/discovery.ts";
import { llmConsoleCatalog, validateLlmBatch } from "../../src/console/llm-batch.ts";
import { SeatInput } from "../../src/input/seat.ts";
import { InputCommandBuilder, type UserCommandFrame } from "../../src/input/user-command.ts";
import { bindInputSettings } from "../../src/ui/settings/index.ts";
import { ApplicationViewSettings } from "../../src/app/bootstrap/view-settings.ts";
import { bindRunCvar } from "../../src/app/bootstrap/shared-setting-cvars.ts";
import { ApplicationConsoleRouting } from "../../src/app/bootstrap/console.ts";
import { ConfigStore } from "../../src/settings/config.ts";
import { loadCvarArchive, saveCvarArchive } from "../../src/app/bootstrap/cvar-archives.ts";

const frames: readonly UserCommandFrame[] = [
  { kind: "q1-netquake", acknowledgedServerTimeSeconds: 1 }, { kind: "q1-quakeworld" },
  { kind: "q2-classic", deltaAngles: { x: 0, y: 0, z: 0 }, lightLevel: 128, attackAllowed: true },
  { kind: "q2-rerelease", deltaAngles: { x: 0, y: 0, z: 0 }, serverFrame: 10, attackAllowed: true },
  { kind: "q3", serverTimeMilliseconds: 110, weapon: 2, sensitivity: 1 },
];

test("live shared cvars route bare, slash, set, toggle and reset to menu and emitted commands", () => {
  const cases = frames.map(frame => ({ frame, dialect: frame.kind }));
  const mixed: { frame: UserCommandFrame; dialect: CommandDialect } = { frame: { kind: "q1-quakeworld" }, dialect: "q2-classic" };
  for (const { frame, dialect } of [...cases, mixed]) {
    const identity = createIdentityOwner(`live-settings-${dialect}-${frame.kind}`), seat = identity.seat(0), other = identity.seat(1);
    const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat, client: identity.client(0, 0) } };
    const otherContext: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat: other, client: identity.client(1, 0) } };
    const fallback = new CvarRegistry({ dialect, context }), first = new CvarRegistry({ dialect, context }), second = new CvarRegistry({ dialect, context: otherContext });
    const shared = new CvarRegistry({ dialect, context: { session: identity.session, origin: { kind: "local-console" } } });
    const output: string[] = [], changed: number[] = [];
    const routing = new ApplicationConsoleRouting({ fallback, sourceDialect: () => dialect, server: () => null, seat: () => null,
      input: selected => selected === null || selected.equals(seat) ? first : second, shared: () => shared });
    const commands = new CommandBuffer({ dialect, context, cvars: fallback, cvarRouting: routing, print: text => { output.push(text); } });
    const builder = new InputCommandBuilder(frame.kind), otherBuilder = new InputCommandBuilder(frame.kind);
    otherBuilder.tuning = { ...otherBuilder.tuning, alwaysRun: false };
    const input = new SeatInput({ seat, dialect: frame.kind, context, commands, uiEvent: () => false });
    const view = new ApplicationViewSettings(value => { changed.push(value); }); view.setFieldOfView(110);
    const removeView = view.bindCvars(shared), removeRun = bindRunCvar(first, builder), removeOther = bindRunCvar(second, otherBuilder);
    registerDiscoveryCommands(commands, text => { output.push(text); });
    const console = new SeatConsole({ seat, context, dialect, commands, cvars: fallback, now: () => 0, connected: () => true,
      clipboard: () => null, focus: () => undefined, chat: () => { throw new Error("Setting entered chat"); } });
    const submit = (text: string): void => { console.field.setText(text); console.submit(); commands.execute(); };
    const toggle = bindInputSettings(input, builder).find(binding => binding.id === "ui:input:always-run");
    if (toggle?.kind !== "toggle") throw new Error("Missing Always run toggle");
    const binding = view.binding(); if (binding.kind !== "slider") throw new Error("Missing FOV slider");
    for (const prefix of ["", "/", "set "]) {
      if (prefix === "set " && !commands.exists("set")) continue;
      for (const run of [false, true]) for (const modifier of [false, true]) {
        submit(`${prefix}cl_run ${run ? 1 : 0}`);
        expect(toggle.read()).toBe(run);
        input.commandButton("forward", "w", true, 10); input.commandButton("walk", "shift", modifier, 10); input.sample(110, 100);
        const command = builder.build(input.sample(210, 100), frame), running = run !== modifier;
        expect(command.forwardMove).toBe(frame.kind === "q3" ? running ? 127 : 64 : running ? 400 : 200);
        expect(otherBuilder.tuning.alwaysRun).toBe(false);
      }
      submit(`${prefix}fov 120`); expect(binding.read()).toBe(120); expect(changed.at(-1)).toBe(120);
    }
    toggle.write(false); expect(commands.findCvar("cl_run", context)?.value).toBe("0");
    if (commands.exists("toggle")) { submit("toggle cl_run"); expect(builder.tuning.alwaysRun).toBe(true); }
    if (commands.exists("reset")) { submit("reset cl_run"); expect(builder.tuning.alwaysRun).toBe(!frame.kind.startsWith("q1")); }
    binding.write(105); expect(commands.findCvar("fov", context)?.value).toBe("105");
    if (commands.exists("toggle")) { submit("toggle fov 105 120"); expect(view.fieldOfView).toBe(120); }
    if (commands.exists("reset")) { submit("reset fov"); expect(view.fieldOfView).toBe(90); expect(changed.at(-1)).toBe(90); }
    submit("fov 105");
    for (const invalid of ["fov NaN", "fov 0", "fov 170", 'fov ""', "cl_run 2"]) submit(invalid);
    expect(view.fieldOfView).toBe(105);
    commands.append("cl_run 1\n", otherContext); commands.execute(); expect(otherBuilder.tuning.alwaysRun).toBe(true);
    expect(findConsoleEntries(commands, "fov", context).map(entry => entry.kind)).toEqual(["cvar"]);
    submit("help fov"); expect(output.join("")).toContain('Current: "105"');
    expect(llmConsoleCatalog(commands, context, "always run and field of view")).toContain("cl_run [0|1]");
    expect(validateLlmBatch("cl_run 1\nfov 120", commands, context)).toEqual(["cl_run 1", "fov 120"]);
    if (commands.exists("set")) expect(validateLlmBatch("set cl_run 1\nset fov 120", commands, context)).toEqual(["set cl_run 1", "set fov 120"]);
    expect(first.archiveEntries().find(entry => entry.name === "cl_run")?.value).toBe(String(Number(builder.tuning.alwaysRun)));
    expect(shared.archiveEntries().find(entry => entry.name === "fov")?.value).toBe("105");
    removeRun(); removeOther(); removeView();
  }
});

test("shared cvars adopt persisted values and replace user-created declarations", () => {
  for (const frame of frames) {
    const identity = createIdentityOwner(`adopt-settings-${frame.kind}`), context: CommandContext = { session: identity.session, origin: { kind: "local-console" } };
    const registry = new CvarRegistry({ dialect: frame.kind, context });
    registry.applyArchive([{ name: "cl_run", value: "1" }, { name: "fov", value: "125" }]);
    const builder = new InputCommandBuilder(frame.kind), view = new ApplicationViewSettings(() => undefined);
    view.setFieldOfView(110); bindRunCvar(registry, builder); view.bindCvars(registry);
    expect(builder.tuning.alwaysRun).toBe(true); expect(view.fieldOfView).toBe(125);
    expect(registry.find("fov")?.resetValue).toBe("90");
    expect(registry.find("cl_run")?.resetValue).toBe(frame.kind.startsWith("q1") ? "0" : "1");
    registry.applyArchive([{ name: "cl_run", value: "0" }, { name: "fov", value: "115" }]);
    expect(builder.tuning.alwaysRun).toBe(false); expect(view.fieldOfView).toBe(115);
    registry.takeEffects(); const saved = registry.captureSaveState();
    registry.set("fov", "150"); registry.restoreSaveState(saved);
    expect(view.fieldOfView).toBe(115);
  }
});

test("default archived FOV preserves source camera ownership and legacy view preferences", () => {
  const identity = createIdentityOwner("fov-default"), context: CommandContext = { session: identity.session, origin: { kind: "local-console" } };
  for (const frame of frames) {
    const registry = new CvarRegistry({ dialect: frame.kind, context }); registry.register("fov", "90", 1);
    const view = new ApplicationViewSettings(() => undefined); view.bindCvars(registry);
    expect(view.override).toBeNull();
    registry.set("fov", "90"); expect(view.override).toBe(90);
    const next = new CvarRegistry({ dialect: frame.kind, context }); next.register("fov", "90", 1); next.applyArchive(registry.archiveEntries());
    const legacy = new ApplicationViewSettings(() => undefined); legacy.setFieldOfView(110); legacy.bindCvars(next);
    expect(legacy.fieldOfView).toBe(110); expect(next.variableString("fov")).toBe("110");
  }
});

test("bound cvar validation protects archive, full-set, staged and restored values", () => {
  const identity = createIdentityOwner("fov-validation"), context: CommandContext = { session: identity.session, origin: { kind: "local-console" } };
  const registry = new CvarRegistry({ dialect: "q2-classic", context }), callbacks: number[] = [];
  const view = new ApplicationViewSettings(value => { callbacks.push(value); }); view.bindCvars(registry);
  registry.set("fov", "115"); const before = registry.captureSaveState();
  registry.applyArchive([{ name: "fov", value: "999" }]); registry.fullSet("fov", "999", 1); registry.stage("fov", "999");
  expect(view.fieldOfView).toBe(115); expect(registry.find("fov")?.latchedValue).toBeUndefined(); expect(callbacks).toEqual([115]);
  const invalid = { ...before, variables: before.variables.map(value => value === null ? null : { ...value, value: "999" }) };
  expect(() => registry.restoreSaveState(invalid)).toThrow("Field of view must be between 60 and 160 degrees");
  expect(view.fieldOfView).toBe(115);
  registry.set("fov", "125"); registry.restoreSaveState(before); expect(callbacks).toEqual([115, 125, 115]);
});

test("rejected setu and sets leave bound cvar value, flags, effects and dirty state untouched", () => {
  for (const frame of frames) for (const command of ["setu", "sets"]) {
    const identity = createIdentityOwner(`reject-${frame.kind}-${command}`);
    const context: CommandContext = { session: identity.session, origin: { kind: "local-console" } };
    const registry = new CvarRegistry({ dialect: frame.kind, context });
    const commands = new CommandBuffer({ dialect: frame.kind, context, cvars: registry });
    if (!commands.exists(command)) continue;
    const callbacks: number[] = [], view = new ApplicationViewSettings(value => { callbacks.push(value); });
    view.bindCvars(registry); registry.set("fov", "115");
    registry.takeEffects(); const before = registry.captureSaveState();
    commands.append(`${command} fov nonsense\n`); commands.execute();
    expect(registry.takeEffects()).toEqual([]);
    expect(registry.captureSaveState()).toEqual(before);
    expect(callbacks).toEqual([115]);
    expect(view.fieldOfView).toBe(115);
    registry.setCommandFlags("fov", "115", command === "setu" ? "serverinfo" : "userinfo");
    registry.takeEffects(); const flagged = registry.captureSaveState();
    commands.append(`${command} fov 999\n`); commands.execute();
    expect(registry.takeEffects()).toEqual([]);
    expect(registry.captureSaveState()).toEqual(flagged);
    expect(view.fieldOfView).toBe(115);
  }
});

test("live cvar preferences survive disk archives and the existing view JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-live-settings-"));
  try {
    const identity = createIdentityOwner("persist-live-settings"), context: CommandContext = { session: identity.session, origin: { kind: "local-console" } };
    const store = new ConfigStore(root), registry = new CvarRegistry({ dialect: "q3", context });
    const builder = new InputCommandBuilder("q1-quakeworld"), view = new ApplicationViewSettings(() => undefined);
    bindRunCvar(registry, builder); view.bindCvars(registry);
    const commands = new CommandBuffer({ dialect: "q3", context, cvars: registry });
    commands.append("set cl_run 1\nset fov 120\n"); commands.execute();
    await saveCvarArchive(store, ["input", "q3", "0"], registry); await view.save(store);
    const restored = new CvarRegistry({ dialect: "q3", context }); restored.applyArchive(await loadCvarArchive(store, ["input", "q3", "0"], "q3"));
    const nextBuilder = new InputCommandBuilder("q1-quakeworld"), nextView = new ApplicationViewSettings(() => undefined);
    await nextView.load(store); bindRunCvar(restored, nextBuilder); nextView.bindCvars(restored);
    expect(nextBuilder.tuning.alwaysRun).toBe(true); expect(nextView.override).toBe(120);
    const saved: unknown = JSON.parse(await store.loadText("view.json") ?? "null");
    expect(saved).toEqual({ version: 1, fieldOfView: 120 });
  } finally { await rm(root, { recursive: true, force: true }); }
});
