// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../src/app/bootstrap/application.ts";
import { ConsoleLog, consoleLogMode } from "../../src/app/bootstrap/console-log.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { RemoteApplication } from "../../src/app/bootstrap/remote-application.ts";
import type { CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { corpusTest } from "../support/corpus.ts";

const registry = (dialect: CommandDialect): CvarRegistry =>
  new CvarRegistry({ dialect, context: { session: createIdentityOwner("console-log").session, origin: { kind: "local-console" } } });

test("the -condebug flag is a launch flag", () => {
  const command = parseApplicationCommand(["--game", "q1-classic-id1", "-condebug"]);
  expect(command.kind).toBe("run");
  if (command.kind === "run") expect(command.options.consoleDebug).toBe(true);
});

test("each game supplies its own trigger: logfile for Quake II and III, -condebug for Quake", () => {
  const q1 = registry("q1-netquake"),
    q2 = registry("q2-classic");
  expect(consoleLogMode(q1, false)).toBe(0);
  expect(consoleLogMode(q1, true)).toBe(2);
  expect(consoleLogMode(null, true)).toBe(2);
  q2.register("logfile", "0", 0);
  expect(consoleLogMode(q2, true)).toBe(0);
  q2.set("logfile", "2", true);
  expect(consoleLogMode(q2, false)).toBe(2);
});

test("the shared console log appends, follows its mode and stops when the trigger turns off", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-console-log-"));
  try {
    let mode = 0;
    const log = new ConsoleLog(
      () => mode,
      () => root,
    );
    log.write("ignored\n");
    expect(await Bun.file(join(root, "qconsole.log")).exists()).toBe(false);
    mode = 1;
    log.write("one\n");
    mode = 2;
    log.write("two\n");
    expect(await readFile(join(root, "qconsole.log"), "latin1")).toBe("one\ntwo\n");
    mode = 0;
    log.write("dropped\n");
    mode = 1;
    log.write("three\n");
    log.close();
    expect(await readFile(join(root, "qconsole.log"), "latin1")).toBe("one\ntwo\nthree\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const games: readonly (readonly [label: string, arguments_: readonly string[], folder: string, probe: string])[] = [
  ["Quake with -condebug", ["--game", "q1-classic-id1", "--map", "start", "-condebug"], "q1/id1", "q1/id1/pak0.pak"],
  [
    "Quake II with logfile",
    ["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q2", "--character", "q2", "+set", "logfile", "1"],
    "q2/baseq2",
    "q2/baseq2/pak0.pak",
  ],
  [
    "Quake III with logfile",
    ["--game", "q3-baseq3", "--map", "q3dm1", "--movement", "q3", "--character", "q3", "--mode", "deathmatch", "+set", "logfile", "2"],
    "q3a/baseq3",
    "q3a/baseq3/pak0.pk3",
  ],
];
for (const [label, extra, folder, probe] of games)
  corpusTest(probe)(
    `a dedicated ${label} appends its console to qconsole.log in the game folder`,
    async () => {
      const root = await mkdtemp(join(tmpdir(), "quake-console-log-app-"));
      const parsed = parseApplicationCommand([...extra, "--dedicated", "--user-content-root", root]);
      if (parsed.kind !== "run") throw new Error("Missing launch options");
      const writes = join(root, "game-writes");
      const app = await Application.open(
        { ...parsed.options, nativeConfigRoot: writes },
        {
          saveDirectory: join(root, "saves"),
          print: () => undefined,
        },
      );
      try {
        app.queueCommand("echo", ["console-log-probe"], null, { session: app.session.session, origin: { kind: "local-console" } });
        await app.step(100);
      } finally {
        await app.close();
      }
      try {
        const log = await readFile(join(writes, folder, "qconsole.log"), "latin1");
        expect(log).toContain("Command requires a player");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    120_000,
  );

corpusTest("q3a/baseq3/pak0.pk3")(
  "a client connected to a remote server logs its console to qconsole.log in the game folder, as the original does",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "quake-console-log-remote-"));
    const common = ["--game", "q3-baseq3", "--map", "q3dm1", "--movement", "q3", "--character", "q3", "--mode", "deathmatch"];
    const hosted = parseApplicationCommand([...common, "--dedicated", "--listen", "0", "--bind", "127.0.0.1", "--user-content-root", join(root, "server")]);
    if (hosted.kind !== "run") throw new Error("Missing server options");
    const server = await Application.open({ ...hosted.options, nativeConfigRoot: join(root, "server-writes") }, { print: () => undefined });
    let client: RemoteApplication | null = null;
    const writes = join(root, "client-writes");
    try {
      const address = server.networkAddress;
      if (address === null) throw new Error("Missing UDP listener");
      const joined = parseApplicationCommand([
        ...common,
        "--connect-q3",
        `127.0.0.1:${address.port}`,
        "--renderer",
        "cpu",
        "--width",
        "320",
        "--height",
        "240",
        "--hidden",
        "+set",
        "logfile",
        "1",
        "--user-content-root",
        join(root, "client"),
      ]);
      if (joined.kind !== "run") throw new Error("Missing client options");
      client = await RemoteApplication.open({ ...joined.options, nativeConfigRoot: writes }, { print: () => undefined });
      let previous = performance.now();
      for (let tick = 0; tick < 100 && client.networkPhase !== "active"; tick++) {
        await Bun.sleep(20);
        const now = performance.now();
        await server.step(now - previous);
        await client.step(now - previous);
        previous = now;
      }
      expect(client.networkPhase).toBe("active");
    } finally {
      await client?.close();
      await server.close();
    }
    try {
      const log = await readFile(join(writes, "q3a/baseq3/qconsole.log"), "latin1");
      expect(log.length).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  120_000,
);
