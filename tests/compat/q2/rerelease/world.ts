// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActorId, OwnedActor } from "../../../../src/contracts/identity.ts";
import type { Vec3 } from "../../../../src/contracts/math.ts";
import { corpusFile } from "../../../support/corpus.ts";

import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { NumericProfile } from "../../../../src/contracts/numeric.ts";
import type { DamageDecision, DamageOutcome } from "../../../../src/contracts/gameplay.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { parseEntities } from "../../../../src/core/common-parse.ts";
import { decodeQ2Map } from "../../../../src/formats/q2-map/index.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable } from "../../../../src/world/actors/index.ts";
import { createSceneQueries } from "../../../../src/world/collision/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../../src/world/gameplay/index.ts";
import { edictLayout, fieldOffset } from "../../../../src/compat/q2/rerelease/layouts.ts";
import { guestPointer } from "../../../../src/compat/q2/rerelease/module.ts";
import { rereleaseLinkBounds } from "../../../../src/compat/q2/rerelease/spatial.ts";
import { RereleaseSourceClient, RereleaseSourceEdict } from "../../../../src/compat/q2/rerelease/source-state.ts";
import { retailRereleaseClientProfile } from "../../../../src/compat/q2/rerelease/client-profile.ts";
import type { RereleaseQ2GuestHost, RereleaseSemanticBindings } from "../../../../src/compat/q2/rerelease/host.ts";
import type { ActorCollision } from "../../../../src/world/spatial/index.ts";
import type { LinkedBody } from "../../../../src/contracts/world.ts";
import type { RereleaseGuestServicesOptions } from "../../../../src/app/bootstrap/simulation/rerelease-guest-services-contract.ts";

