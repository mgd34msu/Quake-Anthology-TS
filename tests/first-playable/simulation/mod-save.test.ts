import { expect, test } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation, loadSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { modInstanceProvider } from "../../../src/contracts/mods.ts";
import type { ModPrivateCheckpoint, ModSelection } from "../../../src/contracts/mods.ts";
import type { PreparedMod } from "../../../src/world/session/mods.ts";
import { decodeSaveImage, encodeSaveImage } from "../../../src/persistence/save-image.ts";
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "../../../src/persistence/value.ts";

function contribution(selection: ModSelection, multiply: boolean, closed: string[]): PreparedMod {
  const source = { provider: "q1:official", content: "q1:classic:id1:test" } satisfies PreparedMod["identity"]["source"];
  const provider = { provider: modInstanceProvider(selection), schema: "test:mod-count", version: 1 } satisfies PreparedMod["identity"]["providers"][number];
  const count = (state: ModPrivateCheckpoint): number => {
    const saved = state.providers[0];
    if (saved === undefined) throw new Error("Missing test contribution state");
    return new SaveReader(decodeCheckpointValue(saved.bytes)).integer(0);
  };
  return { description: { selection, source, title: selection.id, sourceTitle: "Fixture", purpose: "addition", requires: [], conflicts: [], availability: { kind: "available" } },
    identity: { selection, source, declarationDigest: createContentDigest("0".repeat(64)), modules: [], providers: [provider] },
    travel: multiply ? "restart" : "retain",
    validateState: state => { count(state); },
    async initialize() {
      let calls = 0;
      return {
        register(registrations) {
          registrations.register(registrations.operations.inventory.give, { id: "test:amount", kind: "transform", transform: ([actor, item, amount]) => {
            calls++; return [actor, item, (multiply ? amount * 2 : amount) + calls];
          } });
          return undefined;
        },
        async checkpoint() { return { guests: [], providers: [{ ...provider, bytes: encodeCheckpointValue(calls) }] }; },
        async restore(state) { calls = count(state); },
        close() { closed.push(selection.id); return undefined; },
      };
    },
  };
}

test("simulation saves and resumes two stateful contributions through the disk codec and travel handoff", async () => {
  const command = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "e1m1", "--movement", "q1", "--character", "q1", "--dedicated"]);
  if (command.kind !== "run") throw new Error("Expected fixture launch");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner("mod-save"), client = identity.client(0, 0), closed: string[] = [];
  const selections = [{ product: "fixture", id: "offset" }, { product: "fixture", id: "scale" }];
  const preparedMods = selections.map((selection, index) => contribution(selection, index === 1, closed));
  const options = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: command.options.skill, mode: command.options.mode,
    seed: 1, maxClients: 1, preparedMods, enabledMods: selections };
  const nextFrame = async (): Promise<void> => {};
  expect(() => createSimulation(options)).toThrow("asynchronous loadSimulation");
  const original = await loadSimulation(options, nextFrame);
  try {
    const player = original.admitPlayer(client), actor = original.actors.resolveOwned(player.actor);
    if (actor === null) throw new Error("Missing fixture player");
    const item = original.inventory.entries(actor.id).find(entry => entry.count + 30 <= entry.capacity);
    if (item === undefined) throw new Error("Missing writable ammo slot");
    expect(original.inventory.give(actor, item.item, 2)).toBe(7);
    expect(() => original.checkpoint()).toThrow("asynchronous checkpointLoading");
    const image = decodeSaveImage(encodeSaveImage(await original.checkpointLoading(nextFrame)));
    expect(image.mods?.mods.map(mod => mod.identity.selection)).toEqual(selections);
    const modTravel = await original.checkpointModsForTravel();
    expect(original.inventory.give(actor, item.item, 2)).toBe(10);
    const { enabledMods, ...restoreOptions } = options;
    const restored = await loadSimulation({ ...restoreOptions, restore: image, restoredClients: [client] }, nextFrame);
    try {
      const restoredPlayer = restored.players()[0], restoredActor = restoredPlayer === undefined ? null : restored.actors.resolveOwned(restoredPlayer);
      if (restoredActor === null) throw new Error("Missing restored player");
      expect(restored.inventory.give(restoredActor, item.item, 2)).toBe(10);
      expect(restored.inventory.count(restoredActor.id, item.item)).toBe(original.inventory.count(actor.id, item.item));
      expect((await restored.checkpointLoading(nextFrame)).mods).toEqual((await original.checkpointLoading(nextFrame)).mods);
    } finally { restored.close(); }
    if (modTravel === undefined) throw new Error("Missing travel contribution state");
    expect(modTravel.mods[0]?.state).not.toBeNull();
    expect(modTravel.mods[1]?.state).toBeNull();
    const traveled = await loadSimulation({ ...restoreOptions, modTravel }, nextFrame);
    try {
      const next = traveled.admitPlayer(client), owner = traveled.actors.resolveOwned(next.actor);
      if (owner === null) throw new Error("Missing traveled player");
      expect(traveled.inventory.give(owner, item.item, 2)).toBe(9);
    } finally { traveled.close(); }
    original.close(); expect(original.inventory.operations.give.active).toBe(false);
    expect(closed).toEqual(["scale", "offset", "scale", "offset", "scale", "offset"]);
  } finally { original.close(); await content.close(); }
}, 30000);
