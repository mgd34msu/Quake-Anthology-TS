import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cameraTool } from "../../tools/source-camera.ts";
import { parseCamera } from "../../src/camera/spline.ts";
import { registerRuntimeDiagnostics } from "../../src/app/bootstrap/diagnostic-tools.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { createMountIdentity } from "../../src/contracts/content.ts";
import { openMountPlan } from "../../src/content/mounts/index.ts";
test("authoring tool exports reproducible source camera and sampled output", async () => {
  const root = await mkdtemp(join(tmpdir(), "source-camera-"));
  try {
    const source = join(import.meta.dir, "fixtures/inspection.camera"), output = join(root, "normalized.camera");
    await cameraTool(["normalize", source, output]);
    expect(parseCamera(await Bun.file(output).text())).toEqual(parseCamera(await Bun.file(source).text()));
    await cameraTool(["sample", output, join(root, "first.json"), "100"]);
    await cameraTool(["sample", output, join(root, "second.json"), "100"]);
    const first = await Bun.file(join(root, "first.json")).text();
    expect(first).toBe(await Bun.file(join(root, "second.json")).text());
    expect(first).toContain('"milliseconds": 100'); expect(first).toContain('"fov": 60');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("diagnostic commands read live mount data, actual memory and current frame state", async () => {
  const root = await mkdtemp(join(tmpdir(), "diagnostic-mount-"));
  try {
    await Bun.write(join(root, "proof.txt"), "proof");
    const identity = createMountIdentity("mount:diagnostic:fixture", "q3:classic:baseq3:installed", 0);
    using mounts = await openMountPlan({ id: "mount-plan:diagnostic:fixture", mounts: [{ kind: "loose", identity, rootPath: root }], defaultOrder: [identity.id], prefixOrders: [] });
    const owner = createIdentityOwner("diagnostics"), output: string[] = [], pending: Promise<void>[] = [];
    const commands = new CommandBuffer({ dialect: "q3", context: { session: owner.session, origin: { kind: "server-console" } } });
    const unregister = registerRuntimeDiagnostics({ commands, mounts: () => mounts, frame: () => ({ frame: 12, milliseconds: 120, map: "fixture", renderer: "cpu", clients: 1 }), print: text => output.push(text), queue: operation => { pending.push(operation); } });
    commands.append("path;dir . txt;touchFile proof.txt;resourceinfo;frameinfo;meminfo\n"); await commands.executeAsync(async () => { await Promise.all(pending.splice(0)); });
    expect(output.join("")).toContain(root); expect(output.join("")).toContain("proof.txt");
    expect(output.join("")).toContain('"frame": 12'); expect(output.join("")).toMatch(/rss=\d+/);
    unregister(); expect(commands.exists("frameinfo")).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
