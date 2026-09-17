import { parseCamera, serializeCamera, CameraPlayback, type CameraSample } from "../src/camera/spline.ts";
/** Inspect, normalize, and sample authoring files without starting a renderer. */
export async function cameraTool(args: readonly string[]): Promise<void> {
  const [command, input, output, interval] = args;
  if ((command !== "normalize" && command !== "sample") || input === undefined || output === undefined || args.length > 4)
    throw new Error("Usage: source-camera normalize <input.camera> <output.camera> | sample <input.camera> <output.json> [step-ms]");
  const definition = parseCamera(await Bun.file(input).text());
  if (command === "normalize") { await Bun.write(output, serializeCamera(definition)); return; }
  const step = interval === undefined ? 16 : Number(interval);
  if (!Number.isFinite(step) || step <= 0) throw new Error("Camera sample interval must be positive");
  const playback = new CameraPlayback(definition, 0);
  const rows: (CameraSample & { readonly milliseconds: number })[] = [];
  for (let time = 0; ; time += step) { const sample = playback.sample(time); if (sample === null) break; rows.push({ milliseconds: time, ...sample }); }
  await Bun.write(output, JSON.stringify(rows, null, 2) + "\n");
}
if (import.meta.main) await cameraTool(process.argv.slice(2));
