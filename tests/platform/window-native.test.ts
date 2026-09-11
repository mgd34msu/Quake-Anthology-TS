// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, test } from "bun:test";
import { SdlWindow, decodeSdlEvent, type SdlInjectedEvent } from "../../src/platform/sdl.ts";
import { loadGl } from "../../src/platform/gl.ts";
import { loadGlPrograms } from "../../src/platform/gl-programs.ts";
import { openPlatform } from "../../src/platform/runtime.ts";
import { SdlControllers, VirtualSdlController } from "../../src/platform/controller.ts";
import { SdlAudioDevice } from "../../src/platform/audio.ts";

function cpu(): SdlWindow {
  return SdlWindow.open({ title: "platform native test", width: 3, height: 2, backend: "cpu", hidden: true, resizable: true });
}

function frame(width: number, height: number): Uint8Array {
  return Uint8Array.from({ length: width * height * 4 }, (_, index) => index % 4 === 3 ? 255 : (index * 31) % 256);
}

describe.skipIf(process.env["QUAKE_PLATFORM_NATIVE_TEST"] !== "1")("native SDL window ownership", () => {
  test("test process uses its explicitly owned display", () => {
    expect(process.env["WAYLAND_DISPLAY"]).toBeUndefined();
    expect(process.env["SDL_AUDIODRIVER"]).toBe("dummy");
    const driver = process.env["SDL_VIDEODRIVER"];
    if (driver !== "dummy") {
      expect(driver).toBe("x11");
      expect(process.env["DISPLAY"]).toBe(process.env["QUAKE_OWNED_DISPLAY"]);
      expect(process.env["DISPLAY"]).toMatch(/^:\d+$/);
    }
  });

  test("CPU presentation preserves exact pixels and copies typed-array subviews", () => {
    const window = cpu();
    try {
      const backing = new Uint8Array(32);
      backing.set(frame(3, 2), 4);
      const expected = backing.slice(4, 28);
      window.present(backing.subarray(4, 28));
      backing.fill(0);
      Bun.gc(true);
      expect(window.readPixels()).toEqual(expected);
      window.setSize(7, 5);
      window.pollEvents();
      expect(window.drawableSize).toEqual({ width: 7, height: 5 });
      const resized = frame(7, 5);
      window.present(resized);
      expect(window.readPixels()).toEqual(resized);
    } finally { window.close(); window.close(); }
  });

  test("real pushed events retain key, mouse, window and quit fields", () => {
    const window = cpu();
    try {
      window.pollEvents();
      const expected: readonly SdlInjectedEvent[] = [
        { kind: "key", timestamp: 111, down: true, repeat: true, scancode: 40, keycode: 13, modifiers: 0x2040 },
        { kind: "key", timestamp: 112, down: false, repeat: false, scancode: 4, keycode: 97, modifiers: 0 },
        { kind: "mouse-motion", timestamp: 114, buttons: 5, x: -12, y: 42, dx: -7, dy: 19 },
        { kind: "mouse-button", timestamp: 115, down: true, button: 3, clicks: 2, x: 17, y: -2 },
        { kind: "mouse-button", timestamp: 116, down: false, button: 3, clicks: 2, x: 17, y: -2 },
        { kind: "window", timestamp: 118, event: 14, data1: 123, data2: -456 },
        { kind: "quit", timestamp: 119 },
      ];
      for (const event of expected) window.pushEvent(event);
      expect(window.pollEvents()).toEqual(expected);
      expect(window.pollEvents()).toEqual([]);
    } finally { window.close(); }
  });

  test("events stay with their window and closing one preserves the other", () => {
    const first = cpu(), second = cpu();
    try {
      first.pollEvents(); second.pollEvents();
      second.pushEvent({ kind: "key", timestamp: 123, down: true, repeat: false, scancode: 4, keycode: 97, modifiers: 0 });
      first.pushEvent({ kind: "quit", timestamp: 124 });
      expect(first.pollEvents().map(event => event.kind)).toEqual(["quit"]);
      expect(second.pollEvents().map(event => event.kind)).toEqual(["key", "quit"]);
      first.close(); first.close();
      const pixels = frame(3, 2);
      second.present(pixels);
      expect(second.readPixels()).toEqual(pixels);
    } finally { first.close(); second.close(); }
  });

  test("invalid startup and closed handles fail at the boundary", () => {
    for (const width of [0, -1, 1.5, NaN, Infinity, 16385])
      expect(() => SdlWindow.open({ title: "test", width, height: 2, backend: "cpu" })).toThrow("dimensions");
    expect(() => SdlWindow.open({ title: "bad\0title", width: 2, height: 2, backend: "cpu" })).toThrow("NUL");
    const window = cpu();
    try {
      expect(() => window.readPixels()).toThrow("No framebuffer");
      expect(() => window.present(new Uint8Array(23))).toThrow("size");
      expect(() => window.swap()).toThrow("GL window");
      expect(() => window.pushEvent({ kind: "quit", timestamp: -1 })).toThrow("uint32");
    } finally { window.close(); }
    expect(() => window.pollEvents()).toThrow("closed");
    expect(() => window.setSize(4, 4)).toThrow("closed");
    expect(() => window.drawableSize).toThrow("closed");
  });

  test("repeated graphical runtime startup releases all window resources", () => {
    for (let iteration = 0; iteration < 12; iteration++) {
      const platform = openPlatform({ kind: "graphical", window: {
        title: "repeat open", width: 3, height: 2, backend: "cpu", hidden: true,
      } });
      try {
        if (platform.kind !== "graphical") throw new Error("Expected graphical runtime");
        platform.window.present(frame(3, 2));
        expect(platform.window.readPixels()).toEqual(frame(3, 2));
      } finally { platform.close(); platform.close(); }
      expect(platform.closed).toBe(true);
    }
  });

  test("window polling preserves controller events and independent audio lifetime", () => {
    const virtual = VirtualSdlController.attach();
    const controllers = SdlControllers.open();
    using audio = SdlAudioDevice.open({ sampleRate: 48000, channels: 2 });
    const window = cpu();
    try {
      controllers.setAssignments([{ kind: "automatic" }]);
      controllers.pollEvents(); window.pollEvents();
      virtual.setAxis(0, 12000);
      virtual.setButton(0, true);
      window.pushEvent({ kind: "key", timestamp: 56, down: true, repeat: false, scancode: 4, keycode: 97, modifiers: 0 });
      expect(window.pollEvents().some(event => event.kind === "key")).toBe(true);
      const events = controllers.pollEvents();
      expect(events.some(event => event.kind === "axis" && event.instance === virtual.instance && event.value === 12000)).toBe(true);
      expect(events.some(event => event.kind === "button" && event.instance === virtual.instance && event.button === 0 && event.down)).toBe(true);
      window.pushEvent({ kind: "key", timestamp: 57, down: false, repeat: false, scancode: 4, keycode: 97, modifiers: 0 });
      controllers.pollEvents();
      expect(window.pollEvents()).toContainEqual({ kind: "key", timestamp: 57, down: false, repeat: false, scancode: 4, keycode: 97, modifiers: 0 });
      audio.queue(new Int16Array(64));
      window.close();
      expect(audio.queuedFrames).toBe(32);
      virtual.setButton(0, false);
      expect(controllers.pollEvents().some(event => event.kind === "button" && !event.down)).toBe(true);
      using reopened = cpu();
      controllers.close();
      audio.close();
      reopened.present(frame(3, 2));
      expect(reopened.readPixels()).toEqual(frame(3, 2));
    } finally { window.close(); controllers.close(); virtual.close(); }
  });

  test.skipIf(process.env["SDL_VIDEODRIVER"] !== "dummy")("partial GL startup failure leaves a CPU window usable", () => {
    const retained = cpu();
    try {
      for (let iteration = 0; iteration < 3; iteration++)
        expect(() => SdlWindow.open({ title: "unsupported GL", width: 2, height: 2, backend: "gl", hidden: true }))
          .toThrow("SDL could not create any source GL visual candidate");
      retained.present(frame(3, 2));
      expect(retained.readPixels()).toEqual(frame(3, 2));
    } finally { retained.close(); }
  });

  test.skipIf(process.env["SDL_VIDEODRIVER"] !== "x11")("real GL procedures clear, read back, swap and retain context lifetime", () => {
    const first = SdlWindow.open({ title: "GL one", width: 16, height: 16, backend: "gl", hidden: true });
    const second = SdlWindow.open({ title: "GL two", width: 16, height: 16, backend: "gl", hidden: true });
    try {
      for (const window of [first, second]) {
        const native = loadGl(window);
        try {
          expect(() => window.close()).toThrow("procedure tables");
          expect(() => window.detachRenderContext()).toThrow("procedure tables");
          native.symbols.glClearColor(0, 1, 0, 1);
          native.symbols.glClear(0x4000);
          const pixels = new Uint8Array(16 * 16 * 4);
          native.symbols.glReadPixels(0, 0, 16, 16, 0x1908, 0x1401, pixels);
          expect(native.symbols.glGetError()).toBe(0);
          expect(pixels).toEqual(Uint8Array.from({ length: 16 * 16 * 4 }, (_, index) => index % 4 === 1 || index % 4 === 3 ? 255 : 0));
          expect(window.getGlProcAddress("glBegin")).toBeGreaterThan(0);
          window.swap();
        } finally { native.close(); native.close(); }
        const transfer = window.detachRenderContext();
        expect(transfer.windowId).toBe(window.id);
        expect(() => window.makeCurrent()).toThrow("reserved");
        window.restoreRenderContext();
        window.makeCurrent();
      }
      first.close(); second.swap();
    } finally { first.close(); second.close(); }
  });

  test.skipIf(process.env["SDL_VIDEODRIVER"] !== "x11")("GLSL 120 compiles, links and draws through native client arrays", () => {
    using window = SdlWindow.open({ title: "GLSL platform smoke", width: 8, height: 8, backend: "gl", hidden: true });
    const fixed = loadGl(window), programs = loadGlPrograms(window);
    const api = programs.symbols, gl = fixed.symbols, shaders: number[] = [];
    let program = 0;
    const compile = (type: number, source: string): number => {
      const shader = api.glCreateShader(type);
      expect(shader).toBeGreaterThan(0);
      shaders.push(shader);
      programs.shaderSource(shader, source);
      Bun.gc(true);
      api.glCompileShader(shader);
      const status = new Int32Array(1), length = new Int32Array(1), log = new Uint8Array(1024);
      api.glGetShaderiv(shader, 0x8b81, status);
      api.glGetShaderInfoLog(shader, log.length, length, log);
      if (status[0] !== 1) throw new Error(`GLSL compilation failed: ${new TextDecoder().decode(log)}`);
      return shader;
    };
    try {
      const vertex = compile(0x8b31, "#version 120\n// café shader source owns UTF-8 bytes\nvoid main() { gl_Position = gl_Vertex; }\n");
      const fragment = compile(0x8b30, "#version 120\nuniform int mode; uniform float intensity;\nvoid main() { gl_FragColor = mode == 1 ? vec4(0.0, intensity, 0.0, 1.0) : vec4(1.0); }\n");
      program = api.glCreateProgram();
      expect(program).toBeGreaterThan(0);
      api.glAttachShader(program, vertex); api.glAttachShader(program, fragment); api.glLinkProgram(program);
      const status = new Int32Array(1), length = new Int32Array(1), log = new Uint8Array(1024);
      api.glGetProgramiv(program, 0x8b82, status);
      api.glGetProgramInfoLog(program, log.length, length, log);
      if (status[0] !== 1) throw new Error(`GLSL link failed: ${new TextDecoder().decode(log)}`);
      api.glUseProgram(program);
      const mode = api.glGetUniformLocation(program, Buffer.from("mode\0"));
      const intensity = api.glGetUniformLocation(program, Buffer.from("intensity\0"));
      expect(mode).toBeGreaterThanOrEqual(0); expect(intensity).toBeGreaterThanOrEqual(0);
      api.glUniform1i(mode, 1); api.glUniform1f(intensity, 1);
      gl.glViewport(0, 0, 8, 8);
      const vertices = new Float32Array([-1, -1, 3, -1, -1, 3]);
      gl.glEnableClientState(0x8074); gl.glVertexPointer(2, 0x1406, 0, vertices);
      gl.glDrawElements(0x0004, 3, 0x1403, new Uint16Array([0, 1, 2]));
      gl.glDisableClientState(0x8074);
      const pixels = new Uint8Array(8 * 8 * 4);
      gl.glReadPixels(0, 0, 8, 8, 0x1908, 0x1401, pixels);
      expect(gl.glGetError()).toBe(0);
      expect(pixels).toEqual(Uint8Array.from({ length: pixels.length }, (_, index) => index % 4 === 1 || index % 4 === 3 ? 255 : 0));
      window.swap();
      expect(() => window.close()).toThrow("procedure tables");
    } finally {
      api.glUseProgram(0);
      if (program !== 0) api.glDeleteProgram(program);
      for (const shader of shaders) api.glDeleteShader(shader);
      programs.close(); programs.close(); fixed.close();
    }
  });
});

test("text and precise wheel bytes decode independently of synthetic SDL compatibility limits", () => {
  const text = new Uint8Array(56), textView = new DataView(text.buffer);
  textView.setUint32(0, 0x303, true); textView.setUint32(4, 77, true);
  text.set(new TextEncoder().encode("café"), 12);
  expect(decodeSdlEvent(text)).toEqual({ kind: "text", timestamp: 77, text: "café" });
  const wheel = new Uint8Array(56), wheelView = new DataView(wheel.buffer);
  wheelView.setUint32(0, 0x403, true); wheelView.setUint32(4, 78, true);
  wheelView.setInt32(16, -1, true); wheelView.setInt32(20, 2, true); wheelView.setUint32(24, 1, true);
  wheelView.setFloat32(28, -1.5, true); wheelView.setFloat32(32, 2.25, true);
  expect(decodeSdlEvent(wheel)).toEqual({ kind: "mouse-wheel", timestamp: 78, x: -1, y: 2, preciseX: -1.5, preciseY: 2.25, flipped: true });
});
