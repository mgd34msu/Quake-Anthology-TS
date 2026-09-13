import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Application } from '../../../src/app/bootstrap/application.ts';
import { RemoteApplication } from '../../../src/app/bootstrap/remote-application.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { Q1ClientNetwork } from '../../../src/app/bootstrap/network/q1-client.ts';
import { addressKey } from '../../../src/network/common/endpoint.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import type { NetQuakeMessage } from '../../../src/network/q1/netquake.ts';
import { NetQuakeDecoder, writeNetQuakeMessage } from '../../../src/network/q1/netquake.ts';
import { SizeBuf } from '../../../src/network/q1/message.ts';
import { NetQuakeChannel } from '../../../src/network/q1/channels.ts';
import { defaultNetQuakeProfile } from '../../../src/network/q1/profile.ts';
import { ENTALPHA_ENCODE } from '../../../src/network/q1/constants.ts';

test('version-only records retain RMQ flags across packets until server-info replaces them',()=>{
  const profile=defaultNetQuakeProfile(999), decoder=new NetQuakeDecoder(profile);
  const particle={kind:'particle',origin:{x:5000.0625,y:-9000.125,z:12.875},direction:{x:0,y:0,z:0},count:1,color:5} satisfies NetQuakeMessage;
  const first=new SizeBuf(128);writeNetQuakeMessage(first,profile,{kind:'version',version:666});writeNetQuakeMessage(first,profile,particle);
  expect(decoder.decode(first.bytes())[1]).toEqual(particle);expect(decoder.protocol.version).toBe(666);expect(decoder.flags).toBe(130);
  const next=new SizeBuf(128);writeNetQuakeMessage(next,profile,particle);expect(decoder.decode(next.bytes())[0]).toEqual(particle);
  const back=new SizeBuf(128);writeNetQuakeMessage(back,profile,{kind:'version',version:999});decoder.decode(back.bytes());expect(decoder.protocol).toEqual(profile);
  const info=new SizeBuf(128);writeNetQuakeMessage(info,{kind:'q1-fitzquake',version:666},{kind:'server-info',protocol:{kind:'q1-fitzquake',version:666},maxClients:1,gameType:0,level:'reset',models:[],sounds:[]});
  decoder.decode(info.bytes());expect(decoder.flags).toBe(0);
});

