import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { Q3SourcePlayerEvent } from "../../../src/app/bootstrap/simulation/q3/types.ts";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import { QvmModPlayerEvents, readQvmPlayerEvents } from "../../../src/compat/qvm/mod-player-events.ts";
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "../../../src/persistence/value.ts";
import { readQvmPlayerState, readSourceQvmPlayerState } from "../../../src/compat/qvm/player-record.ts";
const module = { id: "mod:source-events", digest: "sha256:9751bad99a2d138f96a9b0436d2ea2d965b86214175dc33e4cea95e059419337", artifactPath: "vm/qagame.qvm", revision: "test" } satisfies import("../../../src/contracts/execution.ts").ModuleIdentity;

test("source player events retain store order, bounded rings, saved cursors and generation lifetime", () => {
  const ids = createIdentityOwner("source-events"), first = ids.actor(4, 2), second = ids.actor(8, 3);
  const memory = new QvmMemory(new Uint8Array(2048)), events: Q3SourcePlayerEvent[] = [];
  const publisher = new QvmModPlayerEvents({ memory, module, abiProfile: "q3-modern", live: () => true,
    origin: () => ({ x: 10, y: 20, z: 30 }), time: () => 1000, emit: event => { events.push(event); } });
  const a = memory.dataView(0, 468), b = memory.dataView(512, 468);
  a.setInt32(140, 11, true); publisher.track(first, 0); publisher.track(second, 512);
  const external = (view: DataView, event: number, time: number) => { view.setInt32(128, event, true); view.setInt32(132, event + 1, true); view.setInt32(136, time, true); };
  const predictable = (event: number) => { const sequence = a.getInt32(108, true); a.setInt32(112 + (sequence & 1) * 4, event, true);
    a.setInt32(120 + (sequence & 1) * 4, event + 1, true); a.setInt32(108, sequence + 1, true); };
  external(b, 349, 700); predictable(999); external(a, 325, 800);
  expect(events).toHaveLength(0);
  const saved = readQvmPlayerEvents(new SaveReader(decodeCheckpointValue(encodeCheckpointValue(publisher.checkpoint()))));
  publisher.restore(saved, [{ actor: first, address: 0 }, { actor: second, address: 512 }]);
  const source = memory.bytes.slice(); publisher.publish();
  expect(events.map(event => [event.actor.slot, event.event, event.parameter, event.sequence])).toEqual([
    [8, 349, 350, { kind: "external", time: 700 }], [4, 999, 1000, { kind: "predictable", sequence: 0 }], [4, 325, 326, { kind: "external", time: 800 }],
  ]);
  expect(events[1]?.playerState.clientNumber).toBe(11); expect(events[1]?.origin).toEqual({ x: 10, y: 20, z: 30 });
  expect(memory.bytes).toEqual(source); publisher.publish(); expect(events).toHaveLength(3);
  external(a, 325, 800); publisher.publish(); expect(events).toHaveLength(3);
  external(a, 325, 801); publisher.publish(); expect(events).toHaveLength(4);
  predictable(101); predictable(102); predictable(103); publisher.publish(); expect(events.slice(-2).map(event => event.event)).toEqual([102, 103]);
  expect(events[1]?.playerState.eventSequence).toBe(1);
  external(a, 581, 900); publisher.discard(); publisher.publish(); expect(events).toHaveLength(6);
  publisher.release(first); external(a, 837, 1000); publisher.publish(); expect(events).toHaveLength(6);
  const replacement = ids.actor(first.slot, first.generation + 1); publisher.track(replacement, 0); publisher.publish(); expect(events).toHaveLength(6);
  external(a, 69, 1100); publisher.publish(); expect(events.at(-1)?.actor).toBe(replacement);
  publisher.close(); expect(memory.observesWrites).toBe(false);
});

test("raw legacy player state retains original enums and private slots while normalized reader stays translated", () => {
  const view = new DataView(new ArrayBuffer(444)); view.setInt32(112, 66, true); view.setInt32(128, 66 | 256, true);
  for (let index = 0; index < 16; index++) { view.setInt32(248 + index * 4, 100 + index, true); view.setInt32(312 + index * 4, 200 + index, true); }
  const raw = readSourceQvmPlayerState(view, "q3-1.16n-base");
  expect(raw.events[0]).toBe(66); expect(raw.externalEvent).toBe(322); expect(raw.persistent).toEqual(Array.from({ length: 16 }, (_, index) => 100 + index));
  expect(raw.powerups).toEqual(Array.from({ length: 16 }, (_, index) => 200 + index));
  expect(() => readQvmPlayerState(view, "q3-1.16n-base")).toThrow("not represented by the selected legacy ABI");
});

test("predictable sequence wraps as int32 and legacy saves begin at the current source cursor", () => {
  const ids = createIdentityOwner("event-wrap"), actor = ids.actor(1, 1), memory = new QvmMemory(new Uint8Array(1024));
  const events: Q3SourcePlayerEvent[] = [], view = memory.dataView(0, 468);
  const publisher = new QvmModPlayerEvents({ memory, module, abiProfile: "q3-modern", live: () => true,
    origin: () => ({ x: 0, y: 0, z: 0 }), time: () => 1, emit: event => { events.push(event); } });
  view.setInt32(108, 0x7fffffff, true); publisher.track(actor, 0);
  view.setInt32(116, 97, true); view.setInt32(124, 3, true); view.setInt32(108, -0x80000000, true);
  publisher.publish(); expect(events[0]?.sequence).toEqual({ kind: "predictable", sequence: 0x7fffffff });
  expect(events[0]?.event).toBe(97);
  view.setInt32(128, 349, true); view.setInt32(136, 55, true);
  publisher.restore(null, [{ actor, address: 0 }]); publisher.publish(); expect(events).toHaveLength(1);
  view.setInt32(128, 605, true); view.setInt32(128, 861, true); publisher.publish();
  expect(events).toHaveLength(2); expect(events[1]?.event).toBe(861);
  const saved = publisher.checkpoint(), cursor = saved.clients[0]; if (cursor === undefined) throw new Error("Missing cursor");
  expect(() => readQvmPlayerEvents(new SaveReader({ nextOrder: 1, clients: [{ ...cursor, externalOrder: 1 }] }))).toThrow("publication order");
  publisher.close();
});
