import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { StartupApplication } from "../../../src/app/bootstrap/startup.ts";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";

for (const product of ["q2-rerelease-baseq2", "q2-classic-baseq2"]) test(`${product} menu Play samples fractional elapsed into the selected Q3 presentation clock`, async () => {
  const root = await mkdtemp("/tmp/quake-q3-clock-"), prints: string[] = [];
  const samples: { elapsed: number; clock: number | null; viewClock: number | null; lastFire: number | null }[] = [];
  let attempts = 0, runs = 0;
  const step = Application.prototype.step, run = Application.prototype.run;
  let startup: StartupApplication | null = null;
  try {
    const command = parseApplicationCommand(["--menu", "--renderer", "gl", "--hidden", "--width", "640", "--height", "480",
      "--frames", "10", "--user-content-root", root]);
    if (command.kind !== "menu") throw new Error("Expected startup menu");
    startup = await StartupApplication.open(command.options, { print: value => { prints.push(value); } }, root + "/saves");
    Application.prototype.run = async function () {
      runs++;
      return run.call(this);
    };
    Application.prototype.step = async function (elapsed) {
      if (attempts === 0) {
        const local = this.localPlayers[0];
        if (local === undefined) throw new Error("Missing gameplay player");
        this.input({ seat: local.seat.id, timeMilliseconds: performance.now(), kind: "mouse-button", button: 1, down: true });
      }
      attempts++;
      const output = await step.call(this, elapsed);
      const view = this.simulation.presentations().find(value => value.q3Weapon !== undefined)?.q3Weapon;
      samples.push({ elapsed, clock: this.simulation.weaponPresentationClock()?.timeMilliseconds ?? null,
        viewClock: view?.timeMilliseconds ?? null, lastFire: view?.lastFireMilliseconds ?? null });
      return output;
    };
    const menu = startup.model;
    menu.select("product", product); menu.select("map", "maps/base1.bsp"); menu.select("movement", "q1-quakeworld");
    menu.select("character", "q1-rerelease-id1"); menu.select("model", "player"); menu.select("weapons", "q3-baseq3");
    menu.select("enemies", product === "q2-rerelease-baseq2" ? "q1:monsters/rerelease/id1" : "q1:monsters/classic/id1");
    menu.select("grapple", "q2-classic-lmctf/offhand"); menu.select("grenades", "q2-classic-baseq2");
    const seat = startup.inputSeat;
    if (seat === null) throw new Error("Missing startup input seat");
    for (const y of [130, 334]) {
      startup.input({ seat, timeMilliseconds: 0, kind: "mouse-motion", position: { x: 100, y }, delta: { x: 0, y: 0 } });
      startup.input({ seat, timeMilliseconds: 0, kind: "mouse-button", button: 1, down: true });
      startup.input({ seat, timeMilliseconds: 0, kind: "mouse-button", button: 1, down: false });
    }
    await startup.run();
    expect(prints.some(value => value.includes("clock") || value.includes("already defined"))).toBe(false);
    expect(runs).toBe(0); expect(attempts).toBe(10); expect(samples).toHaveLength(10);
    expect(samples.some(sample => !Number.isInteger(sample.elapsed))).toBe(true);
    expect(samples.some(sample => sample.lastFire !== null)).toBe(true);
    let accumulated = 0;
    for (const sample of samples) {
      accumulated += sample.elapsed;
      expect(sample.clock).toBe(Math.trunc(accumulated)); expect(sample.viewClock).toBe(sample.clock);
    }
    expect(samples.at(-1)?.clock).toBeGreaterThan(samples[0]?.clock ?? 0);
  } finally {
    Application.prototype.step = step; Application.prototype.run = run;
    try { await startup?.close(); } finally { await rm(root, { recursive: true, force: true }); }
  }
}, 120000);
