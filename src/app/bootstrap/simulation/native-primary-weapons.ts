import type { SessionActorRegistry } from "../../../world/actors/index.ts";
import type { ClassicGuestWorld } from "./classic-guest-world.ts";
import type { RereleaseGuestWorld } from "./rerelease-guest-world.ts";
import { NativePrimaryWeapons, type NativePrimaryWeaponHooks, type NativePrimaryWeaponProfile, type NativePrimaryWeaponHost } from "../../../compat/q2/native-primary-weapons.ts";

export function nativePrimaryWeaponHost(world: ClassicGuestWorld | RereleaseGuestWorld, actors: SessionActorRegistry): NativePrimaryWeaponHost {
  if (world.edition === "classic") {
    const source = world.source, host = source.host;
    return { memory: host.memory, runner: host.options.runner, image: source.imageBase,
      invoke: host.invoke.bind(host), entry: source.entry.bind(source), record: address => host.edicts.fromPointer(address), actor: record => host.edicts.current(record)?.id ?? null,
      recordFor: actor => { const position = actors.sourceOf(actor); return position?.provider === world.module.id ? host.edicts.at(position.slot) : null; } };
  }
  const source = world.source, host = source.host.module;
  return { memory: host.memory, runner: host.options.runner, image: source.imageBase,
    invoke: host.invoke.bind(host), entry: source.entry.bind(source), record: address => host.entities().fromPointer(address), actor: record => record.currentActor(),
    recordFor: actor => { const position = actors.sourceOf(actor); return position?.provider === world.module.id ? host.entities().atSlot(position.slot) : null; } };
}

export function bindNativePrimaryWeapons(world: ClassicGuestWorld | RereleaseGuestWorld, actors: SessionActorRegistry,
  profile: NativePrimaryWeaponProfile, hooks: NativePrimaryWeaponHooks): NativePrimaryWeapons {
  return new NativePrimaryWeapons(nativePrimaryWeaponHost(world, actors), profile, hooks);
}
