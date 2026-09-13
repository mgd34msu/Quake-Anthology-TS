import { expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StartupApplication } from "../../src/app/bootstrap/startup.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { SceneImageRegistry } from "../../src/render/scene/resources.ts";
import { encodePng } from "../../src/formats/images/png.ts";

for (const backend of ["cpu", "gl"]) test(`actual startup ${backend} fonts honor saved image replacement settings`, async () => {
  const root = await mkdtemp(join(tmpdir(), "startup-images-"));
  try {
    await mkdir(join(root, "q2/baseq2/pics"), { recursive: true }); await mkdir(join(root, "settings"));
    await writeFile(join(root, "q2/baseq2/pics/conchars.png"), encodePng(256, 256, new Uint8Array(256 * 256 * 4).fill(255)));
    const parsed = parseApplicationCommand(["--content-root", join(import.meta.dir, "../../../qfiles"), "--user-content-root", root,
      "--game", "q2-classic-baseq2", "--renderer", backend, "--hidden", "--width", "320", "--height", "240"]);
    if (parsed.kind !== "run") throw new Error("Expected startup options");
    for (const level of [0, 1]) {
      await writeFile(join(root, "settings/images.cfg"), `seta r_override_textures "${level}"\nseta r_texture_formats "png"\n`);
      const paths: string[] = [], register = SceneImageRegistry.prototype.register;
      const observed = spyOn(SceneImageRegistry.prototype, "register").mockImplementation(function(this: SceneImageRegistry, ...args) {
        const image = register.call(this, ...args);
        if (image.source.kind === "resource") paths.push(image.source.resource.provenance.memberPath);
        return image;
      });
      let app: StartupApplication | null = null;
      try {
        app = await StartupApplication.open(parsed.options, { print: () => undefined }, join(root, "saves"));
        const capture = app.captureNextFrame(); await app.step(); const pixels = await capture;
        expect(paths).toContain(`pics/conchars.${level === 0 ? "pcx" : "png"}`);
        expect(paths).not.toContain(`pics/conchars.${level === 0 ? "png" : "pcx"}`);
        expect(pixels.some((value, index) => index % 4 !== 3 && value > 0)).toBe(true);
      } finally { await app?.close(); observed.mockRestore(); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
