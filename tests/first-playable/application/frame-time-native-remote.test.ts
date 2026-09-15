import { expect, spyOn, test } from 'bun:test';
import { resolve } from 'node:path';
import { Application } from '../../../src/app/bootstrap/application.ts';
import { RemoteApplication } from '../../../src/app/bootstrap/remote-application.ts';
import { Q3ServerConnection } from '../../../src/network/q3/server.ts';
import { Q3ClientNetwork } from '../../../src/app/bootstrap/network/q3-client.ts';
import { Q3RemotePresentation } from '../../../src/app/bootstrap/network/remote-q3.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { encodePng } from '../../../src/formats/images/png.ts';
const output=process.env["FRAME_TIME_PROOF"] ?? import.meta.dir;
function readRemoteTime(remote: Q3RemotePresentation) {
  const output = remote.output;
  if (output === null) throw new Error("Remote fixture has no active output");
  return output.snapshot.frame.time;
}
test('actual Q3 UDP peer retains wall transport and scaled client command clocks',async()=>{
  const prints:string[]=[], samples:object[]=[], forwards:number[]=[], opened=performance.now();
  let server:Application|null=null,client:RemoteApplication|null=null,completed=false,remoteStart=0;
  const poll=Q3ClientNetwork.prototype.poll,submit=Q3ClientNetwork.prototype.submit;
  const polls=spyOn(Q3ClientNetwork.prototype,'poll').mockImplementation(async function(this:Q3ClientNetwork,now){
    const actual=performance.now(); expect(now).toBeGreaterThanOrEqual(remoteStart); expect(now).toBeLessThanOrEqual(actual);
    samples.push({kind:'poll',wall:now,actual});return await poll.call(this,now);
  });
  const submits=spyOn(Q3ClientNetwork.prototype,'submit').mockImplementation(function(this:Q3ClientNetwork,commands,now){
    samples.push({kind:'submit',wall:now,actual:performance.now(),commands:commands.map(value=>value.command)});
    for(const value of commands)if(value.command.kind==="q3")forwards.push(value.command.forwardMove);
    submit.call(this,commands,now);
    const native=this.native,wire=native?.commands.read(native.commands.currentNumber);
    if(wire!==null&&wire!==undefined){
      samples.push({kind:"actual-wire-command",command:wire});
      if(commands.length>0&&client?.remote instanceof Q3RemotePresentation){
        const time=readRemoteTime(client.remote);
        if(time.kind!=="milliseconds")throw new Error("Unexpected Q3 clock domain");
        expect(wire.serverTime).toBe(time.value);
      }
    }
  });
  const connections=new Set<Q3ServerConnection>(), sendSnapshot=Q3ServerConnection.prototype.sendSnapshot;
  const snapshots=spyOn(Q3ServerConnection.prototype,'sendSnapshot').mockImplementation(function(this:Q3ServerConnection,flags,rate,delivery,download){
    connections.add(this);sendSnapshot.call(this,flags,rate,delivery,download);
    samples.push({kind:'server-snapshot',wall:performance.now(),nextSnapshotTime:this.nextSnapshotTime});
  });
  try{
    const parsed=parseApplicationCommand(['--game','q3-baseq3','--map','q3dm1','--movement','q3','--character','q3','--mode','deathmatch','--dedicated','--listen','0','--bind','127.0.0.1','--user-content-root',resolve(output,'server-content')]);
    if(parsed.kind!=='run')throw new Error('Missing server options');
    server=await Application.open(parsed.options,{print:text=>{prints.push(text);}});
    const authority=server.simulation.q3Source();if(authority===null)throw new Error('Missing native Q3 authority');
    authority.host.cvars.set('sv_cheats','1',true);
    const address=server.networkAddress;if(address===null)throw new Error('Missing UDP listener');
    const chosen=parseApplicationCommand(['--game','q3-baseq3','--map','q3dm1','--movement','q3','--character','q3','--mode','deathmatch','--connect-q3',`127.0.0.1:${address.port}`,'--renderer','gl','--width','320','--height','240','--hidden','--user-content-root',resolve(output,'remote-content')]);
    if(chosen.kind!=='run')throw new Error('Missing remote options');
    client=await RemoteApplication.open(chosen.options,{print:text=>{prints.push(text);}});
    const peer=server,remote=client;let lastServer=performance.now(),lastRemote=lastServer;
    const exchange=async()=>{await Bun.sleep(20);let now=performance.now();await peer.step(now-lastServer);lastServer=now;await Bun.sleep(1);now=performance.now();remoteStart=now;await remote.step(now-lastRemote);lastRemote=now;
      const player=peer.networkClients[0],connection=connections.values().next().value;
      if(player!==undefined){const entity=authority.records.nativeByActor(player.actor);
        samples.push({kind:'authority-state',wall:performance.now(),sourceMilliseconds:authority.level.time,
          position:peer.simulation.playerView(player.actor).origin,health:entity?.health,pmType:entity?.client?.ps.pmType,
          commandTime:entity?.client?.ps.commandTime,lastAcceptedWire:connection?.lastUserCommand.serverTime,
          lastAcceptedForward:connection?.lastUserCommand.forwardmove});}
    };
    for(let i=0;i<100&&remote.networkPhase!=='active';i++)await exchange();
    expect(remote.networkPhase).toBe('active');expect(remote.session.world).toBeNull();
    const local=remote.localPlayers[0],admitted=peer.networkClients[0];if(local===undefined||admitted===undefined)throw new Error('Missing real peer actor');
    if(!(remote.remote instanceof Q3RemotePresentation))throw new Error('Missing native Q3 remote clock');
    authority.host.cvars.set('timescale','2',true);
    for(let i=0;i<30&&remote.clientCommands?.cvars.variableValue('timescale')!==2;i++)await exchange();
    expect(remote.clientCommands?.cvars.variableValue('timescale')).toBe(2);
    const position=peer.simulation.playerView(admitted.actor).origin;
    remote.input({seat:local.seat.id,kind:'key',code:119,down:true,repeat:false,timeMilliseconds:performance.now()});
    for(let i=0;i<16;i++)await exchange();
    remote.input({seat:local.seat.id,kind:'key',code:119,down:false,repeat:false,timeMilliseconds:performance.now()});
    expect(peer.simulation.playerView(admitted.actor).origin).not.toEqual(position);
    expect(forwards.some(value=>value>=100)).toBe(true);
    const connection=connections.values().next().value;
    if(connection===undefined)throw new Error('Missing actual server connection');
    const frozen=peer.simulation.timeSeconds, deadline=connection.nextSnapshotTime, sent=snapshots.mock.calls.length, polled=polls.mock.calls.length;
    authority.host.cvars.set('com_cameraMode','1',true);authority.host.cvars.set('timescale','0',true);
    for(let i=0;i<10;i++)await exchange();
    expect(peer.simulation.timeSeconds).toBe(frozen);expect(connection.nextSnapshotTime).toBe(deadline);
    expect(snapshots.mock.calls.length).toBe(sent);expect(polls.mock.calls.length).toBeGreaterThan(polled);
    expect(remote.clientCommands?.cvars.variableValue('timescale')).toBe(2);
    samples.push({kind:'frozen-server',sourceSeconds:frozen,deadline,polls:polls.mock.calls.length-polled,retainedClientScale:remote.clientCommands?.cvars.variableValue('timescale')});
    const capture=remote.captureNextFrame();await exchange();await Bun.write(resolve(output,'remote-frozen.png'),encodePng(320,240,await capture));
    const frozenHighwater=connection.lastUserCommand.serverTime;
    authority.host.cvars.set('timescale','1',true);authority.host.cvars.set('com_cameraMode','0',true);
    for(let i=0;i<30&&remote.clientCommands?.cvars.variableValue('timescale')!==1;i++)await exchange();
    expect(remote.clientCommands?.cvars.variableValue('timescale')).toBe(1);expect(peer.simulation.timeSeconds).toBeGreaterThan(frozen);
    const resumedPosition=peer.simulation.playerView(admitted.actor).origin;
    remote.input({seat:local.seat.id,kind:'key',code:115,down:true,repeat:false,timeMilliseconds:performance.now()});
    const recoveryStarted=performance.now();let recoveryExchanges=0;
    const moved=()=>{const position=peer.simulation.playerView(admitted.actor).origin;return position.x!==resumedPosition.x||position.y!==resumedPosition.y||position.z!==resumedPosition.z;};
    while(recoveryExchanges<100&&performance.now()-recoveryStarted<5000&&(connection.lastUserCommand.serverTime<=frozenHighwater||connection.lastUserCommand.forwardmove>=0||!moved())){await exchange();recoveryExchanges++;}
    samples.push({kind:'recovery',frozenHighwater,accepted:connection.lastUserCommand.serverTime,acceptedForward:connection.lastUserCommand.forwardmove,wallMilliseconds:performance.now()-recoveryStarted,recoveryExchanges,moved:moved()});
    expect(connection.lastUserCommand.serverTime).toBeGreaterThan(frozenHighwater);expect(connection.lastUserCommand.forwardmove).toBeLessThan(0);
    remote.input({seat:local.seat.id,kind:'key',code:115,down:false,repeat:false,timeMilliseconds:performance.now()});
    expect(peer.simulation.playerView(admitted.actor).origin).not.toEqual(resumedPosition);
    expect(remote.networkPhase).toBe('active');completed=true;
  }finally{await client?.close();await server?.close();polls.mockRestore();submits.mockRestore();snapshots.mockRestore();await Bun.write(resolve(output,'remote.json'),JSON.stringify({completed,wallMilliseconds:performance.now()-opened,samples,prints},null,2));}
},150000);
