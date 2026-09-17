import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorAas } from "../../../tools/navigation/aas.ts";
import { parseAas } from "../../../src/bots/navigation/aas.ts";
import { aasEstimateFixture } from "./estimate-fixture.ts";

test("AAS CLI writes reproducible clustered output and preserves exclusive output/input ownership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aas-authoring-"));
  try {
    const input = join(directory, "input.aas"), output = join(directory, "output.aas"), repeat = join(directory, "repeat.aas");
    const original = aasEstimateFixture([{}, {}], [{ from: 1, to: 2 }, { from: 2, to: 1 }]);
    await writeFile(input, original);
    await authorAas([input, output, "--cluster", "--optimize"]);
    await authorAas([input, repeat, "--cluster", "--optimize"]);
    expect(await readFile(output)).toEqual(await readFile(repeat));
    expect([...await readFile(input)]).toEqual([...original]);
    expect(parseAas(new Uint8Array(await readFile(output))).clusters[1]?.reachabilityAreaCount).toBe(2);
    await expect(authorAas([input, output])).rejects.toThrow("EEXIST");
    await expect(authorAas([input, input])).rejects.toThrow("distinct output");
    await expect(authorAas([input, repeat, "--reachability", "--map", "q3dm1"])).rejects.toThrow("Usage:");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
