import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NumericProfile } from "../../../../../src/contracts/numeric.ts";
import type { BodyState } from "../../../../../src/contracts/world.ts";
import { Q2RereleaseRandom } from "../../../../../src/core/random/q2-rerelease.ts";
import { openArchive } from "../../../../../src/content/archive/index.ts";
import { decodeQ2Map } from "../../../../../src/formats/q2-map/index.ts";
import { createSceneQueries } from "../../../../../src/world/collision/index.ts";
import { createAlternateFlyState } from "../../../../../src/content/q2/foundation/monsters/alternate-fly-state.ts";
import { steerQ2AlternateFly } from "../../../../../src/content/q2/foundation/monsters/alternate-fly.ts";
import type { Q2AlternateFlyServices, Q2AlternateFlySteeringState } from "../../../../../src/content/q2/foundation/monsters/alternate-fly.ts";

const archivePath = resolve(process.env["QUAKE_DATA_PATH"] ?? resolve(import.meta.dir, "../../../../../../qfiles"), "q2/rerelease/baseq2/pak0.pak");
test.skipIf(!existsSync(archivePath))("rerelease flipper steering in retail base3 water accelerates, recovers and resumes", async () => {
  const archive = await openArchive(archivePath);
  try {
    const entry = archive.findEntries("maps/base3.bsp")[0];
    if (entry === undefined) throw new Error("Missing retail base3");
    const scene = createSceneQueries(decodeQ2Map(await archive.readEntry(entry)));
    const numeric: NumericProfile = { id: "test:f32", arithmetic: { kind: "binary32", round: "each-operation" }, scalarStorage: "binary32", floatToInt: "checked-c-truncation", integerOverflow: "wrap32" };
    const random = new Q2RereleaseRandom();
    const state: Q2AlternateFlySteeringState = { ...createAlternateFlyState(), alternateFly: true, flyAcceleration: 30,
      flySpeed: 110, flyMinDistance: 10, flyMaxDistance: 10, flyPositionTime: 10,
      medic: false, combatPoint: false, soundTarget: null, lostSight: false, manualSteering: false, waterLevel: 3, idealYaw: 0 };
    const zero = { x: 0, y: 0, z: 0 };
    const body: BodyState = { origin: { x: 76, y: 1168, z: -1020 }, velocity: zero, angles: zero,
      bounds: { min: { x: -16, y: -16, z: -8 }, max: { x: 16, y: 16, z: 20 } }, ground: null };
    const enemy: BodyState = { ...body, origin: { ...body.origin, x: 172 } };
    const services: Q2AlternateFlyServices = {
      random, visibleEnemy: () => true,
      trace: (start, end, bounds, mask) => scene.trace({ start, end, shape: bounds === null ? { kind: "point" } : { kind: "box", bounds },
        target: { kind: "world" }, policy: { kind: "q2", contentsMask: mask, leafContents: "merged" }, numeric, passActor: null }),
      pointContents: point => {
        const contents = scene.pointContents({ point, target: { kind: "world" }, policy: { kind: "q2", contentsMask: -1, leafContents: "merged" }, numeric, passActor: null });
        if (contents.kind !== "q2") throw new Error("Expected Q2 contents");
        return contents.merged;
      },
    };
    expect(services.pointContents(body.origin) & 32).toBe(32);
    expect(services.trace(body.origin, body.origin, body.bounds, 1 | 2 | 0x20000).startSolid).toBe(false);
    expect(steerQ2AlternateFly({ state, body, enemy, goal: null, flags: 2, now: 1, frameSeconds: 0.1 }, services))
      .toEqual({ kind: "steered", velocity: { x: 30, y: 0, z: 0 }, pitch: 0 });
    expect(random.capture().draws).toBe(0);
    const rising = { ...body, origin: { ...body.origin, z: -950 }, velocity: { x: 0, y: 0, z: 110 } };
    const above = { ...enemy, origin: { ...body.origin, z: -840 } };
    const savedState = structuredClone(state), savedRandom = random.capture();
    const input = { state, body: rising, enemy: above, goal: null, flags: 2, now: 1, frameSeconds: 0.1 };
    const recovered = steerQ2AlternateFly(input, services);
    expect(state.flyRecoveryTime).toBe(2);
    expect(random.capture().draws).toBe(3);
    expect(recovered.kind).toBe("steered");
    if (recovered.kind === "steered") expect(recovered.velocity.z).toBeLessThan(110);
    random.restore(savedRandom);
    expect(steerQ2AlternateFly({ ...input, state: savedState }, services)).toEqual(recovered);
    expect(savedState).toEqual(state);
    state.waterLevel = 2;
    const draws = random.capture().draws;
    expect(steerQ2AlternateFly(input, services)).toEqual({ kind: "steered", velocity: rising.velocity, pitch: null });
    expect(random.capture().draws).toBe(draws);
    expect(body.origin).toEqual({ x: 76, y: 1168, z: -1020 });
  } finally { await archive.close(); }
});
