import type { UnifiedNativePublication } from "../network/unified-native-components.ts";
import type { PresentationOwner } from "../../../contracts/presentation.ts";
import { samePresentationOwner } from "../../../contracts/presentation.ts";
import type { UnifiedComponentPublication } from "../network/unified-components.ts";
import { selectComponentScene } from "../component-scene.ts";
import { projectUnifiedPrediction } from '../network/unified-prediction.ts';
import type { ExecutableRecipe, ResolvedResourceReference, ResourceId } from '../../../contracts/content.ts';
import type { ArsenalIntent } from '../../../contracts/gameplay.ts';
import type { ActorId, ClientId } from '../../../contracts/identity.ts';
import type { UserCommand } from '../../../contracts/protocol.ts';
import type { ActorCommand, SimulationEvent, SimulationOutput } from '../../../contracts/session.ts';
import { q2Userinfo } from '../../../content/q2/base/player/index.ts';
import { addressKey } from '../../../network/common/endpoint.ts';
import type { NetworkAddress } from '../../../network/common/endpoint.ts';
import type { EngineSession } from '../../../world/session/session.ts';
import type { LoadedApplicationContent } from '../content.ts';
import type { UnifiedResourceKey } from '../network/unified-frame-codec.ts';
import { unifiedResourceId } from '../network/unified-content.ts';
import type { UnifiedPresentationFrame } from '../network/unified-types.ts';
import { Q3ClientAdmissionDenied } from './q3/runtime.ts';
import type { SharedSimulation } from './runtime.ts';
import type { SimulationPresentation, SimulationPresentationEvent } from './types.ts';

export interface UnifiedApplicationPlayer { readonly client: ClientId; readonly actor: ActorId; readonly sourceEntity: number; }
export interface UnifiedApplicationServerHost {
  readonly recipe: ExecutableRecipe;
  readonly maxClients: number;
  readonly mode: SharedSimulation["options"]["mode"];
  admit(address: NetworkAddress, userinfo: string): { readonly kind: 'accepted'; readonly player: UnifiedApplicationPlayer } | { readonly kind: 'rejected'; readonly reason: string };
  carriedPlayer(client: ClientId): UnifiedApplicationPlayer;
  disconnect(player: UnifiedApplicationPlayer): void;
  userinfo(player: UnifiedApplicationPlayer, value: string): void;
  components?(player: UnifiedApplicationPlayer): readonly UnifiedComponentPublication[];
  nativeComponents?(player: UnifiedApplicationPlayer): readonly UnifiedNativePublication[];
  componentCommand?(player: UnifiedApplicationPlayer, owner: PresentationOwner, generation: number, args: readonly string[]): boolean;
  command(player: UnifiedApplicationPlayer, name: string, args: readonly string[]): void;
  input(player: UnifiedApplicationPlayer, sequence: number, command: UserCommand, arsenal?: ArsenalIntent): ActorCommand;
  frame(player: UnifiedApplicationPlayer, output: SimulationOutput, epoch: number, acknowledgedInput: number): UnifiedPresentationFrame;
  resources(player: UnifiedApplicationPlayer, output: SimulationOutput): readonly UnifiedResourceKey[];
  presentationEvents(player: UnifiedApplicationPlayer, events: readonly SimulationPresentationEvent[]): readonly SimulationPresentationEvent[];
  initialPresentation(player: UnifiedApplicationPlayer): readonly SimulationPresentationEvent[];
}

