import { expect, test } from "bun:test";
import { RankingLifecycle, type RankingServiceProvider, type RankingServiceReport } from "../../../src/network/services/rankings.ts";

function fixture() {
  const events: string[] = [], reports: RankingServiceReport[] = [];
  const provider: RankingServiceProvider = {
    endpoint: new URL("https://rankings.invalid"),
    async begin(key) { events.push(`begin:${key}`); return { gameId: 17n }; },
    async login(_match, request) { events.push(request.kind); return request.username === "denied"
      ? { kind: "denied", reason: "No membership" } : { kind: "active", account: { playerId: 81n, rank: 9 } }; },
    async join() { events.push("join"); }, async report(_match, report) { reports.push(report); },
    async poll() { events.push("poll"); }, async logout() { events.push("logout"); }, async finish() { events.push("finish"); },
  };
  const changed: string[] = [];
  return { events, reports, provider, changed, owner: new RankingLifecycle(provider, (slot, state) => changed.push(`${slot}:${state.kind}`)) };
}

test("configured lifecycle joins account, serializes reports and cleans player before match", async () => {
  const f = fixture();
  await f.owner.begin(true, false, "source-game-key");
  await f.owner.account(0, { kind: "login", username: "user", password: "not-stored" });
  await f.owner.reportInt(0, -1, 7, 3, true);
  await f.owner.reportString(-1, 0, 8, "map");
  await f.owner.reportInt(1, -1, 7, 99, true);
  await f.owner.frame(); await f.owner.end();
  expect(f.events).toEqual(["begin:source-game-key", "login", "join", "poll", "logout", "finish"]);
  expect(f.reports).toEqual([{ kind: "integer", self: 81n, other: 0n, key: 7, value: 3, accumulate: true },
    { kind: "string", self: 0n, other: 81n, key: 8, value: "map" }]);
  expect(f.changed).toEqual(["0:pending", "0:active", "0:new"]);
  expect(f.owner.state()).toEqual({ kind: "disabled" });
});

test("unconfigured service is unavailable and single-player never starts ranking", async () => {
  const unavailable = new RankingLifecycle(null, () => undefined);
  await unavailable.begin(true, false, "source-game-key"); expect(unavailable.state().kind).toBe("unavailable");
  const f = fixture(); await f.owner.begin(true, true, "source-game-key");
  expect(f.owner.state().kind).toBe("disabled"); expect(f.events).toEqual([]);
});

test("denied account can reset; disconnect and spectator transitions clean account ownership", async () => {
  const f = fixture(); await f.owner.begin(true, false, "key");
  await f.owner.account(0, { kind: "create", username: "denied", password: "not-stored", email: "unused@example.invalid" });
  expect(f.owner.player(0).kind).toBe("denied"); await f.owner.reset(0); expect(f.owner.player(0).kind).toBe("new");
  await f.owner.account(0, { kind: "login", username: "user", password: "not-stored" });
  await f.owner.spectate(0); expect(f.owner.player(0).kind).toBe("spectator");
  await f.owner.disconnect(0); await f.owner.end(); expect(f.events.filter(event => event === "logout")).toHaveLength(1);
});

test("provider failure still attempts remaining cleanup and reports unavailable", async () => {
  const f = fixture(); f.provider.logout = async () => { f.events.push("logout-failed"); throw new Error("Provider unavailable"); };
  await f.owner.begin(true, false, "key"); await f.owner.account(0, { kind: "login", username: "user", password: "not-stored" });
  await expect(f.owner.end()).rejects.toThrow("Ranking report submission or cleanup failed");
  expect(f.events.at(-1)).toBe("finish"); expect(f.owner.state().kind).toBe("unavailable"); expect(f.owner.player(0).kind).toBe("new");
});
