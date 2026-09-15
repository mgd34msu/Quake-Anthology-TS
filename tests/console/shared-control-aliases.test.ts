import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { ApplicationImageSettings } from "../../src/app/bootstrap/image-settings.ts";
import { ApplicationConsoleRouting } from "../../src/app/bootstrap/console.ts";
import { queryConsoleEntries, registerDiscoveryCommands } from "../../src/console/discovery.ts";
import { llmConsoleCatalog, validateLlmBatch } from "../../src/console/llm-batch.ts";
import { SeatConsole } from "../../src/console/session.ts";

for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
  test(`${dialect} native control names share real image and audio settings through discovery and console writes`, async () => {
    const root = await mkdtemp(join(tmpdir(), "shared-control-aliases-")), identity = createIdentityOwner(`shared-control-${dialect}`), seat = identity.seat(0);
    const context = { session: identity.session, origin: { kind: "local-console" } } satisfies import("../../src/contracts/common.ts").CommandContext;
    const output: string[] = [];
    try {
      const image = await ApplicationImageSettings.open({ dialect, context, userContentRoot: root, print: text => { output.push(text); } });
      expect(image.cvars.find("s_volume")?.resetValue).toBe(dialect === "q3" ? "0.8" : "0.7");
      expect(image.cvars.find("s_musicvolume")?.resetValue).toBe(dialect === "q3" ? "0.25" : "1");
      const fallback = new CvarRegistry({ dialect, context }); fallback.register("s_volume", "99");
      const route = new ApplicationConsoleRouting({ fallback, sourceDialect: () => dialect, server: () => null, seat: () => null, shared: () => image.cvars });
      const commands = new CommandBuffer({ dialect, context, cvars: fallback, cvarRouting: route }); registerDiscoveryCommands(commands, text => { output.push(text); });
      commands.append("gamma 0.5\ns_volume 0.25\ns_musicvolume 0.125\nhelp gamma\nhelp s_volume\n"); commands.execute();
      expect(image.gamma).toBe(2); expect(image.cvars.variableValue("volume")).toBe(0.25); expect(image.cvars.variableValue("bgmvolume")).toBe(0.125);
      expect(fallback.variableValue("s_volume")).toBe(99);
      commands.append("vid_gamma 0.8\n"); commands.execute(); expect(image.gamma).toBe(1.25); expect(image.cvars.variableValue("gamma")).toBeCloseTo(0.8);
      commands.append("ogg_volume 0.25\n"); commands.execute(); expect(image.cvars.variableValue("bgmvolume")).toBe(0.25);
      expect(output.join("")).toContain("gamma = 1 / r_gamma"); expect(output.join("")).toContain("Alias of volume");
      image.cvars.set("r_gamma", "1.25"); expect(commands.findCvar("gamma")?.numericValue).toBeCloseTo(0.8);
      commands.append(`${validateLlmBatch("s_volume 0.5", commands, context).join("\n")}\n`); commands.execute();
      expect(image.cvars.variableValue("volume")).toBe(0.5); expect(llmConsoleCatalog(commands, context, "brightness")).toContain("gamma = 1 / r_gamma");
      expect(queryConsoleEntries(commands).filter(entry => entry.name === "s_volume")).toHaveLength(1);
      const console = new SeatConsole({ seat, context, dialect, commands, cvars: fallback, now: () => 0, connected: () => true, clipboard: () => null,
        focus: () => undefined, chat: () => { throw new Error("Setting went to chat"); } });
      console.field.setText("s_musicv"); console.input({ kind: "key", seat, code: 9, down: true, repeat: false, timeMilliseconds: 0 }, { kind: "console" });
      expect(console.field.text).toContain("s_musicvolume");
      const entries = image.cvars.archiveEntries(); expect(entries.some(entry => ["gamma", "vid_gamma", "s_volume", "s_musicvolume", "ogg_volume"].includes(entry.name))).toBe(false);
      expect(entries.filter(entry => entry.name === "r_gamma")).toEqual([{ name: "r_gamma", value: "1.25" }]);
      await image.close();
      const saved = await Bun.file(join(root, "settings/images.cfg")).text(); expect(saved).not.toMatch(/(?:^|\n)(?:seta? )?gamma /); expect(saved).not.toContain("s_volume");
      const reopened = await ApplicationImageSettings.open({ dialect, context, userContentRoot: root, print: () => {} }); expect(reopened.gamma).toBe(1.25);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
