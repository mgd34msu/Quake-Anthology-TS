import { expect, spyOn, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StartupApplication } from "../../../src/app/bootstrap/startup.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { NativeUiController } from "../../../src/ui/common/controller.ts";
import { KeyCode } from "../../../src/input/key-codes.ts";
import { encodePng } from "../../../src/formats/images/png-encoder.ts";

async function until(read:()=>boolean,label:string,step:()=>Promise<void>,milliseconds=45000):Promise<void>{
  const deadline=performance.now()+milliseconds;
  while(!read()){if(performance.now()>deadline)throw new Error(`Timed out: ${label}`);await step();await Bun.sleep(10);}
}
test.skipIf(process.env["QUAKE_ADDON_ASSETS"] === undefined || process.env["QUAKE_ADDON_OUTPUT"] === undefined)("public add-on library installs cached authored package, launches GL world, returns Main and shows Q3 tiers",async()=>{
  const assets=process.env["QUAKE_ADDON_ASSETS"],output=process.env["QUAKE_ADDON_OUTPUT"];
  if(assets===undefined||output===undefined)throw new Error("Use the isolated T02 runner");
  const directory=await mkdtemp(join(tmpdir(),"addon-public-"));
  const user=join(directory,"content");await mkdir(join(user,".addons"),{recursive:true});
  const digest="4108605842870e051b71be0721da4be004b22765dd4ba2bb0fc2e6769a55a17f";
  await copyFile(join(assets,digest+".zip"),join(user,".addons",digest+".zip"));
  await copyFile(join(assets,"quaddicted.json"),join(user,".addons","quaddicted.json"));
  const parsed=parseApplicationCommand(["--content-root","/home/buzzkill/Projects/qfiles","--game","q1-classic-id1","--movement","q1","--character","q1","--renderer","gl","--width","640","--height","480","--user-content-root",user]);
  if(parsed.kind!=="run"&&parsed.kind!=="menu")throw new Error("Missing options");
  const observed:{controller:NativeUiController|null;labels:readonly string[]}={controller:null,labels:[]};
  const original=NativeUiController.prototype.draw;
  const observer=spyOn(NativeUiController.prototype,"draw").mockImplementation(function(this:NativeUiController,...args){const commands=original.call(this,...args);observed.controller=this;observed.labels=commands.flatMap(command=>command.kind==="text"?[command.text.trim()]:[]);return commands;});
  const messages:string[]=[];let startup:StartupApplication|null=null;
  try{
    startup=await StartupApplication.open(parsed.options,{print:text=>{messages.push(text);}},join(directory,"saves"));
    const owner=startup;await owner.step();const retained=owner.inputSeat;if(retained===null)throw new Error("No frontend seat");
    const key=(code:number):void=>{const seat=owner.inputSeat;if(seat===null)throw new Error("Frontend input unavailable");for(const down of [true,false])owner.input({seat,kind:"key",code,down,repeat:false,timeMilliseconds:performance.now()});};
    const focus=(id:string):void=>{for(let attempt=0;attempt<40;attempt++){const state=observed.controller?.state().focus;if(state?.kind==="menu"&&state.control===id)return;key(KeyCode.Tab);}throw new Error(`Control not reachable: ${id}`);};
    const choose=async(id:string):Promise<void>=>{focus(id);key(KeyCode.Enter);await owner.step();};
    const screenshot=async(name:string):Promise<void>=>{const capture=owner.captureNextFrame();await owner.step();const pixels=await capture;await Bun.write(join(output,name),encodePng(640,480,pixels));};
    await choose("ui:startup:library");await choose("ui:startup:library:addons");
    await until(()=>observed.labels.some(label=>label.includes("Base To Hell")),"cached public catalog",()=>owner.step());
    focus("ui:library:search");owner.input({seat:retained,kind:"text",text:"Base To Hell",timeMilliseconds:performance.now()});await owner.step();
    await choose("ui:library:entries");
    expect(observed.labels.some(label=>label.startsWith("Install"))).toBe(true);
    focus("ui:library:entries");key(KeyCode.Home);key(KeyCode.Enter);await owner.step();
    await until(()=>observed.labels.some(label=>label.startsWith("Play")),"package publication",()=>owner.step());
    await screenshot("addon-installed.png");
    focus("ui:library:entries");key(KeyCode.Home);key(KeyCode.Enter);await owner.step();
    await until(()=>owner.activeGame!==null,"authored add-on world",()=>owner.step());
    const game=owner.activeGame;if(game===null)throw new Error("No active game");
    expect(game.options.map).toBe("maps/basetohell.bsp");expect(game.options.product).toContain("qd_");
    const player=game.localPlayers[0];if(player===undefined)throw new Error("No local player");
    expect(player.seat.id).toBe(retained);
    const start=game.simulation.bodies.read(player.actor)?.origin;if(start===undefined)throw new Error("No player body");
    await screenshot("addon-start.png");
    const before={...start};const began=performance.now();let released=false,frames=0;
    game.input({seat:retained,kind:"key",code:119,down:true,repeat:false,timeMilliseconds:began});
    while(performance.now()-began<15000){
      if(!released&&performance.now()-began>1500){game.input({seat:retained,kind:"key",code:119,down:false,repeat:false,timeMilliseconds:performance.now()});released=true;}
      await owner.step();frames++;await Bun.sleep(8);
    }
    const after=game.simulation.bodies.read(player.actor)?.origin;if(after===undefined)throw new Error("Player body disappeared");
    expect(Math.hypot(after.x-before.x,after.y-before.y,after.z-before.z)).toBeGreaterThan(1);
    expect(game.simulation.timeSeconds).toBeGreaterThan(5);expect(frames).toBeGreaterThan(15);
    await screenshot("basetohell-gl.png");
    for(const down of [true,false])game.input({seat:retained,kind:"key",code:KeyCode.Escape,down,repeat:false,timeMilliseconds:performance.now()});
    await owner.step();
    if(!(player.seat.presentation instanceof WorldSeatPresentation))throw new Error("No shared world UI");
    const controller=player.seat.presentation.ui.controller;
    const quitControl=controller.activeMenu==="menu:application:death"?"ui:death:quit":"ui:application:quit";
    for(let attempt=0;attempt<30;attempt++){const state=controller.state().focus;if(state.kind==="menu"&&state.control===quitControl)break;for(const down of [true,false])game.input({seat:retained,kind:"key",code:KeyCode.Tab,down,repeat:false,timeMilliseconds:performance.now()});}
    expect(controller.state().focus).toMatchObject({control:quitControl});
    for(const down of [true,false])game.input({seat:retained,kind:"key",code:KeyCode.Enter,down,repeat:false,timeMilliseconds:performance.now()});
    await until(()=>owner.activeGame===null&&owner.inputSeat!==null,"Main menu",()=>owner.step());await owner.step();
    expect(owner.inputSeat).toBe(retained);
    for(let attempt=0;attempt<8&&observed.controller?.activeMenu!=="menu:startup:main";attempt++){key(KeyCode.Escape);await owner.step();}
    expect(observed.controller?.activeMenu).toBe("menu:startup:main");await screenshot("addon-return-main.png");
    await choose("ui:startup:native");await choose("ui:startup:game:q3:classic");await choose("ui:startup:preset:q3-baseq3");
    await until(()=>observed.controller?.activeMenu==="menu:library:arena-selection"&&observed.labels.some(label=>label.startsWith("Opponents:")),"drawn Q3 arena menu",()=>owner.step());
    expect(observed.labels.some(label=>label.startsWith("Opponents:"))).toBe(true);await screenshot("q3-tier-selection.png");
    for(let attempt=0;attempt<8&&observed.controller?.activeMenu!=="menu:startup:main";attempt++){key(KeyCode.Escape);await owner.step();}
    expect(observed.controller?.activeMenu).toBe("menu:startup:main");await choose("ui:startup:quit");await owner.run();
    console.log(JSON.stringify({map:game.options.map,frames,elapsed:performance.now()-began,originBefore:before,originAfter:after,retainedSeat:true,quit:true}));
  }catch(error){console.error(messages.join("\n"));throw error;}
  finally{startup?.requestQuit();await startup?.close();observer.mockRestore();await rm(directory,{recursive:true,force:true});}
},150000);
