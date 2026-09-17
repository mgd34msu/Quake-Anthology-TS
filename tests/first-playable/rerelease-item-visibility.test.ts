import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { ApplicationRereleasePresentation } from "../../src/app/bootstrap/rerelease-presentation.ts";
import type { SimulationPresentationEvent } from "../../src/app/bootstrap/simulation/types.ts";

test("coop pickup visibility stays per actor and respects recycled item identities", () => {
  const identity = createIdentityOwner("instanced-presentation"), first = identity.actor(1, 0), second = identity.actor(2, 0), item = identity.actor(3, 0);
  const presentation = new ApplicationRereleasePresentation({ provider: async () => { throw new Error("Visibility does not load assets"); } },
    [{ actor: first, seat: identity.seat(0) }, { actor: second, seat: identity.seat(1) }]);
  const event = (visible: boolean): SimulationPresentationEvent => ({ kind: "q2-rerelease", content: "q2:rerelease:baseq2:test", seconds: 1, sequence: 1,
    event: { kind: "item-visibility", actor: first, item: identity.actor(3, 0), visible } });
  expect(presentation.itemVisible(first, item)).toBe(true);
  presentation.receive([event(false)]);
  expect(presentation.itemVisible(first, item)).toBe(false);
  expect(presentation.itemVisible(identity.actor(1, 0), identity.actor(3, 0))).toBe(false);
  expect(presentation.itemVisible(second, item)).toBe(true);
  expect(presentation.itemVisible(first, identity.actor(3, 1))).toBe(true);
  presentation.receive([event(true)]);
  expect(presentation.itemVisible(first, item)).toBe(true);
});
