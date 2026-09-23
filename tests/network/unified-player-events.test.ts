import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { readSourceQvmPlayerState } from "../../src/compat/qvm/player-record.ts";
import type { SimulationPresentationEvent } from "../../src/app/bootstrap/simulation/types.ts";
import type { UnifiedIdentityDecoder } from "../../src/app/bootstrap/network/unified-types.ts";
import { encodeUnifiedPresentationEvents, decodeUnifiedPresentationEvents } from "../../src/app/bootstrap/network/unified-event-codec.ts";

test("unified raw player events retain source provenance, legacy enums and source slots across identity remapping", () => {
  const server = createIdentityOwner("event-source"), client = createIdentityOwner("event-receiver"), actor = server.actor(3, 7), local = client.actor(40, 2);
  const identity: UnifiedIdentityDecoder = { session: client.session, actor: (slot, generation) => { expect([slot, generation]).toEqual([3, 7]); return local; },
    client: (slot, generation) => client.client(slot, generation), seat: index => client.seat(index), resourceId: () => "resource:test" };
  const view = new DataView(new ArrayBuffer(444)); view.setInt32(128, 66 | 768, true); view.setInt32(140, 12, true); view.setInt32(312 + 8 * 4, 2718, true);
  const event = { kind: "q3-source", content: "q3:classic:component:test", sequence: 4, seconds: 1.5, event: {
    kind: "player-event", actor, source: { module: { id: "mod:events", artifactPath: "vm/qagame.qvm", revision: "original",
      digest: "sha256:9751bad99a2d138f96a9b0436d2ea2d965b86214175dc33e4cea95e059419337" }, abiProfile: "q3-1.16n-base" },
    playerState: readSourceQvmPlayerState(view, "q3-1.16n-base"), event: 834, parameter: 123, sequence: { kind: "external", time: -1 }, origin: { x: 4, y: 5, z: 6 }, time: 1500,
  } } satisfies SimulationPresentationEvent;
  const bytes = encodeUnifiedPresentationEvents([event]), result = decodeUnifiedPresentationEvents(bytes, identity)[0];
  expect(result).toEqual({ ...event, event: { ...event.event, actor: local } });
  expect(new TextDecoder().decode(bytes)).not.toContain("event-source");
});
