import type { CommandContext } from "../../contracts/common.ts";
import type { CommandBuffer, CommandInvocation } from "../../core/commands/index.ts";
import type { RegisteredSceneMaterial } from "../../render/scene/material-registrations.ts";
import type { Q3RendererResources } from "../../content/q3/presentation/resources.ts";
import type { RendererDiagnostics } from "./renderer.ts";

export interface RendererDiagnosticServices {
  readonly commands: CommandBuffer;
  renderer(): RendererDiagnostics;
  shaders(sorted: boolean): readonly RegisteredSceneMaterial[];
  resources(source: CommandContext): { readonly models: ReturnType<Q3RendererResources["registeredModels"]>;
    readonly skins: ReturnType<Q3RendererResources["registeredSkins"]> } | null;
  print(text: string, source: CommandContext): void;
}
/** Source commands query the active owners at dispatch; snapshots never execute resource queues. */
export function registerRendererDiagnostics(services: RendererDiagnosticServices): () => void {
  const handlers = new Map<string, (invocation: CommandInvocation) => undefined>();
  const add = (name: string, summary: string, usage: string, run: (invocation: CommandInvocation) => void): void => {
    if (services.commands.exists(name)) throw new Error(`Renderer diagnostic command already registered: ${name}`);
    const handler = (invocation: CommandInvocation): undefined => { run(invocation); return undefined; };
    if (!services.commands.registerEngine(name, handler, { summary, usage, examples: [] })) throw new Error(`Cannot register renderer diagnostic ${name}`);
    handlers.set(name, handler);
  };
  add("imagelist", "List actual resident renderer images.", "imagelist", invocation => {
    const images = services.renderer().images;
    services.print("ordinal width height encoding mipLevels name\n" + images.map(image =>
      `${image.ordinal} ${image.width} ${image.height} ${image.encoding} ${image.mipLevels} ${image.name}`).join("\n") + `\n${images.length} resident images\n`, invocation.source);
  });
  add("shaderlist", "List registered shaders, optionally in source sorted order.", "shaderlist [sorted]", invocation => {
    const shaders = services.shaders(invocation.args.length !== 0);
    services.print("passes lightmap iterator sort name\n" + shaders.map(shader =>
      `${shader.finished.numUnfoggedPasses} ${shader.finished.lightmapIndex} ${shader.finished.iterator.kind} ${shader.finished.sort} ${shader.material.name}`).join("\n")
      + `\n${shaders.length} registered shaders\n`, invocation.source);
  });
  add("modellist", "List model handles registered by the invoking source client.", "modellist", invocation => {
    const resources = services.resources(invocation.source);
    if (resources === null) throw new Error("No active source client model registry");
    services.print("handle kind name\n" + resources.models.map(entry => `${entry.handle} ${entry.model.kind === "model" ? entry.model.model.kind : entry.model.kind} ${entry.path}`).join("\n")
      + `\n${resources.models.length} registered models\n`, invocation.source);
  });
  add("skinlist", "List source skin handles and their registered surface shaders.", "skinlist", invocation => {
    const resources = services.resources(invocation.source);
    if (resources === null) throw new Error("No active source client skin registry");
    services.print(resources.skins.map(entry => `${entry.handle} ${entry.path}\n${entry.skin.surfaces.map(surface => `  ${surface.name} = ${surface.shader}`).join("\n")}`).join("\n")
      + `\n${resources.skins.length} registered skins\n`, invocation.source);
  });
  add("modelist", "List display modes returned by the active video device.", "modelist", invocation => {
    const modes = services.renderer().displayModes;
    services.print(modes.map((mode, index) => `${index}: ${mode.width}x${mode.height} ${mode.colorBits} bit ${mode.refreshRate} Hz`).join("\n") + `\n${modes.length} display modes\n`, invocation.source);
  });
  add("gfxinfo", "Report the actual backend, drawable size and GL driver when present.", "gfxinfo", invocation => {
    const info = services.renderer();
    services.print(`backend: ${info.backend}\ndrawable: ${info.width}x${info.height}\n`
      + (info.driver === null ? "driver: software renderer\n" : `vendor: ${info.driver.vendor}\nrenderer: ${info.driver.renderer}\nversion: ${info.driver.version}\nshadingLanguage: ${info.driver.shadingLanguage}\n`), invocation.source);
  });
  return () => { for (const [name, handler] of handlers) services.commands.unregister(name, handler); handlers.clear(); };
}
