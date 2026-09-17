import type { SceneCamera } from "../contracts/render.ts";
import type { CommandBuffer } from "../core/commands/index.ts";
import { anglesToAxis, length3, vectorToAngles } from "../core/math.ts";
import { perspectiveProjection } from "../render/scene/view.ts";
import { CameraPlayback, parseCamera, serializeCamera } from "./spline.ts";
import type { CameraDefinition } from "./spline.ts";

export interface ApplicationCameraServices {
  readonly commands: CommandBuffer;
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  milliseconds(): number;
  print(text: string): void;
}
/** One view override owner; loading completes before a later command can start it. */
export class ApplicationSplineCamera {
  private definition: CameraDefinition | null = null;
  private playback: CameraPlayback | null = null;
  private loadGeneration = 0;
  private readonly pending = new Set<Promise<void>>();
  private readonly registered = new Map<CommandBuffer, () => void>();
  constructor(private readonly services: ApplicationCameraServices) {}
  activate(): void { this.register(this.services.commands); }
  register(commands: CommandBuffer): () => void {
    const previous = this.registered.get(commands); if (previous !== undefined) return previous;
    const handlers = new Map<string, Parameters<CommandBuffer["register"]>[1]>();
    const add = (name: string, run: (args: readonly string[]) => void): void => {
      if (commands.exists(name)) throw new Error(`Camera command already registered: ${name}`);
      const handler: Parameters<CommandBuffer["register"]>[1] = invocation => { run(invocation.args); return undefined; };
      commands.register(name, handler, { summary: "Control the loaded source spline camera.", usage: `${name}${name === "loadcamera" || name === "savecamera" ? " <file.camera>" : ""}`, examples: [] }); handlers.set(name, handler);
    };
    add("loadcamera", args => { const path = args[0]; if (args.length !== 1 || path === undefined) throw new Error("Usage: loadcamera <file.camera>"); this.queue(this.load(path)); });
    add("startcamera", args => { if (args.length !== 0) throw new Error("Usage: startcamera"); this.start(); });
    add("stopcamera", () => this.stop());
    add("savecamera", args => { const path = args[0], definition = this.definition; if (args.length !== 1 || path === undefined) throw new Error("Usage: savecamera <file.camera>"); if (definition === null) throw new Error("No camera loaded"); this.queue(this.services.write(path, serializeCamera(definition))); });
    const release = (): void => { for (const [name, handler] of handlers) commands.unregister(name, handler); this.registered.delete(commands); };
    this.registered.set(commands, release); return release;
  }
  private queue(operation: Promise<void>): void {
    const pending = operation.catch((error: unknown) => this.services.print(`Camera: ${error instanceof Error ? error.message : String(error)}\n`));
    this.pending.add(pending); void pending.then(() => this.pending.delete(pending));
  }
  async load(path: string): Promise<void> {
    const generation = ++this.loadGeneration, text = await this.services.read(path);
    if (generation !== this.loadGeneration) return;
    if (text === null) throw new Error(`Camera file not found: ${path}`);
    const definition = parseCamera(text); this.stop(); this.definition = definition;
    this.services.print(`Loaded camera ${path}: ${definition.seconds}s, ${definition.events.length} events\n`);
  }
  start(): void {
    if (this.definition === null) throw new Error("No camera loaded");
    this.playback = new CameraPlayback(this.definition, this.services.milliseconds());
  }
  stop(): void { this.playback = null; }
  reset(): void { this.loadGeneration++; this.stop(); this.definition = null; }
  apply(camera: SceneCamera, milliseconds = this.services.milliseconds()): SceneCamera {
    if (this.playback === null || camera.clip.kind === "portal") return camera;
    const sample = this.playback.sample(milliseconds);
    if (sample === null) { this.stop(); return camera; }
    const projection = camera.projection, near = projection[14] / (projection[10] - 1), far = projection[14] / (projection[10] + 1);
    const aspect = projection[5] / projection[0], fovY = Math.atan(Math.tan(sample.fov * Math.PI / 360) / aspect) * 360 / Math.PI;
    return { ...camera, origin: sample.origin, axis: length3(sample.direction) === 0 ? camera.axis : anglesToAxis(vectorToAngles(sample.direction)),
      projection: perspectiveProjection(sample.fov, fovY, far, near) };
  }
  async drain(): Promise<void> { await Promise.all([...this.pending]); }
  async close(): Promise<void> {
    this.loadGeneration++; this.stop();
    for (const release of [...this.registered.values()]) release();
    await this.drain(); this.definition = null;
  }
}
