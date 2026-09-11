// SPDX-License-Identifier: GPL-2.0-or-later
import { isMainThread, parentPort, workerData, Worker } from "node:worker_threads";
import { SdlWindow } from "../../src/platform/sdl.ts";
import { SdlWorkerRenderContext } from "../../src/platform/sdl-render-context.ts";
import { loadGl } from "../../src/platform/gl.ts";

if (!isMainThread) {
  const port = parentPort, transfer: unknown = workerData;
  if (port === null) throw new Error("Context worker requires its parent port");
  let context: SdlWorkerRenderContext | null = null;
  let native: ReturnType<typeof loadGl> | null = null;
  const release = (): void => {
    try { native?.close(); }
    finally { context?.release(); context?.release(); }
    port.postMessage({ kind: "released" });
    port.close();
  };
  try {
    context = SdlWorkerRenderContext.adopt(transfer);
    native = loadGl(context);
    native.symbols.glClearColor(0, 1, 0, 1);
    native.symbols.glClear(0x4000);
    const pixels = new Uint8Array(4 * 4 * 4);
    native.symbols.glReadPixels(0, 0, 4, 4, 0x1908, 0x1401, pixels);
    context.swap();
    let resourceProtected = false;
    try { context.release(); }
    catch (error) { resourceProtected = error instanceof Error && error.message.includes("procedure tables"); }
    port.once("message", release);
    port.postMessage({ kind: "ready", pixels, resourceProtected, error: native.symbols.glGetError() });
  } catch (error) {
    port.postMessage({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    release();
  }
} else {
  const { expect, test } = await import("bun:test");

  function spawnContext(transfer: unknown) {
    const worker = new Worker(new URL(import.meta.url), { workerData: transfer });
    const messages: unknown[] = [];
    const receivers: ((value: unknown) => void)[] = [];
    worker.on("message", (value: unknown) => {
      const receive = receivers.shift();
      if (receive === undefined) messages.push(value);
      else receive(value);
    });
    const exited = new Promise<void>((resolve, reject) => {
      worker.once("error", reject);
      worker.once("exit", () => resolve());
    });
    return {
      worker, exited,
      receive: (): Promise<unknown> => messages.length > 0 ? Promise.resolve(messages.shift()) : new Promise(resolve => receivers.push(resolve)),
    };
  }

  test("malformed context transfer fails before native initialization", () => {
    for (const value of [null, 1, {}, { windowId: 0 }, { windowId: 1, key: "bad", ownership: new SharedArrayBuffer(4) }])
      expect(() => SdlWorkerRenderContext.adopt(value)).toThrow("Invalid SDL render context transfer");
  });

  test.skipIf(process.env["QUAKE_PLATFORM_NATIVE_TEST"] !== "1" || process.env["SDL_VIDEODRIVER"] !== "x11")(
    "real render worker adopts one context, draws, rejects duplicates and releases before cleanup", async () => {
      expect(process.env["DISPLAY"]).toBe(process.env["QUAKE_OWNED_DISPLAY"]);
      expect(process.env["WAYLAND_DISPLAY"]).toBeUndefined();
      const window = SdlWindow.open({ title: "worker context", width: 4, height: 4, backend: "gl", hidden: true });
      try {
        for (let iteration = 0; iteration < 3; iteration++) {
          const transfer = window.detachRenderContext(), first = spawnContext(transfer);
          try {
            const expected = Uint8Array.from({ length: 64 }, (_, index) => index % 4 === 1 || index % 4 === 3 ? 255 : 0);
            expect(await first.receive()).toEqual({ kind: "ready", pixels: expected, resourceProtected: true, error: 0 });
            expect(() => window.makeCurrent()).toThrow("worker");
            expect(() => window.close()).toThrow("worker");
            expect(() => window.restoreRenderContext()).toThrow("worker");
            window.pushEvent({ kind: "quit", timestamp: 42 });
            expect(window.pollEvents().some(event => event.kind === "quit")).toBe(true);
            const duplicate = spawnContext(transfer);
            expect(await duplicate.receive()).toEqual({ kind: "error", message: "SDL render context transfer was already consumed" });
            expect(await duplicate.receive()).toEqual({ kind: "released" });
            await duplicate.exited;
          } finally {
            first.worker.postMessage("release");
            expect(await first.receive()).toEqual({ kind: "released" });
            await first.exited;
            window.restoreRenderContext();
          }
          const native = loadGl(window);
          try {
            const clear = new Float32Array(4);
            native.symbols.glGetFloatv(0x0c22, clear);
            expect(clear).toEqual(new Float32Array([0, 1, 0, 1]));
            window.swap();
          } finally { native.close(); }
          const stale = spawnContext(transfer);
          expect(await stale.receive()).toEqual({ kind: "error", message: "SDL render context transfer was already consumed" });
          expect(await stale.receive()).toEqual({ kind: "released" });
          await stale.exited;
        }
      } finally { window.close(); window.close(); }
    }, 20_000,
  );
}
