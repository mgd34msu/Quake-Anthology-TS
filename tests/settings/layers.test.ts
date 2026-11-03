// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noteLocalForm } from "../../src/app/bootstrap/native-settings.ts";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarFlag, CvarRegistry } from "../../src/core/cvars/index.ts";
import { archivedBindingPairs, registerBindingCommands } from "../../src/input/bindings.ts";
import { SeatInput } from "../../src/input/seat.ts";
import {
  GameLayers,
  LayerStore,
  effectiveSet,
  emptyOverrides,
  type HighLevel,
  type LayerBind,
  type LayerCvar,
  type LayerFormat,
} from "../../src/settings/layers.ts";
import { ENGINE_SETTINGS, registerSettingAliases } from "../../src/core/cvars/setting-declarations.ts";
import { fileCvars, settingFor, toCanonical } from "../../src/settings/setting-spellings.ts";
import { NativeConfig, absorbSession, nativeConfigLayout } from "../../src/settings/native-config.ts";

const temporary = (): Promise<string> => mkdtemp(join(tmpdir(), "layers-"));

interface Game {
  readonly dialect: CommandDialect;
  readonly format: LayerFormat;
  readonly id: string;
  readonly file: string;
  readonly dir: string;
  native(): NativeConfig;
}

const CANONICAL_DEFAULTS: Readonly<Record<string, string>> = {
  sensitivity: "3",
  m_pitch: "0.022",
  volume: "0.7",
  bgmvolume: "1",
  r_gamma: "1",
  fov: "90",
  r_fullscreen: "0",
  r_customwidth: "0",
  r_customheight: "0",
};
let counter = 0;
async function game(layers: string, kind: "q1" | "q2" | "q3"): Promise<Game> {
  const dir = await temporary();
  const spec: Record<"q1" | "q2" | "q3", { dialect: CommandDialect; format: LayerFormat; file: string; family: "q1" | "q2" | "q3"; contentDirectory: string }> =
    {
      q1: { dialect: "q1-netquake", format: "quake", file: "config.cfg", family: "q1", contentDirectory: "q1/id1" },
      q2: { dialect: "q2-classic", format: "quake2", file: "config.cfg", family: "q2", contentDirectory: "q2/baseq2" },
      q3: { dialect: "q3", format: "quake3", file: "q3config.cfg", family: "q3", contentDirectory: "q3a/baseq3" },
    };
  const s = spec[kind];
  const layout = nativeConfigLayout({ family: s.family, edition: "classic", contentDirectory: s.contentDirectory, looseRoot: dir });
  if (layout === null) throw new Error("expected a layout");
  const id = `${kind}/classic/${s.contentDirectory}`;
  return {
    dialect: s.dialect,
    format: s.format,
    id,
    file: join(dir, s.file),
    dir,
    native: () => new NativeConfig(layout, new GameLayers(new LayerStore(layers), s.format, id)),
  };
}

/** One launch of a game: read the layered script, run commands like a player and a script would, then write at quit. */
async function play(
  target: Game,
  commands: readonly string[],
  scripts: Readonly<Record<string, string>> = {},
): Promise<{ native: NativeConfig; script: string | null }> {
  const native = target.native();
  const identity = createIdentityOwner(`layers-${counter++}`);
  const seat = identity.seat(0);
  const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat, client: identity.client(0, 0) } };
  const cvars = new CvarRegistry({ dialect: target.dialect, context });
  for (const setting of ENGINE_SETTINGS) cvars.register(setting.canonical, CANONICAL_DEFAULTS[setting.canonical] ?? "1", CvarFlag.Archive);
  registerSettingAliases(cvars, "shared");
  registerSettingAliases(cvars, "input");
  cvars.register("cg_drawGun", "1", CvarFlag.Archive);
  const buffer = new CommandBuffer({
    dialect: target.dialect,
    context,
    cvars,
    readScript: name => scripts[name],
    localForm: form => noteLocalForm(native.layers, form),
  });
  const input = new SeatInput({ seat, dialect: target.dialect, context, commands: buffer, uiEvent: () => false });
  registerBindingCommands(
    buffer,
    () => input,
    () => {},
  );
  const run = (text: string): void => {
    buffer.append(`${text}\n`, context);
    buffer.execute();
  };
  native.layers?.noteDefaultBinds(archivedBindingPairs(input));
  const script = await native.readScript();
  if (script !== null) run(script);
  for (const command of commands) run(command);
  await native.write(archivedBindingPairs(input), buffer.archiveCommands(context), { resetValue: name => buffer.findCvar(name, context)?.resetValue });
  return { native, script };
}

