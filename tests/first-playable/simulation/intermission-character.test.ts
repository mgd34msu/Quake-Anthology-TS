import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { gameRootIn, steamCommonDirectories } from "../../../src/content/roots.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";

const corpus = [resolve(homedir(), "qfiles"), resolve(homedir(), "Projects/qfiles"), ...steamCommonDirectories()]
  .find(root => existsSync(root) && gameRootIn(root, "q1") !== null && gameRootIn(root, "q3") !== null);

async function viewsDuring(game: string, map: string): Promise<{ play: boolean; intermission: boolean; cutscene: boolean }> {
  const parsed = parseApplicationCommand(["--content-root", corpus ?? "", "--game", game, "--map", map, "--movement", "q1", "--character", "q3", "--dedicated"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const content = await loadApplicationContent(parsed.options), identity = createIdentityOwner(`intermission-character-${game}`);
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts, mode: "singleplayer", skill: 1, seed: 17, maxClients: 1 });
  try {
    const client = identity.client(0, 0), actor = simulation.admitPlayer(client).actor;
    const movement = simulation.movementPlayer(actor);
    if (movement === null) throw new Error("Missing movement player");
    for (let frame = 0; frame < 10; frame++) simulation.step({ elapsedMilliseconds: 50, commands: [] });
    const visible = (): boolean => simulation.characterViews().some(view => view.actor.equals(actor));
    const play = visible();
    Object.assign(movement, { intermission: true });
    const intermission = visible();
    Object.assign(movement, { intermission: false });
    Object.assign(movement, { cutscene: { origin: { x: 0, y: 0, z: 0 }, angles: { x: 0, y: 0, z: 0 }, viewOffset: { x: 0, y: 0, z: 0 } } });
    const cutscene = visible();
    return { play, intermission, cutscene };
  } finally { simulation.close(); await content.close(); }
}

test.skipIf(corpus === undefined)("selected Q3 character remains visible during foreign intermission and cutscenes", async () => {
  expect(await viewsDuring("q1-classic-id1", "e1m1")).toEqual({ play: true, intermission: true, cutscene: true });
}, 30000);

test.skipIf(corpus === undefined)("native Q3 intermission keeps cgame-owned player rendering", async () => {
  expect(await viewsDuring("q3-baseq3", "q3dm1")).toEqual({ play: true, intermission: false, cutscene: false });
}, 30000);
