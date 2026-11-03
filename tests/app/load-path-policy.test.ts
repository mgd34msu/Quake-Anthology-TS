import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import type { CommandContext } from "../../src/contracts/common.ts";
import { assertLoadPathAllowed } from "../../src/persistence/save-policy.ts";
import { corpusTest, testCorpusRoot } from "../support/corpus.ts";

// DOCS2-003: `load` of a file outside the save directory is accepted from the local console (id's
// engines accept no such path at all) and refused from scripts, game modules and remote clients
// unless --allow-load-paths is given.

test("assertLoadPathAllowed accepts inside paths, local origins and the option, and refuses delegated sources", () => {
  const directory = "/saves", outside = "/elsewhere/original.sav", inside = "/saves/a/b.sav";
  const open = { allowAnyPath: false, trustedDirectories: ["/addons/saves"] } as const;
  const context = (origin: CommandContext["origin"], producer?: CommandContext["producer"]): CommandContext =>
    ({ session: undefined as never, origin, ...(producer === undefined ? {} : { producer }) });
  expect(() => assertLoadPathAllowed(directory, outside, undefined, open)).not.toThrow();
  expect(() => assertLoadPathAllowed(directory, outside, context({ kind: "local-console" }), open)).not.toThrow();
  expect(() => assertLoadPathAllowed(directory, outside, context({ kind: "server-console" }), open)).not.toThrow();
  expect(() => assertLoadPathAllowed(directory, inside, context({ kind: "script", name: "autoexec.cfg", caller: { kind: "local-console" } }), open)).not.toThrow();
  expect(() => assertLoadPathAllowed(directory, "/addons/saves/x.sav", context({ kind: "script", name: "a.cfg", caller: { kind: "local-console" } }), open)).not.toThrow();
  const script = context({ kind: "script", name: "autoexec.cfg", caller: { kind: "local-console" } });
  expect(() => assertLoadPathAllowed(directory, outside, script, open)).toThrow("only accepted from the local console");
  expect(() => assertLoadPathAllowed(directory, "/saves/../elsewhere/x.sav", script, open)).toThrow("--allow-load-paths");
  expect(() => assertLoadPathAllowed(directory, outside, script, { ...open, allowAnyPath: true })).not.toThrow();
});

async function launch(extra: readonly string[]): Promise<{ app: Application; printed: string[]; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "quake-load-policy-"));
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q1-classic-id1", "--map", "start", "--renderer", "cpu", "--hidden",
    "--width", "320", "--height", "240", "--user-content-root", root, ...extra]);
  if (parsed.kind !== "run") throw new Error("Missing launch options");
  const printed: string[] = [];
  const app = await Application.open(parsed.options, { saveDirectory: join(root, "saves"), print: text => { printed.push(text); } });
  return { app, printed, root };
}

for (const [label, extra, delegatedAllowed] of [["by default", [], false], ["with --allow-load-paths", ["--allow-load-paths"], true]] as const) {
  corpusTest("q1/id1/pak0.pak")(`the load command ${label} ${delegatedAllowed ? "lets" : "refuses"} a script and a remote client reach a file outside the save directory`, async () => {
    const { app, printed, root } = await launch(extra);
    try {
      const outside = join(root, "elsewhere", "original.sav");
      const base = { session: app.session.session };
      const sources: readonly CommandContext[] = [
        { ...base, origin: { kind: "script", name: "autoexec.cfg", caller: { kind: "local-console" } } },
        { ...base, origin: { kind: "remote-client", client: app.session.createClient(1).id } },
      ];
      for (const source of sources) {
        printed.length = 0;
        app.queueCommand("load", [outside], null, source);
        await app.step(100);
        expect(printed.join("").includes("only accepted from the local console")).toBe(!delegatedAllowed);
      }
      printed.length = 0;
      app.queueCommand("load", [outside], null, { ...base, origin: { kind: "local-console" } });
      await app.step(100);
      expect(printed.join("").includes("only accepted from the local console")).toBe(false);
    } finally { try { await app.close(); } finally { await rm(root, { recursive: true, force: true }); } }
  }, 120_000);
}
