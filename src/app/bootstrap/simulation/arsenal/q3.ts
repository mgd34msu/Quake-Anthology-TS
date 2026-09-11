import type { ArsenalIntent, ItemId } from "../../../../contracts/gameplay.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../../../contracts/identity.ts";
import type { ArsenalState, WeaponStepInput, WeaponStepResult } from "../../../../contracts/movement.ts";
import { Q3_WEAPON_ITEMS, q3SpawnArsenalRuntime, q3SpawnLoadout, q3SpawnAnimation, q3WeaponItem, stepQ3Arsenal } from "../../../../content/q3/foundation/arsenal.ts";
import type { Q3ArsenalRuntimeState } from "../../../../content/q3/foundation/arsenal.ts";
import { ItemType } from "../../../../content/q3/base/shared/definitions.ts";
import { itemList } from "../../../../content/q3/base/shared/items.ts";
import { EntityEvent } from "../../../../movement/q3/constants.ts";
import { readInventoryEntry } from "../../../../persistence/save-image.ts";
import { namespaced } from "../../../../persistence/value.ts";
import type { SaveReader } from "../../../../persistence/value.ts";
import type { SharedInventoryTable } from "../../../../world/gameplay/inventory.ts";
import { resolveQ3ArsenalControls } from "../arsenal-intent.ts";
import type { PlayerUi } from "../types.ts";
import type { SelectedArsenal } from "./selected.ts";

export interface Q3SelectedArsenalOptions {
  readonly provider: ProviderId;
  readonly product: "baseq3" | "missionpack";
  readonly inventory: SharedInventoryTable;
  fire(actor: OwnedActor, weapon: number, input: WeaponStepInput): undefined;
  useHoldable(actor: OwnedActor, event: number, input: WeaponStepInput): undefined;
}

export interface Q3SelectedArsenalCheckpoint {
  readonly arsenal: ArsenalState;
  readonly runtime: Q3ArsenalRuntimeState;
  readonly requestedWeapon: ItemId | null;
  readonly torsoAnimation: number;
  readonly lastFireMilliseconds: number | null;
}

interface PlayerArsenal {
  readonly actor: OwnedActor;
  arsenal: ArsenalState;
  runtime: Q3ArsenalRuntimeState;
  requestedWeapon: ItemId | null;
  torsoAnimation: number;
  lastFireMilliseconds: number | null;
}

export class Q3SelectedArsenal implements SelectedArsenal {
  readonly family = "q3";
  readonly provider: ProviderId;
  private readonly players = new Map<ActorId, PlayerArsenal>();

  constructor(private readonly options: Q3SelectedArsenalOptions) { this.provider = options.provider; }

  admit(actor: OwnedActor, maxHealth: number, teamDeathmatch = false): ArsenalState {
    if (this.players.has(actor.id)) throw new Error("Selected Q3 arsenal already admitted");
    const arsenal = q3SpawnLoadout(this.provider, this.options.product, teamDeathmatch);
    for (const entry of arsenal.ammo) this.options.inventory.configure(actor, entry);
    this.players.set(actor.id, { actor, arsenal, runtime: q3SpawnArsenalRuntime(this.options.product, maxHealth), requestedWeapon: null, torsoAnimation: q3SpawnAnimation().torso, lastFireMilliseconds: null });
    return this.read(actor.id);
  }

  read(actor: ActorId): ArsenalState {
    return { ...this.require(actor).arsenal, ammo: this.options.inventory.entries(actor) };
  }

  select(actor: ActorId, item: ItemId): boolean {
    const player = this.require(actor), weapon = Q3_WEAPON_ITEMS.find(entry => entry.item === item);
    if (weapon === undefined || this.options.product === "baseq3" && weapon.weapon > 10) return false;
    if (this.options.inventory.count(actor, item) <= 0) return false;
    player.requestedWeapon = item;
    return true;
  }

  step(input: WeaponStepInput, intent: ArsenalIntent | undefined): WeaponStepResult {
    const player = this.require(input.actor.id), arsenal = this.read(input.actor.id);
    if (intent !== undefined && intent.provider !== this.provider) throw new Error("Arsenal intent belongs to a different provider");
    if (intent?.weapon != null) {
      const requested = Q3_WEAPON_ITEMS.find(entry => entry.item === intent.weapon);
      if (requested === undefined || this.options.product === "baseq3" && requested.weapon > 10) throw new Error("Weapon does not belong to the selected Q3 product");
      this.select(input.actor.id, intent.weapon);
    }
    const selection = player.requestedWeapon === null ? intent : { provider: this.provider, weapon: player.requestedWeapon,
      useHoldable: intent?.useHoldable ?? (input.command.kind === "q3" && (input.command.buttons & 4) !== 0) };
    const weaponAnimation = { provider: this.provider, state: { ...q3SpawnAnimation(), torso: player.torsoAnimation } };
    const result = stepQ3Arsenal({ ...input, arsenal, animation: input.animation.state.kind === "q3" ? input.animation : weaponAnimation }, player.runtime,
      resolveQ3ArsenalControls(arsenal, selection, input.command, this.options.product));
    player.arsenal = result.arsenal;
    player.runtime = result.runtime;
    if (result.animation.state.kind === "q3") player.torsoAnimation = result.animation.state.torso;
    if (player.requestedWeapon === result.arsenal.activeWeapon) player.requestedWeapon = null;
    for (const entry of result.arsenal.ammo) this.options.inventory.configure(player.actor, entry);
    if (result.arsenal.state.kind !== "q3") throw new Error("Selected Q3 step returned a foreign arsenal");
    for (const effect of result.effects) {
      if (effect.kind !== "event") continue;
      if (effect.value.event === EntityEvent.EV_FIRE_WEAPON) { player.lastFireMilliseconds = input.frame.time.kind === "milliseconds" ? input.frame.time.value : input.frame.time.value * 1000; this.options.fire(player.actor, result.arsenal.state.sourceWeapon, input); }
      else if (effect.value.event >= EntityEvent.EV_USE_ITEM0 && effect.value.event <= EntityEvent.EV_USE_ITEM15) this.options.useHoldable(player.actor, effect.value.event, input);
    }
    return { ...result, animation: input.animation.state.kind === "q3" ? result.animation : input.animation };
  }

