import { savedSimulationSettings } from "../../src/app/bootstrap/simulation/save.ts";
import { expect, test } from "bun:test";
import type { ExecutableRecipe, ProviderReference, ResolvedResourceReference, ResourceRequest } from "../../src/contracts/content.ts";
import { createContentDigest, createResourceId } from "../../src/contracts/content.ts";
import type { SaveImage } from "../../src/contracts/session.ts";
import { CampaignUnit } from "../../src/app/bootstrap/campaign-unit.ts";
import { authoredCampaignStart } from "../../src/app/bootstrap/authored-start.ts";
import { parseAuthoredStarts } from "../../src/content/catalog/start-maps.ts";
import { decodeSaveImage, encodeSaveImage } from "../../src/persistence/save-image.ts";
import { decodeCheckpointValue, encodeCheckpointValue } from "../../src/persistence/value.ts";
function recipe(): ExecutableRecipe {
  const content = "q1:classic:id1:fixture";
  const provider = (role: string): ProviderReference => ({ provider: `q1:${role}`, content });
  const raw: Omit<ResolvedResourceReference, "id"> = { requestedPath: "maps/start.bsp", provenance: { kind: "loose", memberPath: "maps/start.bsp", mount: { kind: "loose", identity: { id: "mount:q1:fixture", content, generation: 2 }, rootPath: "/fixture" } },
    digest: createContentDigest("0".repeat(64)), byteLength: 123, resolution: { kind: "default-order", plan: "mount-plan:fixture:1", rank: 0 } };
  const geometry = { ...raw, id: createResourceId(raw) };
  return { schemaVersion: 3, id: "recipe:fixture:1", preset: "recipe:fixture:1", map: { geometryContent: content, geometry, entities: provider("game") }, campaign: { kind: "campaign", mission: provider("mission"), gamecode: provider("game") },
    movement: provider("movement"), character: { definition: provider("character"), appearance: provider("appearance") }, weapons: [provider("weapons")], equipment: { grapple: { kind: "disabled" }, handGrenades: { kind: "disabled" } }, enemies: { kind: "map-defined" },
    presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: content, hud: provider("hud"), effects: provider("effects"), audio: provider("audio") }, engineBehavior: provider("engine"), combat: provider("combat"), inventory: provider("inventory"), match: provider("match"), transition: provider("transition"),
    execution: [{ kind: "typescript", owner: provider("game"), implementation: "q1:official", role: "server-game", api: { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 } }],
    mounts: { id: "mount-plan:fixture:1", mounts: [raw.provenance.mount], defaultOrder: [raw.provenance.mount.identity.id], prefixOrders: [] }, resources: [geometry], timing: [],
    ordering: { kind: "native", traversal: "source-slot-order", clock: { kind: "q1-netquake", minimumFrameSeconds: 0.001, maximumFrameSeconds: 0.1, fixedFrameSeconds: null } } };
}
function image(map: string, state: string): SaveImage {
  const source = recipe(), geometry = { ...source.map.geometry, requestedPath: `maps/${map}.bsp` };
  return { schemaVersion: 2, recipe: { ...source, map: { ...source.map, geometry } }, frame: { frame: 1, time: { kind: "seconds", value: 1 }, elapsed: { kind: "seconds", value: 0.1 }, phase: "frame-exit" },
    nextEventSequence: 1, clocks: [], random: [], actors: [], bodies: [], combat: [], inventories: [], configurations: [], thinks: [], guests: [],
    providers: [{ provider: "q1:game", schema: "q1:world", version: 1, bytes: encodeCheckpointValue({ state }) }] };
}
const map = (path: string): ResourceRequest => ({ content: "q1:classic:id1:fixture", path });
test("unit revisits retain complete source bytes, failed staging is inert and new units discard departed worlds", () => {
  const unit = new CampaignUnit(), first = image("start", "door-open;pickup-gone;monster-dead");
  unit.stage(map("start"), true, null).commit();
  const failed = unit.stage(map("next"), false, first);
  expect(failed.restore).toBeNull();
  expect(unit.stage(map("start"), false, null).restore).toBeNull();
  failed.commit();
  const envelope = decodeSaveImage(encodeSaveImage(unit.attach(image("next", "switch-on"))));
  const loaded = new CampaignUnit(); loaded.restore(envelope);
  const back = loaded.stage(map("maps/start.bsp"), false, image("next", "switch-on"));
  expect(back.restore?.recipe).toEqual(first.recipe);
  expect(back.restore?.providers).toEqual(first.providers);
  expect(decodeCheckpointValue(back.restore?.providers[0]?.bytes ?? new Uint8Array())).toEqual({ state: "door-open;pickup-gone;monster-dead" });
  back.commit();
  expect(() => back.commit()).toThrow("superseded");
  loaded.stage(map("new"), true, first).commit();
  expect(loaded.stage(map("start"), false, image("new", "fresh")).restore).toBeNull();
});
test("old saves and first-world saves are admitted; failed restore cannot replace current unit", () => {
  const unit = new CampaignUnit(), first = image("start", "old");
  unit.restore(first);
  expect(unit.stage(map("next"), false, null).restore).toBeNull();
  const fresh = new CampaignUnit(); fresh.restore(fresh.attach(first));
  const corrupted = { ...first, providers: [{ provider: "session:campaign-unit", schema: "session:campaign-unit", version: 1, bytes: encodeCheckpointValue({ current: map("elsewhere"), worlds: [] }) }] } satisfies SaveImage;
  expect(() => unit.restore(corrupted)).toThrow("active map");
  expect(() => unit.attach(first)).not.toThrow();
});
test("authored start retains cinematic chain, unit marker, spawnpoint and native starting inventory", () => {
  const parsed = parseAuthoredStarts(new TextEncoder().encode(JSON.stringify({ maps: [{ episode: "mod", sp: true, bsp: "intro.cin+*base1", start_items: "weapon_shotgun;ammo_shells 20" }] })), "mod");
  const start = authoredCampaignStart({ ...parsed, resource: recipe().map.geometry }, "base1");
  expect(start?.target).toMatchObject({ kind: "cinematic", name: "intro.cin", next: { kind: "map", name: "base1", newUnit: true } });
  expect(start?.startItems).toBe("weapon_shotgun;ammo_shells 20");
  expect(authoredCampaignStart({ ...parsed, resource: recipe().map.geometry }, "base2")).toBeNull();
});

test("authored spawnpoint persists in common settings and old saves keep default spawn", () => {
  const original = image("start", "world");
  const saved = (initialSpawnPoint?: string): SaveImage => ({ ...original, providers: [...original.providers,
    { provider: original.recipe.map.entities.provider, schema: "world:simulation", version: 11,
      bytes: encodeCheckpointValue({ settings: { skill: 1, mode: "singleplayer", maxClients: 1, seed: 1,
        ...(initialSpawnPoint === undefined ? {} : { initialSpawnPoint }) }, hostMilliseconds: 0, players: [] }) }] });
  expect(savedSimulationSettings(decodeSaveImage(encodeSaveImage(saved("tram"))))).toMatchObject({ initialSpawnPoint: "tram" });
  expect(savedSimulationSettings(saved()).initialSpawnPoint).toBe("");
});
