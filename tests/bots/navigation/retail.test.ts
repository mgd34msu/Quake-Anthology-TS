// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openArchive } from "../../../src/content/archive/index.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { DecodedWorld } from "../../../src/contracts/scene.ts";
import { readQ1Bsp } from "../../../src/formats/q1-map/index.ts";
import { decodeQ2Map } from "../../../src/formats/q2-map/index.ts";
import { decodeQ3World } from "../../../src/formats/q3-map/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { aasBBoxAreas, aasTraceAreas, constructNavigation, navigationFromAsset, NavigationRuntime, parseAas, parseKexNavigation } from "../../../src/bots/navigation/index.ts";
import type { NavigationGraph } from "../../../src/bots/navigation/index.ts";
import { navigationWorld, profile } from "./prediction.ts";

const root = resolve(import.meta.dir, "../../../../qfiles");
const fixtures: readonly { archive: string; map: string; nav: string; nodes: number; edges: number; decode(bytes: Uint8Array): DecodedWorld }[] = [
  { archive: "q1/rerelease/id1/pak0.pak", map: "maps/dm4.bsp", nav: "bots/navigation/dm4.nav", nodes: 85, edges: 197, decode: readQ1Bsp },
  { archive: "q2/rerelease/baseq2/pak0.pak", map: "maps/base1.bsp", nav: "bots/navigation/base1.nav", nodes: 416, edges: 1391, decode: decodeQ2Map },
  { archive: "q3a/baseq3/pak0.pk3", map: "maps/q3dm1.bsp", nav: "maps/q3dm1.aas", nodes: 1933, edges: 2029, decode: decodeQ3World },
];
for (const fixture of fixtures) test.skipIf(!existsSync(resolve(root, fixture.archive)))(`${fixture.map}: authored and constructed routes use actual selected movement and shared collision`, async () => {
  const archive = await openArchive(resolve(root, fixture.archive));
  try {
    const mapEntry = archive.findEntries(fixture.map)[0], navEntry = archive.findEntries(fixture.nav)[0];
    if (mapEntry === undefined || navEntry === undefined) throw new Error("Required supplied map/navigation asset missing");
    const bytes = await archive.readEntry(mapEntry), geometry = fixture.decode(bytes), scene = createSceneQueries(geometry), world = navigationWorld(scene);
    const map = { name: fixture.map, format: geometry.kind, digest: createContentDigest(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")) };
    const navBytes = await archive.readEntry(navEntry), asset = fixture.nav.endsWith(".aas") ? parseAas(navBytes, fixture.nav) : parseKexNavigation(navBytes, fixture.nav);
    expect(asset.kind === "aas" ? asset.areas.length : asset.nodes.length).toBe(fixture.nodes);
    expect(asset.kind === "aas" ? asset.reachability.length : asset.links.length).toBe(fixture.edges);
    if (asset.kind === "aas") {
      const start = asset.areas[2], end = asset.areas[4];
      if (start === undefined || end === undefined) throw new Error("Missing source AAS fixture areas");
      expect(aasTraceAreas(asset, start.center, end.center, 10).map(crossing => crossing.area)).toEqual([2, 3, 4]);
      expect(aasBBoxAreas(asset, { min: start.center, max: start.center })).toEqual([2]);
    }
    const authored = navigationFromAsset(map, asset, profile, world);
    if (asset.kind === "nav3") {
      const runtime = new NavigationRuntime(authored, world), crouch = authored.edges.find(edge => edge.id === 486);
      if (crouch === undefined) throw new Error("Missing base1 source crouch reachability");
      expect(crouch.mode).toBe("crouch");
      expect(runtime.route({ start: crouch.start, goal: crouch.end, startNode: crouch.from, goalNode: crouch.to,
        edgeFilter: edge => edge.id === crouch.id }).kind).toBe("route");
      const standingOnly = { ...authored, profile: { ...profile, capabilities: new Set([...profile.capabilities].filter(mode => mode !== "crouch")) } };
      expect(new NavigationRuntime(standingOnly, world).edgeAllowed(crouch)).toBe(false);
    }
    const generated = constructNavigation({ geometry, map, profile, world, spacing: 64, linkDistance: 100 });
    expect(generated.asset).toBeNull();
    expect(generated.nodes.length).toBeGreaterThan(20);
    expect(generated.edges.length).toBeGreaterThan(20);
    const obstacleOwner = createIdentityOwner("navigation-obstacle");
    const qualify = (graph: NavigationGraph): void => {
      const runtime = new NavigationRuntime(graph, world);
      for (const edge of graph.edges) {
        const length = Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y, edge.end.z - edge.start.z);
        if (edge.mode !== "walk" || edge.entity !== null || length < (graph.asset?.kind === "aas" ? 8 : 24) || length > 100 || !runtime.edgeAllowed(edge)) continue;
        const before = world.commands;
        const result = runtime.route({ start: edge.start, goal: edge.end, startNode: edge.from, goalNode: edge.to, edgeFilter: candidate => candidate.id === edge.id });
        if (result.kind !== "route") continue;
        let continuous = false;
        for (const next of runtime.outgoing(edge.to).filter(candidate => candidate.mode === "walk" && candidate.to !== edge.from && candidate.entity === null).slice(0, 12)) {
          const chain = runtime.route({ start: edge.start, goal: next.end, startNode: edge.from, goalNode: next.to,
            edgeFilter: candidate => candidate.id === edge.id || candidate.id === next.id, maximumSearches: 2 });
          if (chain.kind === "route" && chain.route.edges.length === 2) {
            expect(chain.route.edges.map(value => value.id)).toEqual([edge.id, next.id]);
            continuous = true; break;
          }
        }
        if (!continuous) continue;
        expect(world.commands).toBeGreaterThan(before);
        expect(result.route.points.length).toBeGreaterThan(2);
        expect(result.route.travelSeconds).toBeGreaterThan(0);
        expect(runtime.routeStillValid(result.route)).toBe(true);
        runtime.blockEdge(edge.id, "test shared-world obstacle notification");
        expect(runtime.routeStillValid(result.route)).toBe(false);
        expect(runtime.route({ start: edge.start, goal: edge.end, startNode: edge.from, goalNode: edge.to, edgeFilter: candidate => candidate.id === edge.id }).kind).toBe("unreachable");
        runtime.blockEdge(edge.id, null);
        world.revision++;
        expect(runtime.routeStillValid(result.route)).toBe(false);
        const actor = obstacleOwner.actor(1, 0), origin = edge.end;
        const bounds = { min: { x: -24, y: -24, z: -24 }, max: { x: 24, y: 24, z: 32 } };
        scene.link({ actor, state: { origin, angles: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, bounds, ground: null },
          absoluteBounds: { min: { x: origin.x - 25, y: origin.y - 25, z: origin.z - 25 }, max: { x: origin.x + 25, y: origin.y + 25, z: origin.z + 33 } }, linkCount: 1 },
        { family: "q3", shape: { kind: "box" }, contents: 0x02000000, owner: null, role: "solid", monster: false, deadMonster: false });
        world.revision++;
        expect(runtime.route({ start: edge.start, goal: edge.end, startNode: edge.from, goalNode: edge.to, edgeFilter: candidate => candidate.id === edge.id }).kind).toBe("unreachable");
        scene.unlink(actor);
        world.revision++;
        expect(runtime.route({ start: edge.start, goal: edge.end, startNode: edge.from, goalNode: edge.to, edgeFilter: candidate => candidate.id === edge.id }).kind).toBe("route");
        return;
      }
      throw new Error(`No actual movement route admitted for ${graph.asset?.kind ?? "constructed"} ${fixture.map}`);
    };
    qualify(authored);
    qualify(generated);
  } finally { archive.close(); }
}, 30000);
