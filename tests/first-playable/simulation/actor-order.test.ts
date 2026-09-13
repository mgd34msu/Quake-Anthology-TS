import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { OwnedActor } from "../../../src/contracts/identity.ts";
import { SessionActorRegistry } from "../../../src/world/actors/registry.ts";
import { orderedActorTurns } from "../../../src/app/bootstrap/simulation/runtime.ts";

type Position = readonly [number, number];
type Turns = (actors: SessionActorRegistry, positionOf: (actor: OwnedActor) => Position, visited: Set<OwnedActor>) => Generator<OwnedActor, void, unknown>;

function* originalTurns(actors: SessionActorRegistry, positionOf: (actor: OwnedActor) => Position, visited: Set<OwnedActor>): Generator<OwnedActor, void, unknown> {
  let cursor: Position | null = null;
  for (;;) {
    const previous = cursor;
    let next: { readonly actor: OwnedActor; readonly position: Position } | null = null;
    for (const observation of actors.observations()) {
      const candidate = actors.resolveOwned(observation.id);
      if (candidate === null || visited.has(candidate)) continue;
      const position = positionOf(candidate);
      if (previous !== null && (position[0] < previous[0] || position[0] === previous[0] && position[1] <= previous[1])) continue;
      if (next === null || position[0] < next.position[0] || position[0] === next.position[0] && position[1] < next.position[1]) next = { actor: candidate, position };
    }
    if (next === null) return;
    cursor = next.position;
    visited.add(next.actor);
    yield next.actor;
  }
}

function exercise(turns: Turns): readonly string[][] {
  const actors = new SessionActorRegistry(createIdentityOwner("actor order"));
  const labels = new Map<OwnedActor, string>();
  function spawn(slot: number, label: string, owner: "q1:game" | "q2:game" = "q1:game"): OwnedActor {
    const actor = actors.allocateAtSource(owner, slot, "world:test"); labels.set(actor, label); return actor;
  }
  spawn(10, "first");
  const removed = spawn(40, "removed");
  const nested = spawn(50, "nested");
  spawn(60, "last");
  spawn(1, "other-provider", "q2:game");
  const positionOf = (actor: OwnedActor): Position => [actor.owner === "q1:game" ? 0 : 1, actors.sourceOf(actor.id)?.slot ?? actor.id.slot];
  const rounds: string[][] = [];
  const release = actors.onRelease(actor => {
    if (actor === removed) spawn(35, "reentrant-reused-host-slot");
    return undefined;
  });
  for (let round = 0; round < 2; round++) {
    const visited = new Set<OwnedActor>(), log: string[] = [];
    for (const actor of turns(actors, positionOf, visited)) {
      const label = labels.get(actor);
      if (label === undefined) throw new Error("Missing actor label");
      log.push(label);
      if (round !== 0) continue;
      if (label === "first") {
        spawn(5, "behind-cursor");
        spawn(20, "ahead-cursor");
        actors.release(removed);
        visited.add(nested);
      } else if (label === "ahead-cursor") {
        actors.release(actor);
        spawn(20, "same-source-new-lifetime");
        spawn(25, "new-source-binding");
      } else if (label === "other-provider") spawn(70, "earlier-provider");
    }
    rounds.push(log);
  }
  release(); actors.close(); return rounds;
}

test("cached source traversal matches original live spawn, release, reuse and nested execution semantics", () => {
  const actual = exercise(orderedActorTurns);
  expect(actual).toEqual(exercise(originalTurns));
  expect(actual[0]).toEqual(["first", "ahead-cursor", "new-source-binding", "reentrant-reused-host-slot", "last", "other-provider"]);
  expect(actual[1]).toEqual(["behind-cursor", "first", "same-source-new-lifetime", "new-source-binding", "reentrant-reused-host-slot", "nested", "last", "earlier-provider", "other-provider"]);
});

test("equal ordering positions preserve host-slot tie selection and strict cursor", () => {
  for (const turns of [originalTurns, orderedActorTurns]) {
    const actors = new SessionActorRegistry(createIdentityOwner("equal actor positions"));
    const first = actors.allocate("q1:game", "world:first");
    actors.allocate("q1:game", "world:second");
    expect([...turns(actors, () => [0, 1], new Set())]).toEqual([first]);
    actors.close();
  }
});

test("registry revision covers source association, restoration and reentrant release", () => {
  const actors = new SessionActorRegistry(createIdentityOwner("revision"));
  const initial = actors.revision;
  const actor = actors.allocateAtSource("q1:game", 9, "world:test");
  expect(actors.revision).toBeGreaterThan(initial + 1);
  const checkpoint = actors.checkpoint(), sources = actors.sourceCheckpoint();
  const beforeRelease = actors.revision;
  actors.onRelease(() => { expect(actors.revision).toBeGreaterThan(beforeRelease); return undefined; });
  actors.release(actor);
  const restored = SessionActorRegistry.restore(createIdentityOwner("restored revision"), checkpoint, sources);
  expect(restored.revision).toBeGreaterThan(1);
  expect(restored.atSource("q1:game", 9)).not.toBeNull();
  actors.close(); restored.close();
});
