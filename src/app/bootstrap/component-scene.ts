import type { ActorId } from "../../contracts/identity.ts";
import type { QvmSceneContext } from "../../compat/qvm/mod-presentation.ts";
import type { QvmModScenePublication } from "../../world/session/mod-presentations.ts";
import type { SharedSceneQueries } from "../../world/collision/index.ts";
import { tokenizeCommand } from "../../core/commands/index.ts";
import { selectApplicationQ3Snapshot } from "./q3-client/visibility.ts";

export function selectComponentScene(source: QvmModScenePublication, viewer: ActorId, queries: SharedSceneQueries, leafCount: number, print: (text: string) => void): QvmSceneContext {
    const player = source.clients.find(row => row.actor.equals(viewer));
    if (player === undefined) throw new Error("Component snapshot has no admitted viewing player");
    const bounds = new Map(source.entities.map(row => [row.state.number, row.bounds]));
    const visible = selectApplicationQ3Snapshot({ clientNum: player.slot, origin: player.state.origin, viewheight: player.state.viewHeight }, source,
      queries, slot => bounds.get(slot) ?? null, leafCount, print);
    const areaMask = new Uint8Array(32); areaMask.set(visible.areaMask);
    return { revision: source.revision, gameState: source.gameState, gameStateRevision: source.gameStateRevision,
      snapshot: { serverTime: source.serverTime, flags: 0, areaMask, playerState: player.state,
      entities: visible.entities, serverCommandSequence: source.commands.at(-1)?.sequence ?? 0 },
      actors: source.entities.map(row => ({ actor: row.actor, slot: row.state.number, owned: row.owned })),
      commands: source.commands.map(command => ({ sequence: command.sequence,
        arguments: command.recipient === null || command.recipient.equals(viewer) ? tokenizeCommand(command.text, "q3").argv : [] })) };
  }
