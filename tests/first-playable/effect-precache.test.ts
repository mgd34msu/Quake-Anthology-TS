import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { WorldSnapshot } from "../../src/contracts/session.ts";
import { SceneImageRegistry } from "../../src/render/scene/resources.ts";
import { SceneTextureLoader } from "../../src/render/scene/textures.ts";
import { encodePng } from "../../src/formats/images/png.ts";
import { ApplicationAssets } from "../../src/app/bootstrap/assets.ts";
import { ApplicationEffects } from "../../src/app/bootstrap/effects.ts";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { anglesToAxis, identityMat4 } from "../../src/core/math.ts";
import { createSceneQueries } from "../../src/world/collision/index.ts";

test("texture rejection retries while absent null remains cached", async () => {
  const identity = createIdentityOwner("texture-retry");
  const images = new SceneImageRegistry({ identity: Symbol("texture-retry"), session: identity.session, generation: 0 });
  let fail = true, reads = 0;
  const bytes = encodePng(1, 1, new Uint8Array([255, 100, 50, 255]));
  const textures = new SceneTextureLoader(images, {
    read: async path => {
      reads++;
      if (fail) { fail = false; throw Error("temporary read"); }
      return path === "skin.png" ? { bytes, source: { kind: "generated", name: path } } : null;
    },
  });
  try {
    await expect(textures.load("skin.png")).rejects.toThrow("temporary read");
    expect((await textures.load("skin.png"))?.image.width).toBe(1);
    await expect(textures.load("missing.png")).resolves.toBeNull();
    const before = reads;
    await expect(textures.load("missing.png")).resolves.toBeNull();
    expect(reads).toBe(before);
  } finally { textures.close(); images.close(); }
});

for (const mode of ["provider", "model", "texture"] satisfies readonly string[]) {
  test(`optional ${mode} failure permits later real explosion`, async () => {
    const temporary = await mkdtemp("/tmp/quake-effect-precache-");
    try {
      const command = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q2",
        "--character", "q2", "--dedicated", "--user-content-root", temporary]);
      if (command.kind !== "run") throw Error("Expected game");
      const content = await loadApplicationContent(command.options), identity = createIdentityOwner(`effect-${mode}-retry`);
      const assets = new ApplicationAssets(content, { identity: Symbol(mode), session: identity.session, generation: 0 });
      try {
        if (mode === "provider") {
          const failure = spyOn(content, "forContent").mockImplementation(async () => { throw Error("temporary provider mounts"); });
          try { await expect(assets.provider(content.recipe.map.entities.content)).rejects.toThrow("temporary provider mounts"); }
          finally { failure.mockRestore(); }
        }
        await assets.loadWorld();
        const source = content.recipe.map.entities.content, provider = await assets.provider(source);
        const effects = new ApplicationEffects(assets, createSceneQueries(content.world), () => false);
        try {
          let failed = false;
          const open = provider.mounts.open.bind(provider.mounts), read = provider.textures.reader.read.bind(provider.textures.reader);
          const openSpy = spyOn(provider.mounts, "open").mockImplementation(async (...args) => {
            if (mode === "model" && !failed && args[0] === "models/objects/r_explode/tris.md2") {
              failed = true; throw Error("temporary model read");
            }
            return open(...args);
          });
          const readSpy = spyOn(provider.textures.reader, "read").mockImplementation(async (...args) => {
            if (mode === "texture" && !failed && args[0] === "models/objects/r_explode/skin1.pcx") {
              failed = true; throw Error("temporary skin read");
            }
            return read(...args);
          });
          try {
            const failures = await effects.preloadTransientResources();
            if (mode === "provider") expect(failures).toHaveLength(0);
            else {
              expect(failed).toBe(true);
              expect(failures.some(failure => failure.path === "models/objects/r_explode/tris.md2")).toBe(true);
            }
          } finally { openSpy.mockRestore(); readSpy.mockRestore(); }
          const snapshot: WorldSnapshot = {
            session: identity.session,
            frame: { frame: 10, time: { kind: "seconds", value: 1 }, elapsed: { kind: "seconds", value: 0.1 }, phase: "frame-exit" },
            actors: [], bodies: [], inventories: [], configurations: [],
            scene: { session: identity.session, time: { kind: "seconds", value: 1 }, world: null, entities: [],
              lights: [], particles: [], lightStyles: [], areaBits: null },
          };
          effects.receive([{ kind: "q2", content: source, seconds: 1, sequence: 1,
            event: { kind: "effect", effect: "rocket-explosion", origin: { x: 80, y: 20, z: 0 },
              direction: { x: -1, y: 0, z: 0 }, count: 0, color: 0 } }]);
          await effects.prepare(snapshot, []);
          expect(effects.drainUnhandled()).toHaveLength(0);
          const output = effects.frame({ origin: { x: 0, y: 0, z: 0 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }),
            projection: identityMat4(), viewport: { x: 0, y: 0, width: 640, height: 480 }, clip: { kind: "none" } });
          expect(output.lights.some(light => light.radius > 0)).toBe(true);
        } finally { effects.close(); }
      } finally { assets.close(); await content.close(); }
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }, 60000);
}

test("late provider failure releases only its new texture loader before retry", async () => {
  const temporary = await mkdtemp("/tmp/quake-effect-provider-cleanup-");
  try {
    const scripts = join(temporary, "q2", "baseq2", "scripts");
    await mkdir(scripts, { recursive: true });
    await writeFile(join(scripts, "provider-retry.shader"), "textures/provider-retry { { map $whiteimage } }");
    const command = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--dedicated",
      "--user-content-root", temporary]);
    if (command.kind !== "run") throw Error("Expected game");
    const content = await loadApplicationContent(command.options), identity = createIdentityOwner("late-provider-retry");
    const assets = new ApplicationAssets(content, { identity: Symbol("late-provider-retry"), session: identity.session, generation: 0 });
    const closed: SceneTextureLoader[] = [], close = SceneTextureLoader.prototype.close;
    const closeSpy = spyOn(SceneTextureLoader.prototype, "close").mockImplementation(function (this: SceneTextureLoader, ...args) {
      closed.push(this); return close.apply(this, args);
    });
    try {
      const source = content.recipe.map.entities.content, mounts = await content.forContent(source);
      const open = mounts.open.bind(mounts);
      const failure = spyOn(mounts, "open").mockImplementation(async (...args) => {
        if (args[0] === "scripts/provider-retry.shader") throw Error("late shader read");
        return open(...args);
      });
      try { await expect(assets.provider(source)).rejects.toThrow("late shader read"); }
      finally { failure.mockRestore(); }
      expect(closed).toHaveLength(1);
      const failed = closed[0];
      if (failed === undefined) throw Error("Failed loader was not closed");
      const operations = assets.images.drainOperations();
      const created = operations.flatMap(operation => operation.kind === "create-image" ? [operation.image] : []);
      expect(created).toHaveLength(2);
      expect(operations.filter(operation => operation.kind === "release-image")).toHaveLength(2);
      expect(created.every(image => !assets.images.isResident(image))).toBe(true);
      const provider = await assets.provider(source);
      expect(assets.images.isResident(provider.textures.white.image)).toBe(true);
      expect(assets.images.isResident(provider.textures.missing.image)).toBe(true);
      assets.close();
      expect(closed.filter(loader => loader === failed)).toHaveLength(1);
      expect(closed.filter(loader => loader === provider.textures)).toHaveLength(1);
    } finally { assets.close(); closeSpy.mockRestore(); await content.close(); }
  } finally { await rm(temporary, { recursive: true, force: true }); }
}, 60000);
