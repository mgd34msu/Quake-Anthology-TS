import { nextActorGeneration } from '../../../src/world/actors/registry.ts';
import { expect, test } from 'bun:test';
import { Application } from '../../../src/app/bootstrap/application.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import { NetQuakeChannel } from '../../../src/network/q1/channels.ts';
import { NetQuakeConnectClient } from '../../../src/network/q1/handshake.ts';
import { NetQuakeDecoder, writeNetQuakeMove, writeNetQuakeMessage } from '../../../src/network/q1/netquake.ts';
import type { NetQuakeMessage } from '../../../src/network/q1/netquake.ts';
import { NetQuakeSignon, writeClientStringCommand } from '../../../src/network/q1/session.ts';
import { SizeBuf } from '../../../src/network/q1/message.ts';
interface NativeClient {
    readonly transport: UdpTransport;
    readonly handshake: NetQuakeConnectClient;
    readonly channel: NetQuakeChannel;
    readonly decoder: NetQuakeDecoder;
    readonly signon: NetQuakeSignon;
    readonly queued: Uint8Array[];
    readonly messages: NetQuakeMessage[];
    readonly deliveries: {
        readonly message: NetQuakeMessage;
        readonly kind: 'reliable' | 'unreliable';
    }[];
    sounds: readonly string[];
    models: readonly string[];
}
async function client(name: string): Promise<NativeClient> {
    const transport = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
    return { transport, handshake: new NetQuakeConnectClient(), channel: new NetQuakeChannel(), decoder: new NetQuakeDecoder(),
        signon: new NetQuakeSignon({ name, color: 0, spawnParameters: '', extensionFlags: null }), queued: [], messages: [], deliveries: [], sounds: [], models: [] };
}
test('retail NetQuake UDP shares actors, sound precaches, scoreboard, effects and travel', async () => {
    const launch = parseApplicationCommand(['--game', 'q1-classic-id1', '--map', 'e1m1', '--movement', 'q1', '--character', 'q1', '--mode', 'coop', '--dedicated', '--listen', '0', '--bind', '127.0.0.1']);
    if (launch.kind !== 'run')
        throw new Error('Launch options missing');
    const prints: string[] = [], app = await Application.open(launch.options, { print: text => { prints.push(text); return undefined; } });
    const first = await client('First UDP'), second = await client('Second UDP'), peers = [first, second];
    const address = app.networkAddress;
    if (address === null || address.kind === "ipx")
        throw new Error('No server address');
    let now = 0;
    const command = (peer: Awaited<ReturnType<typeof client>>, text: string): void => { const bytes = new SizeBuf(256); writeClientStringCommand(bytes, text); peer.queued.push(bytes.bytes()); };
    const exchange = async (): Promise<void> => {
        now += 50;
        for (const peer of peers) {
            if (peer.handshake.state.kind === 'waiting') {
                const connect = peer.handshake.next(now);
                if (connect !== null)
                    peer.transport.send(address, connect);
            }
            if (peer.channel.canSendReliable) {
                const bytes = peer.queued.shift();
                if (bytes !== undefined)
                    peer.channel.queueReliable(bytes);
            }
            const bytes = peer.channel.next(now);
            if (bytes !== null)
                peer.transport.send(address, bytes);
        }
        await Bun.sleep(1);
        await app.step(50);
        await Bun.sleep(1);
        for (const peer of peers)
            for (;;) {
                const packet = peer.transport.poll();
                if (packet === null)
                    break;
                if (packet.kind !== 'packet')
                    continue;
                if (new DataView(packet.payload.buffer, packet.payload.byteOffset).getUint32(0) >>> 16 === 0x8000) {
                    peer.handshake.receive(packet.payload);
                    continue;
                }
                const result = peer.channel.receive(packet.payload, now);
                for (const reply of result.replies)
                    peer.transport.send(address, reply);
                if (result.delivery !== null)
                    for (const message of peer.decoder.decode(result.delivery.payload)) {
                        peer.messages.push(message);
                        peer.deliveries.push({ message, kind: result.delivery.kind });
                        if (message.kind === 'server-info') {
                            peer.signon.stage = 0;
                            peer.sounds = message.sounds;
                            peer.models = message.models;
                        }
                        if (message.kind === 'signon')
                            peer.queued.push(peer.signon.receive(message.stage));
                        if (message.kind === 'entity')
                            peer.signon.firstEntity();
                    }
            }
    };
    try {
        for (let i = 0; i < 100 && peers.some(peer => !peer.signon.active); i++)
            await exchange();
        for (const peer of peers) {
            if (!peer.signon.active) throw new Error(`Native signon failed: ${prints.join('\n')}`);
            expect(peer.signon.active).toBe(true);
            expect(peer.handshake.state.kind).toBe('connected');
        }
        expect(app.networkClients.length).toBe(2);
        const player = app.networkClients[0], other = app.networkClients[1];
        if (player === undefined || other === undefined)
            throw new Error(prints.join('\n'));
        const before = app.simulation.bodies.read(player.actor)?.origin;
        expect(before).toBeDefined();
        for (let i = 0; i < 6; i++) {
            const move = new SizeBuf(128);
            writeNetQuakeMove(move, { kind: 'q1-netquake', acknowledgedServerTimeSeconds: first.decoder.timeSeconds, viewAngles: { x: 0, y: 0, z: 0 }, forwardMove: 200, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 }, { kind: 'q1-netquake', version: 15 });
            first.transport.send(address, first.channel.unreliable(move.bytes()));
            await exchange();
        }
        const after = app.simulation.bodies.read(player.actor)?.origin;
        expect(after).not.toEqual(before);
        const entity = [...first.messages].reverse().find(message => message.kind === 'entity' && message.state.number === player.sourceEntity);
        if (entity?.kind !== 'entity' || after === undefined)
            throw new Error('No native shared-actor snapshot');
        expect(Math.abs(entity.state.origin.x - after.x)).toBeLessThan(0.126);
        expect(app.simulation.players().filter(actor => actor.equals(player.actor)).length).toBe(1);
        const source = app.simulation.q1Source(), owner = app.simulation.actors.resolveOwned(player.actor), body = app.simulation.bodies.read(player.actor);
        if (source === null || owner === null || body === null)
            throw new Error('Source player missing');
        expect(source.game.precaches.phase).toBe('frozen');
        const world = app.simulation.options.world;
        if (world.kind !== 'q1-bsp') throw new Error('Expected the retail Q1 world');
        const seededModels = ['maps/e1m1.bsp', ...world.models.slice(1).map((_model,index) => `*${index+1}`)];
        expect(source.game.precaches.models.slice(1, seededModels.length+1)).toEqual(seededModels);
        expect(source.game.precaches.sounds.slice(1,5)).toEqual(['weapons/r_exp3.wav','weapons/rocket1i.wav','weapons/sgun1.wav','weapons/guncock.wav']);
        for (const peer of peers) {
            expect(peer.models).toEqual(source.game.precaches.models.slice(1));
            expect(peer.sounds).toEqual(source.game.precaches.sounds.slice(1));
        }
        const soundOrigin = { x: body.origin.x + (body.bounds.min.x + body.bounds.max.x) * 0.5, y: body.origin.y + (body.bounds.min.y + body.bounds.max.y) * 0.5, z: body.origin.z + (body.bounds.min.z + body.bounds.max.z) * 0.5 };
        for (const peer of peers) {
            peer.messages.length = 0;
            peer.deliveries.length = 0;
        }
        const projectile = source.game.create('network_sound_projectile');
        source.game.setOrigin(projectile, soundOrigin);
        source.game.setBounds(projectile, { min: { x: -4, y: -8, z: -12 }, max: { x: 20, y: 12, z: 28 } });
        const removedSoundOrigin = { x: soundOrigin.x + 8, y: soundOrigin.y + 2, z: soundOrigin.z + 8 };
        const projectileNumber = app.simulation.actors.sourceOf(projectile.actor.id)?.slot;
        source.game.sound(projectile, 'weapons/r_exp3.wav', 'voice');
        source.game.remove(projectile);
        source.game.sound(owner, 'weapons/shotgn2.wav', 'weapon');
        source.game.effect('explosion', soundOrigin);
        source.game.effect('blood', soundOrigin, null, 4);
        source.game.message(other.actor, 'Only the second player', true);
        source.game.host.emit({ kind: 'lightstyle', style: 32, pattern: 'az' });
        source.composition.clients.addScore(player.actor, 7);
        command(first, 'name "Renamed"');
        command(first, 'color 4 13');
        for (let i = 0; i < 12; i++)
            await exchange();
        for (const peer of peers) {
            const sound = peer.deliveries.find(value => value.message.kind === 'sound' && value.message.entity === player.sourceEntity && value.message.channel === 1);
            if (sound?.message.kind !== 'sound')
                throw new Error(`No source sound: ${prints.join('\n')}`);
            expect(sound.kind).toBe('unreliable');
            expect(sound.message.volume).toBe(255);
            expect(sound.message.attenuation).toBe(1);
            const removed = peer.messages.find(message => message.kind === 'sound' && message.entity === projectileNumber && peer.sounds[message.index - 1] === 'weapons/r_exp3.wav');
            if (removed?.kind !== 'sound')
                throw new Error('Removed projectile lost its sound');
            expect(Math.abs(removed.origin.x - removedSoundOrigin.x)).toBeLessThan(0.126);
            expect(Math.abs(removed.origin.y - removedSoundOrigin.y)).toBeLessThan(0.126);
            expect(Math.abs(removed.origin.z - removedSoundOrigin.z)).toBeLessThan(0.126);
            const state = app.simulation.events.capture();
            expect(state.styles.some(style => style.style === 32 && style.pattern === 'az')).toBe(true);
            expect(peer.sounds[sound.message.index - 1]).toBe('weapons/shotgn2.wav');
            expect(Math.abs(sound.message.origin.x - soundOrigin.x)).toBeLessThan(0.126);
            expect(Math.abs(sound.message.origin.z - soundOrigin.z)).toBeLessThan(0.126);
            expect(peer.deliveries.some(value => value.kind === 'unreliable' && value.message.kind === 'temporary-entity' && value.message.effect.type === 3)).toBe(true);
            expect(peer.deliveries.some(value => value.kind === 'unreliable' && value.message.kind === 'particle' && value.message.color === 73 && value.message.count === 8)).toBe(true);
            for (const kind of ['name', 'colors', 'frags'])
                expect(peer.deliveries.some(value => value.kind === 'reliable' && value.message.kind === kind && 'slot' in value.message && value.message.slot === player.client.slot && 'value' in value.message && value.message.value === (kind === 'name' ? 'Renamed' : kind === 'colors' ? 77 : 7))).toBe(true);
            expect(peer.deliveries.some(value => value.kind === 'reliable' && value.message.kind === 'light-style' && value.message.index === 32 && value.message.value === 'az')).toBe(true);
        }
        expect(first.messages.some(message => message.kind === 'center-print' && message.text === 'Only the second player')).toBe(false);
        expect(second.deliveries.some(value => value.kind === 'reliable' && value.message.kind === 'center-print' && value.message.text === 'Only the second player')).toBe(true);
        source.game.sound(owner, 'unprecached/native-test.wav', 'weapon');
        await exchange();
        expect(prints.some(text => text.includes('not precached'))).toBe(true);
        app.queueCommand('map', ['e1m2'], null);
        await exchange();
        for (let i = 0; i < 100 && (peers.some(peer => !peer.signon.active || !peer.messages.some(message => message.kind === 'server-info' && message.models[0] === 'maps/e1m2.bsp')) || app.networkClients[0]?.actor.equals(player.actor)); i++)
            await exchange();
        const carried = app.networkClients[0];
        if (carried === undefined)
            throw new Error('Travel lost native client');
        if (carried.actor.equals(player.actor))
            throw new Error(prints.join('\n'));
        expect(carried.client.equals(player.client)).toBe(true);
        expect(carried.actor.equals(player.actor)).toBe(false);
        for (const peer of peers) {
            expect(peer.signon.active).toBe(true);
            expect(peer.messages.some(message => message.kind === 'server-info' && message.models[0] === 'maps/e1m2.bsp')).toBe(true);
            const statics = peer.deliveries.filter(value => value.kind === 'reliable' && value.message.kind === 'static').flatMap(value => value.message.kind === 'static' ? [value.message.state] : []);
            expect(statics).toHaveLength(24);
            expect(statics[0]?.origin).toEqual({ x: 932, y: 640, z: 340 });
            expect(statics.every(state => state.effects === 0 && state.colorMap === 0 && state.skin === 0)).toBe(true);
            const firstStatic = statics[0]; if (firstStatic === undefined) throw new Error('Missing authored static signon');
            expect(peer.models[firstStatic.modelIndex - 1]).toBe('progs/flame.mdl');
        }
        first.transport.send(address, first.channel.unreliable(new Uint8Array([2])));
        await exchange();
        expect(app.networkClients.length).toBe(1);
        expect(app.simulation.bodies.read(carried.actor)).toBeNull();
        for (let i = 0; i < 4; i++)
            await exchange();
        expect(second.deliveries.some(value => value.kind === 'reliable' && value.message.kind === 'name' && value.message.slot === carried.client.slot && value.message.value === '')).toBe(true);
    }
    finally {
        for (const peer of peers)
            peer.transport.close();
        await app.close();
    }
}, 30000);

