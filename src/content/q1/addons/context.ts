/* Quake rerelease source services. Copyright (C) 1996-2026 id Software LLC. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import { encodeCheckpointValue, decodeCheckpointValue } from "../../../persistence/value.ts";
import { SaveReader } from "../../../persistence/value.ts";
import type { Q1Base } from "../base/provider.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import { moveDirection } from "../foundation/entity.ts";
import type { Q1EntityServices } from "../foundation/entity-services.ts";
import { ZERO } from "../foundation/types.ts";
import { mg3RuneCount } from "./campaign.ts";

export type Q1AddonProgram = "dopa" | "mg1" | "mg3" | "ctf";
export type Q1AddonEvent =
  | { readonly kind: "music"; readonly track: number; readonly loopTrack: number }
  | { readonly kind: "sell-screen" }
  | { readonly kind: "alpha"; readonly actor: ActorId; readonly alpha: number }
  | { readonly kind: "rune-collected"; readonly player: ActorId; readonly bits: number; readonly program: Q1AddonProgram }
  | { readonly kind: "cutscene"; readonly camera: Vec3; readonly angles: Vec3 }
  | { readonly kind: "fog"; readonly player: ActorId | null; readonly density: number; readonly color: Vec3; readonly skyFactor: number; readonly duration: number }
  | { readonly kind: "punch-angle"; readonly player: ActorId; readonly angles: Vec3 }
  | { readonly kind: "view-roll"; readonly player: ActorId; readonly roll: number }
  | { readonly kind: "lightning"; readonly actor: ActorId; readonly style: 1 | 2 | 3; readonly start: Vec3; readonly end: Vec3 }
  | { readonly kind: "colored-explosion"; readonly origin: Vec3; readonly colorStart: number; readonly colorLength: number }
  | { readonly kind: "monster-count"; readonly count: number }
  | { readonly kind: "developer-message"; readonly text: string }
  | { readonly kind: "actor-effects"; readonly actor: ActorId; readonly effects: number }
  | { readonly kind: "debug-bounds"; readonly min: Vec3; readonly max: Vec3; readonly color: number; readonly lifetime: number; readonly depthTest: boolean };

export interface Q1AddonServices {
  cheatArsenal?(actor: ActorId, category: "weapons" | "ammo"): boolean;
  emit(event: Q1AddonEvent): undefined;
  isMonster(actor: ActorId): boolean;
  cvar(name: string): number;
  setCvar(name: string, value: string): undefined;
}

/** Source-private addon words share the base campaign flags and all gameplay authorities. */
export class Q1AddonContext {
  readonly game: Q1EntityServices;
  frameTime = 0;
  private readonly playerWords = new Map<OwnedActor, Map<string, number>>();
  private readonly playerReferences = new Map<OwnedActor, Map<string, ActorId | null>>();
  private readonly frameTicks: Q1Actor[] = [];

  constructor(readonly base: Q1Base, readonly program: Q1AddonProgram, readonly services: Q1AddonServices) {
    this.game = base.game;
    this.game.host.actors.onRelease(actor => { this.playerWords.delete(actor); this.playerReferences.delete(actor); const index = this.frameTicks.findIndex(entity => entity.actor === actor);
      if (index >= 0) this.frameTicks.splice(index, 1); return undefined; });
    this.game.registerStateExtension({ id: `q1:${program}:addons`, capture: () => encodeCheckpointValue({
      players: [...this.playerWords].map(([actor, words]) => ({ slot: actor.id.slot, generation: actor.id.generation, words: [...words] })),
      references: [...this.playerReferences].map(([actor, references]) => ({ slot: actor.id.slot, generation: actor.id.generation,
        values: [...references].map(([name, target]) => ({ name, target: target === null ? null : { slot: target.slot, generation: target.generation } })) })),
      ticks: this.frameTicks.map(entity => ({ slot: entity.actor.id.slot, generation: entity.actor.id.generation })),
    }), restore: bytes => {
      this.playerWords.clear();
      this.playerReferences.clear();
      const root = new SaveReader(decodeCheckpointValue(bytes), `q1:${program}:addons`);
      root.field("players").list(reader => {
        const actor = this.game.host.actors.resolveSaved({ slot: reader.field("slot").integer(0), generation: reader.field("generation").integer(0) });
        if (actor === null) return reader.fail("missing addon player");
        const words = new Map<string, number>();
        reader.field("words").list(pair => { const values = pair.list(value => value); const key = values[0], value = values[1];
          if (values.length !== 2 || key === undefined || value === undefined) return pair.fail("invalid addon player word");
          words.set(key.string(), value.number()); return undefined; });
        this.playerWords.set(actor, words); return undefined;
      });
      root.field("references").list(reader => {
        const actor = this.game.host.actors.resolveSaved({ slot: reader.field("slot").integer(0), generation: reader.field("generation").integer(0) });
        if (actor === null) return reader.fail("missing addon player references");
        const references = new Map<string, ActorId | null>();
        reader.field("values").list(value => { references.set(value.field("name").string(), value.field("target").nullable(target =>
          this.game.host.actors.referenceSaved({ slot: target.field("slot").integer(0), generation: target.field("generation").integer(0) }))); return undefined; });
        this.playerReferences.set(actor, references); return undefined;
      });
      this.frameTicks.length = 0;
      root.field("ticks").list(reader => {
        const actor = this.game.host.actors.resolveSaved({ slot: reader.field("slot").integer(0), generation: reader.field("generation").integer(0) });
        const entity = actor === null ? null : this.game.entity(actor.id);
        if (entity === null) return reader.fail("missing addon frame tick actor");
        this.frameTicks.push(entity); return undefined;
      });
      return undefined;
    } });
  }

