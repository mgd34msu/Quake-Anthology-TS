import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";

test("the application run loop services timers when every frame exceeds its minimum duration", async () => {
  const directory = await mkdtemp("/tmp/quake-run-yield-");
  const parsed = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "e1m1", "--movement", "q1", "--character", "q1",
    "--dedicated", "--frames", "12", "--user-content-root", directory]);
  if (parsed.kind !== "run") throw new Error("Expected dedicated run options");
  const application = await Application.open(parsed.options, { print: () => undefined, saveDirectory: directory + "/saves" });
  let timer: ReturnType<typeof setTimeout> | undefined, fired = false;
  const step = application.step.bind(application);
  application.step = async elapsed => {
    const output = await step(elapsed);
    if (timer === undefined) timer = setTimeout(() => { fired = true; application.requestQuit(); }, 25);
    const end = performance.now() + 8;
    while (performance.now() < end) {}
    return output;
  };
  try {
    await application.run();
    expect(fired).toBe(true);
    expect(application.frameCount).toBeLessThan(12);
  } finally { clearTimeout(timer); await application.close(); await rm(directory, { recursive: true, force: true }); }
}, 20000);
