/* WinQuake/pr_cmds.c PF_newcheckclient/PF_checkclient. GPL-2.0-or-later. */
import type { ActorId } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { NumericOperations } from "../../contracts/numeric.ts";
import { SaveReader } from "../../persistence/value.ts";
import type { SharedSceneQueries } from "../collision/index.ts";

export interface Q1ClientEye { readonly origin: Vec3; readonly viewOffset: Vec3; }
export interface Q1VisibilityClient extends Q1ClientEye {
  readonly actor: ActorId | null;
  readonly free: boolean;
  readonly health: number;
  readonly notarget: boolean;
}
export interface Q1ClientVisibilityState {
  readonly lastCheckSlot: number;
  readonly lastCheckTime: number;
  readonly checkedCluster: number | null;
}
export type Q1ClientVisibilityScene = Pick<SharedSceneQueries, "geometry" | "pointLeaf" | "leafCluster" | "clusterVisible">;

/** Client numbers are reserved source slots, independent of shared actor identities. */
export class Q1ClientVisibility {
  private state: Q1ClientVisibilityState = { lastCheckSlot: 0, lastCheckTime: 0, checkedCluster: null };
  private readonly maximumCluster: number;
  constructor(readonly services: {
    readonly maxClients: number;
    readonly client: (slot: number) => Q1VisibilityClient;
    readonly visibility: Q1ClientVisibilityScene;
  }) {
    if (!Number.isSafeInteger(services.maxClients) || services.maxClients < 1) throw new RangeError("Q1 visibility requires reserved client slots");
    this.maximumCluster = services.visibility.geometry.leaves.reduce((maximum, _leaf, index) => Math.max(maximum, services.visibility.leafCluster(index)), -1);
  }
  private eyeCluster(eye: Q1ClientEye, numeric: NumericOperations): number {
    const { origin, viewOffset } = eye;
    return this.services.visibility.leafCluster(this.services.visibility.pointLeaf({
      x: numeric.add(origin.x, viewOffset.x), y: numeric.add(origin.y, viewOffset.y), z: numeric.add(origin.z, viewOffset.z),
    }));
  }
  check(observer: Q1ClientEye, timeSeconds: number, numeric: NumericOperations): ActorId | null {
    if (timeSeconds - this.state.lastCheckTime >= 0.1) {
      const previous = Math.max(1, Math.min(this.services.maxClients, this.state.lastCheckSlot));
      let slot = previous === this.services.maxClients ? 1 : previous + 1;
      let client = this.services.client(slot);
      for (;;) {
        if (slot === previous || (!client.free && !(client.health <= 0) && !client.notarget)) break;
        slot = slot === this.services.maxClients ? 1 : slot + 1;
        client = this.services.client(slot);
      }
      this.state = { lastCheckSlot: slot, lastCheckTime: timeSeconds, checkedCluster: this.eyeCluster(client, numeric) };
    }
    const client = this.services.client(this.state.lastCheckSlot);
    if (client.free || client.health <= 0 || this.state.checkedCluster === null) return null;
    const observerCluster = this.eyeCluster(observer, numeric);
    return this.services.visibility.clusterVisible(this.state.checkedCluster, observerCluster, "pvs") ? client.actor : null;
  }
  capture(): Q1ClientVisibilityState { return { ...this.state }; }
  restore(value: unknown): undefined {
    const reader = new SaveReader(value, "q1-client-visibility");
    const lastCheckSlot = reader.field("lastCheckSlot").integer(0), lastCheckTime = reader.field("lastCheckTime").finite();
    const checkedCluster = reader.field("checkedCluster").nullable(value => value.integer(-1));
    if (lastCheckSlot > this.services.maxClients || lastCheckTime < 0 || (checkedCluster !== null && checkedCluster > this.maximumCluster)) reader.fail("visibility cache outside source range");
    if ((lastCheckSlot === 0) !== (checkedCluster === null) || (lastCheckSlot === 0 && lastCheckTime !== 0)) reader.fail("invalid initial visibility cache");
    this.state = { lastCheckSlot, lastCheckTime, checkedCluster };
    return undefined;
  }
}
