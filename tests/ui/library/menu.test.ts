import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { UiDrawContext } from "../../../src/contracts/ui.ts";
import { KeyCode } from "../../../src/input/key-codes.ts";
import { NativeUiController } from "../../../src/ui/common/controller.ts";
import { defaultUiSkin } from "../../../src/ui/common/skin.ts";
import { registerLibraryMenu, type LibraryMenuService } from "../../../src/ui/library/menu.ts";

test("library controller separates detail actions from catalog search and restores catalog search", () => {
  const owner=createIdentityOwner("library-scope"),seat=owner.seat(0);
  let scope="catalog",installed=false;
  const actions:string[]=[];
  const service:LibraryMenuService={scope:()=>scope,entries:()=>scope==="catalog"
    ?[{id:"addon",label:"A map",detail:"Quaddicted"},{id:"other",label:"Another map",detail:"Local"}]
    :[...(installed?[{id:"play",label:"Play"},{id:"remove",label:"Remove"}]:[{id:"install",label:"Install"}]),{id:"back",label:"Back to add-ons"}],
    refresh:()=>{},status:()=>"",activate:id=>{actions.push(id);if(id==="addon")scope="details";if(id==="back")scope="catalog";if(id==="install")installed=true;if(id==="remove")installed=false;}};
  const ui=new NativeUiController({seat,now:()=>0,skin:()=>defaultUiSkin("resource:test:font"),bindings:()=>[],focus:()=>{},sound:()=>{},executeScript:()=>{}});
  const menu=registerLibraryMenu(ui,"menu:test:library","Add-ons",service);
  const provider={provider:"ui:test",content:"q1:rerelease:id1:retail"} satisfies UiDrawContext["binding"]["presentation"]["hud"];
  const context:UiDrawContext={binding:{seat,client:owner.client(0,0),viewport:{x:0,y:0,width:640,height:480},safeArea:{x:0,y:0,width:640,height:480},hudScale:1,
    presentation:{doppler:{kind:"source"},environment:{kind:"audio-content"},assets:provider.content,hud:provider,effects:provider,audio:provider}},timeMilliseconds:0};
  const text=()=>ui.draw(context).flatMap(command=>command.kind==="text"?[command.text.trim()]:[]);
  const key=(code:number):void=>{ui.input({kind:"key",seat,timeMilliseconds:0,code,down:true,repeat:false});};
  ui.openMenu(menu.root);ui.input({kind:"text",seat,timeMilliseconds:0,text:"Quaddicted"});
  expect(text()).not.toContain("Another map");key(KeyCode.Tab);key(KeyCode.Enter);
  expect(text()).toContain("Install");expect(text()).toContain("Back to add-ons");
  key(KeyCode.Home);key(KeyCode.Enter);expect(text()).toContain("Play");expect(text()).toContain("Remove");
  key(KeyCode.Home);key(KeyCode.Down);key(KeyCode.Enter);expect(text()).toContain("Install");
  key(KeyCode.End);key(KeyCode.Enter);
  expect(text()).toContain("Quaddicted");expect(text()).not.toContain("Another map");
  expect(actions).toEqual(["addon","install","remove","back"]);
  menu.dispose();
});
