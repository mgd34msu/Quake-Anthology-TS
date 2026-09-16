import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { AudioOutputFormat } from "../../src/audio/output.ts";
import { registerSharedClientSettings, applyAudioOutputSettings } from "../../src/app/bootstrap/shared-setting-cvars.ts";
import { readAudioOutputCvars } from "../../src/app/bootstrap/audio/output-settings.ts";
import { FrontendPreferences } from "../../src/app/bootstrap/frontend-preferences.ts";
import { loadAudioSettings, saveAudioSettings } from "../../src/app/bootstrap/audio-settings.ts";
import { ConfigStore } from "../../src/settings/config.ts";

test("saved output defaults share source aliases and apply only a changed format", () => {
  const identity = createIdentityOwner("audio-output-caller-test");
  const cvars = new CvarRegistry({ dialect: "q3", context: { session: identity.session, origin: { kind: "local-console" } }, print: () => {} });
  const saved: AudioOutputFormat = { sampleRate: 22050, sampleBits: 8, channels: 1 };
  cvars.register("r_gamma", "1");
  registerSharedClientSettings(cvars, saved);
  expect(readAudioOutputCvars(cvars)).toEqual(saved);
  expect(cvars.variableString("s_khz")).toBe("22");
  let outputFormat = saved, changes = 0;
  const audio = { get outputFormat() { return outputFormat; }, selectOutputFormat(format: AudioOutputFormat) { outputFormat = format; changes++; } };
  applyAudioOutputSettings(cvars, audio);
  expect(changes).toBe(0);
  cvars.set("s_khz", "48");
  applyAudioOutputSettings(cvars, audio);
  expect(outputFormat).toEqual({ ...saved, sampleRate: 48000 });
  expect(changes).toBe(1);
  applyAudioOutputSettings(cvars, audio);
  expect(changes).toBe(1);
});

test("frontend gain-only save preserves format and output services save actual selection", async () => {
  const root = await mkdtemp(join(tmpdir(), "audio-output-callers-"));
  try {
    const store = new ConfigStore(root), preferences = new FrontendPreferences(() => "q3");
    const outputFormat: AudioOutputFormat = { sampleRate: 22050, sampleBits: 8, channels: 1 };
    await saveAudioSettings(store, { selectedOutput: "saved output", outputFormat, effectsVolume: 0.7, musicVolume: 0.25 });
    await preferences.loadBaseline(store);
    preferences.values = { effectsVolume: 0.3 };
    await preferences.saveAudioBaseline(store);
    expect(await loadAudioSettings(store)).toEqual({ deviceName: "saved output", outputFormat, effectsVolume: 0.3, musicVolume: 0.25 });
    let actual: AudioOutputFormat = outputFormat;
    const bindings = preferences.bindings({ selected: () => null, devices: () => [], select: () => {}, report: () => {},
      format: { read: () => actual, select: value => { actual = value; } } });
    const rate = bindings.find(binding => binding.id === "ui:audio:rate");
    if (rate?.kind !== "choice") throw Error("Missing output rate control");
    rate.write("48000");
    await preferences.saveAudioBaseline(store);
    expect(await loadAudioSettings(store)).toEqual({ deviceName: null, outputFormat: { ...outputFormat, sampleRate: 48000 }, effectsVolume: 0.3, musicVolume: 0.25 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Constructed valid startup scripts exercise precedence; this is not a retail default.cfg claim.
test("saved output archive survives mounted defaults and later autoexec remains authoritative", async () => {
  const { StartupConfig } = await import("../../src/app/bootstrap/startup-config.ts");
  const { CommandBuffer } = await import("../../src/core/commands/index.ts");
  const { audioOutputCvarNames, writeAudioOutputCvars } = await import("../../src/app/bootstrap/audio/output-settings.ts");
  for (const override of [false, true]) {
    const identity = createIdentityOwner("audio-startup-order");
    const context = { session: identity.session, origin: { kind: "local-console" } } satisfies ConstructorParameters<typeof CvarRegistry>[0]["context"];
    const cvars = new CvarRegistry({ dialect: "q3", context });
    cvars.register("r_gamma", "1");
    const saved: AudioOutputFormat = { sampleRate: 48000, sampleBits: 8, channels: 1 };
    registerSharedClientSettings(cvars, saved);
    writeAudioOutputCvars(cvars, saved);
    const sharedArchive = audioOutputCvarNames.map(name => ({ name, value: cvars.variableString(name) }));
    const observed: number[] = [];
    const startup = new StartupConfig({ dialect: "q3", context, hasMod: false,
      read: async (name, _source, scope) => scope === "mounted" && name === "default.cfg" ? "s_khz 22\nobserve\n"
        : scope === "user" && name === "autoexec.cfg" ? `observe\n${override ? "s_khz 11\n" : ""}` : undefined,
      applySelectedDefaults: () => {}, applyArchive: () => cvars.applyArchive(sharedArchive), applyLaunchOptions: () => {},
    });
    const commands = new CommandBuffer({ dialect: "q3", context, cvars, readScript: startup.readScript, onScriptComplete: startup.onScriptComplete });
    commands.register("observe", () => { observed.push(readAudioOutputCvars(cvars).sampleRate); });
    expect(await startup.executeFrame(commands, async () => {})).toBe(true);
    expect(observed).toEqual([22050, 48000]);
    expect(readAudioOutputCvars(cvars)).toEqual({ ...saved, sampleRate: override ? 11025 : 48000 });
  }
});