const readHigh = (root: string): Promise<HighLevel | null> => new LayerStore(root).loadHigh();

test("every engine setting maps to each game's own cvar name and value semantics", () => {
  const high: HighLevel = {
    settings: new Map([
      ["sensitivity", "4"],
      ["m_pitch", "-0.022"],
      ["volume", "0.5"],
      ["bgmvolume", "0.3"],
      ["r_gamma", "2"],
      ["r_fullscreen", "1"],
      ["r_customwidth", "1280"],
      ["r_customheight", "720"],
      ["fov", "100"],
    ]),
    binds: new Map<string, LayerBind>(),
  };
  const values = (format: LayerFormat): Record<string, string> =>
    Object.fromEntries(
      [...fileCvars(format, new Map([...effectiveSet(format, high, emptyOverrides()).cvars].map(([name, cvar]) => [name, cvar.value]))).values()].map(cvar => [
        cvar.name,
        cvar.value,
      ]),
    );
  expect(values("quake")).toEqual({
    sensitivity: "4",
    m_pitch: "-0.022",
    volume: "0.5",
    bgmvolume: "0.3",
    gamma: "0.5",
    vid_config_x: "1280",
    vid_config_y: "720",
    fov: "100",
  });
  expect(values("quake2")).toEqual({ sensitivity: "4", m_pitch: "-0.022", s_volume: "0.5", vid_gamma: "0.5", vid_fullscreen: "1", gl_mode: "8", fov: "100" });
  expect(values("quake3")).toMatchObject({
    s_volume: "0.5",
    s_musicvolume: "0.3",
    r_gamma: "2",
    r_fullscreen: "1",
    r_customwidth: "1280",
    r_mode: "-1",
    cg_fov: "100",
  });
  expect(values("kex-quake")).toEqual({
    cl_sensitivity: "4",
    m_pitch: "-0.022",
    snd_volume: "0.5",
    snd_musicvolume: "0.3",
    gamma: "0.5",
    v_width: "1280",
    v_height: "720",
    r_fov: "100",
  });
  expect(values("kex-quake2")).toEqual({ snd_volume: "0.5", s_bgvolume: "0.3", v_width: "1280", v_height: "720", fov_0: "100" });
  expect(values("quake2")["gl_mode"]).toBe("8");
  expect(fileCvars("quake2", new Map([["r_customwidth", "1234"]])).get("gl_mode")?.value).toBe("-1");
  expect(toCanonical("vid_gamma", "0.5")).toEqual({ canonical: "r_gamma", value: "2" });
  expect(settingFor("S_Volume")?.setting.canonical).toBe("volume");
});

const SAMPLES: Readonly<Record<string, string>> = {
  volume: "0.4",
  bgmvolume: "0.6",
  r_gamma: "2",
  fov: "100",
  r_fullscreen: "1",
  r_customwidth: "1280",
  r_customheight: "720",
  sensitivity: "4.5",
  m_pitch: "-0.022",
};
for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
  test(`${dialect} accepts every classic spelling of a shared setting and reads back the canonical value`, () => {
    const identity = createIdentityOwner(`spellings-${dialect}`);
    const context: CommandContext = { session: identity.session, origin: { kind: "server-console" } };
    const cvars = new CvarRegistry({ dialect, context });
    for (const setting of ENGINE_SETTINGS) cvars.register(setting.canonical, CANONICAL_DEFAULTS[setting.canonical] ?? "1", CvarFlag.Archive);
    registerSettingAliases(cvars, "shared");
    registerSettingAliases(cvars, "input");
    for (const setting of ENGINE_SETTINGS)
      for (const entry of setting.spellings) {
        const sample = SAMPLES[setting.canonical] ?? "1";
        const spelled = entry.conversion.kind === "identity" ? sample : entry.conversion.read(sample);
        cvars.set(entry.name, spelled, true);
        expect(Number(cvars.variableString(setting.canonical))).toBeCloseTo(Number(sample), 5);
        cvars.set(setting.canonical, CANONICAL_DEFAULTS[setting.canonical] ?? "1", true);
      }
  });
}

