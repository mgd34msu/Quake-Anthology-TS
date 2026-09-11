import type { SharedGrappleControl } from "../../../../contracts/equipment.ts";
/* ThreeWave CTF 5 rerelease source registration. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q1AddonContext } from "../context.ts";
import { CtfState } from "./state.ts";
import { CTF_FLAGS } from "./types.ts";
import type { Q1CtfServices } from "./types.ts";
import { registerFlags, dropFlag } from "./flags.ts";
import { unhook, grappleTrail } from "./grapple.ts";
import { registerArsenal, grappleAttack, spawnArsenal, characterPose } from "./arsenal.ts";
import { captureTravel, restoreTravel } from "./travel.ts";
import { registerRunes, dropRune, regenerate } from "./runes.ts";
import { registerCombat, scoreDeath } from "./scoring.ts";
import { checkTeam, checkTeamLock, observerImpulse, showTeamPrompt, spawnPoint } from "./teams.ts";
import { becomeObserver, observerFrame } from "./observer.ts";
import { registerMaps } from "./maps.ts";
import { registerDrops, tossAmmo, tossWeapon } from "./drops.ts";

/** Session lifecycle entry points; all mutations remain on shared actors and named source callbacks. */
export class Q1Ctf extends CtfState {
  constructor(context: Q1AddonContext, services: Q1CtfServices, sharedGrapple: SharedGrappleControl | null = null) {
    super(context, services, sharedGrapple);
    if (context.program !== "ctf") throw new Error("CTF requires the selected CTF source program");
    registerFlags(this); registerRunes(this); registerCombat(this); registerDrops(this); registerArsenal(this); registerMaps(this);
    this.game.registerPlayerExtension({ id: "ctf:spawn_parameters", captureTravel: (_runtime, player) => captureTravel(this, player.actor.id),
      restoreTravel: (_runtime, player, bytes) => restoreTravel(this, player.actor.id, bytes) });
  }
  /** Invoke on admission/respawn, after the selected character and arsenal are initialized. */
  spawnPlayer(actor: ActorId, firstAdmission: boolean): undefined {
    spawnArsenal(this, actor);
    if (this.sharedGrapple?.selection.kind === "disabled") this.grant(actor, "q1:ctf/weapon/grapple", 0);
    this.set(actor, "lastHurtCarrier", -10); this.set(actor, "regenTime", 0); this.set(actor, "runeNotice", 0);
    if (firstAdmission) {
      this.set(actor, "killed", 0);
      this.set(actor, "motd", 0);
      if ((this.teamplay & CTF_FLAGS.selectTeam) !== 0 && !this.startMap) becomeObserver(this, actor);
      else checkTeam(this, actor);
    } else if (this.services.observer(actor)) becomeObserver(this, actor);
    if (this.nativeGrappleEnabled && !this.startMap && !(this.teamplay & CTF_FLAGS.disableGrapple)) this.grant(actor, "q1:ctf/weapon/grapple", 1);
    this.set(actor, "stuffColor", 1); return this.update(actor);
  }
  selectSpawn(actor: ActorId) { return spawnPoint(this, actor); }
  characterPose(actor: ActorId) { return characterPose(this, actor); }
  fallDamageAllowed(actor: ActorId): boolean { return !this.grapplePulling(actor); }
  captureTravel(actor: ActorId): Uint8Array { return captureTravel(this, actor); }
  restoreTravel(actor: ActorId, bytes: Uint8Array): undefined { return restoreTravel(this, actor, bytes); }
  /** Source prethink, called once per player by the shared session even with foreign characters. */
  playerFrame(actor: ActorId): undefined {
    if (this.game.intermission !== null) return undefined;
    if (this.number(actor, "motd") === 2) {
      this.update(actor);
      if (this.services.observer(actor)) showTeamPrompt(this, actor);
      else this.game.message(actor, this.startMap ? "$qc_choose_exit" : this.team(actor) === "red" ? "$qc_ctf_red" : "$qc_ctf_blue");
    }
    if (this.number(actor, "motd") <= 2) this.set(actor, "motd", this.number(actor, "motd") + 1);
    if (observerImpulse(this, actor, this.services.isBot(actor) && this.team(actor) === null ? 103 : null)) return undefined;
    checkTeamLock(this, actor);
    if (this.services.observer(actor)) return observerFrame(this, actor);
    if (this.game.health(actor) <= 0) return undefined;
    regenerate(this, actor); return undefined;
  }
  afterPhysics(actor: ActorId): undefined { return grappleTrail(this, actor); }
  /** Returning true consumes only a CTF-specific command; the selected arsenal handles all others. */
  impulse(actor: ActorId): boolean {
    const input = this.services.input(actor);
    if (observerImpulse(this, actor)) return true;
    if (input.impulse === 22 || input.impulse === 1 && !input.grappleSelected) {
      if (!this.nativeGrappleEnabled || this.teamplay & CTF_FLAGS.disableGrapple) this.game.message(actor, "$qc_no_weapon"); else this.services.selectGrapple(actor);
    } else if (!this.services.observer(actor) && (this.teamplay & CTF_FLAGS.dropItems) && input.impulse === 20) tossAmmo(this, actor);
    else if (!this.services.observer(actor) && (this.teamplay & CTF_FLAGS.dropItems) && input.impulse === 21) tossWeapon(this, actor);
    else if (input.impulse === 25) {
      const names = [ [CTF_FLAGS.healthProtect, "Health-Protect"], [CTF_FLAGS.armorProtect, "Armor-Protect"], [CTF_FLAGS.reflectDamage, "Mirror-Damage"], [CTF_FLAGS.fragPenalty, "Frag-Penalty"], [CTF_FLAGS.deathPenalty, "Death-Penalty"], [CTF_FLAGS.staticTeams, "Static-Teams"], [CTF_FLAGS.dropItems, "Drop-Items (Backpack Impulse 20, Weapon Impulse 21)"] ] satisfies readonly (readonly [number, string])[];
      this.game.message(actor, this.teamplay < 0 ? `Frag Penalty: ${-this.teamplay}` : names.filter(([flag]) => (this.teamplay & flag) !== 0).map(([, name]) => name).join(" "), false);
    } else return false;
    this.services.consumeImpulse(actor); return true;
  }
  attack(actor: ActorId): boolean {
    const input = this.services.input(actor);
    if (!this.nativeGrappleEnabled || !input.grappleSelected || !input.attack || this.services.observer(actor) || this.game.health(actor) <= 0) return false;
    grappleAttack(this, actor); return true;
  }
  /** Replaces ordinary frag credit, before dropping the carried flag needed for bonuses. */
  death(victim: ActorId, attacker: ActorId | null): undefined {
    scoreDeath(this, victim, attacker); this.set(victim, "killed", 1);
    dropFlag(this, victim); dropRune(this, victim); return unhook(this, victim);
  }
  disconnectPlayer(actor: ActorId): undefined { dropFlag(this, actor); dropRune(this, actor); return unhook(this, actor); }
  suicide(actor: ActorId): undefined {
    if (this.services.observer(actor) || this.startMap) return undefined;
    if (this.number(actor, "suicideCount") > 3) return this.game.message(actor, "$qc_ctf_too_many_suicide");
    this.announce("$qc_suicides", actor); dropFlag(this, actor); dropRune(this, actor); unhook(this, actor);
    this.services.addScore(actor, -2); this.set(actor, "suicideCount", this.number(actor, "suicideCount") + 1);
    return this.services.respawn(actor, this.selectSpawn(actor));
  }
}
export function registerCTF(context: Q1AddonContext, services: Q1CtfServices, sharedGrapple: SharedGrappleControl | null = null): Q1Ctf { return new Q1Ctf(context, services, sharedGrapple); }
export { CTF_FLAGS, CTF_RUNES } from "./types.ts";
export { CTF_HASTE_INTERVALS, CTF_HASTE_NAIL_SPEED } from "./runes.ts";
export type { CtfCharacterPose } from "./arsenal.ts";
export type { CtfInput, CtfStatus, CtfTeam, CtfRune, Q1CtfServices } from "./types.ts";
