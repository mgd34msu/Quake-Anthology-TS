import { SaveReader } from "../../../../persistence/value.ts";
// Ported from id Software's code/game/g_misc.c missionpack personal portals.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.

import { vec3 } from "../../../../core/math.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { ServerWorld } from "../world.ts";
import { Powerup, statSchema } from "../shared/definitions.ts";
import { findItem, findItemForPowerup, itemList } from "../shared/items.ts";
import { damage, DamageFlags } from "./combat.ts";
import type { CombatContext } from "./combat.ts";
import { setOrigin } from "./entities.ts";
import { dropItem } from "./item-motion.ts";
import type { DropItemContext, LaunchItemContext } from "./item-motion.ts";
import { teleportPlayer } from "./misc.ts";
import { snapVector } from "./missile.ts";
import type { GameRandom } from "./numeric.ts";
import { GameEntity } from "./state.ts";
import { findEntity } from "./utilities.ts";
import type { ConfigStringRegistry } from "./utilities.ts";

const CONTENTS_CORPSE = 0x4000000;
const CONTENTS_TRIGGER = 0x40000000;
const MOD_TELEFRAG = 18;
const PORTAL_HEALTH = 200;
const PORTAL_ENABLE_DELAY = 1_000;
const PORTAL_LIFETIME = 2 * 60 * 1_000;
const PORTAL_DESTINATION = "hi_portal destination";
const PORTAL_SOURCE = "hi_portal source";

export type PersonalPortalHost = {
  readonly combat: Extract<CombatContext, { product: "missionpack" }>;
  readonly world: ServerWorld;
  readonly models: Pick<ConfigStringRegistry, "modelIndex">;
  readonly random: Pick<GameRandom, "random">;
} & ({
  readonly items: Pick<LaunchItemContext, "touchItem" | "droppedFlagThink" | "checkDroppedTeamItem">;
  readonly mapTravel?: undefined;
} | {
  readonly mapTravel: {
    dropCarriedFlag(player: GameEntity): void;
    teleport(player: GameEntity, origin: Vec3, angles: Vec3): void;
  };
});

