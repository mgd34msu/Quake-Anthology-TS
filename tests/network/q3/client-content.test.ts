import { expect, test } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { Q3ApplicationPackages } from "../../../src/app/bootstrap/network/q3-downloads.ts";
import { Q3ClientContent } from "../../../src/app/bootstrap/network/q3-client-content.ts";

test("Q3 server policy reaches map and provider mounts without inheriting seed references", async () => {
  const parsed = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--hidden"]);
  if (parsed.kind !== "run") throw new Error("Missing Q3 options");
  const seed = await loadApplicationContent(parsed.options);
  try {
    const packages = await Q3ApplicationPackages.open(seed, 123);
    const base = packages.packs.find(pak => pak.pack.basename === "pak0");
    if (base === undefined) throw new Error("Missing retail baseq3 pak0");
    // These real seed opens must not count as module loads in the replacement filesystem.
    expect(await seed.mounts.open("vm/cgame.qvm")).not.toBeNull();
    expect(await seed.mounts.open("vm/ui.qvm")).not.toBeNull();
    const info = `\\sv_pure\\1\\sv_paks\\${base.pack.checksum | 0}\\fs_game\\`;
    const client = await Q3ClientContent.open(parsed.options, info, 123, seed);
    try {
      expect(client.pure).toBe(true);
      expect(client.content).not.toBe(seed);
      expect(client.policy?.archives).toEqual([base.mount.archiveDigest]);
      expect(client.content.mounts.options.pure).toEqual(client.policy);
      expect(client.content.recipe.map.geometry.provenance.mount.identity.id).toBe(base.mount.identity.id);
      const provider = await client.content.forContent(client.content.recipe.map.entities.content);
      expect(provider.options.pure).toEqual(client.policy);
      const model = await provider.open("models/players/sarge/lower.md3");
      expect(model?.reference.provenance.mount.identity.id).toBe(base.mount.identity.id);
      client.packages.collect();
      expect(client.packages.references.references.snapshot().find(reference => reference.pack.basename === "pak0")?.flags).toBe(1);
      expect(() => client.referencedPureCommand(99)).toThrow("actually loaded cgame");
      expect(client.matches(info, 123)).toBe(true);
      expect(client.matches(info, 124)).toBe(false);
      expect(client.matches(info.replace("\\sv_pure\\1", "\\sv_pure\\0"), 123)).toBe(false);
      const restarted = await Q3ClientContent.open(parsed.options, info, 124, client.content);
      try {
        expect(restarted.content.mounts).not.toBe(client.content.mounts);
        expect(await restarted.content.forContent(restarted.content.recipe.map.entities.content)).not.toBe(provider);
        expect(restarted.packages.packs.find(pak => pak.pack.basename === "pak0")?.pack.pureChecksum).not.toBe(base.pack.pureChecksum);
        expect(() => restarted.referencedPureCommand(100)).toThrow("actually loaded cgame");
      } finally { await restarted.close(); }
    } finally { await client.close(); }
    expect(client.matches(info, 123)).toBe(false);
    expect(() => client.referencedPureCommand(99)).toThrow("closed");
  } finally { await seed.close(); }
}, 60000);
