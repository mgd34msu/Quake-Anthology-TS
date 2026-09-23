import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { SessionActorRegistry, SharedBodyTable } from "../../src/world/actors/index.ts";
import { SimulationEvents } from "../../src/app/bootstrap/simulation/events.ts";
import { SaveReader, decodeCheckpointValue, encodeCheckpointValue } from "../../src/persistence/value.ts";
import { decodeUnifiedPresentationEvents, encodeUnifiedPresentationEvents } from "../../src/app/bootstrap/network/unified-event-codec.ts";
import { UnifiedAudio } from "../../src/audio/engine.ts";
import type { SoundAsset } from "../../src/audio/types.ts";

const content = "q1:classic:id1:installed", modContent = "q1:classic:hipnotic:installed";
function world() {
  const ids = createIdentityOwner("presentation-owners"), actors = new SessionActorRegistry(ids);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: (_actor, body) => body.bounds, onLink: () => undefined, onUnlink: () => undefined });
  return { ids, actors, events: new SimulationEvents(bodies, () => ({ kind: "seconds", value: 1 }), () => null, actor => actor.slot) };
}

test("persistent component output retires its activation and restores prior source overrides across save and wire", () => {
  const first = world(), style = (pattern: string) => ({ kind: "q1", event: { kind: "lightstyle", style: 0, pattern } } satisfies import("../../src/app/bootstrap/simulation/types.ts").SourcePresentationEvent);
  first.events.emit(content, style("m"));
  const one = first.events.bindOwner("mod:one", modContent, false), two = first.events.bindOwner("mod:two", modContent, false);
  one.emit(modContent, style("a")); two.emit(modContent, style("z"));
  one.emit(modContent, { kind: "q1", event: { kind: "static-model", path: "progs/flame.mdl", origin: { x: 1, y: 2, z: 3 }, angles: { x: 0, y: 0, z: 0 }, frame: 0, skin: 0, colorMap: 0 } });
  expect(first.events.lightStyle(0)).toBe("z");
  const state = decodeCheckpointValue(encodeCheckpointValue(first.events.capture()));
  first.events.takePresentation(); first.events.take();
  const restored = world(); restored.events.restore(new SaveReader(state), saved => restored.ids.actor(saved.slot, saved.generation));
  expect(() => restored.events.finishOwnerRestore()).toThrow("was not restored");
  const restoredOne = restored.events.bindOwner("mod:one", modContent, true), restoredTwo = restored.events.bindOwner("mod:two", modContent, true);
  restored.events.finishOwnerRestore();
  expect(() => restored.events.bindOwner("mod:one", modContent, true)).toThrow("already active");
  restored.events.takePresentation(); restoredTwo.close();
  expect(restored.events.lightStyle(0)).toBe("a");
  const output = restored.events.takePresentation();
  const wire = decodeUnifiedPresentationEvents(encodeUnifiedPresentationEvents(output), { session: restored.ids.session, actor: restored.ids.actor, client: restored.ids.client, seat: restored.ids.seat, resourceId: id => id });
  expect(wire.filter(event => event.kind !== "presentation-owner")).toEqual(output.filter(event => event.kind !== "presentation-owner"));
  const retired = wire.find(event => event.kind === "presentation-owner");
  if (retired?.kind !== "presentation-owner") throw new Error("Missing retirement");
  expect(output.find(event => event.kind === "presentation-owner")?.event).toEqual(retired.event);
  expect(() => restoredTwo.emit(modContent, style("b"))).toThrow("retired");
  const newTwo = restored.events.bindOwner("mod:two", modContent, false); newTwo.emit(modContent, style("c"));
  expect(restored.events.takePresentation()[0]?.owner?.generation).toBeGreaterThan(retired.event.owner.generation);
  restoredOne.close(); expect(restored.events.persistentPresentation().some(event => event.kind === "q1" && event.event.kind === "static-model")).toBe(false);
  expect(restored.events.lightStyle(0)).toBe("c"); newTwo.close(); expect(restored.events.lightStyle(0)).toBe("m");
  one.close(); two.close(); first.actors.close(); restored.actors.close();
});

test("static voice removal preserves another owner and ambient channel", () => {
  const ids = createIdentityOwner("owned-static-audio"), seat = ids.seat(0), origin = { x: 0, y: 0, z: 0 };
  const sound = (value: number): SoundAsset => ({ name: "loop.wav", resource: `resource:tone:${value}`, pcm: { samples: new Int16Array(128).fill(value), sampleRate: 44100, channels: 1, frameCount: 128, loopStart: 0 } });
  using audio = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 }); audio.setEffectsVolume(1);
  audio.setListeners([{ seat, actor: null, origin, axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], gain: 1, underwater: false }]);
  audio.addStaticSound(seat, sound(1000), origin, 255, 0, 1); audio.addStaticSound(seat, sound(2000), origin, 255, 0, 2);
  const both = audio.mix(1)[0]; audio.removeStaticSound(seat, 1); const remaining = audio.mix(1)[0];
  expect(both).toBeGreaterThan(remaining ?? 0); expect(remaining).toBeGreaterThan(0);
  audio.removeStaticSound(seat, 2); expect(audio.mix(1)).toEqual(new Int16Array(2));
});

test("legacy persistence stays primary unless restoring a component makes provenance ambiguous", () => {
  const source = world(); source.events.emit(content, { kind: "q1", event: { kind: "lightstyle", style: 2, pattern: "abc" } });
  const saved = source.events.capture(), legacy = { sequence: saved.sequence, presentationSequence: saved.presentationSequence, styles: saved.styles, persistent: saved.persistent };
  const target = world(); target.events.restore(new SaveReader(legacy), actor => target.ids.actor(actor.slot, actor.generation));
  const unrelated = target.events.bindOwner("mod:unrelated", modContent, true); unrelated.close(); expect(target.events.lightStyle(2)).toBe("abc");
  expect(() => target.events.bindOwner("mod:ambiguous", content, true)).toThrow("without recorded ownership");
  const fresh = target.events.bindOwner("mod:fresh", content, false); fresh.close(); expect(target.events.lightStyle(2)).toBe("abc");
  target.events.finishOwnerRestore(); source.actors.close(); target.actors.close();
});

test("retiring a global override replays still-live recipient overrides in source order", async () => {
  const { Q1ServicePresentation } = await import("../../src/app/bootstrap/q1-service-presentation.ts");
  const state = world(), recipient = state.ids.actor(4, 0), presentation = new Q1ServicePresentation();
  const source = (value: number) => ({ kind: "q1-client", event: { kind: "frags", slot: 0, value } } satisfies import("../../src/app/bootstrap/simulation/types.ts").SourcePresentationEvent);
  state.events.emit(content, source(0));
  const first = state.events.bindOwner("mod:first", content, false), second = state.events.bindOwner("mod:second", content, false);
  first.emit(content, source(1)); second.emit(content, source(2), undefined, recipient);
  presentation.receive(state.events.takePresentation()); expect(presentation.clients(content, recipient)[0]?.frags).toBe(2);
  first.close(); presentation.receive(state.events.takePresentation()); expect(presentation.clients(content, recipient)[0]?.frags).toBe(2);
  second.close(); presentation.receive(state.events.takePresentation()); expect(presentation.clients(content, recipient)[0]?.frags).toBe(0);
  presentation.close(); state.actors.close();
});
