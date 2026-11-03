import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { StartupApplication } from "../../src/app/bootstrap/startup.ts";
import { corpusHasFile, testCorpusRoot } from "../support/corpus.ts";

test.skipIf(!corpusHasFile("q2/baseq2/pak0.pak"))("a session fault returns the client to the menu and the program keeps running", async () => {
  const root = await mkdtemp(join(tmpdir(), "startup-session-fault-"));
  const parsed = parseApplicationCommand(["--menu", "--content-root", testCorpusRoot(), "--user-content-root", root, "--renderer", "cpu", "--hidden", "--width", "640", "--height", "480"]);
  if (parsed.kind !== "menu") throw new Error("Expected startup menu");
  const printed: string[] = [];
  let app: StartupApplication | null = null;
  const fault = spyOn(Application.prototype, "step");
  try {
    app = await StartupApplication.open(parsed.options, { print: text => { printed.push(text); return undefined; } }, join(root, "saves"));
    app.model.select("product", "q2-classic-baseq2"); app.model.select("map", "maps/base1.bsp");
    const seat = app.inputSeat;
    if (seat === null) throw new Error("Missing startup input seat");
    for (const [x, y] of [[100, 130], [100, 232], [452, 429]] satisfies readonly (readonly [number, number])[]) {
      app.input({ seat, timeMilliseconds: 0, kind: "mouse-motion", position: { x, y }, delta: { x: 0, y: 0 } });
      app.input({ seat, timeMilliseconds: 0, kind: "mouse-button", button: 1, down: true });
      app.input({ seat, timeMilliseconds: 0, kind: "mouse-button", button: 1, down: false });
    }
    for (let frame = 0; frame < 400 && fault.mock.calls.length === 0; frame++) await app.step();
    expect(fault.mock.calls.length).toBeGreaterThan(0);
    fault.mockImplementationOnce(() => Promise.reject(new Error("injected session fault")));
    await app.step();
    expect(printed.some(text => text.startsWith("Session ended by an error") && text.includes("injected session fault"))).toBe(true);
    fault.mockClear();
    for (let frame = 0; frame < 5; frame++) await app.step();
    expect(fault).not.toHaveBeenCalled();
  } finally { await app?.close(); fault.mockRestore(); await rm(root, { recursive: true, force: true }); }
}, 120000);