test('production NetQuake remote frontend presents retail e1m1, sends input and travels without a simulation', async () => {
    const { RemoteApplication } = await import('../../../src/app/bootstrap/remote-application.ts');
    const { Q1RemotePresentation } = await import('../../../src/app/bootstrap/network/remote-q1.ts');
    const { addressKey } = await import('../../../src/network/common/endpoint.ts');
    const selected = parseApplicationCommand(['--game','q1-classic-id1','--map','e1m1','--movement','q1','--character','q1','--dedicated','--listen','0','--bind','127.0.0.1']);
    if(selected.kind!=='run') throw new Error('Missing native server options');
    const prints:string[]=[], host={print:(text:string):undefined=>{prints.push(text);return undefined;}};
    const server=await Application.open(selected.options,host);
    let remote:Awaited<ReturnType<typeof RemoteApplication.open>>|null=null;
    try {
        const address=server.networkAddress;if(address===null) throw new Error('No native listener');
        const launch=parseApplicationCommand(['--game','q1-classic-id1','--map','e1m1','--movement','q1','--character','q1','--connect-q1',addressKey(address),'--renderer','cpu','--width','160','--height','120','--hidden']);
        if(launch.kind!=='run') throw new Error('Missing native client options');
        remote=await RemoteApplication.open(launch.options,host);
        const app=remote;
        const exchange=async():Promise<void>=>{await app.step(50);await Bun.sleep(1);await server.step(50);await Bun.sleep(1);await app.step(50);};
        for(let i=0;i<100&&app.localPlayers.length===0;i++) await exchange();
        expect(app.networkPhase).toBe('active'); expect(app.session.world).toBeNull();
        expect(app.remote instanceof Q1RemotePresentation).toBe(true);
        const local=app.localPlayers[0], admitted=server.networkClients[0];
        if(local===undefined||admitted===undefined) throw new Error(`No native player: ${prints.join('\n')}`);
        expect(app.remote.playerUi(local.actor).health).toBe(server.simulation.playerUi(admitted.actor).health);
        expect(app.remote.playerUi(local.actor).activeWeapon).toBe(server.simulation.playerUi(admitted.actor).activeWeapon);
        expect(new Set(app.readPixels()).size).toBeGreaterThan(16);
        const before=server.simulation.bodies.read(admitted.actor)?.origin;
        app.input({seat:local.seat.id,kind:'key',code:119,down:true,repeat:false,timeMilliseconds:performance.now()});
        for(let i=0;i<8;i++) await exchange();
        app.input({seat:local.seat.id,kind:'key',code:119,down:false,repeat:false,timeMilliseconds:performance.now()});
        expect(server.simulation.bodies.read(admitted.actor)?.origin).not.toEqual(before);
        app.queueCommand('use',['q1:weapon/axe'],local.seat.id);
        for(let i=0;i<5;i++) await exchange();
        expect(server.simulation.playerUi(admitted.actor).activeWeapon).toBe('q1:weapon/axe');
        expect(app.remote.playerUi(local.actor).activeWeapon).toBe('q1:weapon/axe');
        const source=server.simulation.q1Source(), native=server.simulation.players()[0];
        if(source===null||native===undefined) throw new Error('No source player');
        const player=source.game.player(native);if(player===null) throw new Error('No native player');
        source.game.sound(player.actor,'weapons/shotgn2.wav','weapon');
        await server.step(50);await Bun.sleep(1);
        const sounding=await app.step(50);
        const playback=sounding?.events.find(event=>event.payload.kind==='sound');
        expect(playback?.payload.kind).toBe('sound');
        if(playback?.payload.kind!=='sound') throw new Error('No decoded native sound playback');
        expect(playback.payload.channel).toBe(1);expect(playback.payload.actor?.equals(local.actor)).toBe(true);
        expect(app.remote.sourceRecords.some(record=>typeof record==='object'&&record!==null&&'kind' in record&&record.kind==='sound')).toBe(true);
        const audible=app.presentationEvents.find(event=>event.kind==='q1'&&event.event.kind==='sound');
        if(audible?.kind!=='q1'||audible.event.kind!=='sound'||audible.event.origin===undefined) throw new Error('No positional audio event');
        const { ApplicationAudio }=await import('../../../src/app/bootstrap/audio.ts');
        const audio=new ApplicationAudio(app.content,()=>1000,1,'player',host.print);
        try {
            audio.engine.setListeners([{seat:local.seat.id,actor:null,origin:audible.event.origin,axis:[{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}],gain:1,underwater:false}]);
            audio.engine.updateActor(local.actor,{x:100000,y:100000,z:100000});
            await audio.receive([audible]);
            expect(audio.engine.mix(512).some(value=>value!==0)).toBe(true);
            if(!(app.remote instanceof Q1RemotePresentation)) throw new Error('Wrong remote adapter');
            const decoded = app.remote;
            const afterDrain = decoded.samplePresentation(performance.now());
            expect(afterDrain?.events.some(event => event.payload.kind === 'sound')).toBe(false);
            const replay = decoded.sourceRecords.find(record => record.kind === 'sound');
            if (replay === undefined) throw new Error('No source sound record');
            const receive = local.seat.receive;
            let delivered = 0;
            local.seat.receive = events => {
                delivered += events.filter(event => event.payload.kind === 'sound').length;
                return receive.call(local.seat, events);
            };
            try {
                await decoded.receive([replay], performance.now());
                await decoded.receive([], performance.now());
                const firstSample = decoded.samplePresentation(performance.now());
                const secondSample = decoded.samplePresentation(performance.now());
                expect(firstSample?.events.filter(event => event.payload.kind === 'sound')).toHaveLength(1);
                expect(secondSample?.events).toEqual(firstSample?.events);
                expect(delivered).toBe(0);
                expect(decoded.drainPresentationEvents().some(event => event.kind === 'q1' && event.event.kind === 'sound')).toBe(true);
                expect(delivered).toBe(1);
                expect(decoded.samplePresentation(performance.now())?.events).toHaveLength(0);
                expect(decoded.drainPresentationEvents()).toHaveLength(0);
                expect(delivered).toBe(1);
            } finally { local.seat.receive = receive; }

            const stop=async(channel:number):Promise<void>=>{
                const packed=admitted.sourceEntity*8+channel;
                await decoded.receive(new NetQuakeDecoder().decode(Uint8Array.of(16,packed&255,packed>>8)),performance.now());
                await audio.receive(decoded.drainPresentationEvents().filter(event=>event.kind==='q1'&&event.event.kind==='stop-sound'));
            };
            await stop(1);expect(audio.engine.mix(512).every(value=>value===0)).toBe(true);
            const auto={...audible,event:{...audible.event,channel:'auto'}} satisfies import('../../../src/app/bootstrap/simulation/types.ts').SimulationPresentationEvent;
            await audio.receive([auto,auto]);await stop(0);
            expect(audio.engine.mix(512).some(value=>value!==0)).toBe(true);
            await stop(0);expect(audio.engine.mix(512).every(value=>value===0)).toBe(true);
            await audio.receive([audible,{...audible,event:{...audible.event,channel:'voice'}}]);
            await stop(1);expect(audio.engine.mix(512).some(value=>value!==0)).toBe(true);
            await stop(2);expect(audio.engine.mix(512).every(value=>value===0)).toBe(true);
            const other=app.remote.presentations().find(value=>!value.actor.equals(local.actor));
            if(other===undefined) throw new Error('No second audio actor');
            await audio.receive([{...audible,event:{...audible.event,actor:other.actor}}]);
            await stop(1);expect(audio.engine.mix(512).some(value=>value!==0)).toBe(true);
            await audio.receive([{...audible,event:{kind:'stop-sound',actor:other.actor,channel:1}}]);
            expect(audio.engine.mix(512).every(value=>value===0)).toBe(true);

        }finally{audio.close();}
        const oldActor=local.actor, seat=local.seat, window=app.window;
        server.queueCommand('map',['e1m2'],null);
        for(let i=0;i<100&&(app.content.recipe.map.geometry.requestedPath!=='maps/e1m2.bsp'||app.localPlayers[0]?.actor.equals(oldActor)||app.networkPhase!=='active');i++) await exchange();
        expect(app.content.recipe.map.geometry.requestedPath).toBe('maps/e1m2.bsp');
        expect(app.networkPhase).toBe('active');expect(app.session.world).toBeNull();
        expect(app.localPlayers[0]?.actor.equals(oldActor)).toBe(false);expect(app.localPlayers[0]?.seat).toBe(seat);expect(app.window).toBe(window);
        const connection = app.remote.client.connection;
        if (connection === null) throw new Error('Missing published NetQuake connection');
        const reason = 'NetQuake owner disconnect reason';
        app.remote.disconnected(reason);
        expect(prints.filter(text => text === `${reason}\n`)).toHaveLength(1);
        expect(connection.isClosed).toBe(true); expect(app.remote.client.connection).toBeNull();
        await app.close();await Bun.sleep(1);await server.step(50);expect(server.networkClients.length).toBe(0);
    } finally {await remote?.close();await server.close();}
},30000);

