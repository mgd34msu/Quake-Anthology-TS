import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarFlag, CvarRegistry } from "../../src/core/cvars/index.ts";

function owners() {
  const identity = createIdentityOwner("cvar-transfer");
  const context = { session: identity.session, origin: { kind: "local-console" } } satisfies CvarRegistry["context"];
  const live = new CvarRegistry({ dialect: "q1-quakeworld", context });
  const candidate = new CvarRegistry({ dialect: "q1-quakeworld", context });
  for (const owner of [live, candidate]) owner.register("name", "before", CvarFlag.UserInfo);
  live.takeEffects(); candidate.takeEffects();
  live.set("name", "old-pending");
  return { live, candidate };
}

test("candidate cvars retain old effects and append their own once at publication", () => {
  const { live, candidate } = owners();
  const oldState = live.captureWorldTransferState();
  const changed: string[] = [];
  live.bindValue("name", { validate: () => null, changed: value => { changed.push(value); } });
  const transfer = live.prepareTransfer(candidate);
  candidate.set("name", "candidate");
  transfer.validatePublication();
  expect(live.captureWorldTransferState()).toEqual(oldState);
  expect(changed).toEqual([]);
  transfer.publish();
  expect(live.variableString("name")).toBe("candidate");
  expect(changed).toEqual(["candidate"]);
  expect(live.takeEffects().map(effect => effect.kind === "userinfo" ? effect.value : effect.kind)).toEqual(["old-pending", "candidate"]);
  expect(() => transfer.publish()).toThrow("already published");
});

test("failed or stale candidate cannot erase live pending effects", () => {
  const { live, candidate } = owners();
  const transfer = live.prepareTransfer(candidate);
  candidate.set("name", "candidate");
  live.set("name", "late-live");
  expect(() => transfer.validatePublication()).toThrow("changed during preparation");
  expect(() => transfer.publish()).toThrow("changed during preparation");
  expect(live.variableString("name")).toBe("late-live");
  expect(live.takeEffects().map(effect => effect.kind === "userinfo" ? effect.value : effect.kind)).toEqual(["old-pending", "late-live"]);
});

test("shared transfer preserves aliases and existing plus candidate VM indexes", () => {
  const context = { session: createIdentityOwner("transfer-handles").session, origin: { kind: "local-console" } } satisfies CvarRegistry["context"];
  const live = new CvarRegistry({ dialect: "q3", context }), candidate = new CvarRegistry({ dialect: "q3", context });
  for (const owner of [live, candidate]) {
    owner.register("gamma", "2");
    owner.registerAlias({ name: "brightness", target: "gamma", conversion: { kind: "converted", read: value => String(1 / Number(value)),
      write: value => ({ kind: "value", value: String(1 / Number(value)) }) }, documentation: { summary: "Inverse gamma", usage: "brightness", examples: [] } });
  }
  const retained = live.bindVm("brightness", "1");
  const transfer = live.prepareTransfer(candidate);
  const created = candidate.bindVm("guest-setting", "7");
  candidate.set("brightness", "0.25");
  transfer.publish();
  expect(live.readVm(retained)?.value).toBe("0.25");
  expect(live.readVm(created)?.value).toBe("7");
  expect(live.variableString("gamma")).toBe("4");
  live.set("brightness", "0.5");
  expect(live.variableString("gamma")).toBe("2");
});

test("Q1 value ABA still invalidates candidate publication without a native modification count", () => {
  const context = { session: createIdentityOwner("transfer-aba").session, origin: { kind: "local-console" } } satisfies CvarRegistry["context"];
  const live = new CvarRegistry({ dialect: "q1-netquake", context }), candidate = new CvarRegistry({ dialect: "q1-netquake", context });
  live.register("gamma", "1");
  const before = live.captureWorldTransferState(), transfer = live.prepareTransfer(candidate);
  live.set("gamma", "2"); live.set("gamma", "1");
  expect(live.captureWorldTransferState()).toEqual(before);
  expect(() => transfer.publish()).toThrow("changed during preparation");
});

test("prepared registry inherits validation and aliases without firing retained value bindings", () => {
  const context = { session: createIdentityOwner("candidate-clone").session, origin: { kind: "local-console" } } satisfies CvarRegistry["context"];
  const live = new CvarRegistry({ dialect: "q3", context });
  live.register("level", "2");
  const changed: string[] = [];
  live.bindValue("level", { validate: value => Number(value) > 0 ? null : "positive required", changed: value => { changed.push(value); } });
  const next = live.prepareCandidate();
  next.cvars.set("level", "0");
  expect(next.cvars.variableString("level")).toBe("2");
  next.cvars.set("level", "3");
  expect(live.variableString("level")).toBe("2"); expect(changed).toEqual([]);
  next.publish();
  expect(live.variableString("level")).toBe("3"); expect(changed).toEqual(["3"]);
  expect(() => next.publish()).toThrow("already published");
});