for (const version of [15, 666, 999]) test(`native Application protocol ${version} carries source visuals, wide frames, moves and travel`, async () => {
  const launch = parseApplicationCommand(['--game','q1-classic-id1','--map','e1m1','--movement','q1','--character','q1','--dedicated','--listen','0','--bind','127.0.0.1','--q1-protocol',String(version)]);
  if (launch.kind !== 'run') throw new Error('Missing launch');
  expect(launch.options.q1Protocol).toEqual(defaultNetQuakeProfile(version));
  const users=await mkdtemp(join(tmpdir(),'nq-protocol-host-'));
  const prints:string[] = [];
  let opened:Application|null=null, cleanup:Q1ClientNetwork|null=null;
  try {
  const app = await Application.open({...launch.options,userContentRoot:users},{print:text=>{prints.push(text);return undefined;}});
  opened=app;
  const address=app.networkAddress;
  if(address===null)throw new Error('Missing UDP host');
  const source=app.simulation.q1Source();if(source===null)throw new Error('Missing native source');
  const fixture=source.game.create('wire_visual_fixture');fixture.model='progs/eyes.mdl';
  source.game.setOrigin(fixture,{x:480,y:-296,z:96});fixture.frame=513;fixture.fields.set('alpha','0.5');fixture.fields.set('scale','1.5');
  const number=app.simulation.actors.sourceOf(fixture.actor.id)?.slot;if(number===undefined)throw new Error('Missing fixture source identity');
  if(version!==15)for(let i=0;i<400;i++){
    const extra=source.game.create('wire_capacity_fixture');extra.model='progs/eyes.mdl';extra.frame=513;
    extra.fields.set('alpha','0.5');source.game.setOrigin(extra,{x:480,y:-296,z:96});
  }
  const messages:NetQuakeMessage[]=[], payloads:Uint8Array[]=[], observer=new NetQuakeChannel(64000);
  const transport=await UdpTransport.bind({host:'127.0.0.1',port:0});
  const wrapped:typeof transport = transport;
  const poll=wrapped.poll.bind(wrapped);
  wrapped.poll=()=>{const packet=poll();if(packet?.kind==='packet'&&(new DataView(packet.payload.buffer,packet.payload.byteOffset).getUint32(0)>>>16)!==0x8000){const received=observer.receive(packet.payload,0);if(received.delivery!==null)payloads.push(received.delivery.payload);}return packet;};
  const client=new Q1ClientNetwork({transport,remote:address,seat:{name:'Native wide',color:0,spawnParameters:'',extensionFlags:null},host:{receive:async incoming=>{messages.push(...incoming);},command:command=>{if(command.command.kind!=='q1-netquake')throw new Error('Wrong move');return command.command;},disconnected:reason=>{prints.push(reason);}}});
  cleanup=client;
  let now=0;
  const exchange=async()=>{now+=50;await client.poll(now);await Bun.sleep(1);await app.step(50);await Bun.sleep(1);await client.poll(now);};
    for(let i=0;i<100&&client.phase!=='active';i++)await exchange();
    expect(client.phase).toBe('active');expect(client.wire).toEqual({kind:'source',protocol:defaultNetQuakeProfile(version)});
    expect(payloads.some(value=>value.length>8000)).toBe(version!==15);
    const player=app.networkClients[0];if(player===undefined)throw new Error(prints.join('\n'));
    const baseline=messages.find(value=>value.kind==='baseline'&&value.state.number===number);
    if(baseline?.kind!=='baseline')throw new Error('Missing native baseline');
    expect(baseline.state.frame).toBe(version===15?0:513);expect(baseline.state.alpha).toBe(version===15?0:ENTALPHA_ENCODE(0.5));
    expect(baseline.state.scale).toBe(version===999?24:16);
    const initial=[...messages].reverse().find(value=>value.kind==='entity'&&value.state.number===number);
    expect(initial?.kind==='entity'?initial.state.frame:null).toBe(version===15?1:513);
    const before=app.simulation.bodies.read(player.actor)?.origin;
    for(let i=0;i<8;i++){
      client.submit([{actor:player.actor,source:{kind:'remote-client',client:player.client},sequence:i,command:{kind:'q1-netquake',acknowledgedServerTimeSeconds:0,viewAngles:{x:0,y:0.5,z:0},forwardMove:200,sideMove:0,upMove:0,buttons:0,impulse:0}}],now);
      await exchange();
    }
    const body=app.simulation.bodies.read(player.actor);if(body===null)throw new Error('Missing player body');
    expect(body.origin).not.toEqual(before);
    const movement=app.simulation.movementPlayer(player.actor);if(movement===null||movement.state.kind!=='q1-netquake')throw new Error('Missing native move');
    expect(movement.state.viewAngles.y).toBeCloseTo(version===15?0:0.4998779296875,4);
    source.game.setOrigin(fixture,{...body.origin,x:body.origin.x-16.0625});fixture.frame=514;fixture.fields.set('alpha','0.25');fixture.fields.set('scale','2');
    const native=source.game.player(player.actor);if(native===null)throw new Error('Missing player');native.alpha=0.75;native.scale=1.5;
    messages.length=0;payloads.length=0;
    await exchange();await exchange();
    expect(payloads.some(value=>value.length>1024)).toBe(version!==15);
    const update=[...messages].reverse().find(value=>value.kind==='entity'&&value.state.number===number), data=[...messages].reverse().find(value=>value.kind==='client-data');
    if(update?.kind!=='entity'||data?.kind!=='client-data')throw new Error('Missing native update: '+prints.join('\n'));
    expect(update.state.frame).toBe(version===15?2:514);expect(update.state.alpha).toBe(version===15?0:ENTALPHA_ENCODE(0.25));expect(update.state.scale).toBe(version===15?16:32);
    expect(data.weaponAlpha).toBe(version===15?0:ENTALPHA_ENCODE(0.75));
    const fixtureBody=app.simulation.bodies.read(fixture.actor.id);if(fixtureBody===null)throw new Error('Missing fixture body');
    expect(Math.abs(update.state.origin.x-fixtureBody.origin.x)).toBeLessThan(version===999?0.063:0.126);
    const witness={version,baseline:baseline.state,update:{...update.state,frame:fixture.frame,origin:fixtureBody.origin,angles:fixtureBody.angles},payloads:payloads.map(value=>Array.from(value))};
    await Bun.write(`/tmp/nq-protocol-${version}-witness.json`,JSON.stringify(witness));
    await Bun.write(`/tmp/nq-protocol-${version}-witness.ts`,'export default '+JSON.stringify(witness)+';\n');
    fixture.fields.set('alpha','-1');messages.length=0;await exchange();
    expect(messages.some(value=>value.kind==='entity'&&value.state.number===number)).toBe(version===15);
    const clientIdentity=player.client;await app.changeLevel('e1m2');
    for(let i=0;i<100&&!messages.some(value=>value.kind==='server-info'&&value.models[0]==='maps/e1m2.bsp');i++)await exchange();
    for(let i=0;i<100&&client.phase!=='active';i++)await exchange();
    expect(client.phase).toBe('active');expect(client.wire).toEqual({kind:'source',protocol:defaultNetQuakeProfile(version)});
    expect(app.networkClients[0]?.client.equals(clientIdentity)).toBe(true);expect(app.networkClients[0]?.actor.equals(player.actor)).toBe(false);
    expect(messages.some(value=>value.kind==='server-info'&&value.models[0]==='maps/e1m2.bsp'&&value.protocol.version===version)).toBe(true);
    expect(prints.some(text=>text.includes('overflow'))).toBe(false);
  } finally {cleanup?.close();try {await opened?.close();} finally {await rm(users,{recursive:true,force:true});}}
},30000);

