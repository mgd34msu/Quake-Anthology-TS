import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { ApplicationImageSettings } from "../../src/app/bootstrap/image-settings.ts";

test("image startup replays only persisted writes including explicit declaration defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "startup-image-provenance-"));
  try {
    await mkdir(join(root, "settings"));
    await writeFile(join(root, "settings/images.cfg"), 'seta r_gamma "1"\n');
    const id = createIdentityOwner("image-provenance");
    const images = await ApplicationImageSettings.open({ userContentRoot: root, dialect: "q2-classic", deferPersistence: true,
      context: { session: id.session, origin: { kind: "server-console" } }, print: () => {} });
    expect(images.persistedEntries).toEqual([{ name: "r_gamma", value: "1" }]);
    expect(images.cvars.find("fov")?.value).toBe("90");
  } finally { await rm(root, { recursive: true, force: true }); }
});