test('production NetQuake client honors advertised game port and original signon/move bytes', async () => {
    const { Q1ClientNetwork } = await import('../../../src/app/bootstrap/network/q1-client.ts');
    const { encodeNetQuakeControl } = await import('../../../src/network/q1/handshake.ts');
    const { createIdentityOwner } = await import('../../../src/contracts/identity.ts');
    const control=await UdpTransport.bind({host:'127.0.0.1',port:0}), game=await UdpTransport.bind({host:'127.0.0.1',port:0}), transport=await UdpTransport.bind({host:'127.0.0.1',port:0});
    const identity=createIdentityOwner('native-port-proof'), reasons:string[]=[], messages:NetQuakeMessage[]=[];
    const client=new Q1ClientNetwork({transport,remote:control.address,seat:{name:'Native',color:77,spawnParameters:'',extensionFlags:null},host:{
        receive:async values=>{messages.push(...values);},command:value=>{if(value.command.kind!=='q1-netquake')throw new Error('Wrong command');return value.command;},disconnected:reason=>{reasons.push(reason);}}});
    const server=new NetQuakeChannel();
    const receive=async(socket:UdpTransport):Promise<Uint8Array>=>{for(let i=0;i<100;i++){const p=socket.poll();if(p?.kind==='packet')return p.payload;await Bun.sleep(1);}throw new Error('No native packet');};
    const send=async(payload:Uint8Array,now:number):Promise<Uint8Array>=>{
        game.send(transport.address,server.unreliable(payload));await Bun.sleep(1);await client.poll(now);
        const packet=await receive(game), delivered=server.receive(packet,now);
        for(const reply of delivered.replies)game.send(transport.address,reply);
        if(delivered.delivery===null)throw new Error('No reliable command');return delivered.delivery.payload;
    };
    try {
        await client.poll(0);
        expect([...await receive(control)]).toEqual([128,0,0,12,1,81,85,65,75,69,0,3]);
        control.send(transport.address,encodeNetQuakeControl({kind:'accept',port:game.address.port}));await Bun.sleep(1);await client.poll(1);
        expect(client.serverAddress).toEqual(game.address);
        expect([...await send(Uint8Array.of(25,1),2)]).toEqual([4,112,114,101,115,112,97,119,110,0]);
        await Bun.sleep(1);await client.poll(3);
        const stage2=await send(Uint8Array.of(25,2),4);
        expect(new TextDecoder().decode(stage2)).toBe('\x04name "Native"\n\0\x04color 4 13\n\0\x04spawn \0');
        await Bun.sleep(1);await client.poll(5);
        expect([...await send(Uint8Array.of(25,3),6)]).toEqual([4,98,101,103,105,110,0]);
        await Bun.sleep(1);await client.poll(7);
        game.send(transport.address,server.unreliable(Uint8Array.of(7,0,0,128,63,128,1)));await Bun.sleep(1);await client.poll(8);
        expect(client.phase).toBe('active');
        const command={actor:identity.actor(0,0),source:{kind:'remote-client',client:identity.client(0,0)},sequence:0,command:{kind:'q1-netquake',acknowledgedServerTimeSeconds:99,viewAngles:{x:0,y:90,z:180},forwardMove:200,sideMove:-100,upMove:0,buttons:3,impulse:7}} satisfies import('../../../src/contracts/session.ts').ActorCommand;
        client.submit([command],9);client.submit([command],10);await Bun.sleep(1);expect(game.poll()).toBeNull();
        client.submit([command],11);
        const move=server.receive(await receive(game),11).delivery;
        expect(move?.kind).toBe('unreliable');
        expect(move===null?[]:[...move.payload]).toEqual([3,0,0,128,63,0,64,128,200,0,156,255,0,0,3,7]);
        expect(control.poll()).toBeNull();expect(reasons).toEqual([]);expect(messages.some(value=>value.kind==='entity')).toBe(true);
        const profile = { kind:'q1-fitzquake',version:666 } satisfies import('../../../src/contracts/protocol.ts').Q1ProtocolIdentity;
        const wide = new SizeBuf(128), origin = {x:0,y:0,z:0};
        writeNetQuakeMessage(wide,profile,{kind:'version',version:666});
        writeNetQuakeMessage(wide,profile,{kind:'baseline',state:{number:7,origin,angles:origin,modelIndex:257,frame:513,colorMap:0,skin:0,effects:0,alpha:128,scale:16,lerpFinishSeconds:0,step:false}});
        game.send(transport.address,server.unreliable(wide.bytes()));await Bun.sleep(1);await client.poll(12);
        expect(client.wire).toEqual({kind:'source',protocol:profile});
        expect(messages.find(value=>value.kind==='baseline'&&value.state.number===7)).toMatchObject({kind:'baseline',state:{modelIndex:257,frame:513,alpha:128}});
        client.submit([command],13);
        const wideMove=server.receive(await receive(game),13).delivery;
        expect(wideMove===null?[]:[...wideMove.payload]).toEqual([3,0,0,128,63,0,0,0,64,0,128,200,0,156,255,0,0,3,7]);
        game.send(transport.address,server.unreliable(Uint8Array.of(4,9,3,0,0)));await Bun.sleep(1);
        await expect(client.poll(14)).rejects.toThrow('Unsupported NetQuake protocol 777');
    } finally {client.close();control.close();game.close();}
});

