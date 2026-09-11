// SPDX-License-Identifier: GPL-2.0-or-later
// Q2 ref_gl/qgl.ts shader ABI and single-string indirection, with explicit buffer ownership.
import { linkSymbols, ptr } from "bun:ffi";
import type { SdlRenderContext } from "./sdl-render-context.ts";

/** The renderer owns program/shader objects and selects its context before raw symbol calls. */
export function loadGlPrograms(context: Pick<SdlRenderContext, "getGlProcAddress" | "retainProcedures" | "makeCurrent">) {
  if (process.arch !== "x64" && process.arch !== "arm64") throw new Error("GL shader source requires a 64-bit pointer ABI");
  const table = linkSymbols({
    glCreateShader: { args: ["u32"], returns: "u32", ptr: context.getGlProcAddress("glCreateShader") },
    glShaderSource: { args: ["u32", "i32", "buffer", "buffer"], returns: "void", ptr: context.getGlProcAddress("glShaderSource") },
    glCompileShader: { args: ["u32"], returns: "void", ptr: context.getGlProcAddress("glCompileShader") },
    glGetShaderiv: { args: ["u32", "u32", "buffer"], returns: "void", ptr: context.getGlProcAddress("glGetShaderiv") },
    glGetShaderInfoLog: { args: ["u32", "i32", "buffer", "buffer"], returns: "void", ptr: context.getGlProcAddress("glGetShaderInfoLog") },
    glDeleteShader: { args: ["u32"], returns: "void", ptr: context.getGlProcAddress("glDeleteShader") },
    glCreateProgram: { args: [], returns: "u32", ptr: context.getGlProcAddress("glCreateProgram") },
    glAttachShader: { args: ["u32", "u32"], returns: "void", ptr: context.getGlProcAddress("glAttachShader") },
    glLinkProgram: { args: ["u32"], returns: "void", ptr: context.getGlProcAddress("glLinkProgram") },
    glGetProgramiv: { args: ["u32", "u32", "buffer"], returns: "void", ptr: context.getGlProcAddress("glGetProgramiv") },
    glGetProgramInfoLog: { args: ["u32", "i32", "buffer", "buffer"], returns: "void", ptr: context.getGlProcAddress("glGetProgramInfoLog") },
    glDeleteProgram: { args: ["u32"], returns: "void", ptr: context.getGlProcAddress("glDeleteProgram") },
    glUseProgram: { args: ["u32"], returns: "void", ptr: context.getGlProcAddress("glUseProgram") },
    glGetUniformLocation: { args: ["u32", "buffer"], returns: "i32", ptr: context.getGlProcAddress("glGetUniformLocation") },
    glUniform1i: { args: ["i32", "i32"], returns: "void", ptr: context.getGlProcAddress("glUniform1i") },
    glUniform1f: { args: ["i32", "f32"], returns: "void", ptr: context.getGlProcAddress("glUniform1f") },
  });
  let release: () => void;
  try { release = context.retainProcedures(); }
  catch (error) { table.close(); throw error; }
  const sources = new Set<Uint8Array>();
  let closed = false;
  return {
    symbols: table.symbols,
    shaderSource(shader: number, source: string): void {
      if (closed) throw new Error("GL program procedure table is closed");
      if (!Number.isInteger(shader) || shader <= 0 || shader > 0xffffffff) throw new RangeError("GL shader must be a nonzero uint32");
      if (source.includes("\0")) throw new Error("GL shader source contains NUL");
      const length = Buffer.byteLength(source, "utf8");
      if (length > 0x7fffffff) throw new RangeError("GL shader source exceeds signed 32-bit length");
      const bytes = Buffer.from(`${source}\0`, "utf8");
      const pointers = new BigUint64Array([BigInt(ptr(bytes))]);
      const lengths = new Int32Array([length]);
      context.makeCurrent();
      sources.add(bytes);
      try { table.symbols.glShaderSource(shader, 1, pointers, lengths); }
      finally { sources.delete(bytes); }
    },
    close(): void {
      if (closed) return;
      table.close();
      closed = true;
      release();
    },
    [Symbol.dispose](): void { this.close(); },
  };
}
