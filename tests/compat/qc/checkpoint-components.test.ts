import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { CvarRegistry } from "../../../src/core/cvars/index.ts";
import { NetQuakeDecoder, writeNetQuakeMessage } from "../../../src/network/q1/netquake.ts";
import { QuakeWorldDecoder, qwEntity, writeQuakeWorldEntities } from "../../../src/network/q1/quakeworld.ts";
import { QwEntityStateT } from "../../../src/network/q1/qw-constants.ts";
import { EntityStateT } from "../../../src/network/q1/wire-types.ts";
import { SizeBuf } from "../../../src/network/q1/message.ts";
import { encodeCheckpointValue, decodeCheckpointValue } from "../../../src/persistence/value.ts";

const roundtrip = (value: unknown) => decodeCheckpointValue(encodeCheckpointValue(value));

test("QC cvar restore preserves declaration order, numeric words and subsequent writes", () => {
  const make = () => new CvarRegistry({ dialect: "q1-netquake", context: { session: createIdentityOwner("qc-cvars").session, origin: { kind: "server-console" } } });
  const original = make(); original.register("gravity", "800"); original.register("aim", "0.93"); original.set("aim", "0.875");
  const documentation = { summary: "World gravity", usage: "gravity <value>", examples: ["gravity 800"] };
  original.document("gravity", documentation);
  const restored = make(); restored.register("gravity", "800"); restored.document("gravity", documentation);
  restored.restoreQuakeCState(roundtrip(original.captureQuakeCState()));
  expect(restored.documentation("gravity")).toEqual(documentation);
  expect(restored.captureQuakeCState()).toEqual(original.captureQuakeCState());
  original.set("gravity", "600"); restored.set("gravity", "600");
  expect(restored.captureQuakeCState()).toEqual(original.captureQuakeCState());
});

test("NetQuake decoder resumes protocol, time and private baseline words", () => {
  const original = new NetQuakeDecoder({ kind: "q1-rmq", version: 999, flags: 0 });
  const state = new EntityStateT(); state.origin[0] = -0; state.origin[1] = 12.375; state.origin[2] = 44; state.effects = 128; original.baselines.set(7, state); original.timeSeconds = 3.25;
  const restored = new NetQuakeDecoder(); restored.restore(roundtrip(original.capture()));
  expect(restored.capture()).toEqual(original.capture());
  const packet = new SizeBuf(); writeNetQuakeMessage(packet, original.protocol, { kind: "time", seconds: 4.25 });
  expect(restored.decode(packet.bytes())).toEqual(original.decode(packet.bytes()));
  expect(restored.capture()).toEqual(original.capture());
});

test("QuakeWorld decoder restores delta history before the next delta packet", () => {
  const original = new QuakeWorldDecoder(), entity = new QwEntityStateT(); entity.number = 9; entity.modelindex = 2; entity.origin[0] = 16; entity.origin[1] = 32; entity.origin[2] = 48;
  const packet = new SizeBuf(); writeQuakeWorldEntities(packet, original.protocol, [entity], new Map<number, QwEntityStateT>(), null);
  original.decode(packet.bytes(), 10); original.recordDeltaRequest(11, 10);
  const restored = new QuakeWorldDecoder(); restored.restore(roundtrip(original.capture()));
  expect(restored.capture()).toEqual(original.capture());
  const moved = new QwEntityStateT(); moved.copyFrom(entity); moved.origin[0] += 8;
  const delta = new SizeBuf(); writeQuakeWorldEntities(delta, original.protocol, [moved], new Map<number, QwEntityStateT>(), { sequence: 10, states: [entity] });
  expect(restored.decode(delta.bytes(), 11)).toEqual(original.decode(delta.bytes(), 11));
  expect(restored.capture()).toEqual(original.capture()); expect(qwEntity(moved).origin.x).toBe(24);
});
