import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { NativeRenderer } from "../../src/app/bootstrap/renderer.ts";
import { ApplicationImageSettings } from "../../src/app/bootstrap/image-settings.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { bindNativeVideoSettings } from "../../src/ui/settings/services.ts";

test.skipIf(process.env["SDL_VIDEODRIVER"] !== "dummy")("saved display state clamps old-monitor sizes, honors explicit gamma 1 and restores fullscreen", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-display-preferences-"));
  const identity = createIdentityOwner("display-preferences"), context = { session: identity.session, origin: { kind: "local-console" } } satisfies Parameters<typeof ApplicationImageSettings.open>[0]["context"];
  const errors: string[] = [];
  try {
    await mkdir(join(root, "settings"));
    await writeFile(join(root, "settings/images.cfg"), 'seta r_gamma "2"\nseta r_customwidth "9000"\nseta r_customheight "9000"\n');
    const parsed = parseApplicationCommand(["--gamma", "1", "--width", "1280"]);
    if (parsed.kind !== "menu") throw new Error("Expected startup options");
    const settings = await ApplicationImageSettings.open({ context, dialect: "q3", userContentRoot: root, print: text => errors.push(text),
      ...(parsed.options.displayOverrides === undefined ? {} : { displayOverrides: parsed.options.displayOverrides }) });
    expect(settings.gamma).toBe(1);
    const renderer = NativeRenderer.open({ renderer: "cpu", width: 640, height: 480, hidden: true, gamma: 1 }, { identity: Symbol("display"), session: identity.session, generation: 0 });
    try {
      await settings.refreshDisplay(renderer);
      const desktop = renderer.window.display.bounds;
      expect(desktop.width).toBe(1024);
      expect(renderer.window.logicalSize).toEqual({ width: 1280, height: desktop.height });
      const bindings = bindNativeVideoSettings(renderer.window, settings.cvars, text => errors.push(text));
      const customWidth = bindings.find(binding => binding.id === "ui:video:custom-width"), customHeight = bindings.find(binding => binding.id === "ui:video:custom-height");
      const apply = bindings.find(binding => binding.id === "ui:video:custom-apply");
      if (customWidth?.kind !== "text-entry" || customHeight?.kind !== "text-entry" || apply?.kind !== "button") throw new Error("Missing custom size controls");
      customWidth.write("1300"); customHeight.write("800"); apply.activate();
      await settings.refreshDisplay(renderer); expect(renderer.window.logicalSize).toEqual({ width: 1300, height: 800 });
      settings.cvars.set("r_customheight", "801"); await settings.refreshDisplay(renderer);
      expect(renderer.window.logicalSize).toEqual({ width: 1300, height: 801 });
      const fullscreen = bindings.find(binding => binding.id === "ui:video:fullscreen");
      if (fullscreen?.kind !== "toggle") throw new Error("Missing fullscreen setting");
      fullscreen.write(true); await settings.refreshDisplay(renderer); expect(renderer.window.fullscreen).toBe(true);
      expect(await Bun.file(join(root, "settings/images.cfg")).text()).toContain('r_fullscreen "1"');
    } finally { renderer.close(); await settings.close(); }
    const restored = await ApplicationImageSettings.open({ context, dialect: "q3", userContentRoot: root, print: text => errors.push(text) });
    const next = NativeRenderer.open({ renderer: "cpu", width: 640, height: 480, hidden: true, gamma: 1 }, { identity: Symbol("restored display"), session: identity.session, generation: 1 });
    try {
      await restored.refreshDisplay(next); expect(next.window.fullscreen).toBe(true); expect(next.outputGamma).toBe(1);
      next.window.setFullscreen(false); await restored.refreshDisplay(next);
      expect(next.window.logicalSize).toEqual({ width: next.window.display.bounds.width, height: next.window.display.bounds.height });
      next.window.setSize(700, 500); await restored.refreshDisplay(next); await restored.refreshDisplay(next);
      expect(next.window.logicalSize).toEqual({ width: 700, height: 500 });
      expect(await Bun.file(join(root, "settings/images.cfg")).text()).toContain('r_customwidth "700"');
      expect(errors).toEqual([]);
    } finally { next.close(); await restored.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
