import { expect, test } from "bun:test";
import type { ExecutableRecipe, ProviderReference, ResolvedResourceReference } from "../../src/contracts/content.ts";
import { createContentDigest } from "../../src/contracts/content.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarFlag } from "../../src/core/cvars/index.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { createStartupSource } from "../../src/app/bootstrap/startup-source.ts";

function recipe(source: ProviderReference): ExecutableRecipe {
  const geometry: ResolvedResourceReference = { id: "resource:startup:map", requestedPath: "maps/test.bsp", digest: createContentDigest("0".repeat(64)), byteLength: 0,
    provenance: { kind: "loose", memberPath: "maps/test.bsp", mount: { kind: "loose", identity: { id: "mount:startup:map", content: source.content, generation: 0 }, rootPath: "/unused" } },
    resolution: { kind: "default-order", plan: "mount-plan:startup:map", rank: 0 } };
  return { schemaVersion: 3, id: "recipe:startup:q3", preset: "recipe:startup:q3", map: { geometryContent: source.content, geometry, entities: source },
    campaign: { kind: "none" }, movement: source, character: { definition: source, appearance: source }, weapons: [source],
    equipment: { grapple: { kind: "disabled" }, handGrenades: { kind: "disabled" } }, enemies: { kind: "map-defined" },
    presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: source.content, hud: source, effects: source, audio: source },
    engineBehavior: source, combat: source, inventory: source, match: source, transition: source,
    execution: [{ kind: "typescript", owner: source, implementation: "q3:official", role: "server-game", api: { kind: "q3-qagame", version: 8 } }],
    mounts: { id: "mount-plan:startup:map", mounts: [geometry.provenance.mount], defaultOrder: [geometry.provenance.mount.identity.id], prefixOrders: [] },
    resources: [geometry], timing: [], ordering: { kind: "mixed", providers: [source.provider], entityOrder: "source-slot-order", ties: "provider-entity-invocation" } };
}

test("ordinary Q3 startup selects game cvars from map source content rather than provider spelling", () => {
  const command = parseApplicationCommand(["--game", "q3-missionpack", "--map", "mpq3ctf4"]);
  if (command.kind !== "run") throw new Error("Expected ordinary launch");
  const context = { session: createIdentityOwner("startup-q3-product").session, origin: { kind: "server-console" } } satisfies Parameters<typeof createStartupSource>[3];
  const missionpack = createStartupSource(command.options, recipe({ provider: "q3:official", content: "q3:classic:missionpack:installed" }), "q3", context, 8, () => {});
  expect(missionpack.get("g_redTeam")).toMatchObject({ name: "g_redteam", value: "Stroggs", resetValue: "Stroggs", flags: CvarFlag.Archive | CvarFlag.ServerInfo | CvarFlag.UserInfo });
  expect(missionpack.get("g_blueTeam")).toMatchObject({ name: "g_blueteam", value: "Pagans", resetValue: "Pagans", flags: CvarFlag.Archive | CvarFlag.ServerInfo | CvarFlag.UserInfo });
  expect(missionpack.get("g_obeliskHealth")).toMatchObject({ value: "2500", resetValue: "2500", flags: 0 });
  expect(missionpack.get("g_obeliskRespawnDelay")).toMatchObject({ value: "10", flags: CvarFlag.ServerInfo });
  const base = createStartupSource(command.options, recipe({ provider: "q3:official", content: "q3:classic:baseq3:installed" }), "q3", context, 8, () => {});
  expect(base.get("g_redteam")).toBeUndefined();
  expect(base.get("g_obeliskHealth")).toBeUndefined();
  expect(base.get("g_speed")).toEqual(missionpack.get("g_speed"));
  expect(base.get("g_speed")).toMatchObject({ value: "320", resetValue: "320", flags: 0 });
});