/** Audience projection does not execute server actions or expose another seat's private UI. */
export function unifiedPresentationFor(actor: ActorId, client: ClientId, value: SimulationPresentationEvent): boolean {
  if (value.recipient !== undefined && !value.recipient.equals(actor)) return false;
  const own = (target: ActorId | null): boolean => target === null || target.equals(actor);
  switch (value.kind) {
    case "presentation-owner": case "debug-graph": return true;
    case 'view-reset': return own(value.actor);
    case 'q1-fog': return own(value.event.player);
    case 'q1': {
      const event = value.event;
      if (event.kind === 'server-command') return false;
      return 'player' in event ? own(event.player) : true;
    }
    case 'q1-composition': {
      const event = value.event;
      if (event.kind === 'source-log' || event.kind === 'developer-message') return false;
      if (event.kind === 'addon') return 'player' in event.event ? own(event.event.player) : event.event.kind !== 'developer-message';
      if (event.kind === 'ctf-status' || event.kind === 'prompt' || event.kind === 'clear-prompt') return own(event.actor);
      return true;
    }
    case 'q2': {
      const event = value.event;
      if (event.kind === 'pickup') return own(event.player);
      if (event.kind === 'centerprint' || event.kind === 'print' || event.kind === 'damage-indicator') return own(event.actor);
      return true;
    }
    case 'q2-player': {
      const event = value.event;
      if (event.kind === 'stufftext' || event.kind === 'load-menu' || event.kind === 'trail') return false;
      if (event.kind === 'userinfo') return true;
      return event.kind === 'print' ? own(event.target) : own(event.actor);
    }
    case 'q2-composition': {
      const event = value.event;
      if (event.kind === 'kick') return false;
      if (event.kind === 'missionpack-entity') return true;
      if (event.kind === 'missionpack-player') return own(event.event.actor);
      if (event.kind === 'grapple-prediction') return own(event.actor);
      if (event.event.kind === 'score-log') return false;
      if (event.event.kind === 'grapple-cable' || event.event.kind === 'match-status') return true;
      return own(event.event.actor);
    }
    case 'q2-rerelease': {
      const event = value.event;
      if (event.kind === 'autosave' || event.kind === 'restart-level') return false;
      if (event.kind === 'alpha' || event.kind === 'dynamic-light' || event.kind === 'player-dogtag' || event.kind === 'flashlight') return true;
      return 'actor' in event ? own(event.actor) : true;
    }
    case 'q3-source': {
      const event = value.event;
      if (event.kind === 'console-command' || event.kind === 'drop-client' || event.kind === 'log') return false;
      return event.kind === 'server-command' ? event.client < 0 || event.client === client.slot : true;
    }
    case 'q3-ballistics': return value.event.kind !== 'rail-award' || own(value.event.actor);
    case 'q2-weapon': return value.event.kind !== 'view-weapon' || own(value.event.actor);
    case 'q3-character': case 'music': case 'q1-level': case 'q1-session': case 'q1-sky': case 'q1-client': return true;
  }
}

/** Foreign view records carry held-model identity without exposing or loading a first-person model. */
export function unifiedModelPresentations(viewer: ActorId, models: readonly SimulationPresentation[]): readonly SimulationPresentation[] {
  return models.map(source => {
    if (!source.viewWeapon || source.actor.equals(viewer)) return source;
    const weapon = source.q3Weapon;
    return { actor: source.actor, content: source.content, family: source.family, path: source.path,
      frame: 0, oldFrame: 0, skin: 0, effects: 0, renderFlags: 0, origin: { x: 0, y: 0, z: 0 }, angles: { x: 0, y: 0, z: 0 },
      scale: 1, visible: false, viewWeapon: true,
      ...(source.renderOwner === undefined ? {} : { renderOwner: source.renderOwner }),
      ...(source.weaponItem === undefined ? {} : { weaponItem: source.weaponItem }),
      ...(source.heldWeapon === undefined ? {} : { heldWeapon: source.heldWeapon }),
      ...(weapon === undefined ? {} : { q3Weapon: { weapon: weapon.weapon, timeMilliseconds: weapon.timeMilliseconds,
        lastFireMilliseconds: weapon.lastFireMilliseconds, firing: weapon.firing, torsoAnimation: 0, horizontalSpeed: 0, bobCycle: 0 } }) };
  });
}

