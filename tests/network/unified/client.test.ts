import {expect,test} from 'bun:test';
import {createIdentityOwner} from '../../../src/contracts/identity.ts';
import {EngineSession} from '../../../src/world/session/session.ts';
import {nextActorGeneration} from '../../../src/world/actors/registry.ts';
import type {DatagramTransport,ReceiveEvent} from '../../../src/network/common/transport.ts';
import type {LoopbackAddress} from '../../../src/network/common/endpoint.ts';
import {UnifiedClientNetwork} from '../../../src/app/bootstrap/network/unified-client.ts';
import {UnifiedRemotePresentation} from '../../../src/app/bootstrap/network/remote-unified.ts';
import {decodeUnifiedHandshake,encodeUnifiedHandshake} from '../../../src/app/bootstrap/network/unified-control.ts';

function fixture(){
  const identity=createIdentityOwner('unified-client-test'),session=new EngineSession(identity,{kind:'local'}),client=session.createClient(3),seat=session.createSeat(2,client);
  const remote:LoopbackAddress={kind:'loopback',id:'server'},received:ReceiveEvent<LoopbackAddress>[]=[],sent:Uint8Array[]=[],failures:string[]=[];
  let closed=false;
  const transport:DatagramTransport<LoopbackAddress>={address:{kind:'loopback',id:'client'},get closed(){return closed;},
    send:(_to,bytes)=>{sent.push(bytes);return !closed;},poll:()=>received.shift()??null,subscribeReadable:()=>()=>{},close:()=>{closed=true;}};
  const presentation=new UnifiedRemotePresentation({identity,client,seat:seat.id,nextGeneration:slot=>nextActorGeneration(identity.session,slot),
    loadContent:async()=>{throw new Error('Unexpected world offer');},model:async()=>{throw new Error('Unexpected model');},publish:()=>{},sendCommand:()=>{},disconnected:reason=>failures.push(reason),print:()=>{}});
  return {remote,received,sent,failures,transport,client,network:new UnifiedClientNetwork({transport,remote,host:presentation,userinfo:()=>String.raw`\name\Test`})};
}

test('unanswered unified handshake times out and retires only its transport',async()=>{
  const f=fixture();await f.network.poll(100);expect(f.network.phase).toBe('challenging');
  await expect(f.network.poll(120101)).rejects.toThrow('timed out');
  expect(f.transport.closed).toBe(true);expect(f.network.phase).toBe('closed');expect(f.client.isClosed).toBe(false);expect(f.failures).toEqual(['Unified connection timed out']);
});

test('unified challenge accepts only matching peer and nonce and close prevents later work',async()=>{
  const f=fixture();await f.network.poll(0);const first=f.sent[0];if(first===undefined)throw new Error('Missing hello');
  const hello=decodeUnifiedHandshake(first);if(hello?.kind!=='hello')throw new Error('Expected hello');
  const token='a'.repeat(32),push=(from:LoopbackAddress,nonce:string)=>f.received.push({kind:'packet',from,receivedAt:1,payload:encodeUnifiedHandshake({kind:'challenge',nonce,token})});
  push({kind:'loopback',id:'other'},hello.nonce);push(f.remote,'b'.repeat(32));await f.network.poll(1);expect(f.network.phase).toBe('challenging');expect(f.sent.length).toBe(1);
  push(f.remote,hello.nonce);await f.network.poll(2);expect(f.network.phase).toBe('connecting');
  const connect=f.sent[1];if(connect===undefined)throw new Error('Missing connect');expect(decodeUnifiedHandshake(connect)).toEqual({kind:'connect',nonce:hello.nonce,token});
  f.network.close();const count=f.sent.length;await f.network.poll(10000);expect(f.sent.length).toBe(count);expect(f.client.isClosed).toBe(false);
});
