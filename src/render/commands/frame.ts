import type { SeatId } from "../../contracts/identity.ts";
import type { Vec4 } from "../../contracts/math.ts";
import type { ImageResourceOperation, Rect, RenderCommand, RendererDrawBuffer, RendererImage, RenderFrame, RenderView, TextureRect } from "../../contracts/render.ts";
import { SceneImageRegistry } from "../scene/resources.ts";
import type { PreparedWorldView } from "../scene/world.ts";

/** One ordered frame may contain independent seats, previews and portal children. */
export class SceneFrameBuilder {
  private commands: RenderCommand[] = [];
  private sequence = 0;
  private active = false;

  constructor(readonly images: SceneImageRegistry) {}

  begin(buffer: RendererDrawBuffer = "back", clear = false): void {
    if (this.active) throw new Error("A scene frame is already being prepared");
    this.active = true;
    this.commands = [{ kind: "draw-buffer", buffer, clear }];
    this.resources(this.images.drainOperations());
  }

  resources(operations: readonly ImageResourceOperation[]): void {
    this.requireActive();
    for (const operation of operations) this.commands.push({ kind: "image-resource", operation });
  }

  view(view: RenderView): void {
    this.requireActive();
    if (view.target.kind === "seat" && view.target.seat.session !== this.images.owner.session)
      throw new Error("Render seat belongs to another session");
    this.resources(this.images.drainOperations());
    this.commands.push({ kind: "view", view });
  }

  world(prepared: PreparedWorldView): void { this.resources(prepared.imageOperations); this.view(prepared.view); }

  /** Local seat coordinates are clipped before they enter the global 2D queue. */
  picture(seat: SeatId, viewport: Rect, rect: Rect, image: RendererImage,
    uv: TextureRect = { s1: 0, t1: 0, s2: 1, t2: 1 }, color: Vec4 = { x: 1, y: 1, z: 1, w: 1 }): void {
    if (seat.session !== this.images.owner.session) throw new Error("HUD seat belongs to another session");
    this.images.require(image);
    const clipped = clipPicture(rect, uv, { x: 0, y: 0, width: viewport.width, height: viewport.height });
    if (clipped === null) return;
    this.command({ kind: "set-color", color });
    this.command({ kind: "stretch-pic", image, uv: clipped.uv,
      rect: { ...clipped.rect, x: viewport.x + clipped.rect.x, y: viewport.y + clipped.rect.y } });
  }

  command(command: Exclude<RenderCommand, { readonly kind: "swap-buffers" }>): void { this.requireActive(); this.commands.push(command); }

  finish(present = true): RenderFrame {
    this.requireActive();
    if (present) this.commands.push({ kind: "swap-buffers" });
    const frame: RenderFrame = { owner: this.images.owner, sequence: this.sequence++, commands: this.commands };
    this.commands = []; this.active = false;
    return frame;
  }

  discard(): void { this.commands = []; this.active = false; }
  private requireActive(): void { if (!this.active) throw new Error("Begin a scene frame before submitting commands"); }
}

export function clipPicture(rect: Rect, uv: TextureRect, clip: Rect): { readonly rect: Rect; readonly uv: TextureRect } | null {
  if (rect.width === 0 || rect.height === 0) return null;
  const left = Math.max(Math.min(rect.x, rect.x + rect.width), clip.x), right = Math.min(Math.max(rect.x, rect.x + rect.width), clip.x + clip.width);
  const top = Math.max(Math.min(rect.y, rect.y + rect.height), clip.y), bottom = Math.min(Math.max(rect.y, rect.y + rect.height), clip.y + clip.height);
  if (left >= right || top >= bottom) return null;
  return { rect: { x: left, y: top, width: right - left, height: bottom - top }, uv: {
    s1: uv.s1 + (uv.s2 - uv.s1) * (left - rect.x) / rect.width, s2: uv.s1 + (uv.s2 - uv.s1) * (right - rect.x) / rect.width,
    t1: uv.t1 + (uv.t2 - uv.t1) * (top - rect.y) / rect.height, t2: uv.t1 + (uv.t2 - uv.t1) * (bottom - rect.y) / rect.height } };
}
