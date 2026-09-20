import { expect, test } from "bun:test";
import { UnifiedAudio } from "../../src/audio/engine.ts";
import type { LoopSound, SoundAsset } from "../../src/audio/types.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { ProviderId } from "../../src/contracts/identity.ts";
import { SessionActorRegistry, SharedBodyTable } from "../../src/world/actors/index.ts";
import { SimulationEvents } from "../../src/app/bootstrap/simulation/events.ts";
import { decodeUnifiedPresentationEvents, encodeUnifiedPresentationEvents } from "../../src/app/bootstrap/network/unified-event-codec.ts";
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "../../src/persistence/value.ts";

const ids = createIdentityOwner("component-loops"), origin = { x: 0, y: 0, z: 0 };
const actor = ids.actor(4, 2), first: ProviderId = "mod:first", second: ProviderId = "mod:second";
const sound = (value: number): SoundAsset => ({ name: "loop.wav", resource: `resource:tone:${value}`, pcm: {
  samples: new Int16Array(128).fill(value), sampleRate: 44100, channels: 1, frameCount: 128, loopStart: null } });

test("two components and the primary keep independent loops on one borrowed actor", () => {
  using audio = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
  audio.setEffectsVolume(1);
  audio.setListeners([{ seat: ids.seat(0), actor: null, origin, axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], gain: 1, underwater: false }]);
  audio.updateActor(actor, origin);
  const base = { family: "q2", actor, origin: { kind: "actor", actor }, audience: { kind: "world" }, volume: 1,
    attenuation: 1, velocity: origin, frameNumber: 1, lifetime: "persistent" } satisfies Omit<LoopSound, "sound">;
  audio.loop({ ...base, owner: first, sound: sound(1000) });
  audio.loop({ ...base, owner: second, sound: sound(2000) });
  audio.loop({ ...base, sound: sound(4000) });
  audio.endLoopFrame();
  const combined = audio.mix(1)[0];
  audio.stopLoop(actor, { kind: "world" }, first);
  const remaining = audio.mix(1)[0];
  expect(combined).toBeGreaterThan(remaining ?? 0);
  audio.stopLoop(actor);
  const component = audio.mix(1)[0];
  expect(remaining).toBeGreaterThan(component ?? 0);
  expect(component).toBeGreaterThan(0);
  audio.updateActor(actor, { x: 4096, y: 0, z: 0 });
  audio.endLoopFrame();
  expect(audio.mix(1)).toEqual(new Int16Array(2));
  audio.updateActor(actor, origin);
  audio.endLoopFrame();
  expect(audio.mix(1)[0]).toBeGreaterThan(0);
  audio.stopLoop(actor, { kind: "world" }, second);
  expect(audio.mix(1)).toEqual(new Int16Array(2));
});

test("component loop ownership survives wire and save remapping while old loops remain readable", () => {
  const actors = new SessionActorRegistry(ids);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: (_actor, body) => body.bounds, onLink: () => undefined, onUnlink: () => undefined });
  const events = new SimulationEvents(bodies, () => ({ kind: "seconds", value: 1 }), () => null, actor => actor.slot);
  const start = { kind: "sound", actor, origin, path: "world/loop.wav", channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "start" } satisfies import("../../src/content/q2/foundation/host.ts").Q2PresentationEvent;
  for (const loopOwner of [first, second]) events.emit("q2:classic:baseq2:installed", { kind: "q2", event: { ...start, loopOwner } });
  events.emit("q2:classic:baseq2:installed", { kind: "q2", event: start });
  expect(events.persistentPresentation()).toHaveLength(3);
  const local = createIdentityOwner("restored-loop"), restoredActor = local.actor(9, 5);
  const decoded = decodeUnifiedPresentationEvents(encodeUnifiedPresentationEvents(events.takePresentation()), {
    session: local.session, actor: () => restoredActor, client: local.client, seat: local.seat, resourceId: id => id });
  expect(decoded.filter(event => event.kind === "q2" && event.event.kind === "sound" && event.event.loopOwner === first)).toHaveLength(1);
  events.restore(new SaveReader(decodeCheckpointValue(encodeCheckpointValue(events.capture()))), () => restoredActor);
  events.emit("q2:classic:baseq2:installed", { kind: "q2", event: { ...start, actor: restoredActor, loopOwner: first, loop: "stop" } });
  const retained = events.persistentPresentation();
  expect(retained).toHaveLength(2);
  expect(retained.some(event => event.kind === "q2" && event.event.kind === "sound" && event.event.loopOwner === second)).toBe(true);
  expect(retained.some(event => event.kind === "q2" && event.event.kind === "sound" && event.event.loopOwner === undefined)).toBe(true);
  actors.close();
});
