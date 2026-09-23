import type { ExecutableRecipe } from "../../../../contracts/content.ts";
import type { Q3MovementState, MovementEnvironment, ArsenalState, ActorAnimationState } from "../../../../contracts/movement.ts";
import { createNumericOperations } from "../../../../core/numeric.ts";
import { Q3_WEAPON_ITEMS, q3WeaponItem, q3SpawnArsenalRuntime } from "../../../../content/q3/foundation/arsenal.ts";
import { Powerup, statSchema } from "../../../../content/q3/base/shared/definitions.ts";
import { itemAt } from "../../../../content/q3/base/shared/items.ts";
import { MoveFlags } from "../../../../movement/q3/constants.ts";
import { fromQ3PlayerState } from "../../../../network/q3/adapters.ts";
import type { Q3ApplicationPlayer } from "../../network/q3-types.ts";
import { locomotionTemplate, type MovementPredictionPlayer } from "../player-movement.ts";
import type { Q3QvmServerGame } from "./guest-runtime.ts";

/** Read public VM records at use time; navigation never owns a second gameplay player. */
export function guestMovementProjection(guest: Q3QvmServerGame, player: Q3ApplicationPlayer, recipe: ExecutableRecipe): MovementPredictionPlayer {
  const template = locomotionTemplate(recipe), profile = template.profile;
  if (profile.kind !== "q3") throw new Error("QVM movement projection requires its selected movement adapter");
  const product = recipe.map.entities.content.includes(":missionpack:") ? "missionpack" : "baseq3";
  const schema = statSchema(product), provider = recipe.weapons[0]?.provider ?? recipe.map.entities.provider;
  const state = () => guest.records.player(player.sourceEntity);
  const powerup = (slot: number): boolean => (state().powerups[slot] ?? 0) !== 0;
  const environment = (): MovementEnvironment => ({ health: state().stats[0] ?? 0, flight: powerup(Powerup.PW_FLIGHT),
    haste: powerup(Powerup.PW_HASTE), invulnerable: product === "missionpack" && powerup(Powerup.PW_INVULNERABILITY), gravityMultiplier: 1 });
  return {
    ...template, client: player.client, actor: guest.records.actor(player.sourceEntity),
    services: { numeric: createNumericOperations(profile.numeric) }, gravityMultiplier: 1, movementSpeedMultiplier: 1,
    get flight() { return environment().flight; },
    get worldGravity() { return state().gravity; },
    get sourceEnvironment() { return environment(); },
    get sourceMovement() {
      const ps = state(), cvars = guest.state.cvars;
      return { traceMask: (ps.stats[0] ?? 0) <= 0 ? 0x10001 : 0x02010001,
        fixedMsec: cvars.variableValue("pmove_fixed") === 0 ? null : Math.max(8, Math.min(33, cvars.variableValue("pmove_msec"))),
        noFootsteps: cvars.variableValue("dmflags") !== 0 && (cvars.variableValue("dmflags") & 32) !== 0,
        gauntletHit: false, debugLevel: 0 };
    },
    get bounds() { const entity = guest.records.entity(player.sourceEntity); return { min: entity.r.mins, max: entity.r.maxs }; },
    get viewHeight() { return state().viewHeight; },
    get state(): Q3MovementState {
      const ps = state();
      return { ...ps, kind: "q3", ground: ps.groundEntityNumber === 1022 ? { kind: "world", model: 0 }
        : ps.groundEntityNumber === 1023 ? { kind: "none" } : { kind: "actor", actor: guest.records.actor(ps.groundEntityNumber).id },
        predictableEventSequence: ps.eventSequence, jumpPad: ps.jumpPadEntity === 0 ? null : guest.records.reference(ps.jumpPadEntity),
        movementFrame: ps.movementFrameCount };
    },
    get arsenal(): ArsenalState {
      const ps = state();
      return { provider, activeWeapon: q3WeaponItem(ps.weapon)?.item ?? null,
        state: { kind: "q3", sourceWeapon: ps.weapon, state: ps.weaponState, timeMilliseconds: ps.weaponTimeMilliseconds },
        ammo: Q3_WEAPON_ITEMS.filter(item => product === "missionpack" || item.weapon < 11).flatMap(item => {
          const entries = [{ item: item.item, count: ((ps.stats[schema.weapons] ?? 0) & (1 << item.weapon)) === 0 ? 0 : 1, capacity: 1 }];
          if (item.ammo !== null) entries.push({ item: item.ammo, count: ps.ammo[item.weapon] ?? 0, capacity: 200 });
          return entries;
        }) };
    },
    get animation(): ActorAnimationState {
      const ps = state();
      return { provider: recipe.character.definition.provider, state: { kind: "q3", legs: ps.legsAnimation, torso: ps.torsoAnimation,
        legsTimerMilliseconds: ps.legsTimerMilliseconds, torsoTimerMilliseconds: ps.torsoTimerMilliseconds } };
    },
    get q3Arsenal() {
      const ps = fromQ3PlayerState(state(), product), holdableItem = ps.stats.get(schema.holdableItem);
      return { ...q3SpawnArsenalRuntime(product, ps.stats.get(0)), maxHealth: ps.stats.get(schema.maxHealth), spectator: ps.pmType === 1,
        persistentPowerupTag: schema.product === "missionpack" ? itemAt(product, ps.stats.get(schema.persistentPowerup)).tag : 0,
        holdableItem, holdableTag: itemAt(product, holdableItem).tag, respawned: (ps.pmFlags & MoveFlags.RESPAWNED) !== 0,
        useItemHeld: (ps.pmFlags & MoveFlags.USE_ITEM_HELD) !== 0, eventSequence: ps.eventSequence };
    },
  };
}
