// SPDX-License-Identifier: GPL-2.0-or-later
import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../src/app/bootstrap/application.ts";
import { applicationPreset } from "../../src/app/bootstrap/content.ts";
import { saveCvarArchive } from "../../src/app/bootstrap/cvar-archives.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { StartupSelectionModel } from "../../src/app/bootstrap/startup-selection.ts";
import { readTeamArenaSkirmish } from "../../src/app/bootstrap/team-arena-skirmish.ts";
import { presetChoice, resolveLaunch } from "../../src/content/catalog/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { userProductDirectory } from "../../src/content/user-data.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { ConfigStore } from "../../src/settings/config.ts";
import { corpusTest } from "../support/corpus.ts";

// A world change whose source owner differs from the running world's plans with that owner's saved variables, not the previous owner's.
// A Team Arena skirmish replacing a Quake III world is the only travel that changes the owner, and the application's own entry
// points never start one from a Quake III launch, so the replacement is planned directly with the skirmish's own options.
corpusTest("q3a/missionpack/pak0.pk3")(
  "planning a world replacement with a different source owner loads that owner's archive",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "quake-source-owner-"));
    let app: Application | null = null;
    try {
      const parsed = parseApplicationCommand([
        "--game",
        "q3-baseq3",
        "--map",
        "q3dm1",
        "--movement",
        "q3",
        "--character",
        "q3",
        "--mode",
        "deathmatch",
        "--dedicated",
        "--user-content-root",
        root,
      ]);
      if (parsed.kind !== "run") throw new Error("Missing launch options");
      app = await Application.open(
        { ...parsed.options, nativeConfigRoot: join(root, "game-writes") },
        { print: () => undefined, saveDirectory: join(root, "saves") },
      );
      const catalog = app.content.catalog;
      const selection = new StartupSelectionModel(catalog, parsed.options);
      await selection.prepareMaps();
      const teamArena = await selection.resolvePreset("q3-missionpack", 2);
      const setup = await readTeamArenaSkirmish(catalog, 2, { map: "maps/mpq3ctf4.bsp", gameType: 4, advance: false });
      const restored = {
        ...teamArena.options,
        map: setup.map,
        teamArenaSkirmish: setup,
        characterModel: setup.playerModel,
        nativeConfigRoot: join(root, "game-writes"),
      };
      const preset = applicationPreset(catalog, restored, { movement: teamArena.recipe.movement, character: teamArena.recipe.character.definition });
      const target = (await resolveLaunch({ catalog, preset, choice: presetChoice(preset.id) })).map.entities;
      expect(target.content).not.toBe(app.content.recipe.map.entities.content);
      const product = catalog.product(target.content);
      await saveCvarArchive(
        new ConfigStore(product.userContent?.root ?? userProductDirectory(root, product.expectation.contentDirectory)),
        ["source", target.content, target.provider],
        new CvarRegistry({ dialect: "q3", context: { session: createIdentityOwner("source-owner").session, origin: { kind: "local-console" } } }),
        [{ name: "sv_floodProtect", value: "7" }],
      );
      const plan = await app["planWorldReplacement"]({
        map: setup.map,
        carry: null,
        initialSourceMilliseconds: 0,
        skirmish: setup,
        nextFrame: async () => undefined,
        guestRestart: false,
        q2NextServer: "",
        restoredOptions: restored,
      });
      try {
        expect(plan.sameSourceOwner).toBe(false);
        expect(plan.sourceArchive).toEqual([{ name: "sv_floodProtect", value: "7" }]);
      } finally {
        await plan.content.close();
      }
    } finally {
      try {
        await app?.close();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  },
  180_000,
);
