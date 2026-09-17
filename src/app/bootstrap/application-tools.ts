import type { CommandContext } from "../../contracts/common.ts";
import type { SceneCamera } from "../../contracts/render.ts";
import type { MountedContent } from "../../content/mounts/index.ts";
import type { CommandBuffer } from "../../core/commands/index.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import { OmniTimer } from "../../core/omnitimer.ts";
import { ApplicationSplineCamera } from "../../camera/application.ts";
import { ConfigStore } from "../../settings/config.ts";
import { registerDiagnosticTools, registerRuntimeDiagnostics, sourceCaptureFrame } from "./diagnostic-tools.ts";
import type { RuntimeDiagnosticServices } from "./diagnostic-tools.ts";
import { registerRendererDiagnostics } from "./renderer-diagnostics.ts";
import type { RendererDiagnosticServices } from "./renderer-diagnostics.ts";

export interface ApplicationToolServices {
  mounts(): MountedContent;
  outputRoot(): string;
  milliseconds(): number;
  cvars(): CvarRegistry | null;
  frame: RuntimeDiagnosticServices["frame"];
  renderer: RendererDiagnosticServices["renderer"];
  shaders: RendererDiagnosticServices["shaders"];
  resources: RendererDiagnosticServices["resources"];
  print(text: string, source?: CommandContext): void;
}
/** Shared by the active authority and input buffers; callbacks follow world publication. */
export class ApplicationTools {
  readonly timer = new OmniTimer();
  private readonly camera: ApplicationSplineCamera;
  private readonly bindings = new Map<CommandBuffer, () => void>();
  private readonly pending = new Set<Promise<void>>();
  constructor(commands: CommandBuffer, private readonly services: ApplicationToolServices) {
    this.camera = new ApplicationSplineCamera({ commands, milliseconds: services.milliseconds, print: text => services.print(text),
      read: async path => {
        const saved = await new ConfigStore(services.outputRoot()).loadText(path);
        if (saved !== null) return saved;
        const file = await services.mounts().open(path); return file === null ? null : new TextDecoder().decode(file.bytes);
      }, write: (path, text) => new ConfigStore(services.outputRoot()).dump(path, text) });
  }
  bind(commands: readonly CommandBuffer[]): void {
    const current = new Set(commands);
    for (const [owner, release] of this.bindings) if (!current.has(owner)) { release(); this.bindings.delete(owner); }
    for (const owner of current) {
      if (this.bindings.has(owner)) continue;
      const releases: (() => void)[] = [];
      try {
        releases.push(this.camera.register(owner));
        releases.push(registerDiagnosticTools({ commands: owner, timer: this.timer, print: text => this.services.print(text) }));
        releases.push(registerRuntimeDiagnostics({ commands: owner, mounts: this.services.mounts, frame: this.services.frame,
          print: text => this.services.print(text), queue: operation => this.queue(operation) }));
        releases.push(registerRendererDiagnostics({ commands: owner, renderer: this.services.renderer, shaders: this.services.shaders,
          resources: this.services.resources, print: (text, source) => this.services.print(text, source) }));
      } catch (error) { for (const release of releases.reverse()) release(); throw error; }
      this.bindings.set(owner, () => { for (const release of [...releases].reverse()) release(); });
    }
  }
  private queue(operation: Promise<void>): void {
    const pending = operation.catch((error: unknown) => this.services.print(`Diagnostic: ${error instanceof Error ? error.message : String(error)}\n`));
    this.pending.add(pending); void pending.then(() => this.pending.delete(pending));
  }
  async drain(): Promise<void> { await this.camera.drain(); await Promise.all([...this.pending]); }
  beforeWorldChange(): void { this.camera.reset(); for (const release of this.bindings.values()) release(); this.bindings.clear(); }
  applyCamera(camera: SceneCamera): SceneCamera { return this.camera.apply(camera); }
  frameTime(milliseconds: number, active: boolean): ReturnType<typeof sourceCaptureFrame> {
    const cvars = this.services.cvars();
    return sourceCaptureFrame(milliseconds, { fps: cvars?.variableValue("cl_avidemo") ?? 0, timescale: cvars?.find("timescale")?.numericValue ?? 1,
      active, force: (cvars?.variableValue("cl_forceavidemo") ?? 0) !== 0 });
  }
  async measureAsync<T>(name: string, operation: () => Promise<T>): Promise<T> {
    if (!this.timer.enabled) return operation();
    this.timer.push(name); try { return await operation(); } finally { this.timer.pop(); }
  }
  async close(): Promise<void> { this.beforeWorldChange(); await this.drain(); await this.camera.close(); this.timer.setEnabled(false); this.timer.reset(); }
}
