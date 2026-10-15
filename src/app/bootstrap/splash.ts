import titleImage from "../../../assets/ui/title.png" with { type: "file" };
import type { PngImage } from "../../formats/images/png.ts";

export interface SplashScreen { close(): void; }

/** Bilinear cover-fit scale of the title art into a width*height RGBA frame. */
export function scaleCover(image: PngImage, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const scale = Math.max(width / image.width, height / image.height);
  const sourceWidth = width / scale;
  // Anchor vertical crops to the top so the title treatment is never cut.
  const originX = (image.width - sourceWidth) / 2, originY = 0;
  for (let y = 0; y < height; y++) {
    const sourceY = originY + (y + 0.5) / scale - 0.5;
    const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(sourceY))), y1 = Math.min(image.height - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sourceY - y0));
    for (let x = 0; x < width; x++) {
      const sourceX = originX + (x + 0.5) / scale - 0.5;
      const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(sourceX))), x1 = Math.min(image.width - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sourceX - x0));
      const target = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const top = (image.pixels[(y0 * image.width + x0) * 4 + channel] ?? 0) * (1 - fx) + (image.pixels[(y0 * image.width + x1) * 4 + channel] ?? 0) * fx;
        const bottom = (image.pixels[(y1 * image.width + x0) * 4 + channel] ?? 0) * (1 - fx) + (image.pixels[(y1 * image.width + x1) * 4 + channel] ?? 0) * fx;
        out[target + channel] = Math.round(top * (1 - fy) + bottom * fy);
      }
      out[target + 3] = 255;
    }
  }
  return out;
}

/**
 * Splash child process body (`--splash-child <width> <height>`). Runs in its
 * own process so its SDL event pump stays responsive while the parent's main
 * thread is blocked loading; a same-process splash never answers the
 * compositor and gets flagged "not responding". Exits when the user closes
 * the window or the parent closes the stdin pipe (including parent death).
 */
export async function runSplashChild(width: number, height: number): Promise<number> {
  const [{ SdlWindow }, { decodePng }] = await Promise.all([import("../../platform/sdl.ts"), import("../../formats/images/png.ts")]);
  const image = decodePng(await Bun.file(titleImage).bytes(), "assets/ui/title.png");
  const window = SdlWindow.open({ title: "Quake Anthology", width, height, backend: "cpu" });
  let parentGone = false;
  void (async () => {
    try { for await (const _chunk of Bun.stdin.stream()) { /* Parent sends nothing; EOF is the signal. */ } }
    catch { /* A broken pipe is the same signal. */ }
    parentGone = true;
  })();
  try {
    window.present(scaleCover(image, width, height));
    process.stdout.write("ready\n");
    let ticks = 0;
    for (;;) {
      if (parentGone) break;
      const events = window.pollEvents();
      if (events.some(event => event.kind === "quit")) break;
      if (++ticks % 30 === 0) process.stdout.write(`tick ${Date.now()}\n`);
      await Bun.sleep(16);
    }
  } finally { window.close(); }
  return 0;
}

/** Best-effort title splash shown while the application loads; failures never block launch. */
export async function openSplash(width: number, height: number): Promise<SplashScreen | null> {
  if (process.env["QTS_SPLASH_CHILD"] !== undefined) return null; // A splash child never spawns its own splash.
  try {
    const compiled = Bun.main.startsWith("/$bunfs/") || Bun.main.startsWith("B:/~BUN/");
    const command = compiled
      ? [process.execPath, "--splash-child", String(width), String(height)]
      : [process.execPath, Bun.main, "--splash-child", String(width), String(height)];
    const child = Bun.spawn(command, { stdin: "pipe", stdout: "pipe", stderr: "ignore", env: { ...process.env, QTS_SPLASH_CHILD: "1" } });
    const closed = { value: false };
    const splash: SplashScreen = {
      close: () => {
        if (closed.value) return;
        closed.value = true;
        try { child.stdin.end(); } catch { /* Already closed. */ }
        setTimeout(() => { try { child.kill(); } catch { /* Already exited. */ } }, 300).unref();
      },
    };
    // Drain the child's pipe (discarding ticks) and wait briefly for its
    // first presented frame so the splash is up before loading starts.
    let signalReady: (presented: boolean) => void = () => {};
    const ready = new Promise<boolean>(resolveReady => { signalReady = resolveReady; });
    void (async () => {
      const decoder = new TextDecoder();
      let pending = "";
      let presented = false;
      for await (const chunk of child.stdout) {
        pending += decoder.decode(chunk, { stream: true });
        if (!presented && pending.includes("ready\n")) { presented = true; signalReady(true); }
        if (pending.length > 4096) pending = pending.slice(-1024);
      }
      signalReady(presented);
    })();
    const presented = await Promise.race([ready, Bun.sleep(5000).then(() => false), child.exited.then(() => false)]);
    if (!presented && child.exitCode !== null) return null;
    return splash;
  } catch { return null; }
}
