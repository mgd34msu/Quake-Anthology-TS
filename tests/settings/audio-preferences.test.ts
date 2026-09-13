import type { Application as ApplicationInstance } from '../../src/app/bootstrap/application.ts';
import type { RemoteApplication as RemoteApplicationInstance } from '../../src/app/bootstrap/remote-application.ts';
import type { SdlAudioDevice as SdlAudioDeviceInstance } from '../../src/platform/audio.ts';
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from '../../src/settings/config.ts';
import { loadAudioSettings, saveAudioSettings } from '../../src/app/bootstrap/audio-settings.ts';
import { bindAudioSettings } from '../../src/ui/settings/index.ts';

test('audio menu exposes default and retained named output without claiming failed selection', async () => {
  const messages: string[] = [];
  const state: { selectedOutput: string | null; effectsVolume: number; musicVolume: number } = { selectedOutput: 'Previously attached', effectsVolume: 0.7, musicVolume: 0.5 };
  const bindings = bindAudioSettings({ read: () => state, write: values => { Object.assign(state, values); } }, {
    selected: () => state.selectedOutput, devices: () => ['Available'],
    select: name => { if (name === 'Unavailable') throw new Error('Device unavailable'); state.selectedOutput = name; }, report: text => { messages.push(text); } });
  const device = bindings.find(binding => binding.id === 'ui:audio:device'); if (device?.kind !== 'choice') throw Error('Missing device choice');
  expect(device.choices()).toEqual([{id:'default',label:'System default'},{id:'device:Available',label:'Available'},{id:'device:Previously attached',label:'Previously attached'}]);
  device.write('device:Unavailable'); expect(device.read()).toBe('device:Previously attached'); expect(messages).toHaveLength(1);
  device.write('default'); expect(device.read()).toBe('default');
  device.write('device:Available'); expect(device.read()).toBe('device:Available');
  for (const binding of bindings) if (binding.kind === 'slider') binding.write(binding.id === 'ui:audio:effects' ? 0.3 : 0.8);
  const root = await mkdtemp(join(tmpdir(), 'audio-preferences-'));
  try {
    const store = new ConfigStore(root); expect(await loadAudioSettings(store)).toEqual({});
    await saveAudioSettings(store, state);
    expect(await loadAudioSettings(new ConfigStore(root))).toEqual({deviceName:'Available',effectsVolume:0.3,musicVolume:0.8});
    state.selectedOutput = null; await saveAudioSettings(store, state);
    expect((await loadAudioSettings(store)).deviceName).toBeNull();
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('audio disk preferences reject malformed or out-of-range settings at load boundary', async () => {
  const root = await mkdtemp(join(tmpdir(),'audio-invalid-'));
  try {
    const store = new ConfigStore(root);
    for (const invalid of [{version:1,deviceName:`bad${String.fromCharCode(0)}name`,effectsVolume:0.5,musicVolume:0.5}, {version:2,deviceName:null,effectsVolume:0.5,musicVolume:0.5}, {version:1,deviceName:'',effectsVolume:0.5,musicVolume:0.5}, {version:1,deviceName:null,effectsVolume:2,musicVolume:0.5}]) {
      await store.dump('audio.json',JSON.stringify(invalid)); await expect(loadAudioSettings(store)).rejects.toThrow('Invalid audio preferences');
    }
  } finally { await rm(root,{recursive:true,force:true}); }
});

for (const backend of ['cpu', 'gl']) test(`actual ${backend} audio menu saves device and volumes across application restart`, async () => {
  const { spyOn } = await import('bun:test');
  const { Application } = await import('../../src/app/bootstrap/application.ts');
  const { ApplicationAudio } = await import('../../src/app/bootstrap/audio.ts');
  const { parseApplicationCommand } = await import('../../src/app/bootstrap/options.ts');
  const { WorldSeatPresentation } = await import('../../src/app/bootstrap/presentation.ts');
  const { encodePng } = await import('../../src/formats/images/png.ts');
  const root = await mkdtemp(join(tmpdir(), 'audio-application-'));
  const parsed = parseApplicationCommand(['--game','q2-classic-baseq2','--map','base1','--movement','q2','--character','q2','--renderer',backend,'--hidden','--width','640','--height','480']);
  if (parsed.kind !== 'run') throw Error('Missing options');
  const owners: InstanceType<typeof ApplicationAudio>[] = [];
  const original = ApplicationAudio.prototype.prepareEnvironment;
  const prepare = spyOn(ApplicationAudio.prototype, 'prepareEnvironment').mockImplementation(function(this: InstanceType<typeof ApplicationAudio>, ...args) { owners.push(this); return original.apply(this,args); });
  let app: ApplicationInstance | null = null;
  try {
    app = await Application.open({...parsed.options,userContentRoot:root},{print:()=>undefined});
    const application=app, local=application.localPlayers[0], audio=owners.at(-1);
    if(local===undefined || !(local.seat.presentation instanceof WorldSeatPresentation) || audio===undefined)throw Error('Missing frontend');
    const ui=local.seat.presentation.ui.controller;
    const key=(code:number):void=>{for(const down of [true,false])application.input({seat:local.seat.id,kind:'key',code,down,repeat:false,timeMilliseconds:performance.now()});};
    const click=async(row:number,x=300):Promise<void>=>{
      const size=application.window?.drawableSize;if(size===undefined)throw Error('Missing window');
      const scale=Math.min(size.width/640,size.height/480);
      application.input({seat:local.seat.id,kind:'mouse-motion',position:{x:(size.width-640*scale)/2+x*scale,y:(size.height-480*scale)/2+(106+row*28)*scale},delta:{x:0,y:0},timeMilliseconds:performance.now()});
      for(const down of [true,false])application.input({seat:local.seat.id,kind:'mouse-button',button:1,down,timeMilliseconds:performance.now()});
      await application.step(25);
    };
    await application.step(25);key(27);await application.step(25);await click(3);await click(1);
    expect(ui.activeMenu).toBe('menu:settings:audio:0');
    const named=audio.outputDeviceNames()[0];if(named===undefined)throw Error('Dummy output unavailable');
    await click(0);expect(audio.selectedOutput).toBe(named);
    await click(1,400);await click(2,460);
    const expected={deviceName:audio.selectedOutput,effectsVolume:audio.effectsVolume,musicVolume:audio.musicVolume};
    expect(expected.effectsVolume).not.toBe(1);expect(expected.musicVolume).not.toBe(1);
    const pending=application.captureNextFrame();await application.step(25);await Bun.write(`/tmp/audio-menu-${backend}.png`,encodePng(640,480,await pending));
    await application.close();app=null;
    expect(await loadAudioSettings(new ConfigStore(join(root,'q2/baseq2')))).toEqual(expected);
    app=await Application.open({...parsed.options,userContentRoot:root},{print:()=>undefined});
    const restored=owners.at(-1);if(restored===undefined)throw Error('Missing restored audio');
    expect({deviceName:restored.selectedOutput,effectsVolume:restored.effectsVolume,musicVolume:restored.musicVolume}).toEqual(expected);
    await app.step(25);
  } finally { await app?.close();prepare.mockRestore();await rm(root,{recursive:true,force:true}); }
}, 60000);

test('native remote named audio output and volumes survive travel and close', async () => {
  const { spyOn }=await import('bun:test');
  const { Application }=await import('../../src/app/bootstrap/application.ts');
  const { RemoteApplication }=await import('../../src/app/bootstrap/remote-application.ts');
  const { ApplicationAudio }=await import('../../src/app/bootstrap/audio.ts');
  const { parseApplicationCommand }=await import('../../src/app/bootstrap/options.ts');
  const { addressKey }=await import('../../src/network/common/endpoint.ts');
  const { SdlAudioDevice, SdlAudioUnavailableError }=await import('../../src/platform/audio.ts');
  const live=new Set<SdlAudioDeviceInstance>();
  const openDevice=SdlAudioDevice.open, closeDevice=SdlAudioDevice.prototype.close;
  const opened=spyOn(SdlAudioDevice,'open').mockImplementation(options=>{if(live.size!==0)throw new SdlAudioUnavailableError('Exclusive output already in use');const device=openDevice.call(SdlAudioDevice,options);live.add(device);return device;});
  const closed=spyOn(SdlAudioDevice.prototype,'close').mockImplementation(function(this:SdlAudioDeviceInstance){live.delete(this);return closeDevice.call(this);});
  const messages:string[]=[];
  const root=await mkdtemp(join(tmpdir(),'audio-remote-'));
  const selected=parseApplicationCommand(['--game','q1-classic-id1','--map','e1m1','--movement','q1','--character','q1','--dedicated','--listen','0','--bind','127.0.0.1']);
  if(selected.kind!=='run')throw Error('Missing server options');
  const owners:InstanceType<typeof ApplicationAudio>[]=[];
  const original=ApplicationAudio.prototype.prepareEnvironment;
  const prepare=spyOn(ApplicationAudio.prototype,'prepareEnvironment').mockImplementation(function(this:InstanceType<typeof ApplicationAudio>,...args){owners.push(this);return original.apply(this,args);});
  let serverOwner:ApplicationInstance|null=null, remote:RemoteApplicationInstance|null=null;
  try {
    const server=await Application.open({...selected.options,userContentRoot:join(root,'server')},{print:()=>undefined});
    serverOwner=server;
    const address=server.networkAddress;if(address===null)throw Error('No server address');
    const parsed=parseApplicationCommand(['--game','q1-classic-id1','--map','e1m1','--movement','q1','--character','q1','--connect-q1',addressKey(address),'--renderer','cpu','--width','160','--height','120','--hidden']);
    if(parsed.kind!=='run')throw Error('Missing client options');
    remote=await RemoteApplication.open({...parsed.options,userContentRoot:join(root,'client')},{print:text=>{messages.push(text);return undefined;}});
    const app=remote;
    const exchange=async():Promise<void>=>{await app.step(50);await Bun.sleep(1);await server.step(50);await Bun.sleep(1);await app.step(50);};
    for(let i=0;i<100&&app.localPlayers.length===0;i++)await exchange();
    expect(app.networkPhase).toBe('active');
    const audio=owners.at(-1);if(audio===undefined)throw Error('No remote audio');
    const named=audio.outputDeviceNames()[0];if(named===undefined)throw Error('No dummy output');
    audio.selectOutput(named);audio.effectsVolume=0.35;audio.musicVolume=0.65;
    const seat=app.localPlayers[0]?.seat,window=app.window;
    server.queueCommand('map',['e1m2'],null);
    for(let i=0;i<100&&(app.content.recipe.map.geometry.requestedPath!=='maps/e1m2.bsp'||app.networkPhase!=='active');i++)await exchange();
    expect(app.content.recipe.map.geometry.requestedPath).toBe('maps/e1m2.bsp');expect(app.networkPhase).toBe('active');
    const current=owners.at(-1);if(current===undefined)throw Error('No travelled audio');
    expect(messages.some(text=>text.includes('Using system default'))).toBe(false);
    expect(current.selectedOutput).toBe(named);expect(current.effectsVolume).toBe(0.35);expect(current.musicVolume).toBe(0.65);
    expect(app.localPlayers[0]?.seat).toBe(seat);expect(app.window).toBe(window);expect(app.session.world).toBeNull();
    await app.close();remote=null;
    expect(await loadAudioSettings(new ConfigStore(join(root,'client/q1/id1')))).toEqual({deviceName:named,effectsVolume:0.35,musicVolume:0.65});
  } finally {
    try { await remote?.close(); } finally {
      try { await serverOwner?.close(); } finally { prepare.mockRestore();opened.mockRestore();closed.mockRestore();await rm(root,{recursive:true,force:true}); }
    }
  }
},60000);
