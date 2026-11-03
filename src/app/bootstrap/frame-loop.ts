import { setImmediate } from "node:timers/promises";

/** The wall-clock loop shared by the local and remote applications. */
export interface FrameLoopHost {
  /** False once the host is stopping, closed or past its frame limit. */
  alive(): boolean;
  /** Shortest wall time between steps. */
  minimumMilliseconds(): number;
  step(elapsed: number): Promise<void>;
  /** Changes whenever a video restart or world operation happened, so its duration does not become simulation time. */
  clockState(): string;
  /** Absent when a faulting step must end the loop. */
  recover?(error: unknown): Promise<void>;
}

export async function runFrameLoop(host: FrameLoopHost): Promise<void> {
  let previous = performance.now();
  while (host.alive()) {
    const now = performance.now(), elapsed = now - previous, minimum = host.minimumMilliseconds();
    if (elapsed < minimum) { await Bun.sleep(Math.max(1, minimum - elapsed)); continue; }
    previous = now;
    const state = host.clockState();
    try { await host.step(elapsed); }
    catch (error) {
      if (host.recover === undefined) throw error;
      await host.recover(error); previous = performance.now();
    }
    if (host.clockState() !== state) previous = performance.now();
    await setImmediate();
  }
}