test("a high-level change flows to every game, overrides survive it, and a hand-edit is detected against what the engine wrote", async () => {
  const layers = await temporary();
  const q3 = await game(layers, "q3"),
    q1 = await game(layers, "q1"),
    q2 = await game(layers, "q2");
  // The first game played seeds the high level through the console, and its own unmapped variable stays its own.
  await play(q3, ["seta sensitivity 8", "bind F5 quicksave", "seta cg_drawGun 0"]);
  expect((await readHigh(layers))?.settings.get("sensitivity")).toBe("8");
  expect((await readHigh(layers))?.binds.get("f5")?.command).toBe("quicksave");
  expect((await readHigh(layers))?.settings.has("fov")).toBe(false);
  const first = await play(q1, []);
  expect(first.script).toContain('bind "F5" "quicksave"');
  expect(first.script).toContain('sensitivity "8"');
  expect(first.script).not.toContain("cg_drawGun");
  expect(await readFile(q3.file, "utf8")).toContain('seta cg_drawGun "0"');
  expect(await readFile(q1.file, "utf8")).toContain('bind "F5" "quicksave"');
  // Hand-editing Quake's file makes that value Quake's own.
  await writeFile(q1.file, (await readFile(q1.file, "utf8")).replace('sensitivity "8"', 'sensitivity "2"'));
  const edited = await play(q1, []);
  expect(edited.script).toContain('sensitivity "2"');
  expect((await new LayerStore(layers).loadGame(q1.id)).overrides.cvars.get("sensitivity")?.value).toBe("2");
  // A later change in Quake III reaches Quake II but leaves overridden Quake alone.
  await play(q3, ["seta sensitivity 9"]);
  expect((await play(q2, [])).script).toContain('sensitivity "9"');
  expect((await play(q1, [])).script).toContain('sensitivity "2"');
  // Changing the overridden value in the game itself updates the high level and ends that override.
  await play(q1, ["sensitivity 5"]);
  expect((await readHigh(layers))?.settings.get("sensitivity")).toBe("5");
  expect((await new LayerStore(layers).loadGame(q1.id)).overrides.cvars.has("sensitivity")).toBe(false);
  expect((await play(q2, [])).script).toContain('sensitivity "5"');
});

test("hand-edited bindings are detected, and an edit that matches the high level is not an override", async () => {
  const layers = await temporary();
  const q3 = await game(layers, "q3"),
    q1 = await game(layers, "q1");
  await play(q3, ["bind F5 quicksave", "bind F7 help"]);
  await play(q1, []);
  const text = await readFile(q1.file, "utf8");
  await writeFile(q1.file, `${text.replace('bind "F7" "help"\n', "")}bind "F8" "echo hand"\nbind "F5" "quicksave"\n`);
  const script = (await play(q1, [])).script;
  expect(script).toContain('bind "F8" "echo hand"');
  const state = await new LayerStore(layers).loadGame(q1.id);
  expect(state.overrides.binds.get("f8")?.command).toBe("echo hand");
  expect(state.overrides.binds.has("f5")).toBe(false);
  // A new high-level binding reaches Quake while its own F8 stays.
  await play(q3, ["bind F9 screenshot"]);
  const next = (await play(q1, [])).script;
  expect(next).toContain('bind "F9" "screenshot"');
  expect(next).toContain('bind "F8" "echo hand"');
});

test("bind -local, unbind -local and set -local from the console and from an exec'd script stay with the game", async () => {
  const layers = await temporary();
  const q3 = await game(layers, "q3"),
    q1 = await game(layers, "q1");
  await play(q3, ["bind F5 quicksave", "bind F7 help", "seta sensitivity 7"]);
  await play(q1, [], {});
  await play(q3, ["bind -local F6 screenshot", "unbind -local F7", "seta -local sensitivity 3", "exec autoexec.cfg", "bind F11 shared"], {
    "autoexec.cfg": "bind -local F10 mine\nbind F12 everywhere\nseta -local m_pitch -0.022\n",
  });
  const high = await readHigh(layers);
  expect([...(high?.binds.keys() ?? [])].sort()).toEqual(["f11", "f12", "f5", "f7"]);
  expect(high?.settings.get("sensitivity")).toBe("7");
  expect(high?.settings.has("invertPitch")).toBe(false);
  const own = await new LayerStore(layers).loadGame(q3.id);
  expect(own.overrides.binds.get("f6")?.command).toBe("screenshot");
  expect(own.overrides.binds.get("f10")?.command).toBe("mine");
  expect(own.overrides.binds.get("f7")?.command).toBeNull();
  expect(own.overrides.cvars.get("sensitivity")?.value).toBe("3");
  expect(own.overrides.cvars.get("m_pitch")?.value).toBe("-0.022");
  const here = (await play(q3, [])).script ?? "";
  expect(here).toContain('unbind "F7"');
  expect(here).toContain('sensitivity "3"');
  expect(here).toContain('bind "F6" "screenshot"');
  const there = (await play(q1, [])).script ?? "";
  expect(there).toContain('bind "F7" "help"');
  expect(there).toContain('bind "F12" "everywhere"');
  expect(there).toContain('sensitivity "7"');
  expect(there).not.toContain("F6");
  expect(there).not.toContain("F10");
  expect(there).not.toContain("-0.022");
});

