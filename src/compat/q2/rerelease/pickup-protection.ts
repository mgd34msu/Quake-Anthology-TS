import type { RawEntityView } from "../../../contracts/execution.ts";
import type { ProtectionChannel } from "../../../contracts/gameplay.ts";
import type { RereleaseQ2GuestHost } from "./host.ts";
import { RereleaseSourceClient, RereleaseSourceEdict } from "./source-state.ts";
import { retailRereleaseClientProfile } from "./client-profile.ts";

/** Publish original primary protection stores while a selected grant or debit is held. */
export function withRereleasePrimaryProtection<T>(host: RereleaseQ2GuestHost, recipient: RawEntityView, channel: ProtectionChannel,
  current: () => void, operation: (consume: (execute: () => void) => void) => T, committed: () => boolean = () => true): T {
  current();
  const { engine } = host.options, actor = host.actor(recipient);
  if (actor === null) throw new Error("Native protection operation has no live recipient");
  const observe = (run: () => T): T => host.foreignActors === null ? run() : host.foreignActors.withInventoryPublication(actor.id, committed, run);
  if (engine.combat.protectionOwner(actor, channel) !== null) return observe(() => operation(() => { current(); }));
  const source = new RereleaseSourceEdict(recipient, host.module), memory = host.module.memory;
  const primaryCurrent = (): void => {
    current();
    if (engine.combat.protectionOwner(actor, channel) !== null) throw new Error("Native primary protection ownership changed during its operation");
  };
  const publish = (): void => {
    primaryCurrent();
    if (!committed()) return;
    if (host.foreignActors?.observingDamage(actor.id)) return;
    const state = engine.combat.read(actor.id);
    if (state === null) throw new Error("Native protection operation lost its combat binding");
    // The original bytes are already committed. The existing public write publishes them to held damage cursors without rewriting the source.
    if (channel === "powered") engine.combat.setPoweredProtection(actor, state.armor.powered);
    else engine.combat.setRegularArmor(actor, state.armor.regular);
  };
  const remove = [memory.observeWrites(source.at("flags"), 8, publish)];
  if (source.client !== null) {
    const client = new RereleaseSourceClient(source.client, host.module, retailRereleaseClientProfile);
    remove.push(memory.observeWrites(client.at("pers.inventory"), retailRereleaseClientProfile.inventoryCount * 4, publish));
  }
  const run = (): T => {
    const result = operation(execute => { primaryCurrent(); execute(); primaryCurrent(); });
    primaryCurrent(); return result;
  };
  try {
    return observe(run);
  } finally { for (const close of remove.reverse()) close(); }
}
