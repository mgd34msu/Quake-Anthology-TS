import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarFlag, CvarRegistry } from "../../src/core/cvars/index.ts";
import { initializeQ3ClientCvars } from "../../src/app/bootstrap/q3-client/userinfo.ts";
import { Q3ClientClock } from "../../src/network/q3/clock.ts";
import { PlayerStateRecord } from "../../src/network/q3/state/player.ts";
import type { Snapshot } from "../../src/network/q3/server-message.ts";

function registry(): CvarRegistry {
  return new CvarRegistry({ dialect: "q3", context: { session: createIdentityOwner("client-clock-cvars").session,
    origin: { kind: "local-console" } } });
}
const identity = { name: "Player", model: "sarge" };

test("native clock cvar precedes authored guest registration without replacing its flags", () => {
  const cvars = registry();
  initializeQ3ClientCvars(cvars, identity);
  expect(cvars.get("cl_timeNudge")).toMatchObject({ value: "0", resetValue: "0", flags: CvarFlag.Temporary });
  cvars.register("cl_timeNudge", "grunt", CvarFlag.Archive | CvarFlag.UserInfo);
  expect(cvars.get("cl_timeNudge")).toMatchObject({ value: "0", resetValue: "0",
    flags: CvarFlag.Temporary | CvarFlag.Archive | CvarFlag.UserInfo });
});

test("native registration preserves explicit user timing before and after guest registration", () => {
  const cvars = registry();
  cvars.set("cl_timeNudge", "-15");
  initializeQ3ClientCvars(cvars, identity);
  cvars.register("cl_timeNudge", "grunt", CvarFlag.Archive | CvarFlag.UserInfo);
  expect(cvars.get("cl_timeNudge")).toMatchObject({ value: "-15", resetValue: "0", integerValue: -15 });
  cvars.set("cl_timeNudge", "12");
  initializeQ3ClientCvars(cvars, identity);
  expect(cvars.variableString("cl_timeNudge")).toBe("12");
});

test("live client timing uses existing clock clamp, monotonicity, and snapshot delta correction", () => {
  const cvars = registry(); initializeQ3ClientCvars(cvars, identity);
  const clock = new Q3ClientClock();
  const snapshot: Snapshot = { messageNumber: 1, serverTime: 1000, deltaNumber: -1, flags: 0,
    serverCommandNumber: 0, parseEntitiesNumber: 0, areaMask: new Uint8Array(32),
    playerState: new PlayerStateRecord("baseq3", 0, 0, 0), entities: [] };
  const advance = (now: number) => clock.advance(now, { paused: false, timeNudge: cvars.get("cl_timeNudge")?.integerValue ?? 0,
    timescale: 1, demo: false, freezeDemo: false, timedemo: false });
  clock.publish(snapshot);
  expect(advance(0)).toBe(1000);
  cvars.set("cl_timeNudge", "-15"); expect(advance(50)).toBe(1065);
  cvars.set("cl_timeNudge", "30"); expect(advance(60)).toBe(1065);
  cvars.set("cl_timeNudge", "999"); expect(advance(100)).toBe(1070);
  expect(cvars.variableString("cl_timeNudge")).toBe("999");
  cvars.set("cl_timeNudge", "-999"); expect(advance(150)).toBe(1180);
  expect(clock.delta).toBe(1000);
  clock.publish({ ...snapshot, messageNumber: 2, serverTime: 1200 });
  expect(advance(200)).toBe(1230);
  expect(clock.delta).toBe(998);
  expect(snapshot.serverTime).toBe(1000);
});
