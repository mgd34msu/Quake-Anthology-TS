import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApplicationImageSettings } from "../../src/app/bootstrap/image-settings.ts";
import { ApplicationViewSettings } from "../../src/app/bootstrap/view-settings.ts";
import { ConfigStore } from "../../src/settings/config.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";

test("image candidate preserves live FOV gamma volume and files until retained-owner publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "candidate-images-"));
  const context = { session: createIdentityOwner("candidate-images").session, origin: { kind: "local-console" } } satisfies CommandBuffer["context"];
  const images = await ApplicationImageSettings.open({ context, dialect: "q3", userContentRoot: root, print: () => {}, deferPersistence: true });
  const seen: number[] = [], view = new ApplicationViewSettings(value => { seen.push(value); });
  let release = view.bindCvars(images.cvars);
  const reads = spyOn(ConfigStore.prototype, "loadText"), writes = spyOn(ConfigStore.prototype, "dump");
  try {
    const owner = images.cvars, before = owner.captureWorldTransferState();
    const candidate = images.prepareClientSettings();
    const commands = new CommandBuffer({ dialect: "q3", context, cvars: candidate.settings.cvars });
    commands.executeNow("gamma 0.5"); commands.executeNow("s_volume 0.2"); commands.executeNow("fov 120");
    expect(candidate.settings.gamma).toBe(2); expect(candidate.settings.cvars.variableString("volume")).toBe("0.2");
    expect(owner.captureWorldTransferState()).toEqual(before);
    expect(view.fieldOfView).toBe(90); expect(seen).toEqual([]);
    expect(reads).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
    candidate.validatePublication();
    release(); candidate.publish();
    view.setFieldOfView(Number(owner.variableString("fov"))); release = view.bindCvars(owner);
    expect(images.cvars).toBe(owner); expect(images.gamma).toBe(2);
    expect(owner.variableString("s_volume")).toBe("0.2"); expect(view.fieldOfView).toBe(120); expect(seen).toEqual([120]);
    expect(() => candidate.publish()).toThrow("already published");
    expect(reads).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
    const rejected = images.prepareClientSettings();
    rejected.settings.cvars.set("fov", "15");
    expect(rejected.settings.cvars.variableString("fov")).toBe("120");
    images.cvars.set("volume", "0.4");
    expect(() => rejected.publish()).toThrow("changed during preparation");
    expect(images.cvars.variableString("volume")).toBe("0.4");
  } finally { release(); reads.mockRestore(); writes.mockRestore(); await images.close(); await rm(root, { recursive: true, force: true }); }
});
