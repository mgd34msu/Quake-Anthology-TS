import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { admitWeaponTiming, selectedWeaponResources } from "../../../src/content/catalog/weapons.ts";
import { nativeProviderTiming } from "../../../src/content/catalog/timing.ts";
import { applicationPreset } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";

const corpusRoot = join(import.meta.dir, "../../../../qfiles");

test.skipIf(!existsSync(corpusRoot))("foreign base Q1 weapons resolve their own classic and rerelease assets", async () => {
  const catalog = await discoverInstalledContent({ corpusRoot, discoverMods: false });
  for (const game of ["q2-classic-baseq2", "q3-baseq3"]) {
    const command = parseApplicationCommand(["--game", game, "--map", game.startsWith("q2") ? "base1" : "q3dm1"]);
    if (command.kind !== "run") throw new Error("Expected a launch command");
    const preset = applicationPreset(catalog, command.options);
    for (const edition of ["classic", "rerelease"]) {
      const weapon = { provider: "q1:official", content: catalog.require(`q1-${edition}-id1`).id } satisfies typeof preset.map.entities;
      const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [weapon] } } });
      const requests = selectedWeaponResources(preset.map.entities, [weapon], catalog);
      expect(recipe.timing.filter(entry => entry.provider === weapon.provider)).toEqual([nativeProviderTiming(weapon, "q1", edition === "rerelease")]);
      if (recipe.ordering.kind !== "mixed" || preset.ordering.kind !== "mixed") throw new Error("Expected mixed provider order");
      expect(recipe.ordering.providers.slice(0, preset.ordering.providers.length)).toEqual([...preset.ordering.providers]);
      expect(recipe.ordering.providers.filter(provider => provider === weapon.provider)).toHaveLength(1);
      expect(requests.filter(request => request.path.startsWith("progs/v_"))).toHaveLength(8);
      for (const request of requests) {
        const resource = recipe.resources.find(entry => entry.requestedPath === request.path);
        expect(resource?.provenance.mount.identity.content).toBe(weapon.content);
      }
      expect(selectedWeaponResources(weapon, [weapon], catalog)).toHaveLength(0);
    }
  }
}, 60000);

test("foreign Q1 launch rejects missing weapon assets before play", async () => {
  const root = await mkdtemp(join(tmpdir(), "q1-weapon-admission-"));
  try {
    await mkdir(join(root, "q1/id1"), { recursive: true });
    await mkdir(join(root, "q2/baseq2/maps"), { recursive: true });
    await writeFile(join(root, "q2/baseq2/maps/base1.bsp"), "map");
    const products = [
      { id: "q1-classic-id1", family: "q1", edition: "classic", campaign: "id1", title: "Q1", contentDirectory: "q1/id1", baseProduct: null, requiredContentArchives: [], requiredPrograms: [], mapWitness: null, unresolvedReason: null },
      { id: "q2-classic-baseq2", family: "q2", edition: "classic", campaign: "baseq2", title: "Q2", contentDirectory: "q2/baseq2", baseProduct: null, requiredContentArchives: [], requiredPrograms: [], mapWitness: null, unresolvedReason: null },
    ] satisfies NonNullable<Parameters<typeof discoverInstalledContent>[0]["products"]>;
    const catalog = await discoverInstalledContent({ corpusRoot: root, products, discoverMods: false });
    const command = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q2", "--character", "q2"]);
    if (command.kind !== "run") throw new Error("Expected a launch command");
    const preset = applicationPreset(catalog, command.options);
    await expect(resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [
      { provider: "q1:official", content: catalog.require("q1-classic-id1").id },
    ] } } })).rejects.toThrow("Required weapon resource is absent from its selected content and base");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("selected weapon metadata retains matching native timing and rejects conflicting profiles", () => {
  const weapon = { provider: "q1:official", content: "q1:classic:id1:installed" } satisfies Parameters<typeof nativeProviderTiming>[0];
  const profile = nativeProviderTiming(weapon, "q1", false), timing = [profile];
  admitWeaponTiming(timing, nativeProviderTiming(weapon, "q1", false));
  expect(timing).toHaveLength(1);
  expect(() => admitWeaponTiming(timing, { ...profile, clock: { kind: "q1-netquake", minimumFrameSeconds: 0.001, maximumFrameSeconds: 0.1, fixedFrameSeconds: 0.1 } })).toThrow("conflicting timing");
  expect(() => admitWeaponTiming(timing, { ...profile, numeric: { ...profile.numeric, floatToInt: "qvm-indefinite" } })).toThrow("conflicting timing");
});
