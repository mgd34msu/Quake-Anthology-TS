/* Shader cinematic execution boundary adapted from Q3 cl_cin.c.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { ImageResourceOperation, RendererImage } from "../contracts/render.ts";

export interface ShaderCinematicCall {
  readonly upload: ImageResourceOperation;
  afterShaderUpload(): undefined;
}

/** Called at execution time so animation frames do not become stale while queued. */
export interface ShaderCinematicSource {
  readonly image: RendererImage;
  prepareAtExecution(): ShaderCinematicCall | null;
}
