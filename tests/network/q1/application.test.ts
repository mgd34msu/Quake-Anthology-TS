import { expect, test } from 'bun:test';
import { Application } from '../../../src/app/bootstrap/application.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import { NetQuakeChannel } from '../../../src/network/q1/channels.ts';
import { NetQuakeConnectClient } from '../../../src/network/q1/handshake.ts';
import { NetQuakeDecoder, writeNetQuakeMove } from '../../../src/network/q1/netquake.ts';
import type { NetQuakeMessage } from '../../../src/network/q1/netquake.ts';
import { NetQuakeSignon } from '../../../src/network/q1/session.ts';
import { SizeBuf } from '../../../src/network/q1/message.ts';
test('retail e1m1 NetQuake UDP signon and input use the Application world', async () => {
 const launch = parseApplicationCommand(['--game','q1-classic-id1','--map','e1m1','--movement','q1','--character','q1','--mode','coop','--dedicated','--listen','0','--bind','127.0.0.1']);
 if (launch.kind !== 'run') throw new Error('Launch options missing');
 const prints: string[] = [], app = await Application.open(launch.options,{print:text => {prints.push(text);return undefined;}}), client = await UdpTransport.bind({host:'127.0.0.1',port:0});
 const address = app.networkAddress; if (address === null) throw new Error('No server address');
 const handshake = new NetQuakeConnectClient(), channel = new NetQuakeChannel(), decoder = new NetQuakeDecoder(), signon = new NetQuakeSignon({name:'UDP Player',color:0,spawnParameters:'',extensionFlags:null});
 const queued: Uint8Array[] = [], messages: NetQuakeMessage[] = []; let now = 0;
 const exchange = async (): Promise<void> => {
  now += 50; if (handshake.state.kind === 'waiting') { const connect = handshake.next(now); if (connect !== null) client.send(address,connect); }
  if (channel.canSendReliable) { const bytes = queued.shift(); if (bytes !== undefined) channel.queueReliable(bytes); }
  const bytes = channel.next(now); if (bytes !== null) client.send(address,bytes);
  await Bun.sleep(1); await app.step(50); await Bun.sleep(1);
  for (;;) { const packet = client.poll(); if (packet === null) break; if (packet.kind !== 'packet') continue;
   if (new DataView(packet.payload.buffer,packet.payload.byteOffset).getUint32(0) >>> 16 === 0x8000) { handshake.receive(packet.payload); continue; }
   const result = channel.receive(packet.payload,now); for (const reply of result.replies) client.send(address,reply);
   if (result.delivery !== null) for (const message of decoder.decode(result.delivery.payload)) { messages.push(message); if (message.kind === 'server-info') signon.stage = 0; if (message.kind === 'signon') queued.push(signon.receive(message.stage)); if (message.kind === 'entity') signon.firstEntity(); }
  }
 };
 try {
  for (let i=0;i<100 && !signon.active;i++) await exchange();
  expect(prints.filter(text => text.includes('Error'))).toEqual([]);
  expect(signon.active).toBe(true); expect(handshake.state.kind).toBe('connected'); expect(app.networkClients.length).toBe(1);
  const player = app.networkClients[0]; if (player === undefined) throw new Error(prints.join('\n'));
  const before = app.simulation.bodies.read(player.actor)?.origin; expect(before).toBeDefined();
  for (let i=0;i<6;i++) { const move = new SizeBuf(128); writeNetQuakeMove(move,{kind:'q1-netquake',acknowledgedServerTimeSeconds:decoder.timeSeconds,viewAngles:{x:0,y:0,z:0},forwardMove:200,sideMove:0,upMove:0,buttons:0,impulse:0},{kind:'q1-netquake',version:15}); client.send(address,channel.unreliable(move.bytes())); await exchange(); }
  const after = app.simulation.bodies.read(player.actor)?.origin; expect(after).not.toEqual(before);
  const entity = [...messages].reverse().find(message => message.kind === 'entity' && message.state.number === player.sourceEntity);
  if (entity?.kind !== 'entity' || after === undefined) throw new Error('No native shared-actor snapshot');
  expect(Math.abs(entity.state.origin.x-after.x)).toBeLessThan(0.126);
  expect(app.simulation.players().filter(actor => actor.equals(player.actor)).length).toBe(1);
  app.queueCommand('map',['e1m2'],null); await exchange();
  for (let i=0;i<100 && (!signon.active || app.networkClients[0]?.actor.equals(player.actor));i++) await exchange();
  const carried = app.networkClients[0]; if (carried === undefined) throw new Error('Travel lost native client');
  expect(signon.active).toBe(true); expect(carried.client.equals(player.client)).toBe(true); expect(carried.actor.equals(player.actor)).toBe(false);
  expect(messages.some(message => message.kind === 'server-info' && message.models[0] === 'maps/e1m2.bsp')).toBe(true);
  client.send(address,channel.unreliable(new Uint8Array([2]))); await exchange(); expect(app.networkClients.length).toBe(0); expect(app.simulation.bodies.read(player.actor)).toBeNull();
 } finally { client.close(); await app.close(); }
},30000);
