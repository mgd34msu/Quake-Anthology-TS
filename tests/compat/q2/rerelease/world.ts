// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActorId } from "../../../../src/contracts/identity.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { NumericProfile } from "../../../../src/contracts/numeric.ts";
import type { DamageDecision, DamageOutcome } from "../../../../src/contracts/gameplay.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { parseEntities } from "../../../../src/core/common-parse.ts";
import { decodeQ2Map } from "../../../../src/formats/q2-map/index.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable } from "../../../../src/world/actors/index.ts";
import { createSceneQueries } from "../../../../src/world/collision/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../../src/world/gameplay/index.ts";
import { edictLayout, fieldOffset, guestPointer, rereleaseLinkBounds, rereleaseNetworkSolid, RereleaseSourceClient, RereleaseSourceEdict, retailRereleaseClientProfile } from "../../../../src/compat/q2/rerelease/index.ts";
import type { RereleaseQ2GuestHost, RereleaseQ2HostOptions } from "../../../../src/compat/q2/rerelease/index.ts";

function unavailable(): never { throw new Error("The native map fixture has no foreign actors or combat transport"); }
const numeric: NumericProfile = { id: "q2-rerelease:source-f32", arithmetic: { kind: "binary32", round: "each-operation" }, scalarStorage: "binary32", floatToInt: "checked-c-truncation", integerOverflow: "wrap32" };
export async function nativeWorld(modelName: (index: number) => string | undefined) {
  const archive = await openArchive(new URL("../../../../../qfiles/q2/rerelease/baseq2/pak0.pak", import.meta.url).pathname);
  const world = await (async () => {
    try { const entry = archive.findEntries("maps/base1.bsp")[0]; if (entry === undefined) throw new Error("Missing rerelease base1.bsp"); return decodeQ2Map(await archive.readEntry(entry), entry.path); }
    finally { archive.close(); }
  })();
  const start = parseEntities(world.entities).find(entity => entity.get("classname") === "info_player_start");
  if (start === undefined) throw new Error("Retail base1 has no player start");
  const scene = createSceneQueries(world), actors = new SessionActorRegistry(createIdentityOwner("rerelease-native-world"));
  let host: RereleaseQ2GuestHost | null = null;
  const owner = (): RereleaseQ2GuestHost => { if (host === null) throw new Error("Native world host is not attached"); return host; };
  const raw = (actor: ActorId) => { const source = actors.sourceOf(actor); if (source === null) return unavailable(); return owner().module.entities().atSlot(source.slot); };
  const integer = (actor: ActorId, field: string) => raw(actor).bytes.getUint32(fieldOffset(edictLayout, field), true);
  const callbacks = new ActorCallbackTable(actors);
  const inlineModel = (index: number): number => {
    const name = modelName(index), ordinal = name === "maps/base1.bsp" ? 0 : name?.startsWith("*") ? Number(name.slice(1)) : -1;
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= world.models.length) throw new Error(`Native inline model index ${index} does not resolve into the loaded BSP`);
    return ordinal;
  };
  const native = (actor: ActorId): boolean => actors.sourceOf(actor)?.provider === owner().module.memory.module.id;
  const bodies = new SharedBodyTable(actors, { absoluteBounds: (actor, state) => native(actor.id) ? rereleaseLinkBounds(state, raw(actor.id).bytes.getUint8(fieldOffset(edictLayout, "solid"))) : {
    min: { x: state.origin.x + state.bounds.min.x, y: state.origin.y + state.bounds.min.y, z: state.origin.z + state.bounds.min.z },
    max: { x: state.origin.x + state.bounds.max.x, y: state.origin.y + state.bounds.max.y, z: state.origin.z + state.bounds.max.z },
  }, onUnlink: actor => { scene.unlink(actor); return undefined; }, onLink: body => {
    if (!native(body.actor)) { scene.link(body, { family: "q3", shape: { kind: "box" }, contents: 0x2000000, owner: null, role: "solid", monster: false, deadMonster: false }); return undefined; }
    const view = raw(body.actor), solid = view.bytes.getUint8(fieldOffset(edictLayout, "solid")), flags = integer(body.actor, "svflags");
    if (view.slot === 0 || solid === 0) { scene.unlink(body.actor); return undefined; }
    const ownerAddress = owner().module.memory.readPointer(owner().module.memory.offset(view.address, BigInt(fieldOffset(edictLayout, "owner"))));
    const owningActor = ownerAddress === null ? null : owner().actor(owner().module.entities().fromPointer(ownerAddress))?.id ?? null;
    scene.link(body, { family: "q2", shape: solid === 3 ? { kind: "model", model: inlineModel(integer(body.actor, "s.modelindex")) } : { kind: "box" }, contents: solid === 3 ? 1 : (flags & 2) !== 0 ? 0x4000000 : (flags & 8) !== 0 ? 0x40000000 : (flags & 128) !== 0 ? 0x80000000 : 0x2000000, owner: owningActor, role: solid === 1 ? "trigger" : "solid", monster: (flags & 4) !== 0, deadMonster: (flags & 2) !== 0 });
    return undefined;
  } });
  scene.bindActorState(actor => bodies.read(actor));
  const decisions: DamageDecision[] = [], outcomes: DamageOutcome[] = [];
  const combat = new GameplayAuthority(actors, callbacks, {
    impulse: (actor, impulse) => {
      const body = bodies.read(actor.id); if (body === null) throw new Error("Damage impulse has no body");
      bodies.write(actor, { ...body, velocity: { x: body.velocity.x + impulse.x, y: body.velocity.y + impulse.y, z: body.velocity.z + impulse.z } }); return undefined;
    },
    beforeReaction: (_actor, decision) => { decisions.push(decision); return undefined; },
    confirmed: outcome => { outcomes.push(outcome); return undefined; },
  });
  let traceCalls = 0;
  const engine: RereleaseQ2HostOptions["engine"] = { actors, bodies, callbacks, combat, inventory: new SharedInventoryTable(actors),
    trace: request => { traceCalls++; return scene.trace({ start: request.start, end: request.end, shape: request.bounds === null ? { kind: "point" } : { kind: "box", bounds: request.bounds }, target: { kind: "world" }, policy: { kind: "q2", contentsMask: request.mask, leafContents: "merged" }, numeric, passActor: request.ignore }); },
    pointContents: point => { const contents = scene.pointContents({ point, target: { kind: "world" }, policy: { kind: "q2", contentsMask: 0xffffffff, leafContents: "merged" }, numeric, passActor: null }); if (contents.kind !== "q2") throw new Error("Expected source Q2 contents"); return contents.merged; },
    setAreaPortal: (portal, open) => { scene.setAreaPortalState(portal, open); return undefined; }, inlineModelBounds: model => scene.modelBounds(model),
    setSolid: actor => { scene.unlink(actor.id); return undefined; },
    worldActor: () => { const actor = owner().actor(owner().module.entities().atSlot(0)); if (actor === null) throw new Error("Native world edict is not active"); return actor.id; },
  };
  const spatial: RereleaseQ2HostOptions["spatial"] = {
    areasConnected: (first, second) => scene.areasConnected(first, second),
    visibility: (kind, first, second, portals) => { const a = scene.pointLeaf(first), b = scene.pointLeaf(second); return scene.clusterVisible(scene.leafCluster(a), scene.leafCluster(b), kind) && (!portals || scene.areasConnected(scene.leafArea(a), scene.leafArea(b))); },
    surfaceId: surface => { const index = world.textureInfo.findIndex(value => value === surface); if (index < 0) throw new Error("Trace surface is not part of the loaded BSP"); return index; },
    boxEdicts: (min, max, area) => scene.queryActors({ min, max }, area === 1 ? "solid" : "trigger").map(value => value.body.actor), inlineModel,
    linkMetadata: (actor, view) => {
      const linked = bodies.linked(actor.id); if (linked === null) throw new Error("Native body lacks a link snapshot");
      let area = 0, area2 = 0;
      for (const leaf of scene.boxLeaves(linked.absoluteBounds, 128).leaves) { const next = scene.leafArea(leaf); if (next !== 0) { if (area !== 0 && area !== next) area2 = next; else area = next; } }
      const solid = view.bytes.getUint8(fieldOffset(edictLayout, "solid"));
      return { area, area2, networkSolid: rereleaseNetworkSolid(linked.state.bounds, solid, integer(actor.id, "svflags")) };
    },
  };
  const semantics: RereleaseQ2HostOptions["semantics"] = { generation: view => view.bytes.getInt32(1472, true), foreignAddress: unavailable,
    bind: (view, _actor, module) => {
      const source = new RereleaseSourceEdict(view, module), address = source.client;
      const client = address === null ? null : new RereleaseSourceClient(address, module, retailRereleaseClientProfile);
      return { body: source.body({ actor: address => owner().actor(module.entities().fromPointer(address))?.id ?? null, address: actor => owner().addressForActor(actor) }), combat: null,
        powerArmorCells: client?.powerArmorCells() ?? null,
        inventory: client?.inventory([{ item: "q2:cells", sourceIndex: 30, capacity: { kind: "ammo", sourceIndex: 4 } }, { item: "q2:flechettes", sourceIndex: 34, capacity: { kind: "ammo", sourceIndex: 8 } }, { item: "q2:blaster", sourceIndex: 8, capacity: { kind: "fixed", count: 1 } }, { item: "q2:compass", sourceIndex: 83, capacity: { kind: "fixed", count: 1 } }]) ?? null,
        callbacks: { think: () => { source.call("think", []); return undefined; },
          use: (_self, other, activator) => { source.call("use", [guestPointer(other === null ? null : owner().addressForActor(other)), guestPointer(activator === null ? null : owner().addressForActor(activator))]); return undefined; }, touch: null, pain: null, die: null } };
    },
  };
  return { engine, spatial, semantics, scene, world, outcomes, decisions, origin: start.get("origin") ?? "", get traceCalls() { return traceCalls; }, attach: (value: RereleaseQ2GuestHost) => { host = value; } };
}