function unavailable(): never {
  throw new Error("The native map fixture has no foreign actors or combat transport");
}
const numeric: NumericProfile = {
  id: "q2-rerelease:source-f32",
  arithmetic: { kind: "binary32", round: "each-operation" },
  scalarStorage: "binary32",
  floatToInt: "checked-c-truncation",
  integerOverflow: "wrap32",
};
export async function nativeWorld() {
  const archive = await openArchive(corpusFile("q2/rerelease/baseq2/pak0.pak"));
  const world = await (async () => {
    try {
      const entry = archive.findEntries("maps/base1.bsp")[0];
      if (entry === undefined) throw new Error("Missing rerelease base1.bsp");
      return decodeQ2Map(await archive.readEntry(entry), entry.path);
    } finally {
      archive.close();
    }
  })();
  const start = parseEntities(world.entities).find(entity => entity.get("classname") === "info_player_start");
  if (start === undefined) throw new Error("Retail base1 has no player start");
  const scene = createSceneQueries(world),
    actors = new SessionActorRegistry(createIdentityOwner("rerelease-native-world"));
  let host: RereleaseQ2GuestHost | null = null;
  const owner = (): RereleaseQ2GuestHost => {
    if (host === null) throw new Error("Native world host is not attached");
    return host;
  };
  const raw = (actor: ActorId) => {
    const source = actors.sourceOf(actor);
    if (source === null) return unavailable();
    return owner().module.entities().atSlot(source.slot);
  };
  const callbacks = new ActorCallbackTable(actors);
  const native = (actor: ActorId): boolean => actors.sourceOf(actor)?.provider === owner().module.memory.module.id;
  const collisions = new Map<ActorId, ActorCollision>();
  const worldId = (): ActorId | null => (host === null ? null : (host.actor(host.module.entities().atSlot(0))?.id ?? null));
  // Linking follows SharedPhysics: the collision handed off by prepareLink is exact, the world edict is never linked, and any other body (a foreign test actor) links as a plain solid box.
  const linked = (body: LinkedBody): undefined => {
    const exact = collisions.get(body.actor),
      world = worldId();
    if (exact !== undefined) {
      scene.link(body, exact);
      return undefined;
    }
    if (world !== null && world.equals(body.actor)) {
      scene.unlink(body.actor);
      return undefined;
    }
    scene.link(body, { family: "q3", shape: { kind: "box" }, contents: 0x2000000, owner: null, role: "solid", monster: false, deadMonster: false });
    return undefined;
  };
  const bodies = new SharedBodyTable(actors, {
    absoluteBounds: (actor, state) =>
      native(actor.id)
        ? rereleaseLinkBounds(state, raw(actor.id).bytes.getUint8(fieldOffset(edictLayout, "solid")))
        : {
            min: { x: state.origin.x + state.bounds.min.x, y: state.origin.y + state.bounds.min.y, z: state.origin.z + state.bounds.min.z },
            max: { x: state.origin.x + state.bounds.max.x, y: state.origin.y + state.bounds.max.y, z: state.origin.z + state.bounds.max.z },
          },
    onUnlink: actor => {
      scene.unlink(actor);
      return undefined;
    },
    onLink: body => linked(body),
  });
  actors.onRelease(actor => {
    collisions.delete(actor.id);
    return undefined;
  });
  scene.bindActorState(actor => bodies.read(actor));
  const decisions: DamageDecision[] = [],
    outcomes: DamageOutcome[] = [];
  const combat = new GameplayAuthority(actors, callbacks, {
    impulse: (actor, impulse) => {
      const body = bodies.read(actor.id);
      if (body === null) throw new Error("Damage impulse has no body");
      bodies.write(actor, { ...body, velocity: { x: body.velocity.x + impulse.x, y: body.velocity.y + impulse.y, z: body.velocity.z + impulse.z } });
      return undefined;
    },
    beforeReaction: (_actor, decision) => {
      decisions.push(decision);
      return undefined;
    },
    confirmed: outcome => {
      outcomes.push(outcome);
      return undefined;
    },
  });
  const visible = (kind: "pvs" | "phs", first: Vec3, second: Vec3): boolean => {
    const a = scene.pointLeaf(first),
      b = scene.pointLeaf(second);
    return scene.clusterVisible(scene.leafCluster(a), scene.leafCluster(b), kind) && scene.areasConnected(scene.leafArea(a), scene.leafArea(b));
  };
  let traceCalls = 0;
  const engine: RereleaseGuestServicesOptions["engine"] = {
    actors,
    bodies,
    callbacks,
    combat,
    inventory: new SharedInventoryTable(actors),
    trace: request => {
      traceCalls++;
      return scene.trace({
        start: request.start,
        end: request.end,
        shape: request.bounds === null ? { kind: "point" } : { kind: "box", bounds: request.bounds },
        target: { kind: "world" },
        policy: { kind: "q2", contentsMask: request.mask, leafContents: "merged" },
        numeric,
        passActor: request.ignore,
      });
    },
    pointContents: point => {
      const contents = scene.pointContents({
        point,
        target: { kind: "world" },
        policy: { kind: "q2", contentsMask: 0xffffffff, leafContents: "merged" },
        numeric,
        passActor: null,
      });
      if (contents.kind !== "q2") throw new Error("Expected source Q2 contents");
      return contents.merged;
    },
    setAreaPortal: (portal, open) => {
      scene.setAreaPortalState(portal, open);
      return undefined;
    },
    inlineModelBounds: model => scene.modelBounds(model),
    setSolid: actor => {
      const body = bodies.linked(actor.id);
      return body === null ? undefined : linked(body);
    },
    worldActor: () => {
      const id = worldId();
      if (id === null) throw new Error("Native world edict is not active");
      return id;
    },
    emit: () => undefined,
    inPvs: (first, second) => visible("pvs", first, second),
    inPhs: (first, second) => visible("phs", first, second),
  };
  const foreignRequests: ActorId[] = [];
  const semantics: RereleaseSemanticBindings = {
    generation: view => view.bytes.getInt32(1472, true),
    foreignAddress: actor => {
      foreignRequests.push(actor);
      return unavailable();
    },
    bind: (view, _actor, module) => {
      const source = new RereleaseSourceEdict(view, module),
        address = source.client;
      const client = address === null ? null : new RereleaseSourceClient(address, module, retailRereleaseClientProfile);
      return {
        body: source.body({
          actor: address => owner().actor(module.entities().fromPointer(address))?.id ?? null,
          address: actor => owner().addressForActor(actor),
        }),
        combat: null,
        powerArmorCells: client?.powerArmorCells() ?? null,
        inventory:
          client?.inventory([
            { item: "q2:cells", sourceIndex: 30, capacity: { kind: "ammo", sourceIndex: 4 } },
            { item: "q2:flechettes", sourceIndex: 34, capacity: { kind: "ammo", sourceIndex: 8 } },
            { item: "q2:blaster", sourceIndex: 8, capacity: { kind: "fixed", count: 1 } },
            { item: "q2:compass", sourceIndex: 83, capacity: { kind: "fixed", count: 1 } },
          ]) ?? null,
        callbacks: {
          think: () => {
            source.call("think", []);
            return undefined;
          },
          use: (_self, other, activator) => {
            source.call("use", [
              guestPointer(other === null ? null : owner().addressForActor(other)),
              guestPointer(activator === null ? null : owner().addressForActor(activator)),
            ]);
            return undefined;
          },
          touch: null,
          pain: null,
          die: null,
        },
      };
    },
  };
  return {
    engine,
    semantics,
    scene,
    collision: (actor: OwnedActor, collision: ActorCollision): undefined => {
      collisions.set(actor.id, collision);
      const body = bodies.linked(actor.id);
      return body === null ? undefined : linked(body);
    },
    world,
    outcomes,
    foreignRequests,
    decisions,
    origin: start.get("origin") ?? "",
    get traceCalls() {
      return traceCalls;
    },
    attach: (value: RereleaseQ2GuestHost) => {
      host = value;
    },
  };
}
