import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { SharedSimulation } from "../../../src/app/bootstrap/simulation/runtime.ts";
import { createApplicationBotNavigation } from "../../../src/app/bootstrap/simulation/navigation.ts";
import { preloadNavigation } from "../../../src/bots/navigation/load.ts";
import { playerCrouchedBounds } from "../../../src/app/bootstrap/simulation/player-movement.ts";

const corpus = resolve(import.meta.dir, "../../../../qfiles");
for (const movement of ["q3", "q1", "q2"]) test.skipIf(!existsSync(resolve(corpus, "q3a/baseq3/pak4.pk3")))(
  `mounted retail navigation predicts selected ${movement} movement without actor writes`, async () => {
    const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q3-baseq3", "--map", "q3dm1",
      "--movement", movement, "--character", "q3", "--mode", "deathmatch"]);
    if (launch.kind !== "run") throw new Error("Expected retail launch options");
    const content = await loadApplicationContent(launch.options), identity = createIdentityOwner(`navigation-check-${movement}`);
    try {
      const simulation = new SharedSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
        mode: "deathmatch", skill: 3, seed: 7, maxClients: 4 });
      const navigation = await createApplicationBotNavigation({ content, simulation });
      const { actor } = simulation.admitPlayer(identity.client(0, 1));
      const player = simulation.movementPlayer(actor);
      if (player === null) throw new Error("Admitted player missing");
      const initialNavigation = navigation.forClient(0);
      simulation.setWorldGravity(420);
      const changedNavigation = navigation.forClient(0);
      expect(changedNavigation).not.toBe(initialNavigation);
      expect(navigation.forClient(0)).toBe(changedNavigation);
      for (const profile of [navigation.runtime.graph.profile, initialNavigation.graph.profile, changedNavigation.graph.profile]) {
        expect(profile.shape.bounds).toEqual(player.standingBounds);
        expect(profile.capabilities.has("crouch")).toBe(movement !== "q1");
        expect(profile.capabilities.has("water-jump")).toBe(true);
        if (movement === "q1") expect(profile.crouchedShape).toBeUndefined();
        else expect(profile.crouchedShape?.bounds).toEqual(playerCrouchedBounds(player));
      }
      expect(navigation.crouchedBounds).toEqual(movement === "q1" ? player.standingBounds : playerCrouchedBounds(player));
      const sourcePlayer = simulation.q3Source()?.pool.at(0).client?.ps;
      const sourceBefore = sourcePlayer?.copy();
      const combatBefore = simulation.combat.read(actor), inventoryBefore = simulation.inventory.entries(actor);
      const arsenalBefore = JSON.stringify(player.arsenal);
      const before = JSON.stringify(player.state), body = simulation.bodies.read(actor), origin = player.view().origin;
      const result = navigation.predictClientMovement({ entityNum: 0, origin, presence: 2, onGround: true,
        velocity: { x: 0, y: 0, z: 0 }, commandMove: { x: 400, y: 0, z: 0 }, commandFrames: 8, maxFrames: 8,
        frameTime: 0.016, stopEvents: 0, stopArea: 0, visualize: false });
      const selected = navigation.forClient(0).graph.profile.movement;
      if (selected.kind === "q1-netquake" || selected.kind === "q1-quakeworld") expect(selected.parameters.gravity).toBe(player.worldGravity);
      expect(navigation.runtime.graph.asset?.kind).toBe("aas");
      expect(navigation.runtime.graph.asset?.kind === "aas" && navigation.runtime.graph.asset.vertices.length).toBe(0);
      expect(navigation.runtime.graph.nodes.length).toBeGreaterThan(100);
      expect(result.frames).toBe(8);
      expect(result.end).not.toEqual(origin);
      expect(navigation.forClient(0).world.passActor?.equals(actor)).toBe(true);
      expect(navigation.forClient(0).route({ start: origin, goal: result.end }).kind).toBe("route");
      expect(JSON.stringify(player.state)).toBe(before);
      expect(sourcePlayer?.copy()).toEqual(sourceBefore);
      expect(simulation.bodies.read(actor)).toEqual(body);
      expect(simulation.combat.read(actor)).toEqual(combatBefore);
      expect(simulation.inventory.entries(actor)).toEqual(inventoryBefore);
      expect(JSON.stringify(player.arsenal)).toBe(arsenalBefore);
      if (movement === "q3") {
        const source = simulation.q3Source();
        if (source === null) throw new Error("Retail Q3 source missing");
        const entity = source.pool.at(0), client = entity.client;
        if (client === null) throw new Error("Retail Q3 player missing");
        const snapped = { x: Math.trunc(result.end.x), y: Math.trunc(result.end.y), z: Math.trunc(result.end.z) };
        client.ps.origin = result.end;
        entity.r.withCurrentOrigin(snapped, () => {
          expect(entity.r.currentOrigin).toEqual(snapped);
          expect(client.ps.origin).toEqual(result.end);
          source.world.link(entity);
          expect(simulation.bodies.linked(actor)?.state.origin).toEqual(snapped);
          expect(simulation.bodies.read(actor)?.origin).toEqual(result.end);
          expect(() => entity.r.withCurrentOrigin(origin, () => {
            entity.r.currentOrigin = origin;
            expect(client.ps.origin).toEqual(origin);
            throw new Error("source callback interruption");
          })).toThrow("source callback interruption");
          expect(entity.r.currentOrigin).toEqual(snapped);
          expect(client.ps.origin).toEqual(origin);
        });
        expect(entity.r.currentOrigin).toEqual(origin);
      }
    } finally { await content.close(); }
  }, 30000);