test('native RMQ host reaches normal hidden RemoteApplication visuals',async()=>{
  const { encodePng }=await import('../../../src/formats/images/png.ts');
  const host=parseApplicationCommand(['--game','q1-classic-id1','--map','e1m1','--movement','q1','--character','q1','--dedicated','--listen','0','--bind','127.0.0.1','--q1-protocol','999']);
  if(host.kind!=='run')throw new Error('Missing host');
  const users=await mkdtemp(join(tmpdir(),'nq-wide-remote-')), prints:string[]=[];
  let opened:Application|null=null, remote:RemoteApplication|null=null;
  try {
    const server=await Application.open({...host.options,userContentRoot:users},{print:text=>{prints.push(text);return undefined;}});
    opened=server;
    const address=server.networkAddress;if(address===null)throw new Error('Missing listener');
    const launch=parseApplicationCommand(['--game','q1-classic-id1','--map','e1m1','--movement','q1','--character','q1','--connect-q1',addressKey(address),'--hidden','--renderer','cpu','--width','320','--height','240']);
    if(launch.kind!=='run')throw new Error('Missing remote');
    remote=await RemoteApplication.open({...launch.options,userContentRoot:users},{print:text=>{prints.push(text);return undefined;}});
    for(let i=0;i<100&&remote.networkPhase!=='active';i++){await remote.step(50);await Bun.sleep(1);await server.step(50);await Bun.sleep(1);}
    expect(remote.networkPhase).toBe('active');
    const own=remote.localPlayers[0], admitted=server.networkClients[0], source=server.simulation.q1Source();
    if(own===undefined||admitted===undefined||source===null)throw new Error('Missing connected player');
    const player=source.game.player(admitted.actor);if(player===null)throw new Error('Missing source player');
    player.alpha=0.5;player.scale=1.5;
    for(let i=0;i<3;i++){await server.step(50);await Bun.sleep(1);await remote.step(50);}
    const weapon=remote.remote.presentations().find(value=>value.viewWeapon&&value.actor.equals(own.actor));
    const body=remote.remote.presentations().find(value=>!value.viewWeapon&&value.actor.equals(own.actor));
    expect(weapon?.alpha).toBeCloseTo((ENTALPHA_ENCODE(0.5)-1)/254,6);expect(body?.alpha).toBe(weapon?.alpha);expect(body?.scale).toBe(1.5);
    const capture=remote.captureNextFrame();await remote.step(1);const pixels=await capture;
    expect(pixels.length).toBe(320*240*4);await Bun.write('/tmp/nq-rmq-remote-alpha.png',encodePng(320,240,pixels));
    expect(remote.networkPhase).toBe('active');expect(server.networkClients).toHaveLength(1);
  } finally {try {await remote?.close();await opened?.close();} finally {await rm(users,{recursive:true,force:true});}}
},45000);
