// SPDX-License-Identifier: GPL-2.0-or-later
/* API 2023 guest projection through the shared native Q2 server channel. GPL-2.0-or-later. */
import type { Vec3 } from "../../../contracts/math.ts";
import { expandCommandMacros } from "../../../core/commands/text.ts";
import { blockChecksum } from "../../../core/md4.ts";
import { addressKey } from "../../../network/common/endpoint.ts";
import { fromQ2Entity, fromQ2Player, toQ2RereleaseCommand } from "../../../network/q2/adapters.ts";
import { q2Userinfo } from "../../../content/q2/base/player/index.ts";
import { createQ2ApplicationDownloads } from "../network/q2-downloads.ts";
import { q2GameCallback } from "../network/types.ts";
import type { Q2ApplicationAdmission, Q2ApplicationPlayer, Q2ApplicationServerHost } from "../network/types.ts";
import type { Q2ApplicationServerBindingOptions } from "./network.ts";
import { createQ2GuestHostCore } from "./network-q2-guest-core.ts";
import type { RereleaseGuestWorld } from "./rerelease-guest-world.ts";
import { Q2ServerMessageReader, Q2WireCodec, encodeQ2ServerEvent } from "../../../network/q2/index.ts";
import type { Q2ProtocolIdentity } from "../../../contracts/protocol.ts";
import { q2ApplicationLayout } from "../network/q2-layout.ts";
import type { RereleaseGuestMessage } from "./rerelease-guest-services-contract.ts";

