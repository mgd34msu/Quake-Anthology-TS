import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface Event {
  readonly elapsedMs: number;
  readonly kind: "stdin" | "checkpoint";
  readonly text: string;
}

export function startObserved(command: readonly string[], cwd: string, environment: Record<string, string>, timeoutMs = 60_000) {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const child = Bun.spawn([...command], { cwd, env: environment, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  let stdout = "";
  let stderr = "";
  const events: Event[] = [];
  async function consume(stream: ReadableStream<Uint8Array>, kind: "stdout" | "stderr"): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        const text = decoder.decode(item.value, { stream: true });
        if (kind === "stdout") stdout += text;
        else stderr += text;
      }
      const tail = decoder.decode();
      if (kind === "stdout") stdout += tail;
      else stderr += tail;
    } finally { reader.releaseLock(); }
  }
  const stdoutDone = consume(child.stdout, "stdout");
  const stderrDone = consume(child.stderr, "stderr");
  let stopped = false;
  let timeout = false;
  const watchdog = setTimeout(() => { timeout = true; child.kill("SIGKILL"); }, timeoutMs);
  return {
    pid: child.pid,
    output: (): string => stdout + stderr,
    async waitForExit(): Promise<number> { return child.exited; },
    async send(text: string): Promise<void> {
      if (child.exitCode !== null) throw new Error(`Process exited before command: ${text}`);
      events.push({ elapsedMs: performance.now() - start, kind: "stdin", text });
      child.stdin.write(text + "\n");
      await child.stdin.flush();
    },
    async waitFor(text: string, timeoutMs = 15_000): Promise<void> {
      const deadline = performance.now() + timeoutMs;
      while (!stdout.includes(text) && !stderr.includes(text)) {
        if (child.exitCode !== null) throw new Error(`Process exited before ${text}: ${stdout}${stderr}`);
        if (performance.now() > deadline) throw new Error(`Missing checkpoint ${text}: ${stdout.slice(-2500)}${stderr.slice(-1000)}`);
        await Bun.sleep(25);
      }
      events.push({ elapsedMs: performance.now() - start, kind: "checkpoint", text });
    },
    async finish(directory: string) {
      if (!stopped) {
        stopped = true;
        if (child.exitCode === null) child.kill("SIGTERM");
      }
      const force = setTimeout(() => child.kill("SIGKILL"), 2000);
      const exitCode = await child.exited;
      clearTimeout(force);
      clearTimeout(watchdog);
      await Promise.all([stdoutDone, stderrDone]);
      await mkdir(directory, { recursive: true });
      await Bun.write(join(directory, "stdout.txt"), stdout);
      await Bun.write(join(directory, "stderr.txt"), stderr);
      return { command, cwd, environment, pid: child.pid, startedAt, durationMs: performance.now() - start,
        exitCode, timeout, events, stdout, stderr, cleanup: "reaped" };
    },
  };
}

export type ObservedProcess = ReturnType<typeof startObserved>;
