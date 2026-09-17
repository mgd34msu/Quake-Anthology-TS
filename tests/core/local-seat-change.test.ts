import { expect, test } from 'bun:test';
import { createIdentityOwner } from '../../src/contracts/identity.ts';
import type { ExecutableRecipe } from '../../src/contracts/content.ts';
import type { Simulation, SimulationOutput } from '../../src/contracts/session.ts';
import { EngineSession, SourceClock } from '../../src/world/session/index.ts';
import { prepareLocalSeatChange } from '../../src/app/bootstrap/local-seat-change.ts';

test('local join preparation rolls back and publication retains current world and other client resources', () => {
 const identity=createIdentityOwner('local-seat-change'), session=new EngineSession(identity,{kind:'local'});
 const clock=new SourceClock({kind:'milliseconds',value:50});
 const output:SimulationOutput={snapshot:{session:identity.session,frame:clock.frame,actors:[],bodies:[],inventories:[],configurations:[],scene:{session:identity.session,time:clock.frame.time,world:null,entities:[],lights:[],particles:[],lightStyles:[],areaBits:null}},events:[]};
 let worldClosed=0, retainedClosed=0, removedClosed=0;
 const simulation:Simulation={session:identity.session,get recipe():ExecutableRecipe{throw new Error('Unused recipe');},step:()=>output,checkpoint:()=>{throw new Error('Unused checkpoint');},close:()=>{worldClosed++;return undefined;}};
 const world=session.attachWorld(simulation), client=session.createClient(0), seat=session.createSeat(0,client);
 client.worldResources.defer(()=>{retainedClosed++;return undefined;});
 const original=[{client,seat}], capacity={localSeats:4,clients:4};
 session.step({elapsedMilliseconds:50,commands:[]});
 const discarded=prepareLocalSeatChange(session,original,{kind:'join'},capacity);
 expect(session.clientAt(1)).toBeNull(); discarded.validate(); discarded.discard(); discarded.discard();
 expect(discarded.added?.seat.isClosed).toBe(true); expect(session.world).toBe(world); expect(session.snapshot).toBe(output.snapshot);
 const added=prepareLocalSeatChange(session,original,{kind:'join'},capacity); const newSeat=added.added;
 if(newSeat===null)throw new Error('Missing joined seat'); newSeat.client.worldResources.defer(()=>{removedClosed++;return undefined;});
 added.publish().close(); expect(session.clientAt(1)).toBe(newSeat.client); expect(session.world).toBe(world); expect(retainedClosed).toBe(0); expect(worldClosed).toBe(0);
 const drop=prepareLocalSeatChange(session,added.next,{kind:'drop',seat:newSeat.seat.id},capacity); drop.validate();
 const retired=drop.publish(); expect(session.clientAt(1)).toBeNull(); expect(newSeat.seat.isClosed).toBe(false); expect(removedClosed).toBe(0);
 retired.close();retired.close();expect(newSeat.seat.isClosed).toBe(true);expect(removedClosed).toBe(1);expect(retainedClosed).toBe(0);expect(session.world).toBe(world);expect(session.snapshot).toBe(output.snapshot);
 world.close(); expect(() => session.validateLocalSeats([], {added:[],removed:[]}, {added:[],removed:[]})).toThrow("retired world");
 session.close();expect(worldClosed).toBe(1);expect(retainedClosed).toBe(1);
});

test('remote seats reserve and publish distinct connections without an authoritative world', async () => {
  const { prepareRemoteSeatIdentities } = await import('../../src/app/bootstrap/remote-seat-identities.ts');
  const identity=createIdentityOwner('remote-seat-identities'),session=new EngineSession(identity,{kind:'local'});
  const primary=session.createClient(0),seat=session.createSeat(0,primary),connection=primary.connect('remote');
  try {
    const abandoned=prepareRemoteSeatIdentities(session,[{client:primary,seat}],3);
    expect(session.clientAt(1)).toBeNull();
    abandoned.discard();abandoned.discard();
    expect(abandoned.added.every(entry=>entry.client.isClosed && entry.seat.isClosed)).toBe(true);
    expect(primary.connection).toBe(connection);
    const next=prepareRemoteSeatIdentities(session,[{client:primary,seat}],3);
    next.validate();next.publish();
    expect(session.world).toBeNull();expect(session.snapshot).toBeNull();
    expect(next.selected[0]?.seat).toBe(seat);
    expect(new Set(next.selected.map(entry=>entry.client.id.slot)).size).toBe(3);
    expect(new Set(next.selected.map(entry=>entry.seat.id.index)).size).toBe(3);
    for(const entry of next.added){expect(session.clientAt(entry.client.id.slot)).toBe(entry.client);entry.client.connect('remote');}
    next.discard();
    expect(next.selected.every(entry=>!entry.client.isClosed && !entry.seat.isClosed)).toBe(true);
    expect(primary.connection).toBe(connection);
    const promoted = next.selected[1];
    if (promoted === undefined) throw new Error('Missing retained successor');
    const promotedConnection = promoted.client.connection;
    primary.disconnect();
    const joined = prepareRemoteSeatIdentities(session, [promoted, {client: primary, seat}], 2);
    joined.validate(); joined.publish();
    expect(joined.selected[0]).toBe(promoted);
    expect(joined.selected[1]?.seat).toBe(seat);
    expect(joined.added).toHaveLength(0);
    expect(promoted.client.connection).toBe(promotedConnection);
  } finally {session.close();}
});
