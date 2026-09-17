import type { Vec4 } from "../contracts/math.ts";
import type { DrawBatch, ImageResourceOperation, RenderCommand, RendererBackend, RenderOperation, RenderViewState } from "../contracts/render.ts";
import { resolveDrawTextures } from "./commands/dynamic-texture.ts";

export type ExecutionOperation = Exclude<RenderOperation, { readonly kind: "draw" | "object-opacity" }>
  | { readonly kind: "draw"; readonly batches: Iterable<DrawBatch, undefined, unknown> }
  | { readonly kind: "object-opacity"; readonly opacity: number; readonly batches: Iterable<DrawBatch, undefined, unknown> };
export interface ExecutionView extends RenderViewState {
  readonly beforeView: Iterable<ExecutionOperation, undefined, unknown>;
  readonly operations: Iterable<ExecutionOperation, undefined, unknown>;
}
export type ExecutionCommand = Exclude<RenderCommand, { readonly kind: "view" | "swap-buffers" }>
  | { readonly kind: "view"; readonly view: ExecutionView }
  | { readonly kind: "swap-buffers"; readonly captures: readonly number[] };

export interface ExecutionServices {
  imageApplied(operation: ImageResourceOperation): void;
  swap(captures: readonly number[]): void;
}

/** The command interpreter is identical on the frontend and render worker. */
export class RenderExecutor {
  private color: Vec4 = { x: 1, y: 1, z: 1, w: 1 };
  constructor(private backend: RendererBackend, private readonly services: ExecutionServices) {}

  replaceBackend(backend: RendererBackend): void { this.backend = backend; }

  image(operation: ImageResourceOperation): void {
    this.backend.applyImageResource(operation);
    this.services.imageApplied(operation);
  }

  private draw(input: DrawBatch): void {
    const batch = resolveDrawTextures(input, operation => this.image(operation));
    const prepared = this.backend.prepareGeometry(batch);
    try {
      prepared.begin();
      prepared.applyTexture(0, batch.texture);
      if (batch.texturing === "pair") prepared.applyTexture(1, batch.secondTexture.binding);
      prepared.draw();
    } finally { prepared.cleanup(); }
  }

  private operations(operations: Iterable<ExecutionOperation, undefined, unknown>): void {
    for (const operation of operations) {
      if (operation.kind === "draw") for (const batch of operation.batches) this.draw(batch);
      else if (operation.kind === "object-opacity") this.backend.withObjectOpacity(operation.opacity, () => {
        for (const batch of operation.batches) this.draw(batch);
        return undefined;
      });
      else this.backend.drawImmediate(operation);
    }
  }

  private picture(command: Extract<RenderCommand, { readonly kind: "stretch-pic" }>): void {
    const { width, height } = this.backend;
    this.backend.beginView({ viewport: { x: 0, y: 0, width, height }, clear: null, clipPlane: null });
    const left = command.rect.x / width * 2 - 1, right = (command.rect.x + command.rect.width) / width * 2 - 1;
    const top = 1 - command.rect.y / height * 2, bottom = 1 - (command.rect.y + command.rect.height) / height * 2;
    this.draw({ primitive: "triangles", texturing: "single", texture: { kind: "bind-image", image: command.image }, lighting: { kind: "vertex" },
      vertices: [
        { position: { x: left, y: top, z: 0, w: 1 }, texCoord: { x: command.uv.s1, y: command.uv.t1 }, color: this.color },
        { position: { x: right, y: top, z: 0, w: 1 }, texCoord: { x: command.uv.s2, y: command.uv.t1 }, color: this.color },
        { position: { x: right, y: bottom, z: 0, w: 1 }, texCoord: { x: command.uv.s2, y: command.uv.t2 }, color: this.color },
        { position: { x: left, y: bottom, z: 0, w: 1 }, texCoord: { x: command.uv.s1, y: command.uv.t2 }, color: this.color },
      ], indices: [0, 1, 2, 0, 2, 3], state: { blend: { source: "src-alpha", destination: "one-minus-src-alpha" },
        depthTest: "always", depthWrite: false, alphaTest: "none", cull: "none", depthRange: [0, 1], polygonOffset: null } });
  }

  execute(command: ExecutionCommand): void {
    switch (command.kind) {
      case "draw-buffer": this.backend.selectDrawBuffer(command.buffer, command.clear); break;
      case "image-resource": this.image(command.operation); break;
      case "set-color": this.color = command.color; break;
      case "stretch-pic": this.picture(command); break;
      case "view":
        this.operations(command.view.beforeView);
        this.backend.beginView(command.view);
        this.operations(command.view.operations);
        break;
      case "swap-buffers": this.services.swap(command.captures); break;
      default: { const exhaustive: never = command; throw new Error(`Unhandled render command: ${String(exhaustive)}`); }
    }
  }
}
