import { expect, test } from "bun:test";
import type { SceneFlare } from "../../src/contracts/flare.ts";
import type { SceneCamera } from "../../src/contracts/render.ts";
import { anglesToAxis } from "../../src/core/math.ts";
import { flareGeometry } from "../../src/render/scene/flare.ts";
import { perspectiveProjection } from "../../src/render/scene/view.ts";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { EngineSession } from "../../src/world/session/session.ts";
import { createQ2ApplicationServerHost } from "../../src/app/bootstrap/simulation/network.ts";
import { EntityStateT, PlayerStateT, Q2WireCodec, Q2ServerMessageReader, encodeQ2Frame } from "../../src/network/q2/index.ts";

const flare: SceneFlare = { image: "misc/flare.tga", fadeStart: 96, fadeEnd: 384, scale: 1,
  color: { x: 255, y: 255, z: 255 }, rimColor: { x: 255, y: 0, z: 0 }, lockAngle: false };
const camera: SceneCamera = { origin: { x: 0, y: 0, z: 0 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }),
  projection: perspectiveProjection(90, 90, 4096, 1), viewport: { x: 0, y: 0, width: 128, height: 128 }, clip: { kind: "none" } };

test("flare fan retains native shell rim, distance fade, custom size and camera basis", () => {
  expect(flareGeometry(flare, { x: 95, y: 0, z: 0 }, camera, flare.image).vertices).toHaveLength(0);
  const half = flareGeometry(flare, { x: 240, y: 0, z: 0 }, camera, flare.image);
  expect(half.indices).toEqual([0, 2, 3, 0, 3, 4, 0, 4, 1, 0, 1, 2]);
  expect(half.vertices[0]?.color).toEqual({ x: 255, y: 255, z: 255, w: 80 });
  expect(half.vertices[1]?.color).toEqual({ x: 255, y: 0, z: 0, w: 80 });
  const custom = flareGeometry(flare, { x: 500, y: 0, z: 0 }, camera, "custom.tga");
  expect(custom.vertices[0]?.color.w).toBe(128);
  expect(Math.abs(custom.vertices[1]?.position.y ?? 0)).toBe(25);
  const far = flareGeometry(flare, { x: 500, y: 0, z: 0 }, camera, "sprites/psx_flare1.tga");
  expect(far.vertices[0]?.color.w).toBe(160);
  expect(Math.abs(far.vertices[1]?.position.y ?? 0)).toBe(50);
  const origin = { x: 500, y: 300, z: 100 };
  const unlocked = flareGeometry(flare, origin, camera, flare.image);
  const locked = flareGeometry({ ...flare, lockAngle: true }, origin, camera, flare.image);
  expect(locked.vertices.every(vertex => vertex.position.x === 500)).toBe(true);
  expect(unlocked.vertices.some(vertex => vertex.position.x !== 500)).toBe(true);
});

test("unchanged retail q64/rtest admits source misc_flare and target toggles presentation", async () => {
  const command = parseApplicationCommand(["--game", "q2-rerelease-baseq2", "--map", "q64/rtest", "--renderer", "cpu", "--mode", "coop"]);
  if (command.kind !== "run") throw new Error("Expected application launch");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner("rerelease flare");
  const session = new EngineSession(identity, { kind: "headless" });
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
    skill: command.options.skill, mode: command.options.mode, seed: command.options.seed, maxClients: 2,
    playerIdentity: client => ({ seat: client.slot, socialId: "" }) });
  try {
    const client = session.createClient(0);
    simulation.admitPlayer(client.id);
    const source = simulation.q2Source();
    if (source === null) throw new Error("Expected Q2 source");
    const authored = [...source.game.entities.values()].filter(entity => entity.classname === "misc_flare");
    const custom = source.game.spawn({ ordinal: 100000, classname: "misc_flare", values: new Map([["classname", "misc_flare"], ["targetname", "flare-test"], ["image", "missing-flare.tga"], ["fade_start_dist", "32"], ["fade_end_dist", "200"]]) });
    authored.push(custom);
    const protocol = { kind: "q2-rerelease", version: 1038 } satisfies import("../../src/contracts/protocol.ts").Q2ProtocolIdentity;
    const host = await createQ2ApplicationServerHost({ session, simulation, content, protocol, print: () => undefined });
    const peer = host.carriedPlayer(client.id);
    expect(authored.length).toBeGreaterThan(0);
    for (const entity of authored) {
      const payload = entity.flare;
      if (payload === null) throw new Error("Authored flare has no payload");
      const presentation = simulation.presentations().find(value => value.actor.equals(entity.actor.id));
      expect(presentation?.flare).toEqual(payload);
      expect(presentation?.visible).toBe(true);
      const address = simulation.actors.sourceOf(entity.actor.id);
      if (address === null) throw new Error("Missing flare source address");
      const state = host.gameState(peer).baselines.get(address.slot);
      if (state === undefined) throw new Error("Missing wire flare");
      const frame = { serverFrame: 1, deltaFrame: -1, suppressedCount: 0, areaBits: new Uint8Array(), player: new PlayerStateT(), entities: [state] };
      const reader = new Q2ServerMessageReader(protocol, host.messageOptions);
      const decoded = reader.read(encodeQ2Frame(new Q2WireCodec(protocol), frame, null, new Map<number, EntityStateT>(), 4)).find(record => record.event.kind === "frame")?.event;
      if (decoded?.kind !== "frame") throw new Error("Missing decoded flare frame");
      const received = decoded.frame.entities.find(value => value.number === address.slot);
      expect(received?.modelindex).toBe(1); expect(received?.modelindex2).toBe(payload.fadeStart); expect(received?.modelindex3).toBe(payload.fadeEnd);
      expect(received?.renderfx).toBe(entity.renderFlags);
      if (entity === custom) expect(received?.frame).toBeGreaterThan(0);
      if (entity.use !== null) {
        entity.use(entity, source.game, entity.actor.id, entity.actor.id);
        expect(simulation.presentations().find(value => value.actor.equals(entity.actor.id))?.visible).toBe(false);
        entity.use(entity, source.game, entity.actor.id, entity.actor.id);
        expect(simulation.presentations().find(value => value.actor.equals(entity.actor.id))?.visible).toBe(true);
      }
    }
  } finally { simulation.close(); await content.close(); }
}, 30000);
