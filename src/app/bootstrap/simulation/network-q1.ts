import type { ActorId } from '../../../contracts/identity.ts';
import type { Q1ProtocolIdentity, Q1ExtendedEntityState } from '../../../contracts/protocol.ts';
import type { EngineSession } from '../../../world/session/session.ts';
import type { LoadedApplicationContent } from '../content.ts';
import type { SharedSimulation } from './runtime.ts';
import type { Q1ApplicationPlayer, Q1ApplicationServerHost, Q1ApplicationMessage } from '../network/q1-types.ts';
import { WEAPONS } from '../../../content/q1/foundation/types.ts';
export interface Q1ApplicationServerBindingOptions { readonly session: EngineSession; readonly simulation: SharedSimulation; readonly content: LoadedApplicationContent; readonly protocol: Q1ProtocolIdentity; print(text: string): void; }
export async function createQ1ApplicationServerHost(options: Q1ApplicationServerBindingOptions): Promise<Q1ApplicationServerHost> {
 const simulation = options.simulation, source = simulation.q1Source();
 if (source === null) throw new Error('Q1 network requires the Q1 source game');
 const game = source.game, maxClients = game.options.maxClients ?? 1, clients = new Map<number,Q1ApplicationPlayer>();
 const models = new Map<string,number>(), sounds = new Map<string,number>();
 const index = (path: string, table: Map<string,number>): number => { if (path === '') return 0; const existing = table.get(path); if (existing !== undefined) return existing; if (table.size >= 255) throw new Error('NetQuake 15 precache overflow'); const value = table.size+1; table.set(path,value); return value; };
 index(options.content.recipe.map.geometry.requestedPath,models); index('progs/player.mdl',models);
 for (const entity of game.entities.values()) index(entity.model,models);
 for (const weapon of WEAPONS) index(game.weaponModel(weapon),models);
 const number = (actor: ActorId): number => { const address = simulation.actors.sourceOf(actor); if (address === null || address.provider !== simulation.recipe.map.entities.provider) throw new Error('Q1 actor has no source address'); return address.slot; };
 const entities = (): readonly Q1ExtendedEntityState[] => {
  const states: Q1ExtendedEntityState[] = [], presentations = new Map(simulation.presentations().filter(value => !value.viewWeapon).map(value => [value.actor,value]));
  for (const entity of game.entities.values()) { const body = simulation.bodies.read(entity.actor.id), presentation = presentations.get(entity.actor.id), path = presentation?.path ?? entity.model;
   if (body === null || path === '' || number(entity.actor.id) === 0) continue;
   states.push({number:number(entity.actor.id), origin:body.origin, angles:body.angles, modelIndex:index(path,models), frame:presentation?.frame ?? entity.frame, colorMap:game.player(entity.actor.id) === null ? 0 : number(entity.actor.id), skin:presentation?.skin ?? entity.skin, effects:presentation?.effects ?? entity.effects, alpha:0, scale:16, lerpFinishSeconds:0, step:entity.movement === 'step'});
  }
  for (const actor of simulation.players()) { const body = simulation.bodies.read(actor), presentation = presentations.get(actor); if (body === null) continue; states.push({number:number(actor),origin:body.origin,angles:body.angles,modelIndex:index(presentation?.path ?? 'progs/player.mdl',models),frame:presentation?.frame ?? 0,colorMap:number(actor),skin:presentation?.skin ?? 0,effects:presentation?.effects ?? 0,alpha:0,scale:16,lerpFinishSeconds:0,step:false}); }
  return states.sort((a,b) => a.number-b.number);
 };
 const clientData = (player: Q1ApplicationPlayer): Q1ApplicationMessage => { const movement = simulation.movementPlayer(player.actor), native = game.player(player.actor), ui = simulation.playerUi(player.actor); if (movement === null || movement.state.kind !== 'q1-netquake' || native === null) throw new Error('Q1 native movement/player state unavailable');
  const state = movement.state; let items = 0; const weaponBits = [4096,1,2,4,8,16,32,64];
  WEAPONS.forEach((weapon,ordinal) => { if (simulation.inventory.count(player.actor,game.weaponItem(weapon)) > 0) items |= weaponBits[ordinal] ?? 0; });
  if (ui.armor.kind !== 'none') items |= ui.armor.kind === 'q1' && ui.armor.absorption >= 0.8 ? 32768 : ui.armor.kind === 'q1' && ui.armor.absorption >= 0.6 ? 16384 : 8192;
  for (const [powerup,expires] of native.powerups) if (expires > game.time) items |= powerup === 'quad' ? 4194304 : powerup === 'invulnerability' ? 1048576 : powerup === 'invisibility' ? 524288 : powerup === 'suit' ? 2097152 : 0;
  return {kind:'client-data', weaponAlpha:0, data:{viewHeight:movement.viewHeight,idealPitch:state.idealPitch,punchAngles:state.punchAngles,velocity:state.velocity,items,onGround:(state.flags & 512)!==0,inWater:state.waterLevel >= 2,weaponFrame:native.weaponFrame,armor:ui.armor.kind === 'none' ? 0 : ui.armor.points,weaponModel:index(game.weaponModel(native.weapon,native),models),health:ui.health,ammo:ui.ammo?.count ?? 0,shells:simulation.inventory.count(player.actor,'q1:ammo/shells'),nails:simulation.inventory.count(player.actor,'q1:ammo/nails'),rockets:simulation.inventory.count(player.actor,'q1:ammo/rockets'),cells:simulation.inventory.count(player.actor,'q1:ammo/cells'),activeWeapon:weaponBits[WEAPONS.findIndex(weapon => weapon === native.weapon)] ?? 0}};
 };
 return {
  protocol:options.protocol,maxClients,mapName:game.mapName,
  supportsSourceWire: () => { const reasons: string[] = []; if (source.composition.selection.program !== 'id1') reasons.push('Native NetQuake application item serialization currently binds id1'); if (options.protocol.version !== 15) reasons.push('Q1 application network currently binds NetQuake protocol 15'); if (!simulation.recipe.movement.provider.startsWith('q1:') || !simulation.recipe.character.definition.provider.startsWith('q1:') || !simulation.recipe.inventory.provider.startsWith('q1:') || simulation.recipe.weapons.some(value => !value.provider.startsWith('q1:'))) reasons.push('Mixed composition requires unified serialization'); return reasons.length === 0 ? {kind:'supported'} : {kind:'unsupported',reasons}; },
  admit: from => { let slot = 0; for (;slot < maxClients;slot++) if (!clients.has(slot) && !simulation.players().some(actor => simulation.movementPlayer(actor)?.client.slot === slot)) break; if (slot === maxClients) return {kind:'rejected',reason:'Server is full'};
   const client = options.session.createClient(slot); client.connect(from.kind === 'loopback' ? 'loopback' : 'remote'); let actor: ActorId | null = null;
   try { const admitted = simulation.admitPlayer(client.id); actor = admitted.actor; const player = {client:client.id,actor,sourceEntity:number(actor)}; clients.set(slot,player); return {kind:'accepted',player}; } catch(error) { if (actor !== null) simulation.disconnectPlayer(actor); options.session.closeClient(client.id); throw error; }
  },
  carriedPlayer: client => { const actor = simulation.players().find(actor => simulation.movementPlayer(actor)?.client.equals(client)); if (actor === undefined) throw new Error('Carried Q1 player has not been admitted'); const player = {client,actor,sourceEntity:number(actor)}; clients.set(client.slot,player); return player; },
  disconnect: player => { simulation.disconnectPlayer(player.actor); options.session.closeClient(player.client); clients.delete(player.client.slot); },
  gameState: player => { const states = entities(); clientData(player); return {info:{kind:'server-info',protocol:options.protocol,maxClients,gameType:game.options.deathmatch === 0 ? 0 : 1,level:game.world?.message || game.mapName,models:[...models.keys()],sounds:[...sounds.keys()]},baselines:new Map(states.map(state => [state.number,state])),signon:[]}; },
  spawn: player => [{kind:'time',seconds:game.time}, ...Array.from({length:64},(_,index) => ({kind:'light-style',index,value:simulation.events.lightStyle(index)} satisfies Q1ApplicationMessage)), ...[...source.composition.clients.records.values()].flatMap(client => [{kind:'name',slot:client.slot,value:client.name},{kind:'colors',slot:client.slot,value:client.shirt*16+client.pants},{kind:'frags',slot:client.slot,value:client.frags}] satisfies Q1ApplicationMessage[]), {kind:'stat',index:11,value:game.totalSecrets},{kind:'stat',index:12,value:game.totalMonsters},{kind:'stat',index:13,value:game.foundSecrets},{kind:'stat',index:14,value:game.killedMonsters},{kind:'set-angle',angles:simulation.playerView(player.actor).angles},clientData(player)],
  frame: (player,_output) => { const origin = simulation.playerView(player.actor).origin, cluster = simulation.scene.leafCluster(simulation.scene.pointLeaf(origin)); return {seconds:game.time,messages:[clientData(player)],entities:entities().filter(state => state.number === player.sourceEntity || simulation.scene.clusterVisible(cluster,simulation.scene.leafCluster(simulation.scene.pointLeaf(state.origin)),'pvs'))}; },
  input: (player,command,sequence) => ({actor:player.actor,source:{kind:'remote-client',client:player.client},sequence,command}),
  command: (player,name,args) => { if (name === 'name') { const values = new Map(source.composition.clients.require(player.actor).userinfo); values.set('name',(args[0] ?? 'unconnected').slice(0,15)); source.composition.userinfo(player.actor,values); } else if (name === 'color') source.composition.clients.colors(player.actor,Number(args[0] ?? 0),Number(args[1] ?? args[0] ?? 0)); else if (name === 'use' || name === 'weapnext' || name === 'weapprev') simulation.playerCommand(player.actor,name,args); else options.print(`Unsupported native Q1 client command: ${name}`); },
  observe: (_output,_events) => {},
  print:options.print
 };
}
