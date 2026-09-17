import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { ApplicationImageSettings } from "../../src/app/bootstrap/image-settings.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { bindRendererSettings } from "../../src/ui/settings/services.ts";

test("render-worker CLI distinguishes no override from explicit off and preserves renderer", () => {
  for (const renderer of ["cpu", "gl"] satisfies readonly ("cpu" | "gl")[]) {
    for (const value of ["0", "1"]) {
      const parsed = parseApplicationCommand(["--renderer", renderer, "--render-worker", value]);
      if (parsed.kind !== "menu") throw new Error("Expected menu options");
      expect(parsed.options.renderWorker).toBe(value === "1"); expect(parsed.options.renderer).toBe(renderer);
    }
  }
  const defaults = parseApplicationCommand([]);
  if (defaults.kind !== "menu") throw new Error("Expected menu defaults");
  expect(defaults.options.renderWorker).toBeUndefined();
  expect(() => parseApplicationCommand(["--render-worker", "2"])).toThrow("0 or 1");
});

test("r_smp defaults to off, restores archived choice and honors explicit off", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-worker-settings-"));
  const identity = createIdentityOwner("render worker settings");
  const context = { session: identity.session, origin: { kind: "local-console" } } satisfies Parameters<typeof ApplicationImageSettings.open>[0]["context"];
  const options = { context, dialect: "q3", userContentRoot: root, print() {} } satisfies Parameters<typeof ApplicationImageSettings.open>[0];
  try {
    const initial = await ApplicationImageSettings.open(options);
    expect(initial.cvars.variableValue("r_smp")).toBe(0);
    await mkdir(join(root, "settings"), { recursive: true });
    await writeFile(join(root, "settings/images.cfg"), 'seta r_smp "1"\n');
    const restored = await ApplicationImageSettings.open(options);
    expect(restored.cvars.variableValue("r_smp")).toBe(1);
    restored.cvars.set("r_smp", "2"); expect(restored.cvars.variableValue("r_smp")).toBe(1);
    const override = await ApplicationImageSettings.open({ ...options, renderWorker: false });
    expect(override.cvars.variableValue("r_smp")).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("render worker menu queues current backend independently of renderer draft", () => {
  let worker = false;
  const queued: string[] = [];
  const controls = bindRendererSettings({ current: () => "cpu", apply: backend => { queued.push(backend); }, report() {},
    worker: { read: () => worker, write: value => { worker = value; } } });
  const choice = controls.find(control => control.id === "ui:video:renderer"), toggle = controls.find(control => control.id === "ui:video:render-worker");
  if (choice?.kind !== "choice" || toggle?.kind !== "toggle") throw new Error("Missing renderer controls");
  choice.write("gl"); toggle.write(true);
  expect(worker).toBe(true); expect(queued).toEqual(["cpu"]); expect(choice.read()).toBe("gl");
});
