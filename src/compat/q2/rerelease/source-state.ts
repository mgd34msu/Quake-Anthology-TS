// SPDX-License-Identifier: GPL-2.0-or-later
// Direct bindings for rerelease/g_local.h's source-private edict prefix.
import type { GuestAddress, GuestCallResult, GuestCallValue, RawEntityView } from "../../../contracts/execution.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { ArmorState, AttackProvenance, ItemId } from "../../../contracts/gameplay.ts";
import type { ActorCallbacks } from "../../../contracts/world.ts";
import type { TraceResult } from "../../../contracts/scene.ts";
import { nativeCauseFromCanonical } from "../../../content/q2/missionpacks/damage.ts";
import type { BodyStateBinding } from "../../../world/actors/body.ts";
import type { InventoryStateBinding } from "../../../world/gameplay/inventory.ts";
import type { CombatStateBinding, PowerArmorCellBinding } from "../../../world/gameplay/authority.ts";
import { fieldOffset, privateEdictPrefixLayout } from "./layouts.ts";
import type { RereleaseClientProfile } from "./client-profile.ts";
import { signature } from "./api.ts";
import { guestBool, guestInt, guestPointer } from "./module.ts";
import type { RereleaseGuestModule } from "./module.ts";

export interface RereleaseActorAddresses {
  actor(address: GuestAddress): ActorId | null;
  address(actor: ActorId): GuestAddress;
}
export interface RereleaseInventoryItem {
  readonly item: ItemId;
  readonly sourceIndex: number;
  readonly capacity: { readonly kind: "ammo"; readonly sourceIndex: number } | { readonly kind: "fixed"; readonly count: number };
}
export interface RereleaseSourceProtection {
  armor(): ArmorState;
  writeArmor(value: ArmorState): undefined;
  traits(): { readonly invulnerable: boolean; readonly team: string | null; readonly noKnockback: boolean };
}
export class RereleaseSourceClient {
  constructor(readonly address: GuestAddress, readonly module: RereleaseGuestModule, readonly profile: RereleaseClientProfile) {
    if (profile.authority.kind === "artifact" && profile.authority.digest !== module.memory.module.digest) throw new Error("Rerelease private client profile belongs to another artifact");
    module.memory.check(address, profile.layout.byteLength, "read");
  }
  at(name: string): GuestAddress { return this.module.memory.offset(this.address, BigInt(fieldOffset(this.profile.layout, name))); }
  invincibleUntilMilliseconds(): bigint { return this.module.memory.readInt64(this.at("invincible_time")); }
  #item(index: number): GuestAddress {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.profile.inventoryCount) throw new RangeError("Rerelease inventory index is outside the selected IT_TOTAL");
    return this.module.memory.offset(this.at("pers.inventory"), BigInt(index * 4));
  }
  #ammo(index: number): GuestAddress {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.profile.ammoCount) throw new RangeError("Rerelease capacity index is outside the selected AMMO_MAX");
    return this.module.memory.offset(this.at("pers.max_ammo"), BigInt(index * 2));
  }
  inventory(items: readonly RereleaseInventoryItem[]): InventoryStateBinding {
    const ids = new Set<ItemId>(), slots = new Set<number>();
    for (const item of items) {
      this.#item(item.sourceIndex);
      if (ids.has(item.item) || slots.has(item.sourceIndex)) throw new Error("Duplicate semantic or source inventory item");
      ids.add(item.item); slots.add(item.sourceIndex);
      if (item.capacity.kind === "ammo") this.#ammo(item.capacity.sourceIndex);
    }
    return {
      read: () => items.map(item => ({ item: item.item, count: this.module.memory.readInt32(this.#item(item.sourceIndex)), countPolicy: { kind: "source-counter", arithmetic: "int32" }, capacity: item.capacity.kind === "fixed" ? item.capacity.count : this.module.memory.readInt16(this.#ammo(item.capacity.sourceIndex)) })),
      write: entry => {
        const item = items.find(value => value.item === entry.item);
        if (item === undefined) throw new Error("Item has no native inventory binding");
        if (!Number.isSafeInteger(entry.count) || entry.count < -0x80000000 || entry.count > 0x7fffffff) throw new RangeError("Native inventory count exceeds int32");
        if (item.capacity.kind === "fixed") { if (entry.capacity !== item.capacity.count) throw new Error("Native item has a fixed source capacity"); }
        else {
          if (!Number.isSafeInteger(entry.capacity) || entry.capacity < 0 || entry.capacity > 0x7fff) throw new RangeError("Native ammo capacity exceeds int16");
          this.module.memory.writeInt16(this.#ammo(item.capacity.sourceIndex), entry.capacity);
        }
        this.module.memory.writeInt32(this.#item(item.sourceIndex), entry.count);
        return undefined;
      },
    };
  }
  /** IT_AMMO_CELLS=30: armor and ammunition bind this same native int32. */
  powerArmorCells(): PowerArmorCellBinding {
    return { read: () => this.module.memory.readInt32(this.#item(30)), write: count => {
      if (!Number.isSafeInteger(count) || count < -0x80000000 || count > 0x7fffffff) throw new RangeError("Native power armor cell count exceeds int32");
      this.module.memory.writeInt32(this.#item(30), count); return undefined;
    } };
  }
}
/** Explicitly selected source layout; no inference from the public server mirrors. */
export class RereleaseSourceEdict {
  constructor(readonly raw: RawEntityView, readonly module: RereleaseGuestModule) {
    if (raw.strideBytes < privateEdictPrefixLayout.byteLength) throw new Error("Rerelease edict does not contain the selected source-private prefix");
  }
  at(name: string): GuestAddress { return this.module.memory.offset(this.raw.address, BigInt(fieldOffset(privateEdictPrefixLayout, name))); }
  generation(): number { return this.module.memory.readInt32(this.at("spawn_count")); }
  get health(): number { return this.module.memory.readInt32(this.at("health")); }
  set health(value: number) { this.module.memory.writeInt32(this.at("health"), value); }
  get damageable(): boolean { return this.module.memory.readUint8(this.at("takedamage")) !== 0; }
  get client(): GuestAddress | null { return this.module.memory.readPointer(this.at("shared.client")); }
  /** Armor, team and timed protection use the selected source semantic policy. */
  combat(protection: RereleaseSourceProtection): CombatStateBinding {
    return { read: () => ({ health: this.health, mass: this.module.memory.readInt32(this.at("mass")), canTakeDamage: this.damageable, armor: protection.armor(), ...protection.traits() }),
      writeHealth: health => { this.health = health; return undefined; }, writeArmor: value => protection.writeArmor(value) };
  }
  vector(name: string): Vec3 {
    const memory = this.module.memory, address = this.at(name);
    return { x: memory.readFloat32(address), y: memory.readFloat32(memory.offset(address, 4n)), z: memory.readFloat32(memory.offset(address, 8n)) };
  }
  writeVector(name: string, value: Vec3): void {
    const memory = this.module.memory, address = this.at(name);
    memory.writeFloat32(address, value.x); memory.writeFloat32(memory.offset(address, 4n), value.y); memory.writeFloat32(memory.offset(address, 8n), value.z);
  }
  body(addresses: RereleaseActorAddresses): BodyStateBinding {
    return {
      read: () => {
        const ground = this.module.memory.readPointer(this.at("groundentity"));
        return { origin: this.vector("shared.s.origin"), angles: this.vector("shared.s.angles"), velocity: this.vector("velocity"),
          bounds: { min: this.vector("shared.mins"), max: this.vector("shared.maxs") }, ground: ground === null ? null : addresses.actor(ground) };
      },
      write: state => {
        this.writeVector("shared.s.origin", state.origin); this.writeVector("shared.s.angles", state.angles); this.writeVector("velocity", state.velocity);
        this.writeVector("shared.mins", state.bounds.min); this.writeVector("shared.maxs", state.bounds.max);
        this.module.memory.writePointer(this.at("groundentity"), state.ground === null ? null : addresses.address(state.ground));
        return undefined;
      },
    };
  }
  callbacks(addresses: RereleaseActorAddresses, encodeTrace: (trace: TraceResult) => GuestCallResult): ActorCallbacks {
    const memory = this.module.memory;
    const present = (name: string): boolean => memory.readPointer(this.at(`${name}.value`)) !== null;
    const address = (actor: ActorId | null): GuestAddress | null => actor === null ? null : addresses.address(actor);
    const withCause = (attack: AttackProvenance | null, invoke: (mod: GuestAddress) => void): undefined => {
      if (attack !== null && attack.cause.kind !== "q2") throw new Error("Native rerelease callback requires a classified Q2 damage cause");
      const cause = attack?.cause;
      const native = cause?.kind === "q2" && cause.native?.edition === "rerelease" ? cause.native
        : nativeCauseFromCanonical({ edition: "rerelease" }, cause?.kind === "q2" ? cause.meansOfDeath : 0);
      if (native === null || native.edition !== "rerelease") throw new Error("Damage cause has no rerelease mod_t representation");
      const mod = memory.allocate({ byteLength: 3, label: "Q2 callback mod_t" });
      try {
        memory.writeUint8(mod, native.id); memory.writeUint8(memory.offset(mod, 1n), native.friendlyFire ? 1 : 0); memory.writeUint8(memory.offset(mod, 2n), native.noPointLoss ? 1 : 0);
        invoke(mod);
      } finally { memory.unmap(mod, 3); }
      return undefined;
    };
    return {
      think: () => { this.call("think", []); return undefined; },
      use: (_self, other, activator) => {
        if (present("use")) this.call("use", [guestPointer(address(other)), guestPointer(address(activator))]);
        return undefined;
      },
      touch: contact => {
        if (!present("touch")) return undefined;
        if (contact.sourceTrace === undefined) throw new Error("Native rerelease touch requires its source trace");
        const other = addresses.address(contact.other), encoded = encodeTrace(contact.sourceTrace.trace);
        if (encoded.kind !== "aggregate") throw new Error("Native rerelease trace encoder must return an aggregate");
        const trace = memory.allocate({ byteLength: encoded.bytes.length, alignment: 8n, label: "Q2 callback trace" });
        try { memory.write(trace, encoded.bytes); this.call("touch", [guestPointer(other), guestPointer(trace), guestBool(contact.sourceTrace.inverted)]); }
        finally { memory.unmap(trace, encoded.bytes.length); }
        return undefined;
      },
      pain: reaction => {
        if (!present("pain")) return undefined;
        const other = address(reaction.attacker);
        return withCause(reaction.attack, mod => { this.call("pain", [guestPointer(other), { kind: "float32", value: reaction.kick }, guestInt(reaction.damage), guestPointer(mod)]); });
      },
      die: reaction => {
        if (!present("die")) return undefined;
        const inflictor = address(reaction.inflictor), attacker = address(reaction.attacker);
        return withCause(reaction.attack, mod => {
          const point = memory.allocate({ byteLength: 12, alignment: 4n, label: "Q2 callback damage point" });
          try {
            memory.writeFloat32(point, reaction.point.x); memory.writeFloat32(memory.offset(point, 4n), reaction.point.y); memory.writeFloat32(memory.offset(point, 8n), reaction.point.z);
            this.call("die", [guestPointer(inflictor), guestPointer(attacker), guestInt(reaction.damage), guestPointer(point), guestPointer(mod)]);
          } finally { memory.unmap(point, 12); }
        });
      },
    };
  }
  /** Values are fetched for each call: native assignments can replace callbacks at runtime. */
  call(name: "prethink" | "postthink" | "think" | "touch" | "use" | "pain" | "die", arguments_: readonly GuestCallValue[], other: RawEntityView | null = null): GuestCallResult {
    const address = this.module.memory.readPointer(this.at(`${name}.value`));
    if (address === null) return { kind: "void" };
    const P = { kind: "scalar", storage: "pointer" } satisfies import("../../../contracts/execution.ts").GuestValueLayout;
    const I = { kind: "scalar", storage: "int32" } satisfies import("../../../contracts/execution.ts").GuestValueLayout;
    const F = { kind: "scalar", storage: "float32" } satisfies import("../../../contracts/execution.ts").GuestValueLayout;
    const B = { kind: "scalar", storage: "uint8" } satisfies import("../../../contracts/execution.ts").GuestValueLayout;
    const parameters = name === "touch" ? [P, P, P, B] : name === "use" ? [P, P, P] : name === "pain" ? [P, P, F, I, P] : name === "die" ? [P, P, P, I, P, P] : [P];
    return this.module.invoke(address, signature(parameters), [guestPointer(this.raw.address), ...arguments_], this.raw, other);
  }
}