import {loadApplicationContent} from '../../../src/app/bootstrap/content.ts';
import {Q1RemotePresentation} from '../../../src/app/bootstrap/network/remote-q1.ts';
import {createIdentityOwner} from '../../../src/contracts/identity.ts';
import {EngineSession} from '../../../src/world/session/session.ts';
import type {Q1ExtendedEntityState} from '../../../src/contracts/protocol.ts';
test("NetQuake U_NOLERP snaps and dropped-packet interpolation retains the clamped endpoint", async () => {
const launch=parseApplicationCommand(['--game','q1-classic-id1','--map','e1m1','--movement','q1','--character','q1']);
if(launch.kind!=='run')throw Error('launch');
const content=await loadApplicationContent(launch.options),identity=createIdentityOwner('native-review'),session=new EngineSession(identity,{kind:'local'});
const remote=new Q1RemotePresentation({identity,session,client:session.createClient(0),nextGeneration:slot=>nextActorGeneration(session.session,slot),content,loadContent:async()=>content,sendCommand:()=>{},print:()=>{},publish:output=>session.publish(output),disconnected:()=>{}});
const zero={x:0,y:0,z:0};
const state=(x:number,step:boolean):Q1ExtendedEntityState=>({number:1,origin:{x,y:0,z:0},angles:zero,modelIndex:2,frame:0,colorMap:0,skin:0,effects:0,alpha:0,scale:16,lerpFinishSeconds:0,step});
try {
await remote.receive([{kind:'server-info',protocol:{kind:'q1-netquake',version:15},maxClients:1,gameType:0,level:'review',models:['maps/e1m1.bsp','progs/player.mdl'],sounds:[]},{kind:'set-view',entity:1},{kind:'client-data',weaponAlpha:0,data:{viewHeight:22,idealPitch:0,punchAngles:zero,velocity:zero,items:1,onGround:false,inWater:false,weaponFrame:0,armor:0,weaponModel:0,health:100,ammo:25,shells:25,nails:0,rockets:0,cells:0,activeWeapon:1}},{kind:'time',seconds:1},{kind:'entity',state:state(0,true)}],1000);
await remote.receive([{kind:'time',seconds:1.1},{kind:'entity',state:state(20,true)}],1100);
remote.samplePresentation(1150);
expect(remote.presentations()[0]?.origin.x).toBe(20);
const player=remote.player;if(player===null)throw Error('No remote view entity');
expect(remote.playerView(player.actor).origin.x).toBe(20);
await remote.receive([{kind:'time',seconds:1.5},{kind:'entity',state:state(40,false)}],1500);
const sampled=remote.samplePresentation(1550);
if(sampled===null||sampled.snapshot.frame.time.kind!=='seconds')throw Error('No sampled clock');
expect(sampled.snapshot.frame.time.value).toBeCloseTo(1.45,12);
expect(remote.presentations()[0]?.origin.x).toBeCloseTo(30,12);
expect(remote.samplePresentation(1500)?.snapshot.frame.time).toEqual({kind:'seconds',value:1.4});
expect(remote.samplePresentation(1600)?.snapshot.frame.time).toEqual({kind:'seconds',value:1.5});
await remote.receive([{kind:'static',state:state(60,true)}],1600);
const beforeReset=remote.presentations().map(value=>value.actor);
expect(beforeReset).toHaveLength(2);
expect(new Set(beforeReset.map(actor=>actor.slot)).size).toBe(2);
expect(beforeReset.every(actor=>actor.slot<65536)).toBe(true);
await remote.receive([{kind:'server-info',protocol:{kind:'q1-netquake',version:15},maxClients:1,gameType:0,level:'replacement',models:['maps/e1m1.bsp','progs/player.mdl'],sounds:[]},{kind:'entity',state:state(0,true)},{kind:'static',state:state(60,true)}],1700);
const afterReset=remote.presentations().map(value=>value.actor);
expect(afterReset.map(actor=>actor.slot)).toEqual(beforeReset.map(actor=>actor.slot));
expect(afterReset.every(actor=>beforeReset.every(old=>!actor.equals(old)))).toBe(true);
expect(afterReset.every(actor=>actor.slot<65536)).toBe(true);
} finally {session.close();await content.close();}
});