/** Owns level.portalSequence and the source/destination entity lifecycle. */
export class PersonalPortalRuntime {
  captureSaveState() { return { portalSequence: this.#portalSequence }; }
  restoreSaveState(value: unknown): void {
    const reader = new SaveReader(value, "q3.portals").field("portalSequence"), sequence = reader.integer(-2147483648);
    if (sequence > 2147483647) reader.fail("portal sequence exceeds source integer range");
    this.#portalSequence = sequence;
  }

  #portalSequence = 0;

  constructor(readonly host: PersonalPortalHost) {
    if (host.combat.entities.options.product !== "missionpack") {
      throw new Error("Personal portals require a missionpack entity pool");
    }
    if (!Object.is(host.combat.spatial, host.world)) {
      throw new Error("Personal portal combat and collision worlds must match");
    }

    this.bindSaveCallbacks();
  }

  private get time(): number { return this.host.combat.time; }

  private owned(entity: GameEntity): void {
    if (this.host.combat.entities.get(entity.slot) !== entity) {
      throw new Error("Personal portal entity does not belong to its entity pool or was replaced");
    }
  }

  private player(entity: GameEntity) {
    this.owned(entity);
    if (entity.client === null) throw new Error("Personal portal use requires a client entity");
    return entity.client;
  }

  private freePortal(entity: GameEntity): void {
    this.owned(entity);
    this.host.combat.entities.free(entity);
  }

  private dropContext(items: Pick<LaunchItemContext, "touchItem" | "droppedFlagThink" | "checkDroppedTeamItem">): DropItemContext {
    return {
      entities: this.host.combat.entities,
      product: "missionpack",
      gameType: this.host.combat.gameType,
      time: this.time,
      touchItem: items.touchItem,
      droppedFlagThink: items.droppedFlagThink,
      checkDroppedTeamItem: items.checkDroppedTeamItem,
      random: (): number => this.host.random.random(),
    };
  }

  private destination(sequence: number): GameEntity | null {
    let destination: GameEntity | null = null;
    while ((destination = findEntity(this.host.combat.entities, destination, "classname", PORTAL_DESTINATION)) !== null) {
      if (destination.count === sequence) return destination;
    }
    return null;
  }

  private portalDie(entity: GameEntity): void {
    this.freePortal(entity);
  }

  private dropCarriedFlag(player: GameEntity): void {
    if (this.host.mapTravel !== undefined) { this.host.mapTravel.dropCarriedFlag(player); return; }
    const client = player.client;
    if (client === null) throw new Error("Portal touch requires a client entity");
    const powerup = client.ps.powerups.get(Powerup.PW_NEUTRALFLAG) !== 0 ? Powerup.PW_NEUTRALFLAG
      : client.ps.powerups.get(Powerup.PW_REDFLAG) !== 0 ? Powerup.PW_REDFLAG
        : client.ps.powerups.get(Powerup.PW_BLUEFLAG) !== 0 ? Powerup.PW_BLUEFLAG : Powerup.PW_NONE;
    if (powerup === Powerup.PW_NONE) return;
    const item = findItemForPowerup("missionpack", powerup);
    if (item === null) throw new Error(`Portal carried flag ${powerup} is absent from the missionpack item table`);
    dropItem(this.dropContext(this.host.items), player, item, 0);
    client.ps.powerups.set(powerup, 0);
  }

  private portalTouch(source: GameEntity, other: GameEntity): void {
    this.owned(source);
    if (other.health <= 0 || other.client === null) return;
    this.owned(other);
    this.dropCarriedFlag(other);
    const destination = this.destination(source.count);
    if (destination === null) {
      if (source.pos1.x !== 0 || source.pos1.y !== 0 || source.pos1.z !== 0) {
        this.teleport(other, source.pos1, source.s.angles);
      }
      damage(this.host.combat, other, other, other, null, null, 100_000, DamageFlags.NO_PROTECTION, MOD_TELEFRAG);
      return;
    }
    this.teleport(other, destination.s.pos.base, destination.s.angles);
  }

  private teleport(player: GameEntity, origin: Vec3, angles: Vec3): void {
    if (this.host.mapTravel !== undefined) this.host.mapTravel.teleport(player, origin, angles);
    else teleportPlayer({ combat: this.host.combat, world: this.host.world }, player, origin, angles);
  }

  private portalEnable(source: GameEntity): void {
    this.owned(source);
    source.touch = this.host.combat.entities.callbacks.touch.resolve("q3.base.game.personal-portal.portalEnable.touch");
    source.think = this.host.combat.entities.callbacks.think.resolve("q3.base.game.personal-portal.portalEnable.think");
    source.nextthink = (this.time + PORTAL_LIFETIME) | 0;
  }

  dropPortalDestination(player: GameEntity): void {
    const client = this.player(player);
    const portal = this.host.combat.entities.spawn();
    portal.s.modelindex = this.host.models.modelIndex("models/powerups/teleporter/tele_exit.md3");
    setOrigin(portal, snapVector(player.s.pos.base));
    portal.r.mins = vec3(player.r.mins.x, player.r.mins.y, player.r.mins.z);
    portal.r.maxs = vec3(player.r.maxs.x, player.r.maxs.y, player.r.maxs.z);
    portal.classname = PORTAL_DESTINATION;
    portal.r.contents = CONTENTS_CORPSE;
    portal.takedamage = true;
    portal.health = PORTAL_HEALTH;
    portal.die = this.host.combat.entities.callbacks.die.resolve("q3.base.game.personal-portal.dropPortalDestination.die");
    portal.s.angles = vec3(player.s.apos.base.x, player.s.apos.base.y, player.s.apos.base.z);
    portal.think = this.host.combat.entities.callbacks.think.resolve("q3.base.game.personal-portal.portalEnable.think");
    portal.nextthink = (this.time + PORTAL_LIFETIME) | 0;
    this.host.world.link(portal);
    this.#portalSequence = (this.#portalSequence + 1) | 0;
    client.portalID = this.#portalSequence;
    portal.count = client.portalID;
    const item = findItem("missionpack", "Portal");
    if (item === null) throw new Error("Portal holdable is absent from the missionpack item table");
    const index = itemList("missionpack").indexOf(item);
    if (index < 1) throw new Error("Portal holdable has no missionpack item index");
    client.ps.stats.set(statSchema("missionpack").holdableItem, index);
  }

  dropPortalSource(player: GameEntity): void {
    const client = this.player(player);
    const portal = this.host.combat.entities.spawn();
    portal.s.modelindex = this.host.models.modelIndex("models/powerups/teleporter/tele_enter.md3");
    setOrigin(portal, snapVector(player.s.pos.base));
    portal.r.mins = vec3(player.r.mins.x, player.r.mins.y, player.r.mins.z);
    portal.r.maxs = vec3(player.r.maxs.x, player.r.maxs.y, player.r.maxs.z);
    portal.classname = PORTAL_SOURCE;
    portal.r.contents = CONTENTS_CORPSE | CONTENTS_TRIGGER;
    portal.takedamage = true;
    portal.health = PORTAL_HEALTH;
    portal.die = this.host.combat.entities.callbacks.die.resolve("q3.base.game.personal-portal.dropPortalDestination.die");
    this.host.world.link(portal);
    portal.count = client.portalID;
    client.portalID = 0;
    portal.nextthink = (this.time + PORTAL_ENABLE_DELAY) | 0;
    portal.think = this.host.combat.entities.callbacks.think.resolve("q3.base.game.personal-portal.dropPortalSource.think");
    const destination = this.destination(portal.count);
    if (destination !== null) {
      portal.pos1 = vec3(destination.s.pos.base.x, destination.s.pos.base.y, destination.s.pos.base.z);
    }
  }

  bindSaveCallbacks(): void {
    this.host.combat.entities.callbacks.touch.intern("q3.base.game.personal-portal.portalEnable.touch", (self, other) => { if (other instanceof GameEntity) this.portalTouch(self, other); });
    this.host.combat.entities.callbacks.think.intern("q3.base.game.personal-portal.portalEnable.think", self => { this.freePortal(self); });
    this.host.combat.entities.callbacks.die.intern("q3.base.game.personal-portal.dropPortalDestination.die", self => { this.portalDie(self); });
    this.host.combat.entities.callbacks.think.intern("q3.base.game.personal-portal.dropPortalSource.think", self => { this.portalEnable(self); });
  }
}
