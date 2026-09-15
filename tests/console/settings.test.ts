import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { ApplicationImageSettings } from "../../src/app/bootstrap/image-settings.ts";
import { bindConsoleSettings } from "../../src/ui/settings/console.ts";

test("console size choices persist in the shared local archive", async () => {
  const userContentRoot = await mkdtemp(join(tmpdir(), "console-scale-"));
  const identity = createIdentityOwner("console-settings");
  const options = { userContentRoot, dialect: "q3", context: { session: identity.session, origin: { kind: "local-console" } },
    print: () => undefined } satisfies Parameters<typeof ApplicationImageSettings.open>[0];
  try {
    const settings = await ApplicationImageSettings.open(options);
    const binding = bindConsoleSettings(settings.cvars)[0];
    if (binding?.kind !== "choice") throw new Error("Missing console size choice");
    expect(binding.read()).toBe("0");
    binding.write("3");
    await settings.close();
    const restored = await ApplicationImageSettings.open(options);
    expect(restored.cvars.variableValue("con_scale")).toBe(3);
    await restored.close();
  } finally { await rm(userContentRoot, { recursive: true, force: true }); }
});
