import { CvarFlag, type CvarRegistry } from "../../../core/cvars/index.ts";
import { audioKhzRate, audioOutputFormat, defaultAudioOutputFormat, type AudioOutputFormat } from "../../../audio/output.ts";

const outputFields = [
  { name: "s_outputRate", field: "sampleRate" },
  { name: "s_outputBits", field: "sampleBits" },
  { name: "s_outputChannels", field: "channels" },
] satisfies readonly { readonly name: string; readonly field: keyof AudioOutputFormat }[];
export const audioOutputCvarNames = outputFields.map(field => field.name);
export function registerAudioOutputCvars(cvars: CvarRegistry, defaults: AudioOutputFormat = defaultAudioOutputFormat): void {
  for (const { name, field } of outputFields) {
    const value = defaults[field];
    cvars.register(name, String(value), CvarFlag.Archive);
    cvars.bindValue(name, { validate: text => {
      if (text.trim() === "") return "Expected an integer audio format value";
      try { audioOutputFormat({ ...defaults, [field]: Number(text) }); return null; }
      catch (error) { return error instanceof Error ? error.message : String(error); }
    }, changed: () => undefined });
    cvars.document(name, { summary: "Shared output format; apply with snd_restart or the audio menu.", usage: `${name} <value>`, examples: [`${name} ${value}`] });
  }
  cvars.registerAlias({ name: "s_khz", target: "s_outputRate", conversion: { kind: "converted",
    read: value => value === "11025" ? "11" : value === "22050" ? "22" : value === "44100" ? "44" : value === "48000" ? "48" : String(Number(value) / 1000),
    write: value => { const rate = audioKhzRate(value); return rate === null ? { kind: "invalid", message: "Use s_khz 11, 22, 44 or 48" } : { kind: "value", value: String(rate) }; } },
    documentation: { summary: "Source sample-rate convention for the shared output; apply with snd_restart.", usage: "s_khz <11|22|44|48>", examples: ["s_khz 44"] } });
}
export function readAudioOutputCvars(cvars: CvarRegistry): AudioOutputFormat {
  return audioOutputFormat(Object.fromEntries(outputFields.map(({ name, field }) => [field, cvars.variableValue(name)] satisfies readonly [keyof AudioOutputFormat, number])));
}
export function writeAudioOutputCvars(cvars: CvarRegistry, format: AudioOutputFormat): void {
  for (const { name, field } of outputFields) cvars.set(name, String(format[field]));
}
