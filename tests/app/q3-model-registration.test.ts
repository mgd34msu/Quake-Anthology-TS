import { expect, test } from "bun:test";
import { registerQ3ModelRequest, registerQ3ShaderRequest } from "../../src/app/bootstrap/q3-client/assets.ts";
import { normalizeResourcePath } from "../../src/content/mounts/paths.ts";
import { ClientInfoStore } from "../../src/content/q3/presentation/players.ts";
import { ClientInfo } from "../../src/content/q3/presentation/client-info.ts";
import { ClientGameState } from "../../src/content/q3/presentation/state.ts";
import { DEFAULT_MODEL, type SceneModel } from "../../src/content/q3/presentation/ref-entity.ts";
import { GameType, Team } from "../../src/content/q3/base/shared/definitions.ts";

function model(path: string): SceneModel {
  return { kind: "model", path, model: { kind: "q3-md3", name: path, frames: [], tags: [], surfaces: [] },
    resource: { id: "resource:model-fixture", requestedPath: path, digest: "sha256:fixture", byteLength: 0,
      provenance: { kind: "loose", memberPath: path, mount: { kind: "loose", rootPath: "/fixture",
        identity: { id: "mount:test:models", content: "q3:missionpack:test:1", generation: 0 } } },
      resolution: { kind: "default-order", plan: "mount-plan:test:models", rank: 0 } } };
}

test("Q3 model registration rejects invalid requests without relaxing mounts or hiding loader failures", async () => {
  const loaded: string[] = [];
  const load = async (path: string): Promise<SceneModel> => { loaded.push(path); return model(path); };
  for (const path of ["", "models/players//lower.md3", "../secret", "/absolute.md3", "C:/model.md3", "a/./b", "a\0b"]) {
    expect(() => normalizeResourcePath(path)).toThrow(RangeError);
    expect(await registerQ3ModelRequest(path, load)).toBe(DEFAULT_MODEL);
  }
  expect(loaded).toEqual([]);
  expect((await registerQ3ModelRequest("models\\players\\sarge\\lower.md3", load)).path).toBe("models/players/sarge/lower.md3");
  expect((await registerQ3ModelRequest("*1", load)).path).toBe("*1");
  expect(await registerQ3ModelRequest("models/missing.md3", async () => DEFAULT_MODEL)).toBe(DEFAULT_MODEL);
  for (const error of [new Error("I/O failure"), new RangeError("Malformed MD3")]) {
    await expect(registerQ3ModelRequest("models/present.md3", async () => { throw error; })).rejects.toBe(error);
  }
});
test("Q3 empty source model icon requests fail registration before original fallback and preserve loader errors", async () => {
  const loaded: string[] = [];
  const load = async (name: string) => { loaded.push(name); return { name }; };
  expect(await registerQ3ShaderRequest("models/players//icon_default.tga", load)).toBeNull();
  expect(loaded).toEqual([]);
  expect(await registerQ3ShaderRequest("models/players/sarge/icon_default.tga", load)).toEqual({ name: "models/players/sarge/icon_default.tga" });
  const error = new RangeError("Malformed image");
  await expect(registerQ3ShaderRequest("models/players/sarge/icon_default.tga", async () => { throw error; })).rejects.toBe(error);
});

for (const gameType of [GameType.GT_FFA, GameType.GT_TEAM]) test(`sparse player info uses source default model and cleared info deletes it: ${gameType}`, async () => {
  const slot = new ClientInfo(), loaded: string[] = [];
  const bytes = new TextEncoder().encode(Array.from({ length: 40 }, () => "0 1 0 10").join("\n"));
  const clients = new ClientInfoStore({ state: new ClientGameState("missionpack", 0, 0),
    settings: () => ({ gameType, maxClients: 1, forceModel: false, model: "sarge", headModel: "sarge",
      redTeamName: "Stroggs", blueTeamName: "Pagans", deferPlayers: false, buildScript: false, loading: false }),
    assets: { has: () => true, read: async () => bytes, list: () => [] },
    resources: { registerModel: path => path === null ? Promise.resolve(DEFAULT_MODEL) : registerQ3ModelRequest(path, async valid => {
      loaded.push(valid); return model(valid);
    }), registerSkin: async path => ({ path, surfaces: [] }) },
    registerShaderNoMip: async name => ({ name }), registerSound: async () => null, sound: () => null,
    print: () => {}, memoryRemaining: () => 8000000 }, [slot, ...Array.from({ length: 63 }, () => new ClientInfo())]);
  await clients.newClientInfo(0, `n\\Round Wire\\t\\${gameType === GameType.GT_TEAM ? Team.TEAM_RED : Team.TEAM_FREE}\\model\\\\hmodel\\\\hc\\100`);
  const expected = gameType === GameType.GT_TEAM ? "james" : "sarge";
  expect(slot.infoValid).toBe(true);
  expect(slot.legsModel.path).toBe(`models/players/${expected}/lower.md3`);
  expect(slot.torsoModel.path).toBe(`models/players/${expected}/upper.md3`);
  expect(loaded.every(path => !path.includes("//"))).toBe(true);
  const count = loaded.length;
  await clients.newClientInfo(0, "");
  expect(slot.infoValid).toBe(false); expect(slot.legsModel).toBe(DEFAULT_MODEL); expect(loaded).toHaveLength(count);
});
