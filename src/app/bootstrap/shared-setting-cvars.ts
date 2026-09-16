import { defaultAudioOutputFormat, type AudioOutputFormat } from "../../audio/output.ts";
import { registerAudioOutputCvars, readAudioOutputCvars } from "./audio/output-settings.ts";
import { CvarFlag, type CvarAlias, type CvarRegistry } from "../../core/cvars/index.ts";
import { defaultViewInputTuning, type InputCommandBuilder } from "../../input/user-command.ts";

export function validateFieldOfView(text: string): string | null {
  const value = Number(text);
  return !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) || !Number.isFinite(value) || value < 60 || value > 160
    ? "Field of view must be between 60 and 160 degrees" : null;
}

export function bindRunCvar(cvars: CvarRegistry, builder: InputCommandBuilder): () => void {
  const defaultValue = defaultViewInputTuning(builder.dialect).alwaysRun ? "1" : "0";
  const stored = cvars.find("cl_run") !== undefined;
  if (!stored || !cvars.dialect.startsWith("q1") || cvars.isConsoleCreated("cl_run")) cvars.register("cl_run", defaultValue, CvarFlag.Archive);
  else cvars.addFlags("cl_run", CvarFlag.Archive);
  if (!stored) cvars.set("cl_run", builder.tuning.alwaysRun ? "1" : "0");
  const validate = (value: string): string | null => value === "0" || value === "1" ? null : "Always run must be 0 or 1";
  if (validate(cvars.variableString("cl_run")) !== null) cvars.set("cl_run", builder.tuning.alwaysRun ? "1" : "0", true);
  const remove = cvars.bindValue("cl_run", { validate, changed: () => undefined });
  cvars.document("cl_run", { summary: "Always run for this player; the speed key reverses run and walk. Uses the Always run menu preference.",
    usage: "cl_run [0|1]", examples: ["cl_run 1", "set cl_run 0"], allowedValues: ["0", "1"] });
  builder.bindAlwaysRun({ read: () => cvars.variableValue("cl_run") !== 0, write: value => { cvars.set("cl_run", value ? "1" : "0"); } });
  return remove;
}

/** Shared aliases exist before source configuration executes in every world dialect. */
export function registerSharedClientSettings(cvars: CvarRegistry, outputFormat: AudioOutputFormat = defaultAudioOutputFormat): void {
  registerAudioOutputCvars(cvars, outputFormat);
  cvars.register("r_saveFontData", "0", CvarFlag.None);
  cvars.document("r_saveFontData", { summary: "Export generated Q3 font atlases and DAT records to this content's user directory.",
    usage: "r_saveFontData <0|1>", examples: ["r_saveFontData 1"] });
  cvars.register("volume", cvars.dialect === "q3" ? "0.8" : "0.7", CvarFlag.Archive);
  cvars.register("bgmvolume", cvars.dialect === "q3" ? "0.25" : "1", CvarFlag.Archive);
  const finite = (value: string): string | null => value.trim() !== "" && Number.isFinite(Number(value)) ? null : "Expected a finite number";
  for (const name of ["volume", "bgmvolume"]) cvars.bindValue(name, { validate: finite, changed: () => undefined });
  cvars.bindValue("r_gamma", { validate: value => finite(value) ?? (Number(value) >= 0.5 && Number(value) <= 3 ? null : "Brightness must be between 0.5 and 3"),
    changed: () => undefined });
  const gammaConversion: CvarAlias["conversion"] = { kind: "converted", read: value => String(1 / Number(value)),
    write: value => finite(value) !== null || Number(value) < 1 / 3 || Number(value) > 2
      ? { kind: "invalid", message: "Gamma must be between 1/3 and 2" } : { kind: "value", value: String(1 / Number(value)) } };
  cvars.registerAlias({ name: "gamma", target: "r_gamma", conversion: gammaConversion,
    documentation: { summary: "Quake brightness convention: lower values brighten. Alias of r_gamma with gamma = 1 / r_gamma.", usage: "gamma <1/3..2>", examples: ["gamma 0.5"] } });
  cvars.registerAlias({ name: "vid_gamma", target: "r_gamma", conversion: gammaConversion,
    documentation: { summary: "Quake II brightness convention: lower values brighten. Alias of r_gamma with vid_gamma = 1 / r_gamma.", usage: "vid_gamma <1/3..2>", examples: ["vid_gamma 0.5"] } });
  cvars.registerAlias({ name: "s_volume", target: "volume", conversion: { kind: "identity" },
    documentation: { summary: "Alias of volume. Changes the same effects gain and audio menu preference.", usage: "s_volume <0..1>", examples: ["s_volume 0.7"] } });
  cvars.registerAlias({ name: "s_musicvolume", target: "bgmvolume", conversion: { kind: "identity" },
    documentation: { summary: "Alias of bgmvolume. Changes the same music gain and audio menu preference.", usage: "s_musicvolume <0..1>", examples: ["s_musicvolume 0.5"] } });
  cvars.registerAlias({ name: "ogg_volume", target: "bgmvolume", conversion: { kind: "identity" },
    documentation: { summary: "Quake II music volume. Alias of bgmvolume and the shared music gain.", usage: "ogg_volume <0..1>", examples: ["ogg_volume 0.5"] } });
  cvars.document("volume", { summary: "Effects volume shared with the audio menu. Output clamps to 0 through 1.", usage: "volume <0..1>", examples: ["volume 0.7", "volume 0"] });
  cvars.document("bgmvolume", { summary: "Music volume shared with the audio menu. Output clamps to 0 through 1.", usage: "bgmvolume <0..1>", examples: ["bgmvolume 0.5", "bgmvolume 0"] });
}

export function applyAudioOutputSettings(cvars: CvarRegistry, audio: { readonly outputFormat: AudioOutputFormat; selectOutputFormat(format: AudioOutputFormat): void }): void {
  const desired = readAudioOutputCvars(cvars), current = audio.outputFormat;
  if (desired.sampleRate !== current.sampleRate || desired.sampleBits !== current.sampleBits || desired.channels !== current.channels) audio.selectOutputFormat(desired);
}
