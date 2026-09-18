import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Q1Foundation } from "../../q1/foundation/runtime.ts";
import type { Q1ClientAdmission, Q1ClientSnapshot, Q1CompositionServices, Q1SourceProgram } from "./types.ts";
import { SaveReader, decodeCheckpointValue, encodeCheckpointValue } from "../../../persistence/value.ts";

export class Q1SourceClient {
  readonly userinfo: Map<string, string>;
  frags = 0;
  team = 0;
  observer = false;
  noTarget = false;
  godMode = false;
  impulse = 0;
  use = false;
  deathRecorded = false;
  respawnRequestedAt = -1;
  constructor(readonly actor: OwnedActor, readonly slot: number, userinfo: ReadonlyMap<string, string>) { this.userinfo = new Map(userinfo); }
  get name(): string { return this.userinfo.get("name") || "unconnected"; }
  get shirt(): number { return color(this.userinfo.get("topcolor")); }
  get pants(): number { return color(this.userinfo.get("bottomcolor")); }
  get snapshot(): Q1ClientSnapshot { return { actor: this.actor.id, slot: this.slot, name: this.name, frags: this.frags, shirt: this.shirt, pants: this.pants, team: this.team, observer: this.observer, noTarget: this.noTarget, userinfo: [...this.userinfo].map(([key, value]) => ({ key, value })) }; }
}
function color(value: string | undefined): number { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? Math.max(0, Math.min(13, Math.trunc(parsed))) : 0; }

/** Native client globals on the same source actors as the selected character. */
export class Q1SourceClients {
  readonly records = new Map<OwnedActor, Q1SourceClient>();
  redCaptures = 0;
  blueCaptures = 0;
  constructor(readonly game: Q1Foundation, readonly program: Q1SourceProgram, readonly services: Q1CompositionServices) {
    game.host.actors.onRelease(actor => { this.records.delete(actor); return undefined; });
  }
  get(actor: ActorId): Q1SourceClient | null { const owner = this.game.host.actors.resolveOwned(actor); return owner === null ? null : this.records.get(owner) ?? null; }
  require(actor: ActorId): Q1SourceClient { const client = this.get(actor); if (client === null) throw new Error("Q1 source client is not admitted"); return client; }
  attach(actor: OwnedActor, admission: Q1ClientAdmission): Q1SourceClient {
    this.game.host.actors.assertOwned(actor);
    if (this.records.has(actor) || [...this.records.values()].some(client => client.slot === admission.slot)) throw new Error("Q1 source client slot is already admitted");
    if (!Number.isSafeInteger(admission.slot) || admission.slot < 0 || admission.slot >= (this.game.options.maxClients ?? 1)) throw new Error("Q1 source client slot is out of range");
    const client = new Q1SourceClient(actor, admission.slot, admission.userinfo); client.team = client.pants + 1; this.records.set(actor, client); this.applyPlayerSettings(client); this.publish(client); return client;
  }
  update(actor: ActorId, userinfo: ReadonlyMap<string, string>): undefined {
    const client = this.require(actor), previous = client.pants; client.userinfo.clear(); for (const [key, value] of userinfo) client.userinfo.set(key, value);
    if (client.pants !== previous) client.team = client.pants + 1;
    this.applyPlayerSettings(client); return this.publish(client);
  }
  colors(actor: ActorId, shirt: number, pants: number): undefined {
    const client = this.require(actor); client.userinfo.set("topcolor", String(color(String(shirt)))); client.userinfo.set("bottomcolor", String(color(String(pants))));
    client.team = client.pants + 1;
    this.applyPlayerSettings(client); return this.publish(client);
  }
  teamColor(actor: ActorId): number { return this.require(actor).team; }
  spawned(actor: ActorId): undefined {
    const client = this.require(actor);
    client.godMode = false;
    if (this.game.options.edition === "rerelease" && this.program !== "ctf") {
      if (this.game.options.coop) client.team = 1;
      else if (this.program === "id1") client.team = -1;
    }
    this.applyPlayerSettings(client); return this.publish(client);
  }
  private applyPlayerSettings(client: Q1SourceClient): undefined {
    const team = this.program === "ctf" ? client.team === 5 ? "red" : client.team === 14 ? "blue" : null : client.team > 0 ? String(client.team) : null;
    this.game.host.combat.setTraits(client.actor, { team });
    const player = this.game.player(client.actor.id), autoSwitch = client.userinfo.get("qts_weapon_autoswitch");
    if (player !== null && autoSwitch !== undefined) player.autoSwitch = autoSwitch === "new" || autoSwitch === "never" ? autoSwitch : "always";
    return undefined;
  }
  addScore(actor: ActorId, delta: number): undefined { const client = this.require(actor); client.frags = Math.fround(client.frags + delta); return this.publish(client); }
  setObserver(actor: ActorId, observer: boolean): undefined {
    const client = this.require(actor); client.observer = observer; this.services.setObserver(actor, observer); return this.publish(client);
  }
  publish(client: Q1SourceClient): undefined { return this.services.emit({ kind: "client", client: client.snapshot }); }
  capture(): Uint8Array {
    return encodeCheckpointValue({ version: 1, program: this.program, redCaptures: this.redCaptures, blueCaptures: this.blueCaptures, clients: [...this.records.values()].map(client => ({
      actor: { slot: client.actor.id.slot, generation: client.actor.id.generation }, slot: client.slot, userinfo: [...client.userinfo].map(([key, value]) => ({ key, value })), frags: client.frags, team: client.team,
      observer: client.observer, noTarget: client.noTarget, godMode: client.godMode, impulse: client.impulse, use: client.use, deathRecorded: client.deathRecorded, respawnRequestedAt: client.respawnRequestedAt,
    })) });
  }
  restore(bytes: Uint8Array): undefined {
    const reader = new SaveReader(decodeCheckpointValue(bytes), "q1:source-clients"); reader.field("version").literal(1); reader.field("program").literal(this.program);
    this.redCaptures = reader.field("redCaptures").integer(0); this.blueCaptures = reader.field("blueCaptures").integer(0); this.records.clear();
    reader.field("clients").list(saved => {
      const id = saved.field("actor"), actor = this.game.host.actors.resolveSaved({ slot: id.field("slot").integer(0), generation: id.field("generation").integer(0) }); if (actor === null) return id.fail("missing source client actor");
      const slot = saved.field("slot").integer(0); if ([...this.records.values()].some(client => client.slot === slot)) return saved.fail("duplicate source client slot");
      const userinfo = new Map<string, string>(); saved.field("userinfo").list(entry => { userinfo.set(entry.field("key").string(), entry.field("value").string()); return undefined; });
      const client = new Q1SourceClient(actor, slot, userinfo); client.frags = saved.field("frags").finite(); client.observer = saved.field("observer").boolean(); client.impulse = saved.field("impulse").integer(0); client.use = saved.field("use").boolean(); client.deathRecorded = saved.field("deathRecorded").boolean();
      client.respawnRequestedAt = saved.field("respawnRequestedAt").finite();
      client.noTarget = saved.field("noTarget").boolean();
      const godMode = saved.field("godMode"); client.godMode = godMode.value === undefined ? false : godMode.boolean();
      client.team = saved.field("team").finite();
      this.records.set(actor, client); return undefined;
    }); return undefined;
  }
}
