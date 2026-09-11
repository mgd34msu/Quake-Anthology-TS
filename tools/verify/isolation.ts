import { constants } from "node:fs";
import { chmod, copyFile, mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hashFile } from "./hash.ts";

export interface PortLease {
  readonly ports: readonly number[];
  releaseSockets(): Promise<void>;
  dispose(): Promise<void>;
}

export async function leasePorts(count: number, owner: string): Promise<PortLease> {
  const root = join(tmpdir(), `quake-verify-ports-${process.getuid?.() ?? "user"}`);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const servers: ReturnType<typeof createServer>[] = [];
  const ports: number[] = [];
  const locks: string[] = [];
  async function releaseSockets(): Promise<void> {
    await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))));
  }
  async function dispose(): Promise<void> {
    await releaseSockets();
    await Promise.all(locks.splice(0).map(path => rm(path, { force: true })));
  }
  try {
    let collisions = 0;
    while (ports.length < count) {
      const server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
      });
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        throw new Error("Port lease has no TCP address");
      }
      const path = join(root, `${address.port}.json`);
      try {
        const lock = await open(path, "wx", 0o600);
        try { await lock.writeFile(JSON.stringify({ owner, pid: process.pid, port: address.port })); }
        finally { await lock.close(); }
      } catch (error) {
        server.close();
        if (error instanceof Error && "code" in error && error.code === "EEXIST" && collisions++ < 128) continue;
        throw error;
      }
      locks.push(path);
      ports.push(address.port);
      servers.push(server);
    }
    return { ports, releaseSockets, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

export async function copyPinnedFile(source: string, destination: string, sha256: string, executable = false): Promise<void> {
  const canonical = await realpath(source);
  if (canonical !== resolve(source)) throw new Error(`Input symlink is not an owned immutable file: ${source}`);
  await copyFile(source, destination, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
  await chmod(destination, executable ? 0o500 : 0o400);
  if (await hashFile(destination) !== sha256) throw new Error(`Input changed while being copied: ${source}`);
}

export async function startPrivateDisplay(executable: string, outputRoot: string, environment: Readonly<Record<string, string>>): Promise<{ readonly display: string; dispose(): Promise<void> }> {
  const displayPath = join(outputRoot, "display.txt");
  const child = Bun.spawn([executable, "-displayfd", "1", "-screen", "0", "1280x720x24", "-nolisten", "tcp"], {
    env: environment, stdin: "ignore", stdout: Bun.file(displayPath), stderr: Bun.file(join(outputRoot, "display-stderr.txt")), detached: true,
  });
  async function dispose(): Promise<void> {
    try { process.kill(-child.pid, "SIGKILL"); }
    catch { child.kill("SIGKILL"); }
    await child.exited;
  }
  const deadline = performance.now() + 5000;
  try {
    while (performance.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Private display provider exited ${child.exitCode}`);
      const text = await readFile(displayPath, "utf8").catch(() => "");
      if (/^\d+\n$/.test(text)) return { display: `:${text.trim()}`, dispose };
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    }
    throw new Error("Private display provider did not allocate a display within 5000ms");
  } catch (error) { await dispose(); throw error; }
}
