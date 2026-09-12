// SPDX-License-Identifier: GPL-2.0-or-later
// Q2 ref_gl/qgl.ts framebuffer ABI, resolved through the owning SDL GL context.
import { linkSymbols } from "bun:ffi";
import type { SdlRenderContext } from "./sdl-render-context.ts";

/** The renderer owns framebuffer objects and selects its context before symbol calls. */
export function loadGlFramebuffers(context: Pick<SdlRenderContext, "getGlProcAddress" | "retainProcedures">) {
  const table = linkSymbols({
    glGenFramebuffers: { args: ["i32", "buffer"], returns: "void", ptr: context.getGlProcAddress("glGenFramebuffers") },
    glDeleteFramebuffers: { args: ["i32", "buffer"], returns: "void", ptr: context.getGlProcAddress("glDeleteFramebuffers") },
    glBindFramebuffer: { args: ["u32", "u32"], returns: "void", ptr: context.getGlProcAddress("glBindFramebuffer") },
    glFramebufferTexture2D: { args: ["u32", "u32", "u32", "u32", "i32"], returns: "void", ptr: context.getGlProcAddress("glFramebufferTexture2D") },
    glCheckFramebufferStatus: { args: ["u32"], returns: "u32", ptr: context.getGlProcAddress("glCheckFramebufferStatus") },
    glTexImage2D: { args: ["u32", "i32", "i32", "i32", "i32", "i32", "u32", "u32", "ptr"], returns: "void", ptr: context.getGlProcAddress("glTexImage2D") },
    glBlitFramebuffer: { args: ["i32", "i32", "i32", "i32", "i32", "i32", "i32", "i32", "u32", "u32"], returns: "void", ptr: context.getGlProcAddress("glBlitFramebuffer") },
    glGetFramebufferAttachmentParameteriv: { args: ["u32", "u32", "u32", "buffer"], returns: "void", ptr: context.getGlProcAddress("glGetFramebufferAttachmentParameteriv") },
    glReadBuffer: { args: ["u32"], returns: "void", ptr: context.getGlProcAddress("glReadBuffer") },
  });
  let release: () => void;
  try { release = context.retainProcedures(); }
  catch (error) { table.close(); throw error; }
  let closed = false;
  return {
    symbols: table.symbols,
    close(): void {
      if (closed) return;
      table.close();
      closed = true;
      release();
    },
    [Symbol.dispose](): void { this.close(); },
  };
}
