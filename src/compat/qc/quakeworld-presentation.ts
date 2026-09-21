import type { ActorId } from "../../contracts/identity.ts";
import type { NetQuakeMessage } from "../../network/q1/netquake.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { QuakeCLocalMessageHost } from "../../app/bootstrap/simulation/quakec-local-messages.ts";
import { QuakeCLocalMessages, presentQuakeCLocalMessage } from "../../app/bootstrap/simulation/quakec-local-messages.ts";
import { quakeTemporaryEvent } from "./message-effects.ts";
import type { QcRoutedMessage } from "./presentation-host.ts";

/** QW's decoded services enter common presentation without reinterpreting wire opcodes. */
export function presentQuakeWorldMessage(entry: QcRoutedMessage, target: ActorId | null,
  state: QuakeCLocalMessages, host: QuakeCLocalMessageHost & { muzzle(actor: ActorId): { readonly origin: Vec3; readonly angles: Vec3 } | null }): void {
  const message = entry.message;
  switch (message.kind) {
    case "print": host.message({ kind: "print", level: message.level, text: message.text }, target); return;
    // QW cl_parse.c sets -2/-4; view.c DropPunchAngle subtracts and clamps to zero before V_CalcRefdef.
    case "kick": return;
    case "temporary-entity": host.emit(quakeTemporaryEvent(message.effect, entry.actor, true)); return;
    case "intermission":
      for (const actor of target === null ? host.recipients : [target])
        host.emit({ kind: "intermission", origin: message.origin, angles: message.angles, map: host.map, exitAfter: host.seconds + 5, track: 0 }, actor);
      state.receive([{ kind: "intermission" }], target); return;
    case "cd-track": {
      const track: NetQuakeMessage = { kind: "cd-track", track: message.track, loopTrack: message.track };
      state.receive([track], target); presentQuakeCLocalMessage(track, target, state, host); return;
    }
    case "sound": case "stop-sound": {
      const actor = entry.actor;
      if (actor === null) throw new Error(`QW ${message.kind} had no owned actor when written`);
      presentQuakeCLocalMessage(message, target, state, { ...host, actor: () => actor }); return;
    }
    case "muzzle-flash": {
      if (entry.actor === null) throw new Error("QW muzzle flash had no owned actor when written");
      const muzzle = host.muzzle(entry.actor);
      if (muzzle !== null) host.emit({ kind: "effect", effect: "muzzleflash", actor: entry.actor, origin: muzzle.origin, amount: 1, muzzle });
      return;
    }
    case "set-view":
      // Camera ownership belongs to the destination player; a component cannot replace it with a source edict number.
      throw new Error("QW component set-view requires an explicit destination camera binding");
    case "nop": case "stat": case "stufftext": case "center-print": case "finale":
    case "set-angle": case "light-style": case "static": case "static-sound": case "damage": case "pause":
    case "killed-monster": case "found-secret": case "sell-screen":
      state.receive([message], target); presentQuakeCLocalMessage(message, target, state, host); return;
    default: throw new Error(`QW component service ${message.kind} requires a destination owner binding`);
  }
}