export async function createRereleaseNativeQ2ApplicationServerHost(
  options: Q2ApplicationServerBindingOptions & { readonly world: RereleaseGuestWorld },
): Promise<Q2ApplicationServerHost> {
  if (options.protocol.kind !== "q2-rerelease" && options.protocol.kind !== "q2-kex")
    throw new Error("Rerelease guest server requires protocol1038 or KEX2023");
  const protocol = options.protocol,
    layout = q2ApplicationLayout(protocol);
  const { simulation, world } = options,
    scene = simulation.scene,
    geometry = options.content.world;
  const cvars = world.services.options.cvars,
    maxClients = world.services.options.maxClients,
    numeric = world.services.options.numeric;
  const map = world.services.options.mapPath.replace(/^maps\//, "").replace(/\.bsp$/, "");
  const downloads = createQ2ApplicationDownloads(await options.content.forContent(options.content.recipe.map.entities.content), cvars, "rerelease");
  const core = createQ2GuestHostCore({ options, world, cvars, scene, geometry, maxClients, map, dialect: "q2-rerelease" });
  const { players, requirePlayer } = core;
  core.registerServerVariables(String(protocol.version));
  world.services.setConfigstring(layout.mapChecksum, String(blockChecksum(await options.content.mounts.read(options.content.recipe.map.geometry))));
  world.services.setConfigstring(layout.maxClients, String(maxClients));
  world.services.setConfigstring(layout.airAccelerate, cvars.variableString("sv_airaccelerate"));
  const transcode = createRereleaseNativeMessageTranscoder(protocol);
  let messages: readonly { readonly source: RereleaseGuestMessage; readonly wire: RereleaseGuestMessage }[] = [];
  let localMessages: typeof messages = [];
  const progressedMessages: { readonly source: RereleaseGuestMessage; readonly wire: RereleaseGuestMessage }[] = [];
  const collectMessages = () => world.rawMessages().map(source => ({ source, wire: { ...source, bytes: transcode(source.bytes) } }));
  const localRecipients = new Set<Q2ApplicationPlayer["client"]>();
  const nativeState = (player: Q2ApplicationPlayer) => {
    requirePlayer(player);
    return world.playerState(player.sourceEntity);
  };
  const viewOrigin = (player: Q2ApplicationPlayer): Vec3 => {
    const state = nativeState(player);
    return {
      x: numeric.add(state.movement.origin.x, state.viewOffset.x),
      y: numeric.add(state.movement.origin.y, state.viewOffset.y),
      z: numeric.add(state.movement.origin.z, state.viewOffset.z),
    };
  };
  const playerMessages = (player: Q2ApplicationPlayer, incoming = messages): typeof messages => {
    requirePlayer(player);
    return incoming.filter(({ source }) => core.audienceIncludes(player, source.audience));
  };
  return {
    ...(options.rejects === undefined ? {} : { rejects: options.rejects }),
    protocol: options.protocol,
    messageOptions: { maxConfigStrings: layout.maxConfigStrings, inventorySlots: 256 },
    maxClients,
    downloads,
    ...(options.administration === undefined ? {} : { administration: options.administration }),
    ...(options.masters === undefined ? {} : { masters: options.masters }),
    ...core.shared,
    admit: (from, request) =>
      q2GameCallback<Q2ApplicationAdmission>(() => {
        if (request.protocol.kind !== protocol.kind || request.protocol.version !== protocol.version)
          return { kind: "rejected", reason: "Native game and requested wire editions differ" };
        const slot = core.freeSlot();
        if (slot === null) return { kind: "rejected", reason: "Server is full" };
        const client = options.session.createClient(slot);
        client.connect(from.kind === "loopback" ? "loopback" : "remote");
        const info = new Map(q2Userinfo(request.userinfo));
        if (request.protocol.kind === "q2-kex") {
          const suffix = `_${request.splitSeat ?? 0}`;
          for (const [key, value] of [...info]) if (key.endsWith(suffix)) info.set(key.slice(0, -suffix.length), value);
        }
        info.set("ip", addressKey(from));
        const socialId = request.socialIds?.[0] ?? "";
        if (socialId !== "" && options.playerIdentity === undefined) {
          options.session.closeClient(client.id);
          return { kind: "rejected", reason: "Server has no rerelease social identity owner" };
        }
        let connected = false;
        try {
          options.playerIdentity?.(client.id, { seat: request.splitSeat ?? 0, socialId });
          const result = world.connect(slot + 1, [...info].map(([key, value]) => `\\${key}\\${value}`).join(""), socialId, false);
          if (!result.allowed) {
            options.playerIdentity?.(client.id, null);
            options.session.closeClient(client.id);
            return { kind: "rejected", reason: q2Userinfo(result.userinfo).get("rejmsg") ?? "Connection refused" };
          }
          connected = true;
          const actor = simulation.registerQ2NativeClient(client.id),
            player = { client: client.id, actor: actor.id, sourceEntity: slot + 1 };
          players.set(slot, player);
          return { kind: "accepted", player };
        } catch (error) {
          try {
            if (connected) world.disconnect(slot + 1);
          } catch (cleanup) {
            throw new AggregateError([error, cleanup], "Q2 guest connect cleanup failed");
          } finally {
            try {
              options.playerIdentity?.(client.id, null);
            } finally {
              options.session.closeClient(client.id);
            }
          }
          throw error;
        }
      }),
    disconnect: player =>
      core.disconnect(player, () => {
        options.playerIdentity?.(player.client, null);
      }),
    gameState: player => {
      requirePlayer(player);
      const configs = new Map(world.configstrings());
      return {
        data: {
          servercount: 1,
          attractloop: false,
          gamedir: options.content.catalog.product(simulation.recipe.map.entities.content).expectation.contentDirectory.split("/").at(-1) ?? "baseq2",
          clientnum: player.sourceEntity - 1,
          levelname: configs.get(0) ?? map,
          serverState: 2,
          serverFps: 1000 / world.services.options.frameMilliseconds,
        },
        configStrings: configs,
        baselines: new Map(
          world
            .entityStates()
            .filter(state => state.modelIndexes.some(index => index !== 0) || state.sound !== 0 || state.effects !== 0n)
            .map(state => [state.number, fromQ2Entity(state)]),
        ),
      };
    },
    frame: (player, output) => {
      const origin = viewOrigin(player),
        leaf = scene.pointLeaf(origin),
        area = scene.leafArea(leaf);
      const clusters = [
        ...new Set(
          scene
            .boxLeaves(
              {
                min: { x: numeric.subtract(origin.x, 8), y: numeric.subtract(origin.y, 8), z: numeric.subtract(origin.z, 8) },
                max: { x: numeric.add(origin.x, 8), y: numeric.add(origin.y, 8), z: numeric.add(origin.z, 8) },
              },
              64,
            )
            .leaves.map(index => scene.leafCluster(index)),
        ),
      ];
      const entities = world
        .entityStates()
        .filter(state => {
          if (!state.modelIndexes.some(index => index !== 0) && state.effects === 0n && state.sound === 0 && state.event === 0) return false;
          if (state.number === player.sourceEntity) return true;
          const info = world.entityInfo(state.number);
          if ((info.serverFlags & 1024) !== 0 || cvars.variableValue("sv_novis") !== 0) return true;
          if (!scene.areasConnected(area, info.areas[0]) && !scene.areasConnected(area, info.areas[1])) return false;
          const visible = (kind: "pvs" | "phs"): boolean =>
            info.clusters === null
              ? core.headnodeVisible(info.headnode, clusters, kind)
              : info.clusters.some(target => clusters.some(from => scene.clusterVisible(from, target, kind)));
          const beam = (state.renderEffects & 128) !== 0,
            shadow = (state.renderEffects & 16384) !== 0;
          if (!visible(beam || shadow || state.sound !== 0 ? "phs" : "pvs")) return false;
          const dx = numeric.subtract(origin.x, state.origin.x),
            dy = numeric.subtract(origin.y, state.origin.y),
            dz = numeric.subtract(origin.z, state.origin.z);
          const distance = numeric.squareRoot(numeric.add(numeric.add(numeric.multiply(dx, dx), numeric.multiply(dy, dy)), numeric.multiply(dz, dz)));
          if (state.sound !== 0) {
            const attenuation =
              state.loopAttenuation === -1
                ? 0
                : state.loopAttenuation > 0 && state.loopAttenuation !== 3
                  ? numeric.multiply(state.loopAttenuation, 0.0006)
                  : 0.003;
            if (numeric.multiply(numeric.subtract(distance, 80), attenuation) > 1) return state.modelIndexes[0] !== 0 && (beam || visible("pvs"));
            return true;
          }
          return state.modelIndexes[0] !== 0 || shadow || distance <= 400;
        })
        .map(state => {
          const wire = fromQ2Entity(state);
          if (world.entityInfo(state.number).ownerSlot === player.sourceEntity) wire.solid = 0;
          return wire;
        });
      return {
        serverFrame: output.snapshot.frame.frame,
        deltaFrame: -1,
        suppressedCount: 0,
        areaBits: scene.areaBits(area),
        player: fromQ2Player(nativeState(player)),
        entities,
      };
    },
    observe: () => {
      const air = cvars.variableString("sv_airaccelerate");
      if (world.configstrings().get(layout.airAccelerate) !== air) world.services.setConfigstring(layout.airAccelerate, air);
      localRecipients.clear();
      localMessages = collectMessages();
      messages = [...progressedMessages, ...localMessages];
      progressedMessages.length = 0;
    },
    observeProgress: () => {
      localRecipients.clear();
      localMessages = collectMessages();
      progressedMessages.push(...localMessages);
    },
    localMessages: player => {
      requirePlayer(player);
      if (localRecipients.has(player.client)) return [];
      localRecipients.add(player.client);
      return playerMessages(player, localMessages).map(message => message.source);
    },
    rawMessages: player => playerMessages(player).map(message => message.wire),
    sourceMessages: player => playerMessages(player).map(message => message.source),
    events: () => [],
    input: (player, wire, sequence) =>
      q2GameCallback(() => {
        requirePlayer(player);
        const command = toQ2RereleaseCommand(wire, protocol.kind === "q2-kex" ? wire.serverFrame : sequence);
        simulation.observeClientCommand({ actor: player.actor, source: { kind: "remote-client", client: player.client }, sequence, command });
        world.think(player.sourceEntity, command);
        return null;
      }),
    expandClientCommand: text => expandCommandMacros(text, name => cvars.variableString(name), options.print),
    print: options.print,
  };
}

/** Game imports write FLOAT/1038 records; KEX clients receive newly encoded KEX records. */
export function createRereleaseNativeMessageTranscoder(protocol: Q2ProtocolIdentity): (bytes: Uint8Array) => Uint8Array {
  if (protocol.kind !== "q2-rerelease" && protocol.kind !== "q2-kex") throw new Error("Native rerelease messages require protocol1038 or KEX2023");
  const reader = new Q2ServerMessageReader({ kind: "q2-rerelease", version: 1038 }, { maxConfigStrings: 12448, inventorySlots: 256 });
  const wire = new Q2WireCodec(protocol);
  return bytes => {
    const records = reader.read(bytes).map(record => {
      if (record.event.kind === "frame" || record.event.kind === "private")
        throw new Error(`Native game emitted an unsupported engine-owned ${record.event.kind} message`);
      return encodeQ2ServerEvent(wire, record.event);
    });
    const result = new Uint8Array(records.reduce((length, record) => length + record.length, 0));
    let offset = 0;
    for (const record of records) {
      result.set(record, offset);
      offset += record.length;
    }
    return result;
  };
}
