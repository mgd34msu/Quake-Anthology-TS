import type { ActorId } from "../../../contracts/identity.ts";
import type { Q1ExtendedEntityState } from "../../../contracts/protocol.ts";
import type { Q1ApplicationMessage, Q1ApplicationPlayer, Q1ApplicationServerHost } from "../network/q1-types.ts";
import type { Q1ApplicationServerBindingOptions } from "./network-q1.ts";
import type { SimulationOutput } from "../../../contracts/session.ts";
import type { SimulationPresentationEvent } from "./types.ts";
import { ENTALPHA_ENCODE, ENTALPHA_ZERO, ENTSCALE_ENCODE } from "../../../network/q1/constants.ts";
import { createNetQuakeCodec } from "../../../network/q1/profile.ts";
import { MessageReader } from "../../../network/q1/message.ts";

/** Native NetQuake serializes the executed program's fields and ordered precaches. */
export async function createQuakeCNetQuakeHost(options: Q1ApplicationServerBindingOptions): Promise<Q1ApplicationServerHost> {
    const simulation = options.simulation, game = simulation.quakecSource();
    if (game === null || game.kind !== "netquake") throw new Error("Native NetQuake requires a NetQuake QuakeC source");
    const maxClients = game.options.maxClients, clients = new Map<number, Q1ApplicationPlayer>();
    const codec = createNetQuakeCodec(options.protocol, new MessageReader(new Uint8Array(0))), wide = options.protocol.version !== 15;
    const models = new Map(game.precacheNames("model").map((path, index) => [path, index + 1]));
    const sounds = new Map(game.precacheNames("sound").map((path, index) => [path, index + 1]));
    if (models.size + 1 > codec.maxPrecache || sounds.size + 1 > codec.maxPrecache) throw new Error("Native QuakeC precaches exceed selected NetQuake protocol");
    const mounts = await options.content.forContent(game.prepared.execution.owner.content);
    for (const path of models.keys()) if (!path.startsWith("*") && await mounts.resolve(path) === null) throw new Error(`Missing QuakeC model ${path}`);
    for (const path of sounds.keys()) {
        const resource = await mounts.resolve(`sound/${path}`);
        if (resource === null) throw new Error(`Missing QuakeC sound ${path}`);
        simulation.registerResource(game.prepared.execution.owner.content, `sound/${path}`, resource);
    }
    const index = (path: string, table: ReadonlyMap<string, number>): number => {
        if (path === "") return 0;
        const value = table.get(path); if (value === undefined) throw new Error(`Unprecached QuakeC resource ${path}`); return value;
    };
    const field = (name: string): number => {
        const definition = game.prepared.program.fieldsByName.get(name);
        if (definition === undefined) throw new Error(`Missing NetQuake ABI field ${name}`); return definition.offset;
    };
    const scalar = (slot: number, name: string): number => game.entities.at(slot).float(field(name));
    const optional = (slot: number, name: string): number => { const definition = game.prepared.program.fieldsByName.get(name); return definition === undefined ? 0 : game.entities.at(slot).float(definition.offset); };
    const string = (slot: number, name: string): string => game.machine.strings.get(game.entities.at(slot).int(field(name)));
    const vector = (slot: number, name: string) => game.entities.at(slot).vector(field(name));
    const global = (name: string): number => game.machine.globals.float(game.machine.globalOffset(name));
    const number = (actor: ActorId): number => { const slot = game.sourceSlot(actor); if (slot === null) throw new Error("NetQuake actor has no source slot"); return slot; };
    const entities = (): readonly Q1ExtendedEntityState[] => {
        const result: Q1ExtendedEntityState[] = [];
        for (let slot = 1; slot < game.entities.count; slot++) {
            if (game.slots.at(slot) === null || scalar(slot, "modelindex") === 0 || string(slot, "model") === "") continue;
            result.push({ number: slot, origin: vector(slot, "origin"), angles: vector(slot, "angles"), modelIndex: Math.trunc(scalar(slot, "modelindex")),
                frame: Math.trunc(scalar(slot, "frame")), colorMap: Math.trunc(scalar(slot, "colormap")), skin: Math.trunc(scalar(slot, "skin")), effects: Math.trunc(scalar(slot, "effects")),
                alpha: wide ? ENTALPHA_ENCODE(optional(slot, "alpha")) : 0, scale: wide ? Math.trunc(ENTSCALE_ENCODE(optional(slot, "scale"))) & 255 : 16,
                lerpFinishSeconds: 0, step: scalar(slot, "movetype") === 4 });
        }
        return result;
    };
    const baseline = (state: Q1ExtendedEntityState): Q1ExtendedEntityState => {
        const player = state.number <= maxClients, modelIndex = player ? index("progs/player.mdl", models) : state.modelIndex;
        return { ...state, modelIndex: !wide && modelIndex > 255 ? 0 : modelIndex, frame: !wide && state.frame > 255 ? 0 : state.frame,
            effects: 0, colorMap: player ? state.number : 0, alpha: player ? 0 : state.alpha, scale: player || options.protocol.version !== 999 ? 16 : state.scale, step: false };
    };
    const clientData = (player: Q1ApplicationPlayer): Q1ApplicationMessage => {
        const slot = number(player.actor), items2 = game.prepared.program.fieldsByName.get("items2");
        const items = Math.trunc(scalar(slot, "items")) | (items2 === undefined ? Math.trunc(global("serverflags")) << 28 : Math.trunc(game.entities.at(slot).float(items2.offset)) << 23);
        const weapon = Math.trunc(scalar(slot, "weapon"));
        // hipnotic/rogue native clients interpret the active weapon as its bit ordinal.
        const activeWeapon = game.options.recipe.map.entities.content.includes(":rogue:") || game.options.recipe.map.entities.content.includes(":hipnotic:")
            ? weapon === 0 ? 0 : 31 - Math.clz32(weapon & -weapon) : weapon;
        return { kind: "client-data", weaponAlpha: wide ? ENTALPHA_ENCODE(optional(slot, "alpha")) : 0, data: {
            viewHeight: vector(slot, "view_ofs").z, idealPitch: scalar(slot, "idealpitch"), punchAngles: vector(slot, "punchangle"), velocity: vector(slot, "velocity"), items,
            onGround: (Math.trunc(scalar(slot, "flags")) & 512) !== 0, inWater: scalar(slot, "waterlevel") >= 2,
            weaponFrame: scalar(slot, "weaponframe"), armor: scalar(slot, "armorvalue"), weaponModel: index(string(slot, "weaponmodel"), models),
            health: scalar(slot, "health"), ammo: scalar(slot, "currentammo"), shells: scalar(slot, "ammo_shells"), nails: scalar(slot, "ammo_nails"), rockets: scalar(slot, "ammo_rockets"), cells: scalar(slot, "ammo_cells"), activeWeapon } };
    };
    interface Routed { readonly recipient: ActorId | null; readonly reliable: boolean; readonly message: Q1ApplicationMessage; }
    let routed: Routed[] = [];
    const commandMessages: Routed[] = [];
    let previousPause = simulation.q1Paused;
    const board = new Map<number, { readonly name: string; readonly colors: number; readonly frags: number }>();
    const send = (message: Q1ApplicationMessage, reliable = false, recipient: ActorId | null = null): void => { routed.push({ message, reliable, recipient }); };
    const sourceMessages = (): void => {
        for (const entry of game.drainNetQuakeMessages()) {
            if (entry.destination.kind === "multicast" || entry.destination.kind === "signon") throw new Error("Unexpected NetQuake runtime destination");
            for (const message of entry.messages) {
                if (message.kind === "entity") throw new Error("QuakeC cannot replace the host entity snapshot");
                send(message, entry.destination.reliable, entry.destination.kind === "client" ? entry.destination.actor : null);
            }
        }
    };
    const persistentSignon = (): readonly Q1ApplicationMessage[] => {
        const messages: Q1ApplicationMessage[] = [];
        for (const message of game.netQuakeSignonMessages()) {
            if (message.kind === "entity") throw new Error("Entity update in QuakeC signon"); messages.push(message);
        }
        for (const record of simulation.events.capture().persistent) {
            if (record.kind !== "q1") continue;
            const event = record.event;
            if (event.kind === "ambient") messages.push({ kind: "static-sound", entity: 0, channel: 0, index: index(event.path, sounds), volume: Math.trunc(event.volume * 255), attenuation: event.attenuation, origin: event.origin });
            if (event.kind === "static-model") messages.push({ kind: "static", state: { number: 0, modelIndex: index(event.path, models), frame: event.frame, colorMap: event.colorMap,
                skin: event.skin, effects: 0, origin: event.origin, angles: event.angles, alpha: 0, scale: 16, lerpFinishSeconds: 0, step: false } });
        }
        return messages;
    };
    const observe = (_output: SimulationOutput, events: readonly SimulationPresentationEvent[]): void => {
        routed = commandMessages.splice(0); sourceMessages();
        if (previousPause !== simulation.q1Paused) { previousPause = simulation.q1Paused; send({ kind: "pause", paused: previousPause }, true); }
        for (const player of clients.values()) {
            const slot = player.sourceEntity, info = game.clientInfo(player.client), previous = board.get(player.client.slot);
            const name = string(slot, "netname"), colors = ((Number(info.get("topcolor") ?? 0) & 15) << 4) | (Number(info.get("bottomcolor") ?? 0) & 15), frags = scalar(slot, "frags");
            if (previous?.name !== name) send({ kind: "name", slot: player.client.slot, value: name }, true);
            if (previous?.colors !== colors) send({ kind: "colors", slot: player.client.slot, value: colors }, true);
            if (previous?.frags !== frags) send({ kind: "frags", slot: player.client.slot, value: frags }, true);
            board.set(player.client.slot, { name, colors, frags });
        }
        for (const slot of board.keys()) if (!clients.has(slot)) {
            send({ kind: "name", slot, value: "" }, true); send({ kind: "colors", slot, value: 0 }, true); send({ kind: "frags", slot, value: 0 }, true); board.delete(slot);
        }
        for (const record of events) {
            if (record.kind === "view-reset") { send({ kind: "set-angle", angles: record.angles }, true, record.actor); continue; }
            if (record.kind !== "q1") continue;
            const event = record.event;
            if (event.kind === "particles") {
                const clamp = (value: number): number => Math.max(-128, Math.min(127, Math.trunc(value * 16))) / 16;
                send({ kind: "particle", origin: event.origin, direction: { x: clamp(event.direction.x), y: clamp(event.direction.y), z: clamp(event.direction.z) }, count: event.count, color: event.color });
            } else if (event.kind === "lightstyle") send({ kind: "light-style", index: event.style, value: event.pattern }, true);
        }
    };
    game.attachNetQuakeWire();
    return {
        ...(options.rejects === undefined ? {} : { rejects: options.rejects }), protocol: options.protocol, maxClients, mapName: game.machine.strings.get(game.machine.globals.int(game.machine.globalOffset("mapname"))),
        supportsSourceWire: () => simulation.recipe.movement.provider.startsWith("q1:") && simulation.recipe.character.definition.provider.startsWith("q1:")
            && simulation.recipe.inventory.provider.startsWith("q1:") && simulation.recipe.weapons.every(value => value.provider.startsWith("q1:"))
            ? { kind: "supported" } : { kind: "unsupported", reasons: ["Mixed composition requires unified serialization"] },
        admit: from => {
            let slot = 0;
            for (; slot < maxClients; slot++) if (!clients.has(slot) && !simulation.players().some(actor => game.sourceSlot(actor) === slot + 1)) break;
            if (slot === maxClients) return { kind: "rejected", reason: "Server is full" };
            const client = options.session.createClient(slot); client.connect(from.kind === "loopback" ? "loopback" : "remote");
            let actor: ActorId | null = null;
            try {
                actor = simulation.reserveNetQuakeClient(client.id);
                const player = { client: client.id, actor, sourceEntity: number(actor) }; clients.set(slot, player); return { kind: "accepted", player };
            } catch (error) { if (actor !== null) game.disconnectClient(game.reservedClient(client.id)); options.session.closeClient(client.id); throw error; }
        },
        carriedPlayer: client => {
            const actor = game.clientActor(client); if (actor === null) throw new Error("Carried QuakeC client has not been reserved");
            const player = { client, actor, sourceEntity: number(actor) }; clients.set(client.slot, player); return player;
        },
        disconnect: player => { if (game.isActiveClient(player.actor)) simulation.disconnectPlayer(player.actor); else game.disconnectClient(game.reservedClient(player.client));
            options.session.closeClient(player.client); clients.delete(player.client.slot); },
        gameState: _player => {
            const baselines = new Map(entities().map(state => [state.number, baseline(state)]));
            for (let slot = 1; slot <= maxClients; slot++) if (!baselines.has(slot)) baselines.set(slot, baseline({ number: slot,
                origin: vector(slot, "origin"), angles: vector(slot, "angles"), modelIndex: 0, frame: 0, colorMap: slot, skin: 0, effects: 0, alpha: 0, scale: 16, lerpFinishSeconds: 0, step: false }));
            return { info: { kind: "server-info", protocol: options.protocol, maxClients,
            gameType: game.cvars.variableValue("deathmatch") === 0 ? 0 : 1, level: string(0, "message") || game.machine.strings.get(game.machine.globals.int(game.machine.globalOffset("mapname"))), models: [...models.keys()], sounds: [...sounds.keys()] },
            baselines, signon: persistentSignon() }; },
        spawn: player => {
            if (!game.isActiveClient(player.actor)) {
                const admitted = simulation.admitPlayer(player.client);
                if (!admitted.actor.equals(player.actor)) throw new Error("QuakeC spawn replaced reserved client identity");
            }
            return [{ kind: "pause", paused: simulation.q1Paused }, { kind: "time", seconds: game.timeSeconds }, ...Array.from({ length: 64 }, (_, index) => ({ kind: "light-style", index, value: simulation.events.lightStyle(index) } satisfies Q1ApplicationMessage)),
            ...[...clients.values()].flatMap(client => [{ kind: "name", slot: client.client.slot, value: string(client.sourceEntity, "netname") },
                { kind: "frags", slot: client.client.slot, value: scalar(client.sourceEntity, "frags") }, { kind: "colors", slot: client.client.slot, value: board.get(client.client.slot)?.colors ?? 0 }] satisfies Q1ApplicationMessage[]),
            ...([[11, "total_secrets"], [12, "total_monsters"], [13, "found_secrets"], [14, "killed_monsters"]] satisfies readonly (readonly [number, string])[]).map(([stat, name]) => {
                return { kind: "stat", index: stat, value: global(name) } satisfies Q1ApplicationMessage;
            }), { kind: "set-angle", angles: vector(player.sourceEntity, "angles") }, clientData(player)]; },
        frame: player => {
            if (!game.isActiveClient(player.actor)) return { seconds: game.timeSeconds, messages: [], reliable: routed.filter(event => event.reliable && (event.recipient === null || event.recipient.equals(player.actor))).map(event => event.message), datagram: [], entities: [] };
            const cluster = simulation.scene.leafCluster(simulation.scene.pointLeaf(simulation.playerView(player.actor).origin));
            const messages: Q1ApplicationMessage[] = [clientData(player)], damage = game.consumeNetQuakeDamage(player.actor);
            if (damage !== null) messages.unshift({ kind: "damage", ...damage });
            return { seconds: game.timeSeconds, messages, reliable: routed.filter(event => event.reliable && (event.recipient === null || event.recipient.equals(player.actor))).map(event => event.message),
                datagram: routed.filter(event => !event.reliable && (event.recipient === null || event.recipient.equals(player.actor))).map(event => event.message),
                entities: entities().filter(state => (!wide || state.alpha !== ENTALPHA_ZERO || state.effects !== 0) && (state.number === player.sourceEntity || simulation.scene.clusterVisible(cluster, simulation.scene.leafCluster(simulation.scene.pointLeaf(state.origin)), "pvs"))) };
        },
        input: (player, command, sequence) => ({ actor: player.actor, source: { kind: "remote-client", client: player.client }, sequence, command }),
        command: (player, name, args) => {
            if (name === "pause") {
                const before = simulation.q1Paused, text = simulation.toggleQ1Pause(player.actor);
                commandMessages.push({ recipient: before === simulation.q1Paused ? player.actor : null, reliable: true, message: { kind: "print", text } });
            } else if (name === "name" || name === "color") {
                const info = new Map(game.clientInfo(player.client));
                if (name === "name") info.set("name", (args[0] ?? "unconnected").slice(0, 15));
                else { const top = Math.min(13, Math.trunc(Number(args[0] ?? 0)) & 15), bottom = Math.min(13, Math.trunc(Number(args[1] ?? args[0] ?? 0)) & 15);
                    info.set("topcolor", String(top)); info.set("bottomcolor", String(bottom)); game.entities.at(player.sourceEntity).setFloat(field("team"), bottom + 1); }
                game.setClientInfo(player.client, info);
            } else if (name === "say" || name === "say_team") {
                const text = `\x01${string(player.sourceEntity, "netname")}: ${args.join(" ").slice(0, 126)}\n`;
                for (const recipient of clients.values()) if (name !== "say_team" || game.cvars.variableValue("teamplay") === 0 || scalar(recipient.sourceEntity, "team") === scalar(player.sourceEntity, "team"))
                    commandMessages.push({ message: { kind: "print", text }, reliable: true, recipient: recipient.actor });
            } else simulation.playerCommand(player.actor, name, args);
        }, observe, print: options.print,
    };
}
