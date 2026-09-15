import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { createMountIdentity, type ContentId, type ContentMount } from "../../../src/contracts/content.ts";
import { digestFile, openMountPlan } from "../../../src/content/mounts/index.ts";
import { LocalizationCatalog } from "../../../src/text/localization.ts";
import { q2LocalizedText } from "../../../src/app/bootstrap/q2-localization.ts";
import { ApplicationRereleasePresentation } from "../../../src/app/bootstrap/rerelease-presentation.ts";
import type { ProviderSceneAssets } from "../../../src/app/bootstrap/assets.ts";
import { SceneImageRegistry } from "../../../src/render/scene/resources.ts";
import { SceneTextureLoader } from "../../../src/render/scene/textures.ts";
import { SceneShaderRegistry } from "../../../src/render/scene/shaders.ts";
import { SceneMaterialRegistrations } from "../../../src/render/scene/material-registrations.ts";
import { DEFAULT_MODEL_REPLACEMENT_POLICY } from "../../../src/render/scene/models/replacements.ts";

const identity = createIdentityOwner("q2-source-localization");

test("Q2 presentation keeps missing keys, argument text and source newlines without changing native localization", () => {
  const table = new LocalizationCatalog(identity.seat(0), "q2-rerelease");
  table.reload(new TextEncoder().encode('objective = "Établir la communication"\nitem = "Blaster"\nnotice = "{1}: {0}\\n"'));
  expect(q2LocalizedText(table, "$objective\n")).toBe("Établir la communication\n");
  expect(q2LocalizedText(table, "$notice", ["$item", "Player"])).toBe("Player: Blaster\n");
  expect(q2LocalizedText(table, "$notice", ["$mod_missing", "Player"])).toBe("Player: $mod_missing\n");
  expect(q2LocalizedText(table, "$notice", [])).toBe("$notice");
  expect(q2LocalizedText(table, "$mod_missing\n")).toBe("$mod_missing\n");
  expect(q2LocalizedText(table, "literal $objective\n")).toBe("literal $objective\n");
  expect(table.localize("$mod_missing")).toBe("mod_missing");
});

test("Q2 base and expansion source messages use their mounted catalog and selected seat language", async () => {
  const archivePath = "/home/buzzkill/Projects/qfiles/q2/rerelease/Q2Game.kpf";
  const archiveDigest = await digestFile(archivePath);
  const sources: readonly ContentId[] = ["q2:rerelease:baseq2:retail", "q2:rerelease:xatrix:retail", "q2:rerelease:rogue:retail", "q2:rerelease:mg1:retail"];
  for (const source of sources) {
    const archive: ContentMount = { kind: "archive", identity: createMountIdentity(`mount:test:${source}`, source, 0), format: "kpf", archivePath, archiveDigest };
    using mounts = await openMountPlan({ id: `mount-plan:test:${source}`, mounts: [archive], defaultOrder: [archive.identity.id], prefixOrders: [] });
    const images = new SceneImageRegistry({ identity: Symbol(source), session: identity.session, generation: 0 });
    const textures = new SceneTextureLoader(images, { read: async () => null });
    try {
      const provider: ProviderSceneAssets = { family: "q2", mounts, palette: null, textures,
        shaders: new SceneShaderRegistry(textures, new SceneMaterialRegistrations().provider(source)), modelPolicy: DEFAULT_MODEL_REPLACEMENT_POLICY };
      const opened: ContentId[] = [];
      const presentation = new ApplicationRereleasePresentation({ provider: async content => { opened.push(content); return provider; } }, [
        { seat: identity.seat(0), actor: identity.actor(0, 0) }, { seat: identity.seat(1), actor: identity.actor(1, 0), language: "french" },
      ]);
      const raw = await mounts.open("localization/loc_english.txt");
      if (raw === null) throw new Error("Installed Q2Game.kpf has no English catalog");
      expect(new TextDecoder().decode(raw.bytes)).toContain("map_establish_communication");
      expect(await presentation.localizeMessage(identity.seat(0), source, "$map_establish_communication")).toBe("Establish communication\nlink to command ship.");
      for (const key of ["$map_locate_base_installation", "$map_you_have_found_a_secret_area_1", "$item_blaster"]) {
        const english = await presentation.localizeMessage(identity.seat(0), source, key);
        const french = await presentation.localizeMessage(identity.seat(1), source, key);
        expect(english).not.toStartWith("$"); expect(french).not.toStartWith("$");
        expect(english.length).toBeGreaterThan(0); expect(french.length).toBeGreaterThan(0);
      }
      expect(await presentation.localizeMessage(identity.seat(1), source, "$map_establish_communication")).not.toBe(await presentation.localizeMessage(identity.seat(0), source, "$map_establish_communication"));
      expect(await presentation.localizeMessage(identity.seat(0), source, "$g_exited_level", ["Player"])).toBe("Player exited the level.\n");
      expect(await presentation.localizeMessage(identity.seat(0), source, "$mod_unknown")).toBe("$mod_unknown");
      expect(opened.every(content => content === source)).toBe(true);
    } finally { textures.close(); images.close(); }
  }
});