export function createUnifiedApplicationServerHost(options: { readonly session: EngineSession; readonly simulation: SharedSimulation; readonly content: LoadedApplicationContent; print(text: string): void }): UnifiedApplicationServerHost {
  const { simulation, session } = options;
  const q1 = simulation.q1Source(), q2 = simulation.q2Source(), q3 = simulation.q3Source();
  if (q1 === null && q2 === null && q3 === null) throw new Error('Unified hosting currently requires a TypeScript Q1, Q2 or Q3 source game');
  const players = new Map<number, UnifiedApplicationPlayer>();
  const sourcePlayer = (client: ClientId, actor: ActorId): UnifiedApplicationPlayer => {
    const source = simulation.actors.sourceOf(actor);
    if (source === null || source.provider !== simulation.recipe.map.entities.provider) throw new Error('Unified player lost its authoritative source address');
    return { client, actor, sourceEntity: source.slot };
  };
  const userinfos = new Map<number, ReadonlyMap<string, string>>();
  const requirePlayer = (player: UnifiedApplicationPlayer): void => {
    const current = players.get(player.client.slot);
    if (current === undefined || !current.client.equals(player.client) || !current.actor.equals(player.actor) || !simulation.actors.isLive(player.actor)) throw new Error('Unified client belongs to a retired source player');
  };
  const info = (value: string, address: string): ReadonlyMap<string, string> => { const values = new Map(q2Userinfo(value)); values.set('ip', address); return values; };
  const text = (values: ReadonlyMap<string, string>): string => [...values].map(([key, value]) => `\\${key}\\${value}`).join('');
  const update = (player: UnifiedApplicationPlayer, values: ReadonlyMap<string, string>): void => {
    if (q1 !== null) q1.composition.userinfo(player.actor, values);
    else if (q2 !== null) { const entity = q2.game.entity(player.actor); if (entity === null) throw new Error('Unified Q2 player lost its source entity'); q2.players.userinfoChanged(entity, q2.game, text(values)); }
    else if (q3 !== null) { q3.host.serverState.setUserinfo(player.client.slot, text(values)); q3.admission.userinfoChanged(player.client.slot); }
    userinfos.set(player.client.slot, values);
    simulation.notifyClientEvent("userinfo", player.actor);
  };
  const permitted = (player: UnifiedApplicationPlayer, event: SimulationEvent): boolean => {
    if (event.audience.kind === 'seat' || event.audience.kind === 'client' && !event.audience.client.equals(player.client)) return false;
    if (event.payload.kind === 'transition' || event.payload.kind === 'damage') return false;
    if (event.payload.kind === 'message' && (event.payload.event.kind === 'command-text' || event.payload.event.kind === 'disconnect')) return false;
    return true;
  };
  const resource = (id: ResourceId): ResolvedResourceReference => {
    const found = simulation.events.resource(id) ?? simulation.recipe.resources.find(value => value.id === id);
    if (found === undefined || found === null) throw new Error('Unified sound has no declared content resource');
    return found;
  };
  const key = (value: ResolvedResourceReference): UnifiedResourceKey => ({ content: value.provenance.mount.identity.content, path: value.requestedPath, digest: value.digest, byteLength: value.byteLength });
  const presentationEvents = (player: UnifiedApplicationPlayer, events: readonly SimulationPresentationEvent[]): readonly SimulationPresentationEvent[] => { requirePlayer(player); return events.filter(event => unifiedPresentationFor(player.actor, player.client, event)).map(event => event.kind === 'q3-source' && event.event.kind === 'server-command' ? { ...event, event: { ...event.event, client: -1 } } : event.kind === 'q1-composition' && event.event.kind === 'client' ? { ...event, event: { ...event.event, client: { ...event.event.client, userinfo: [] } } } : event); };
  return {
    recipe: simulation.recipe, maxClients: simulation.options.maxClients, mode: simulation.options.mode,
    admit(address, value) {
      let values = info(value, address.kind === 'loopback' ? 'localhost' : addressKey(address));
      let firstSlot = 0;
      if (q3 !== null && (values.get('password') ?? '') !== q3.host.cvars.variableString('sv_privatePassword')) firstSlot = Math.max(0, Math.trunc(q3.host.cvars.variableValue('sv_privateClients')));
      let slot = firstSlot;
      while (slot < simulation.options.maxClients && (players.has(slot) || simulation.players().some(actor => simulation.movementPlayer(actor)?.client.slot === slot))) slot++;
      if (slot >= simulation.options.maxClients) return { kind: 'rejected', reason: 'Server is full' };
      if (q2 !== null) { const allowed = q2.players.connect(q2.game, text(values)); if (!allowed.allowed) return { kind: 'rejected', reason: allowed.reason }; values = info(allowed.userinfo, values.get('ip') ?? ''); }
      const client = session.createClient(slot); client.connect(address.kind === 'loopback' ? 'loopback' : 'remote');
      let actor: ActorId | null = null;
      try {
        if (q3 !== null) q3.host.serverState.setUserinfo(slot, text(values));
        actor = simulation.admitPlayer(client.id).actor;
        const player = sourcePlayer(client.id, actor); players.set(slot, player); if (q3 === null) update(player, values); else userinfos.set(slot, values);
        return { kind: 'accepted', player };
      } catch (error) {
        actor ??= simulation.players().find(value => simulation.movementPlayer(value)?.client.equals(client.id)) ?? null;
        const failures: unknown[] = [error];
        try { if (actor !== null) simulation.disconnectPlayer(actor); } catch (cleanup) { failures.push(cleanup); }
        try { session.closeClient(client.id); } catch (cleanup) { failures.push(cleanup); }
        players.delete(slot); userinfos.delete(slot);
        if (failures.length > 1) throw new AggregateError(failures, 'Unified admission cleanup failed');
        if (error instanceof Q3ClientAdmissionDenied) return { kind: 'rejected', reason: error.message };
        throw error;
      }
    },
    carriedPlayer(client) {
      const actor = simulation.players().find(value => simulation.movementPlayer(value)?.client.equals(client));
      if (actor === undefined) throw new Error('Unified carried client has no source player');
      const player = sourcePlayer(client, actor); players.set(client.slot, player); return player;
    },
    disconnect(player) {
      requirePlayer(player); const failures: unknown[] = [];
      try { simulation.disconnectPlayer(player.actor); } catch (error) { failures.push(error); }
      try { session.closeClient(player.client); } catch (error) { failures.push(error); }
      players.delete(player.client.slot); userinfos.delete(player.client.slot);
      if (failures.length !== 0) throw new AggregateError(failures, 'Unified player disconnect failed');
    },
    userinfo(player, value) { requirePlayer(player); update(player, info(value, userinfos.get(player.client.slot)?.get('ip') ?? '')); },
    components(player) {
      requirePlayer(player);
      return simulation.modPresentationSources().flatMap(source => {
        source.source.assertCurrent();
        const context = source.source.context(player.actor);
        if (context === null) return [];
        const scene = source.prepared.declaration.runtime === "qvm-scene" ? source.source.scene?.().current : undefined;
        if (source.prepared.declaration.runtime === "qvm-scene" && scene === undefined) throw new Error("Component scene publication is unavailable");
        return [{ owner: source.owner, identity: source.identity, generation: source.source.generation, abi: source.source.abiProfile,
          runtime: source.prepared.declaration.runtime, viewer: player.actor, bindings: source.source.bindings(),
          context: scene === undefined ? context : { ...context, scene: selectComponentScene(scene, player.actor, simulation.scene,
            options.content.world.leaves.length, options.print) } }];
      });
    },
    nativeComponents(player) {
      requirePlayer(player);
      return simulation.modClientPresentationSources().flatMap(source => {
        source.source.assertCurrent(); const frame = source.source.frame(player.actor);
        return frame?.kind !== "native" ? [] : [{ owner: source.owner, identity: source.identity, generation: source.source.generation, viewer: player.actor, frame }];
      });
    },
    componentCommand(player, owner, generation, args) {
      requirePlayer(player);
      const source = simulation.modPresentationSources().find(source => samePresentationOwner(source.owner, owner) && source.source.generation === generation);
      if (source === undefined || !source.source.live(player.actor) || source.source.context(player.actor) === null) return false;
      source.source.assertCurrent();
      if (source.source.clientCommand === undefined) return false;
      source.source.clientCommand(player.actor, args); return true;
    },
    command(player, name, args) {
      requirePlayer(player);
      if (q1 !== null && name === 'name') { const values = new Map(q1.composition.clients.require(player.actor).userinfo); values.set('name', (args[0] ?? 'unconnected').slice(0, 15)); update(player, values); return; }
      if (q1 !== null && name === 'color') { q1.composition.clients.colors(player.actor, Number(args[0] ?? 0), Number(args[1] ?? args[0] ?? 0)); return; }
      simulation.playerCommand(player.actor, name, args);
    },
    input(player, sequence, command, arsenal) {
      requirePlayer(player);
      if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('Invalid unified input sequence');
      const movement = simulation.movementPlayer(player.actor);
      if (movement === null || movement.state.kind !== command.kind) throw new Error('Unified command does not match selected movement');
      return { actor: player.actor, source: { kind: 'remote-client', client: player.client }, sequence, command, angleSpace: "absolute", ...(arsenal === undefined ? {} : { arsenal }) };
    },
    resources(player, output) { requirePlayer(player); const result = new Map<ResourceId, UnifiedResourceKey>(); for (const event of output.events) if (permitted(player, event) && event.payload.kind === 'sound') { const value = resource(event.payload.resource); result.set(value.id, key(value)); } return [...result.values()]; },
    frame(player, output, epoch, acknowledgedInput) {
      requirePlayer(player);
      const events = output.events.filter(event => permitted(player, event)).map((event): SimulationEvent => event.payload.kind === 'sound' ? { ...event, payload: { ...event.payload, resource: unifiedResourceId(resource(event.payload.resource)) } } : event);
      return { epoch, acknowledgedInput, prediction: projectUnifiedPrediction(simulation, player.actor, acknowledgedInput), output: { snapshot: { ...output.snapshot, inventories: output.snapshot.inventories.filter(value => value.actor.equals(player.actor)) }, events },
        models: unifiedModelPresentations(player.actor, simulation.presentations()), characters: simulation.characterViews(), worldText: simulation.worldText(),
        player: { actor: player.actor, view: simulation.playerView(player.actor), ui: simulation.playerUi(player.actor) } };
    },
    presentationEvents,
    initialPresentation(player) { return presentationEvents(player, simulation.events.persistentPresentation()); },
  };
}
