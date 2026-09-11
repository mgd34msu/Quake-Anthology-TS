import type { ActorId, OwnedActor } from "../../../../contracts/identity.ts";
import { sameActor } from "../../../../contracts/identity.ts";
import type { ItemId } from "../../../../contracts/gameplay.ts";
import type { BodyState } from "../../../../contracts/world.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1AddonContext } from "../context.ts";
import { CTF_RUNES } from "./types.ts";
import type { CtfRune, CtfTeam, Q1CtfServices } from "./types.ts";

export const teamNumber = (team: CtfTeam | null): number => team === "red" ? 5 : team === "blue" ? 14 : 0;
export const numberTeam = (value: number): CtfTeam | null => value === 5 ? "red" : value === 14 ? "blue" : null;
export const opposite = (team: CtfTeam): CtfTeam => team === "red" ? "blue" : "red";
export const runeItem = (rune: CtfRune): ItemId => `q1:ctf/rune/${rune}`;

export class CtfState {
  constructor(readonly context: Q1AddonContext, readonly services: Q1CtfServices) {}
  get game() { return this.context.game; }
  get teamplay(): number { return this.context.services.cvar("teamplay"); }
  get startMap(): boolean { return this.game.mapName === "start"; }
  get world(): Q1Actor { const world = this.game.world; if (world === null) throw new Error("CTF map has no world actor"); return world; }
  owner(actor: ActorId): OwnedActor { const owner = this.game.host.actors.resolveOwned(actor); if (owner === null) throw new Error("CTF player is no longer admitted"); return owner; }
  body(actor: ActorId): BodyState { const body = this.game.host.bodies.read(actor); if (body === null) throw new Error("CTF actor has no shared body"); return body; }
  writeBody(actor: ActorId, patch: Partial<BodyState>): undefined { this.game.host.bodies.write(this.owner(actor), { ...this.body(actor), ...patch }); return this.game.host.bodies.link(this.owner(actor)); }
  number(actor: ActorId, name: string): number { return this.context.playerNumber(actor, `ctf.${name}`); }
  set(actor: ActorId, name: string, value: number): undefined { return this.context.setPlayerNumber(actor, `ctf.${name}`, value); }
  team(actor: ActorId): CtfTeam | null { const value = this.game.host.combat.read(actor)?.team; return value === "red" || value === "blue" ? value : null; }
  lastTeam(actor: ActorId): CtfTeam | null { return numberTeam(this.number(actor, "lastteam")); }
  flag(team: CtfTeam): Q1Actor | null { return [...this.game.entities.values()].find(entity => entity.classname === (team === "red" ? "item_flag_team1" : "item_flag_team2")) ?? null; }
  flagTeam(flag: Q1Actor): CtfTeam { return flag.classname === "item_flag_team1" ? "red" : "blue"; }
  carried(actor: ActorId): Q1Actor | null { return [...this.game.entities.values()].find(entity => entity.classname.startsWith("item_flag_team") && entity.count === 1 && entity.owner !== null && sameActor(entity.owner, actor)) ?? null; }
  hook(actor: ActorId): Q1Actor | null { return [...this.game.entities.values()].find(entity => entity.classname === "ctf_hook" && entity.owner !== null && sameActor(entity.owner, actor)) ?? null; }
  rune(actor: ActorId): CtfRune | null { return CTF_RUNES.find(rune => this.game.host.inventory.count(actor, runeItem(rune)) > 0) ?? null; }
  grant(actor: ActorId, item: ItemId, count: number, capacity = 1): undefined {
    this.game.host.inventory.configure(this.owner(actor), { item, count, capacity }); return undefined;
  }
  announce(key: string, actor?: ActorId, extra = ""): undefined {
    const args: string[] = []; if (actor !== undefined) args.push(this.services.name(actor)); if (extra !== "") args.push(extra);
    for (const player of this.game.host.players()) this.game.message(player, key, false, args); return undefined;
  }
  update(player?: ActorId): undefined {
    let flags = 0;
    for (const [index, team] of (["red", "blue"] satisfies readonly CtfTeam[]).entries()) {
      const flag = this.flag(team); flags |= (flag === null ? 1 : 1 << flag.count) << (index * 3);
    }
    for (const actor of player === undefined ? this.game.host.players() : [player]) {
      const rune = this.rune(actor), ordinal = rune === null ? -1 : CTF_RUNES.indexOf(rune);
      this.services.status(actor, { red: this.services.captures("red"), blue: this.services.captures("blue"), flags, runeItems: ordinal < 0 ? 0 : 32 << ordinal });
    }
    return undefined;
  }
}
