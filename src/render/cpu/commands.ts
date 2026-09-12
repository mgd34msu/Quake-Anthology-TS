/* Ordered commands follow id Software tr_cmds.c and tr_backend.c.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Vec4 } from "../../contracts/math.ts";
import type { RenderFrame, RenderOperation } from "../../contracts/render.ts";
import type { SdlWindow } from "../../platform/sdl.ts";
import { SoftwareRenderer } from "./rasterizer.ts";

export type CpuPresenter = Pick<SdlWindow, "backend" | "drawableSize" | "present">;

/** The window owns SDL; this target owns command ordering and CPU rendering. */
export class CpuRenderTarget {
  private color: Vec4 = { x: 1, y: 1, z: 1, w: 1 };

  constructor(readonly backend: SoftwareRenderer, private readonly presenter: CpuPresenter | null = null) {
    if (presenter !== null && presenter.backend !== "cpu") throw new Error("CPU rendering requires an SDL CPU window");
  }

  private operations(operations: readonly RenderOperation[]): void {
    for (const operation of operations) {
      if (operation.kind === "draw") for (const batch of operation.batches) this.backend.draw(batch);
      else if (operation.kind === "object-opacity") this.backend.withObjectOpacity(operation.opacity, () => {
        for (const batch of operation.batches) this.backend.draw(batch);
        return undefined;
      });
      else this.backend.drawImmediate(operation);
    }
  }

  execute(frame: RenderFrame): undefined {
    const owner = this.backend.owner;
    if (frame.owner.identity !== owner.identity || frame.owner.session !== owner.session
      || frame.owner.generation !== owner.generation) throw new Error("CPU frame belongs to another renderer owner");
    for (const command of frame.commands) switch (command.kind) {
      case "image-resource": this.backend.applyImageResource(command.operation); break;
      case "draw-buffer": this.backend.selectDrawBuffer(command.buffer, command.clear); break;
      case "set-color": this.color = { ...command.color }; break;
      case "stretch-pic": this.backend.drawStretchPic(command.image, command.rect, command.uv, this.color); break;
      case "view":
        this.operations(command.view.beforeView);
        this.backend.beginView(command.view);
        this.operations(command.view.operations);
        break;
      case "swap-buffers": this.present(); break;
      default: {
        const invalid: never = command;
        throw new Error(`Invalid CPU command ${invalid}`);
      }
    }
  }

  present(): undefined {
    this.backend.finish();
    if (this.presenter === null) return;
    const { width, height } = this.presenter.drawableSize;
    if (width !== this.backend.width || height !== this.backend.height)
      throw new RangeError("CPU framebuffer dimensions must match the SDL drawable");
    this.presenter.present(this.backend.pixels);
  }

  close(): undefined { this.backend.close(); }
}
