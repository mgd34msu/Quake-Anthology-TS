import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SoundBank } from "../../src/audio/bank.ts";
import { ApplicationAudio } from "../../src/app/bootstrap/audio.ts";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { applicationResourceRequests } from "../../src/app/bootstrap/precache.ts";
import { createSimulation } from "../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { monsterSources } from "../../src/content/monsters/definitions.ts";

test("native source precaches feed the shared list and actual decoded sound cache survives first-use path aliases", async () => {
  const root = await mkdtemp(join(tmpdir(), "shared-precache-"));
  try {
    for (const fixture of [
      { game: "q1-classic-id1", map: "e1m1", family: "q1", sound: "weapons/rocket1i.wav" },
      { game: "q2-classic-baseq2", map: "base1", family: "q2", sound: "weapons/grenlf1a.wav" },
      { game: "q2-rerelease-baseq2", map: "base1", family: "q2", sound: "weapons/grenlf1a.wav" },
    ]) {
      const parsed = parseApplicationCommand(["--game", fixture.game, "--map", fixture.map, "--movement", fixture.family, "--character", fixture.family,
        "--content-root", join(import.meta.dir, "../../../qfiles"), "--user-content-root", root, "--dedicated"]);
      if (parsed.kind !== "run") throw new Error("Expected source precache fixture");
      const content = await loadApplicationContent(parsed.options), identity = createIdentityOwner(`precache-${fixture.game}`);
      const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: 0, mode: "singleplayer", seed: 17, maxClients: 1 });
      const messages: string[] = [];
      const audio = new ApplicationAudio(content, () => 0, 17, "male", message => { messages.push(message); return undefined; }, { deferOutput: true });
      const register = SoundBank.prototype.register;
      let registrations = 0;
      SoundBank.prototype.register = function(this: SoundBank, name, family) { registrations++; return register.call(this, name, family); };
      try {
        const requests = applicationResourceRequests(content, simulation), native = content.recipe.map.entities.content;
        const paths = new Set(requests.filter(request => request.content === native).map(request => request.path));
        const q1 = simulation.q1Source();
        if (q1 !== null) for (const sound of q1.game.precaches.sounds.filter(path => path !== "")) expect(paths.has(`sound/${sound}`)).toBe(true);
        const q2 = simulation.q2Source();
        if (q2 !== null) {
          const product = content.catalog.product(native).expectation;
          const source = monsterSources.find(source => source.family === product.family && source.edition === product.edition && source.program === product.campaign);
          if (source === undefined) throw new Error("Missing native monster declarations");
          for (const classname of new Set([...q2.game.entities.values()].map(entity => entity.classname))) {
            for (const path of source.creatures[classname]?.resources ?? []) if (/\.(mdl|md2|md3|spr|sp2|wav|ogg)$/.test(path)) expect(paths.has(path)).toBe(true);
          }
          expect(paths.has("models/objects/grenade/tris.md2") || paths.has("models/objects/grenade4/tris.md2")).toBe(true);
        }
        await audio.preloadSound(native, `sound/${fixture.sound}`);
        expect(registrations).toBe(1);
        await audio.preloadSound(native, fixture.sound);
        await audio.preloadSound(native, `sound/${fixture.sound}`);
        expect(registrations).toBe(1);
        await audio.command({ name: "soundlist", args: [], seat: null });
        expect(messages.some(message => message.includes(`sound/${fixture.sound}`) && message.includes("16-bit"))).toBe(true);
        expect(messages.some(message => message.includes("Sound unavailable"))).toBe(false);
        await audio.preloadSound(native, "sound/missing-precache-test.wav");
        await audio.preloadSound(native, "missing-precache-test.wav");
        expect(registrations).toBe(2);
        expect(messages.filter(message => message.includes("Sound unavailable"))).toHaveLength(1);
        expect(audio.engine.outputConfiguration).toBeNull();
      } finally { SoundBank.prototype.register = register; audio.close(); simulation.close(); await content.close(); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30000);
