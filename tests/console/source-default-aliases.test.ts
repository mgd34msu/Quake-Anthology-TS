import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openArchive } from "../../src/content/archive/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { CommandDialect } from "../../src/contracts/common.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { ApplicationImageSettings } from "../../src/app/bootstrap/image-settings.ts";
import { ApplicationConsoleRouting } from "../../src/app/bootstrap/console.ts";

const corpus = resolve(import.meta.dir, "../../../qfiles");
for (const donor of [{ path: "q1/id1/PAK0.PAK", q1Settings: true }, { path: "q2/baseq2/pak0.pak", q1Settings: false }, { path: "q3a/baseq3/pak0.pk3", q1Settings: false }]) {
  test.skipIf(!existsSync(join(corpus, donor.path)))(`${donor.path} complete retail default.cfg reaches canonical controls in every world dialect`, async () => {
    const archive = await openArchive(join(corpus, donor.path)), root = await mkdtemp(join(tmpdir(), "retail-default-aliases-"));
    try {
      const entry = archive.findEntries("default.cfg")[0]; if (entry === undefined) throw new Error("Missing retail default.cfg");
      const contents = new TextDecoder().decode(await archive.readEntry(entry)); expect(contents.length).toBeGreaterThan(1000);
      for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
        const context = { session: createIdentityOwner(`retail-${donor.path}-${dialect}`).session, origin: { kind: "local-console" } } satisfies import("../../src/contracts/common.ts").CommandContext;
        const image = await ApplicationImageSettings.open({ dialect, context, userContentRoot: join(root, dialect), print: () => {} });
        image.cvars.set("r_gamma", "2"); image.cvars.set("volume", "0.2");
        const route = new ApplicationConsoleRouting({ fallback: image.cvars, sourceDialect: () => dialect, server: () => null, seat: () => null, shared: () => image.cvars });
        const commands = new CommandBuffer({ dialect, context, cvars: image.cvars, cvarRouting: route, readScript: async name => {
          const nested = archive.findEntries(name)[0]; return nested === undefined ? undefined : new TextDecoder().decode(await archive.readEntry(nested));
        } });
        commands.append(contents);
        for (let frame = 0; frame < 20 && commands.hasPendingCommands; frame++) await commands.executeAsync(async () => {});
        expect(commands.hasPendingCommands).toBe(false);
        if (donor.q1Settings) { expect(image.gamma).toBe(1); expect(image.cvars.variableValue("volume")).toBeCloseTo(0.7); }
        commands.append("gamma 0.5\ns_volume 0.25\nogg_volume 0.125\n"); commands.execute();
        expect(image.gamma).toBe(2); expect(image.cvars.variableValue("volume")).toBe(0.25); expect(image.cvars.variableValue("s_musicvolume")).toBe(0.125);
        expect(image.cvars.canonicalSnapshots().some(value => value.name === "gamma" || value.name === "s_volume" || value.name === "ogg_volume")).toBe(false);
      }
    } finally { archive.close(); await rm(root, { recursive: true, force: true }); }
  });
}
