// SPDX-License-Identifier: GPL-2.0-or-later
import type { ModCallbackInput } from "../../contracts/mod-callbacks.ts";

/** The named inputs a declared callback may read: its common inputs plus those its destination operation supplies. QuakeC and QVM mods validate against this one table. */
export function modCallbackInputs(call: { readonly stage: string; readonly operation: string }): Set<ModCallbackInput> {
  const available = new Set<ModCallbackInput>(["self", "time"]);
  if (call.stage === "observe") available.add("result");
  const additional: readonly ModCallbackInput[] =
    call.operation === "damage"
      ? ["attacker", "inflictor", "amount", "knockback", "direction", "point", "normal"]
      : call.operation === "inventory.give" || call.operation === "inventory.consume"
        ? ["item", "amount"]
        : call.operation === "actor.use"
          ? ["other", "activator"]
          : call.operation === "actor.touch"
            ? ["other"]
            : call.operation === "actor.think"
              ? ["elapsed"]
              : call.operation === "actor.pain"
                ? ["attacker", "amount", "knockback"]
                : ["attacker", "inflictor", "amount", "knockback", "point"];
  for (const name of additional) available.add(name);
  return available;
}