  remove(actor: ActorId): undefined { this.players.delete(actor); return undefined; }

  capture(actor: ActorId): Q3SelectedArsenalCheckpoint {
    const player = this.require(actor);
    return { arsenal: this.read(actor), runtime: { ...player.runtime }, requestedWeapon: player.requestedWeapon, torsoAnimation: player.torsoAnimation, lastFireMilliseconds: player.lastFireMilliseconds };
  }

  restore(actor: OwnedActor, checkpoint: Q3SelectedArsenalCheckpoint): undefined {
    if (checkpoint.arsenal.provider !== this.provider || checkpoint.arsenal.state.kind !== "q3" || checkpoint.runtime.product !== this.options.product) throw new Error("Saved arsenal differs from selected Q3 provider");
    for (const entry of checkpoint.arsenal.ammo) this.options.inventory.configure(actor, entry);
    this.players.set(actor.id, { actor, arsenal: checkpoint.arsenal, runtime: { ...checkpoint.runtime }, requestedWeapon: checkpoint.requestedWeapon, torsoAnimation: checkpoint.torsoAnimation, lastFireMilliseconds: checkpoint.lastFireMilliseconds });
    return undefined;
  }

  ui(actor: ActorId): Pick<PlayerUi, "activeWeapon" | "ammo" | "items"> {
    const arsenal = this.read(actor), weapon = arsenal.state.kind === "q3" ? q3WeaponItem(arsenal.state.sourceWeapon) : null;
    return { activeWeapon: arsenal.activeWeapon,
      ammo: weapon?.ammo == null ? null : { item: weapon.ammo, count: this.options.inventory.count(actor, weapon.ammo) },
      items: Q3_WEAPON_ITEMS.filter(entry => this.options.product === "missionpack" || entry.weapon <= 10).map(entry => {
        const count = entry.ammo === null ? null : this.options.inventory.count(actor, entry.ammo);
        return { id: entry.item, label: entry.item.slice("q3:weapon/".length), kind: "weapon", sourceOrdinal: entry.weapon,
          owned: this.options.inventory.count(actor, entry.item) > 0, hasAmmo: count === null || count > 0, count, warningCount: 0 };
      }) };
  }

  viewState(actor: ActorId) { const player = this.require(actor); return { torsoAnimation: player.torsoAnimation, lastFireMilliseconds: player.lastFireMilliseconds }; }

  view(actor: ActorId): { readonly path: string; readonly frame: number } | null {
    const arsenal = this.read(actor);
    if (arsenal.state.kind !== "q3") throw new Error("Selected Q3 player has foreign arsenal state");
    const number = arsenal.state.sourceWeapon;
    const item = itemList(this.options.product).find(entry => entry.type === ItemType.IT_WEAPON && entry.tag === number);
    const path = item?.worldModels[0];
    return path == null ? null : { path, frame: 0 };
  }

  private require(actor: ActorId): PlayerArsenal {
    const player = this.players.get(actor);
    if (player === undefined) throw new Error("Actor has no selected Q3 arsenal");
    return player;
  }
}

export function readQ3SelectedArsenalCheckpoint(reader: SaveReader): Q3SelectedArsenalCheckpoint {
  const arsenal = reader.field("arsenal"), state = arsenal.field("state"), runtime = reader.field("runtime");
  return {
    arsenal: { provider: namespaced(arsenal.field("provider")), activeWeapon: arsenal.field("activeWeapon").nullable(namespaced),
      ammo: arsenal.field("ammo").list(readInventoryEntry), state: { kind: state.field("kind").literal("q3"),
        sourceWeapon: state.field("sourceWeapon").integer(0), state: state.field("state").integer(0), timeMilliseconds: state.field("timeMilliseconds").number() } },
    runtime: { product: runtime.field("product").choice("baseq3", "missionpack"), maxHealth: runtime.field("maxHealth").number(),
      spectator: runtime.field("spectator").boolean(), persistentPowerupTag: runtime.field("persistentPowerupTag").integer(0),
      holdableItem: runtime.field("holdableItem").integer(0), holdableTag: runtime.field("holdableTag").integer(0),
      respawned: runtime.field("respawned").boolean(), useItemHeld: runtime.field("useItemHeld").boolean(),
      eventSequence: runtime.field("eventSequence").integer(0), fractionalMilliseconds: runtime.field("fractionalMilliseconds").number() },
    requestedWeapon: reader.field("requestedWeapon").nullable(namespaced),
    torsoAnimation: reader.field("torsoAnimation").integer(0), lastFireMilliseconds: reader.field("lastFireMilliseconds").nullable(value => value.finite()),
  };
}