  playerNumber(actor: ActorId, name: string): number {
    return this.playerWord(actor, name) ?? 0;
  }
  playerWord(actor: ActorId, name: string): number | undefined {
    const owner = this.game.host.actors.resolveOwned(actor);
    return owner === null ? undefined : this.playerWords.get(owner)?.get(name);
  }
  setPlayerNumber(actor: ActorId, name: string, value: number): undefined {
    const owner = this.game.host.actors.resolveOwned(actor);
    if (owner === null) throw new Error("Addon player is no longer admitted");
    let words = this.playerWords.get(owner);
    if (words === undefined) { words = new Map<string, number>(); this.playerWords.set(owner, words); }
    words.set(name, Math.fround(value)); return undefined;
  }
  playerReference(actor: ActorId, name: string): ActorId | null {
    const owner = this.game.host.actors.resolveOwned(actor);
    return owner === null ? null : this.playerReferences.get(owner)?.get(name) ?? null;
  }
  setPlayerReference(actor: ActorId, name: string, target: ActorId | null): undefined {
    const owner = this.game.host.actors.resolveOwned(actor);
    if (owner === null) throw new Error("Addon player is no longer admitted");
    let references = this.playerReferences.get(owner);
    if (references === undefined) { references = new Map<string, ActorId | null>(); this.playerReferences.set(owner, references); }
    references.set(name, target); return undefined;
  }
  setNumber(entity: Q1Actor, name: string, value: number): undefined { entity.fields.set(name, String(Math.fround(value))); return undefined; }
  setVector(entity: Q1Actor, name: string, value: Vec3): undefined { entity.fields.set(name, `${Math.fround(value.x)} ${Math.fround(value.y)} ${Math.fround(value.z)}`); return undefined; }
  alpha(entity: Q1Actor, alpha: number): undefined {
    this.setNumber(entity, "alpha", alpha); return this.services.emit({ kind: "alpha", actor: entity.actor.id, alpha });
  }
  broadcast(text: string): undefined { for (const player of this.game.host.players()) this.game.message(player, text); return undefined; }
  initTrigger(entity: Q1Actor): undefined {
    if (this.removedOutsideCoop(entity, false) || this.removedForRunes(entity)) return undefined;
    const angles = this.game.body(entity).angles;
    const direction = entity.fields.has("movedir") ? entity.vector("movedir") : entity.movedir;
    entity.movedir = angles.x === 0 && angles.y === 0 && angles.z === 0 || direction.x !== 0 || direction.y !== 0 || direction.z !== 0 ? direction : moveDirection(angles, this.game);
    entity.solid = "trigger"; entity.movement = "none"; entity.model = "";
    return this.game.setBody(entity, { angles: ZERO });
  }
  removedOutsideCoop(entity: Q1Actor, inhibitCoop = true): boolean {
    if (this.game.options.coop ? inhibitCoop && (entity.spawnflags & 131072) !== 0 : (entity.spawnflags & 32768) !== 0) {
      this.game.remove(entity); return true;
    }
    return false;
  }
  removedForRunes(entity: Q1Actor): boolean {
    if (this.program !== "mg3") return false;
    const flag = 262144 * 2 ** mg3RuneCount(this.base.campaign.readFlags());
    if ((entity.spawnflags & flag) === 0) return false;
    this.game.remove(entity); return true;
  }
  addFrameTick(entity: Q1Actor, name: string): undefined {
    entity.fields.set("addon.frameTick", name); this.frameTicks.unshift(entity); return undefined;
  }
  removeFrameTick(entity: Q1Actor): undefined {
    const index = this.frameTicks.indexOf(entity); if (index >= 0) this.frameTicks.splice(index, 1); return undefined;
  }
  /** Called by the existing source frame phase; this does not advance simulation time. */
  frame(seconds: number): undefined {
    this.frameTime = seconds;
    for (const entity of [...this.frameTicks]) {
      const tick = entity.text("addon.frameTick");
      if (tick !== "" && this.game.live(entity)) this.game.named.action(entity, tick)();
    }
    return undefined;
  }
}
