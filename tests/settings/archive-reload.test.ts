// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { CvarFlag, type CvarRegistry } from "../../src/core/cvars/index.ts";

const noPrint = { print: () => undefined };

async function open(root: string, game: string, map: string, extra: readonly string[] = []): Promise<Application> {
  const parsed = parseApplicationCommand(["--game", game, "--map", map, "--dedicated", ...extra]);
  if (parsed.kind !== "run") throw new Error("Expected a launch");
  return Application.open({ ...parsed.options, userContentRoot: root, nativeConfigRoot: join(root, "native") }, noPrint);
}
function cvarsOf(application: Application): CvarRegistry {
  const cvars = application.simulation.q1Source()?.cvars ?? application.simulation.quakecSource()?.cvars ?? application.simulation.q2ServerCvars();
  if (cvars === null || cvars === undefined) throw new Error("Missing source cvars");
  return cvars;
}
function probe(cvars: CvarRegistry, value: string): void {
  cvars.register("qts_archive_probe", "0", CvarFlag.Archive);
  cvars.set("qts_archive_probe", value, true);
}

test("a dedicated server reads the archives it saved and saves them again on exit", async () => {
  const root = await mkdtemp(join(tmpdir(), "archive-dedicated-"));
  try {
    const first = await open(root, "q2-classic-baseq2", "base1");
    probe(cvarsOf(first), "dedicated-7");
    await first.close();
    const second = await open(root, "q2-classic-baseq2", "base1");
    try {
      expect(cvarsOf(second).get("qts_archive_probe")?.value).toBe("dedicated-7");
    } finally {
      await second.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60000);

test("the front end reloads a product's own bindings when the menu product changes", async () => {
  const { StartupApplication } = await import("../../src/app/bootstrap/startup.ts");
  const { testCorpusRoot } = await import("../support/corpus.ts");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "startup-product-bindings-"));
  const native = join(root, "native");
  const markers: readonly (readonly [string, string])[] = [
    ["q1/id1", "echo q1marker"],
    ["q2/baseq2", "echo q2marker"],
  ];
  for (const [directory, marker] of markers) {
    await mkdir(join(native, directory), { recursive: true });
    await writeFile(join(native, directory, "config.cfg"), `bind "F9" "${marker}"\n`);
  }
  const parsed = parseApplicationCommand([
    "--game",
    "q1-classic-id1",
    "--frames",
    "1",
    "--renderer",
    "cpu",
    "--hidden",
    "--width",
    "640",
    "--height",
    "480",
    "--content-root",
    testCorpusRoot(),
    "--user-content-root",
    root,
  ]);
  if (parsed.kind !== "run") throw new Error("Missing startup options");
  let app: Awaited<ReturnType<typeof StartupApplication.open>> | null = null;
  try {
    app = await StartupApplication.open({ ...parsed.options, nativeConfigRoot: native }, { print: () => undefined }, join(root, "saves"));
    const startup = app;
    const bound = (): string => JSON.stringify(startup["graphics"]?.inputProfile.input.bindings ?? []);
    await startup.step();
    expect(bound()).toContain("q1marker");
    startup.model.select("product", "q2-classic-baseq2");
    await startup.step();
    expect(bound()).toContain("q2marker");
    expect(bound()).not.toContain("q1marker");
    startup.model.select("product", "q1-classic-id1");
    await startup.step();
    expect(bound()).toContain("q1marker");
    expect(bound()).not.toContain("q2marker");
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