test.skipIf(!existsSync(resolve(corpus, "q1/rerelease/mg3/pak0.pak")))("selected geometry provenance rejects inherited NAV for a different BSP", async () => {
  const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q1-rerelease-mg3", "--map", "start", "--dedicated", "--mode", "singleplayer"]);
  if (launch.kind !== "run") throw new Error("Expected retail navigation options");
  const content = await loadApplicationContent(launch.options);
  try {
    const resources = await content.forContent(content.recipe.map.geometry.provenance.mount.identity.content);
    const inherited = await resources.open("bots/navigation/start.nav");
    if (inherited === null) throw new Error("Missing inherited retail NAV witness");
    expect(inherited.reference.provenance.mount.identity.content).not.toBe(content.recipe.map.geometry.provenance.mount.identity.content);
    const prepared = await preloadNavigation({ resources, map: { name: content.recipe.map.geometry.requestedPath,
      format: content.world.kind, digest: content.recipe.map.geometry.digest },
      mapBytes: await content.mounts.read(content.recipe.map.geometry),
      navigationContent: content.recipe.map.geometry.provenance.mount.identity.content });
    expect(prepared.asset).toBeNull();
    expect(prepared.map.digest).toBe(content.recipe.map.geometry.digest);
  } finally { await content.close(); }
}, 30000);

for (const map of ["base1", "fact1"]) test.skipIf(!existsSync(resolve(corpus, "q2/rerelease/baseq2/pak0.pak")))(
  `retail ${map} navigation reads live source doors and hurt triggers`, async () => {
    const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q2-rerelease-baseq2", "--map", map, "--dedicated", "--mode", "singleplayer"]);
    if (launch.kind !== "run") throw new Error("Expected Q2 navigation options");
    const content = await loadApplicationContent(launch.options);
    try {
      const identity = createIdentityOwner(`navigation-live-${map}`);
      const simulation = new SharedSimulation({ identity, recipe: content.recipe,
        world: content.world, mounts: content.mounts, mode: "singleplayer", skill: 1, seed: 7, maxClients: 1,
        playerIdentity: client => ({ seat: client.slot, socialId: "" }) });
      const navigation = await createApplicationBotNavigation({ content, simulation }), source = simulation.q2Source();
      if (source === null) throw new Error("Missing actual Q2 source");
      if (map === "base1") {
        const door = [...source.game.entities.values()].find(entity => entity.model === "*32");
        const automatic = [...source.game.entities.values()].find(entity => entity.model === "*20");
        if (door === undefined || automatic === undefined || door.use === null) throw new Error("Missing authored doors");
        const binding = { model: 32, bounds: source.game.body(door).bounds, raw: [] };
        expect(navigation.runtime.world.entity(binding)?.locked).toBe(true);
        expect(navigation.runtime.world.entity({ ...binding, model: 20 })?.locked).toBe(false);
        door.use(door, source.game, null, null);
        const moving = navigation.runtime.world.entity(binding);
        expect(moving?.locked).toBe(false);
        expect(moving?.destination).not.toBeNull();
        expect(moving?.destination).not.toEqual(source.game.body(door).origin);
      } else {
        const platform = [...source.game.entities.values()].find(entity => entity.model === "*69");
        if (platform === undefined) throw new Error("Missing authored platform");
        const trigger = [...source.game.entities.values()].find(entity => entity.classname === "plat_trigger" && entity.enemy?.equals(platform.actor.id));
        if (trigger === undefined || trigger.touch === null) throw new Error("Missing source platform trigger");
        const binding = { model: 69, bounds: source.game.body(platform).bounds, raw: [] };
        expect(navigation.runtime.world.entity(binding)?.locked).toBe(false);
        expect(navigation.runtime.world.entity(binding)?.destination).toBeNull();
        const player = simulation.admitPlayer(identity.client(0, 1));
        trigger.touch(trigger, source.game, { self: trigger.actor, other: player.actor, plane: null, surface: null });
        const moving = navigation.runtime.world.entity(binding);
        expect(moving?.destination).not.toBeNull();
        expect(moving?.destination?.z).toBeGreaterThan(source.game.body(platform).origin.z);
        const hurt = [...source.game.entities.values()].find(entity => entity.model === "*9");
        if (hurt === undefined || hurt.use === null) throw new Error("Missing authored toggle hurt trigger");
        const body = simulation.bodies.linked(hurt.actor.id);
        if (body === null) throw new Error("Hurt trigger is not linked");
        expect(navigation.runtime.world.hazard(body.absoluteBounds)).toBe(true);
        hurt.use(hurt, source.game, null, null);
        expect(navigation.runtime.world.hazard(body.absoluteBounds)).toBe(false);
        const admitted = navigation.runtime.graph.edges.filter(edge => navigation.runtime.edgeAllowed(edge));
        hurt.use(hurt, source.game, null, null);
        expect(navigation.runtime.world.hazard(body.absoluteBounds)).toBe(true);
        expect(admitted.filter(edge => !navigation.runtime.edgeAllowed(edge)).length).toBeGreaterThan(0);
        const victim = [...source.game.entities.values()].find(entity => source.game.host.combat.read(entity.actor.id)?.canTakeDamage === true);
        if (victim === undefined) throw new Error("Missing authored damageable actor");
        if (hurt.touch === null) throw new Error("Missing actual hurt callback");
        hurt.touch(hurt, source.game, { self: hurt.actor, other: victim.actor.id, plane: null, surface: null });
        expect(navigation.runtime.world.hazard(body.absoluteBounds)).toBe(false);
      }
    } finally { await content.close(); }
  }, 30000);
