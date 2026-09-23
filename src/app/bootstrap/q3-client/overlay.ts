import type { SeatId } from "../../../contracts/identity.ts";
import type { Rect, RenderCommand, SceneCamera } from "../../../contracts/render.ts";
import type { Q3PresentedScene } from "../../../content/q3/presentation/scene.ts";
import { RDF_NOWORLDMODEL } from "../../../content/q3/presentation/refdef.ts";
import { clipPicture, type SceneFrameBuilder } from "../../../render/commands/frame.ts";
import { prepareMaterialText } from "../../../render/commands/material2d.ts";
import { createSourceSceneOrder, finishSceneOperations, reserveSourceEntityRange } from "../../../render/scene/submissions.ts";
import { createWorldSurfaceAdmission, type WorldViewInput } from "../../../render/scene/world.ts";
import type { MaterialTextDraw } from "../../../text/draw2d.ts";
import type { ApplicationAssets } from "../assets.ts";
import type { ApplicationQ3SceneRenderer } from "./scene.ts";

export type Q3OverlaySubmission =
  | { readonly kind: "command"; readonly command: Extract<RenderCommand, { readonly kind: "set-color" | "stretch-pic" }> }
  | { readonly kind: "text"; readonly draw: MaterialTextDraw }
  | { readonly kind: "scene"; readonly scene: Q3PresentedScene };

/** Cropping changes clip coordinates, preserving the source icon's pixel size and position. */
function clippedCamera(camera: SceneCamera, clip: Rect): SceneCamera | null {
  const area = camera.viewport, x = Math.max(area.x, clip.x), y = Math.max(area.y, clip.y);
  const width = Math.min(area.x + area.width, clip.x + clip.width) - x;
  const height = Math.min(area.y + area.height, clip.y + clip.height) - y;
  if (width <= 0 || height <= 0) return null;
  if (x === area.x && y === area.y && width === area.width && height === area.height) return camera;
  const sx = area.width / width, sy = area.height / height;
  const tx = (2 * (area.x - x) + area.width - width) / width, ty = -(2 * (area.y - y) + area.height - height) / height;
  const p = camera.projection;
  return { ...camera, viewport: { x, y, width, height }, projection: [
    sx * p[0] + tx * p[3], sy * p[1] + ty * p[3], p[2], p[3],
    sx * p[4] + tx * p[7], sy * p[5] + ty * p[7], p[6], p[7],
    sx * p[8] + tx * p[11], sy * p[9] + ty * p[11], p[10], p[11],
    sx * p[12] + tx * p[15], sy * p[13] + ty * p[15], p[14], p[15],
  ] };
}

/** Original pictures, glyphs and model icons retain their interleaved source order. */
export function drawQ3Overlay(options: {
  readonly submissions: readonly Q3OverlaySubmission[];
  readonly renderer: ApplicationQ3SceneRenderer;
  readonly assets: ApplicationAssets;
  readonly frames: SceneFrameBuilder;
  readonly camera: SceneCamera;
  readonly viewport: Rect;
  readonly seat: SeatId;
  readonly time: number;
}): void {
  const { frames, viewport, assets } = options;
  const time = { kind: "milliseconds", value: options.time } satisfies WorldViewInput["time"];
  const target = { kind: "seat", seat: options.seat } satisfies WorldViewInput["target"];
  frames.command({ kind: "set-color", color: { x: 1, y: 1, z: 1, w: 1 } });
  for (const submission of options.submissions) {
    if (submission.kind === "command") {
      const command = submission.command;
      if (command.kind === "set-color") frames.command(command);
      else {
        const clipped = clipPicture(command.rect, command.uv, viewport);
        if (clipped !== null) frames.command({ ...command, ...clipped });
      }
    } else if (submission.kind === "text") {
      if (!submission.draw.seat.equals(options.seat)) throw new Error("Source HUD text belongs to another seat");
      frames.view({ target, time, viewport, clear: null, clipPlane: null, beforeView: [], operations: [{ kind: "draw",
        batches: prepareMaterialText(submission.draw, viewport, assets.world.materialContext({ camera: options.camera, target, time })) }] });
    } else {
      const scene = submission.scene;
      if ((scene.source.renderFlags & RDF_NOWORLDMODEL) === 0 || !scene.seat.equals(options.seat))
        throw new Error("Source HUD cannot replace a world view or another seat");
      const camera = clippedCamera(scene.camera, viewport);
      if (camera === null) continue;
      const order = createSourceSceneOrder(assets.materialRegistrations);
      const input: WorldViewInput = { camera, target, time, source: createWorldSurfaceAdmission(order), renderText: scene.source.text,
        q3Lights: scene.lights.map(light => ({ origin: light.origin, radius: light.radius, color: light.color, additive: light.additive })).slice(0, 32) };
      frames.view({ target, time, viewport: camera.viewport, clear: { depth: 1, color: null, stencil: false }, clipPlane: null, beforeView: [],
        operations: finishSceneOperations(options.renderer.operations(scene, input, reserveSourceEntityRange(order, scene.admission.entities.length),
          { noWorldModel: true, splitScreen: false, supplementalViewWeapon: false })) });
    }
  }
  frames.command({ kind: "set-color", color: { x: 1, y: 1, z: 1, w: 1 } });
}
