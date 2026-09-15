import { CvarFlag, type CvarRegistry } from "../../core/cvars/index.ts";
import type { Rect, SceneCamera } from "../../contracts/render.ts";
import type { CommandBuffer } from "../../core/commands/index.ts";

export function registerQ1ViewCommands(commands: CommandBuffer): () => void {
  if (commands.dialect !== "q1-netquake" && commands.dialect !== "q1-quakeworld") return () => {};
  const registered: string[] = [];
  for (const [name, step] of [["sizeup", 10], ["sizedown", -10]] satisfies readonly (readonly [string, number])[]) {
    if (commands.exists(name)) continue;
    if (commands.register(name, command => {
      const size = commands.findCvar("viewsize", command.source);
      if (size !== undefined) command.insert(`viewsize ${size.numericValue + step}\n`);
    })) registered.push(name);
  }
  return () => { for (const name of registered) commands.unregister(name); };
}

/** Native Q1 view declarations belong to the client before quake.rc executes. */
export function registerQ1ClientSettings(cvars: CvarRegistry): void {
  if (cvars.dialect !== "q1-netquake" && cvars.dialect !== "q1-quakeworld") return;
  cvars.register("viewsize", "100", CvarFlag.Archive);
  if (cvars.dialect === "q1-quakeworld") cvars.register("cl_sbar", "0", CvarFlag.Archive);
  cvars.bindValue("viewsize", { validate: value => value.trim() !== "" && Number.isFinite(Number(value)) ? null : "Expected a finite number", changed: () => undefined });
  cvars.document("viewsize", { summary: "Quake view size. 30 through 100 sizes the scene; 110 removes the inventory margin, 120 hides the status display.", usage: "viewsize <30..120>", examples: ["viewsize 100", "viewsize 120"] });
}

export interface Q1ViewSettings { readonly size: number; readonly overlayStatus: boolean; }

export function readQ1ViewSettings(cvars: CvarRegistry | null): Q1ViewSettings | null {
  const current = cvars?.find("viewsize");
  if (cvars === null || current === undefined) return null;
  const size = Math.max(30, Math.min(120, current.numericValue));
  if (size !== current.numericValue) cvars.set("viewsize", String(size));
  return { size, overlayStatus: cvars.dialect === "q1-quakeworld" && cvars.variableValue("cl_sbar") === 0 };
}

/** SCR_CalcRefdef's rectangle; split-screen uses each seat's bounds. */
export function q1ViewRectangle(area: Rect, viewsize: number, intermission: boolean, overlayStatus = false): Rect {
  const size = intermission ? 120 : Math.max(30, Math.min(120, viewsize));
  const lines = size >= 120 ? 0 : size >= 110 ? 24 : 48;
  const available = Math.max(1, area.height - (overlayStatus && size >= 100 ? 0 : lines));
  const fraction = Math.min(size, 100) / 100;
  const width = Math.min(area.width, Math.max(96, Math.trunc(area.width * fraction)));
  const height = Math.max(1, Math.min(available, Math.trunc(area.height * fraction)));
  return { x: area.x + Math.trunc((area.width - width) / 2), y: area.y + (size >= 100 ? 0 : Math.trunc((available - height) / 2)), width, height };
}

export function q1ViewCamera(camera: SceneCamera, area: Rect, settings: Q1ViewSettings, intermission: boolean): SceneCamera {
  const viewport = q1ViewRectangle(area, settings.size, intermission, settings.overlayStatus);
  const ratio = viewport.width / viewport.height / (camera.viewport.width / camera.viewport.height), p = camera.projection;
  return { ...camera, viewport, projection: [p[0], p[1] * ratio, p[2], p[3], p[4], p[5] * ratio, p[6], p[7],
    p[8], p[9] * ratio, p[10], p[11], p[12], p[13] * ratio, p[14], p[15]] };
}