test("the -local flag is removed before the command runs and an unflagged command is unchanged", () => {
  const identity = createIdentityOwner("layers-local");
  const context: CommandContext = { session: identity.session, origin: { kind: "server-console" } };
  const forms: string[] = [],
    seen: string[] = [];
  const buffer = new CommandBuffer({ dialect: "q3", context, localForm: form => forms.push(`${form.command}:${form.args.join(",")}`) });
  buffer.register("bind", command => {
    seen.push(`${command.argv.join(",")}|${command.argsText}|${command.raw}`);
  });
  buffer.append('bind -local x "a b"\nbind y z\n', context);
  buffer.execute();
  expect(forms).toEqual(["bind:x,a b"]);
  expect(seen).toEqual(['bind,x,a b|x a b|bind x "a b"', "bind,y,z|y z|bind y z"]);
});

test("a native file with only the engine's own header and no layers still behaves as before", async () => {
  const dir = await temporary();
  const layout = nativeConfigLayout({ family: "q1", edition: "classic", contentDirectory: "q1/id1", looseRoot: dir });
  if (layout === null) throw new Error("expected a layout");
  const native = new NativeConfig(layout);
  await native.write([["TAB", "+showscores"]], ['sensitivity "4"']);
  expect(await readFile(join(dir, "config.cfg"), "utf8")).toBe('bind "TAB" "+showscores"\nsensitivity "4"\n');
});

test("a mixed combination starts from the high level and its in-game changes go back through the same layers", async () => {
  const layers = await temporary();
  const q3 = await game(layers, "q3");
  await play(q3, ["seta sensitivity 8", "bind F5 quicksave"]);
  const mixed = new GameLayers(new LayerStore(layers), "quake", "mixed/test");
  const start = await mixed.resolve({ binds: new Map<string, LayerBind>(), cvars: new Map<string, LayerCvar>() });
  expect(start.cvars.get("sensitivity")?.value).toBe("8");
  expect(start.binds.map(bind => [bind.key, bind.command])).toEqual([["F5", "quicksave"]]);
  mixed.noteDefaultBinds([["TAB", "+showscores"]]);
  const written = await absorbSession(
    mixed,
    "quake",
    [
      ["TAB", "+showscores"],
      ["F5", "quicksave"],
      ["F6", "echo mixed"],
    ],
    ['sensitivity "5"', 'volume "0.7"'],
    { resetValue: () => "0.7" },
  );
  expect(written.bindings.map(([key]) => key).sort()).toEqual(["F5", "F6", "TAB"]);
  const high = await readHigh(layers);
  expect(high?.settings.get("sensitivity")).toBe("5");
  expect(high?.settings.has("volume")).toBe(false);
  expect(high?.binds.get("f6")?.command).toBe("echo mixed");
  expect(high?.binds.has("tab")).toBe(false);
});

test("layer files written under the first vocabulary migrate to canonical cvar names", async () => {
  const layers = await temporary();
  await mkdir(join(layers, "layers", "games"), { recursive: true });
  await writeFile(
    join(layers, "layers", "high.json"),
    JSON.stringify({ version: 1, settings: { sensitivity: "6", invertPitch: "1", musicVolume: "0.2", gamma: "1.5", width: "800" }, binds: {} }),
  );
  const id = "q2/classic/q2/baseq2";
  await writeFile(
    join(layers, "layers", "games", `${encodeURIComponent(id)}.json`),
    JSON.stringify({
      version: 1,
      overrides: { binds: {}, cvars: { vid_gamma: { name: "vid_gamma", value: "0.5" } } },
      written: { binds: {}, cvars: { s_volume: { name: "s_volume", value: "0.4" } } },
    }),
  );
  const store = new LayerStore(layers);
  const high = await store.loadHigh();
  expect(Object.fromEntries(high?.settings ?? [])).toEqual({ sensitivity: "6", m_pitch: "-0.022", bgmvolume: "0.2", r_gamma: "1.5", r_customwidth: "800" });
  const state = await store.loadGame(id);
  expect(state.overrides.cvars.get("r_gamma")?.value).toBe("2");
  expect(state.record?.cvars.get("volume")).toBe("0.4");
  const written: unknown = JSON.parse(await readFile(join(layers, "layers", "high.json"), "utf8"));
  expect(written).toMatchObject({ version: 2 });
});
