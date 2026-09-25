import { existsSync } from "node:fs";
import { openArchive } from "../../../src/content/archive/index.ts";
import { readQ1Bsp } from "../../../src/formats/q1-map/index.ts";
import { decodePalette } from "../../../src/formats/images/index.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { finishSceneOperations } from "../../../src/render/scene/submissions.ts";
import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { parseMd3, toSceneMd3 } from "../../../src/formats/q3-model/index.ts";
import { SceneModelRenderer } from "../../../src/render/scene/models/renderer.ts";
import { sceneModelBatches } from "../../../src/render/scene/submissions.ts";
import type { DecodedWorld, SceneEntity } from "../../../src/contracts/scene.ts";
import { SceneImageRegistry, SceneTextureLoader, SceneShaderRegistry, WorldScene, perspectiveProjection } from "../../../src/render/scene/index.ts";
import type { SceneAssetReader } from "../../../src/render/scene/textures.ts";
import { SceneMaterialRegistrations, currentRemap } from "../../../src/render/scene/material-registrations.ts";
import { anglesToAxis } from "../../../src/core/math.ts";
import { encodePng } from "../../../src/formats/images/png.ts";
import { prepareMaterialText } from "../../../src/render/commands/material2d.ts";
import { prepareMaterialBatches } from "../../../src/materials/evaluate.ts";

const pixels = encodePng(1, 1, new Uint8Array([255, 0, 0, 255]));
const asset = { bytes: pixels, source: { kind: "generated", name: "source-only" } } satisfies Awaited<ReturnType<SceneAssetReader["read"]>>;
function map(): Extract<DecodedWorld, {kind:"q3-bsp"}> {
  const bounds = { min: {x:32,y:-8,z:-8}, max:{x:32,y:8,z:8} };
  return { kind:"q3-bsp", format:"ibsp46", entities:'{\n"classname" "worldspawn"\n}', shaders:[{name:"shared/original",surfaceFlags:0,contentFlags:0}],
    planes:[],nodes:[],leaves:[{cluster:0,area:0,bounds,surfaces:{first:0,count:1},brushes:{first:0,count:0}}],
    leafSurfaces:[0],leafBrushes:[],models:[{bounds,surfaces:{first:0,count:1},brushes:{first:0,count:0}}],brushes:[],brushSides:[],
    vertices:[{x:32,y:-8,z:-8},{x:32,y:8,z:-8},{x:32,y:0,z:8}].map(position=>({position,normal:{x:-1,y:0,z:0},texCoord:{x:0,y:0},lightmapCoord:{x:0,y:0},color:{x:255,y:255,z:255,w:255}})),
    indices:[0,1,2],fogs:[],surfaces:[{kind:"planar",shader:0,fog:-1,vertices:{first:0,count:3},indices:{first:0,count:3},lightmap:{image:0,x:0,y:0,width:128,height:128,origin:{x:0,y:0,z:0},vectors:[{x:0,y:0,z:0},{x:0,y:0,z:0},{x:-1,y:0,z:0}]}}],
    lightmaps:[new Uint8Array(128*128*3).fill(96)],lightGrid:[],visibility:null };
}
async function fixture(read: SceneAssetReader["read"] = async()=>asset) {
  const identity=createIdentityOwner("atomic-remap"), images=new SceneImageRegistry({identity:Symbol("atomic-remap"),session:identity.session,generation:0}), registrations=new SceneMaterialRegistrations();
  const destination=new SceneShaderRegistry(new SceneTextureLoader(images,{read:async()=>null}),registrations.provider("q1:classic:retail:id1"));
  const source=new SceneShaderRegistry(new SceneTextureLoader(images,{read}),registrations.provider("q3:classic:retail:source"));
  destination.addScript(`shared/original { cull none { map $lightmap } } shared/replacement { { map $whiteimage rgbGen const ( 0 1 0 ) } }`);
  source.addScript(`shared/replacement { cull none q3map_sun 1 0 0 100 0 0 { map $lightmap } { map donor.png blendFunc filter } }
shared/white { cull none { map $whiteimage rgbGen const ( 0 0 1 ) } }`);
  const world=await WorldScene.load(map(),destination), picture=await destination.registerPicture("shared/original"), shader=world.surfaces[0]?.shader;
  if(shader===undefined||shader===null)throw new Error("Missing destination shader");
  const input={camera:{origin:{x:0,y:0,z:0},axis:anglesToAxis({x:0,y:0,z:0}),viewport:{x:0,y:0,width:32,height:32},projection:perspectiveProjection(90,90,4096),clip:{kind:"none"}},target:{kind:"seat",seat:identity.seat(0)},time:{kind:"seconds",value:2}} satisfies Parameters<WorldScene["prepareView"]>[0];
  return {source,destination,registrations,images,world,picture,shader,input,close(){world.close();source.textures.close();destination.textures.close();images.close();}};
}

test("remap prepares all bindings before publishing source images, destination lightmap and cached HUD picture", async()=>{
  const entered=Promise.withResolvers<void>(), release=Promise.withResolvers<void>();let reads=0;
  const f=await fixture(async()=>{if(++reads===2){entered.resolve();await release.promise;}return asset;});
  try {
    const original=f.shader.registered, registration=f.shader.registration;
    const pending=f.world.remapShader("shared/original","shared/replacement",0.5,{source:f.source,current:()=>true});
    await entered.promise;
    expect(currentRemap(f.shader)).toBeNull();expect(currentRemap(f.picture.material.compiled)).toBeNull();expect(f.source.sun).toBeNull();
    release.resolve();expect(await pending).toBe("committed");
    expect(f.shader.registered).toBe(original);expect(f.shader.registration).toBe(registration);expect(f.source.sun).not.toBeNull();
    const selected=currentRemap(f.shader);if(selected===null)throw new Error("Missing selected source shader");
    expect(selected.source).toBe(f.source);expect(selected.material.finished.lightmapIndex).toBe(0);
    const batches=prepareMaterialBatches(selected.material,{vertices:map().vertices,indices:[0,1,2]},f.world.materialContext(f.input));
    const surface=f.world.surfaces[0];if(surface?.kind!=="q3")throw new Error("Missing source lightmap");
    expect(batches.some(batch=>batch.texture.kind==="bind-image"&&batch.texture.image===surface.lightmap||batch.texturing === "pair" && batch.secondTexture.binding.kind==="bind-image"&&batch.secondTexture.binding.image===surface.lightmap)).toBe(true);
    const hud=prepareMaterialText({seat:f.input.target.seat,picture:f.picture,rect:{x:0,y:0,width:8,height:8},uv:{s:0,t:0,s2:1,t2:1},color:{x:1,y:1,z:1,w:1}},f.input.camera.viewport,f.world.materialContext(f.input));
    expect(hud.some(batch=>batch.texture.kind==="bind-image"&&batch.texture.image.source.kind==="generated"&&batch.texture.image.source.name==="source-only"||batch.texturing === "pair" && batch.secondTexture.binding.kind==="bind-image"&&batch.secondTexture.binding.image.source.kind==="generated"&&batch.secondTexture.binding.image.source.name==="source-only")).toBe(true);
    expect(await f.world.remapShader("shared/original","shared/original",0,{source:f.source,current:()=>true})).toBe("committed");
    expect(currentRemap(f.shader)).toBeNull();expect(currentRemap(f.picture.material.compiled)).toBeNull();
  }finally{release.resolve();f.close();}
});

test("failed and obsolete remaps preserve the effective materials and buffered shader globals",async()=>{
  const entered=Promise.withResolvers<void>(), release=Promise.withResolvers<void>();let mode:"fail"|"wait"="fail";
  const f=await fixture(async()=>{if(mode==="fail")throw new Error("source image failure");entered.resolve();await release.promise;return asset;});
  try{
    await f.world.remapShader("shared/original","shared/white",0,{source:f.source,current:()=>true});
    const previous=currentRemap(f.shader);
    await expect(f.world.remapShader("shared/original","shared/replacement",0,{source:f.source,current:()=>true})).rejects.toThrow("source image failure");
    expect(currentRemap(f.shader)).toBe(previous);expect(f.source.sun).toBeNull();
    mode="wait";const pending=f.world.remapShader("shared/original","shared/replacement",0,{source:f.source,current:()=>true});
    await entered.promise;await f.world.remapShader("shared/original","shared/original");release.resolve();
    expect(await pending).toBe("stale");expect(currentRemap(f.shader)).toBeNull();expect(f.source.sun).toBeNull();
  }finally{release.resolve();f.close();}
});

test("new registrations and image refresh retain the effective source with new destination lightmaps",async()=>{
  const f=await fixture();
  const sourceTextures=new SceneTextureLoader(f.images,{read:async()=>asset}), destinationTextures=new SceneTextureLoader(f.images,{read:async()=>null});
  try{
    expect(await f.world.remapShader("shared/original","shared/replacement",0.25,{source:f.source,current:()=>true})).toBe("committed");
    const late=await Promise.all([f.destination.register("shared/original",{kind:"unlit",lightmapIndex:-2,mipmap:true}),f.destination.register("shared/original",{kind:"unlit",lightmapIndex:-2,mipmap:true})]);
    for(const material of late)expect(currentRemap(material)?.source).toBe(f.source);
    const original=currentRemap(f.shader), lightmap=f.world.surfaces[0]?.lightmap;
    const source=f.source.replacement(sourceTextures),destination=f.destination.replacement(destinationTextures);
    await f.source.prepareReplacement(source);await f.destination.prepareReplacement(destination);
    const world=await f.world.prepareImages(destination,provider=>provider===f.source?source:destination);
    const prepared=await f.registrations.prepareRemapRefresh(new Map([[f.source,source],[f.destination,destination]]));
    expect(currentRemap(f.shader)).toBe(original);expect(f.world.surfaces[0]?.lightmap).toBe(lightmap);
    prepared.validate();f.world.validateImages(world);f.source.commitReplacement(source);f.destination.commitReplacement(destination);f.world.commitImages(world);prepared.commit();
    const replacement=currentRemap(f.shader);if(replacement===null)throw new Error("Lost refreshed source remap");
    expect(replacement.source).toBe(f.source);expect(replacement.timeOffset).toBe(0.25);expect(replacement.material.finished.lightmapIndex).toBe(0);
    expect(f.world.surfaces[0]?.lightmap).not.toBe(lightmap);expect(currentRemap(f.picture.material.compiled)?.source).toBe(f.source);
    const batches=prepareMaterialBatches(replacement.material,{vertices:map().vertices,indices:[0,1,2]},f.world.materialContext(f.input));
    const surface=f.world.surfaces[0];if(surface?.kind!=="q3")throw new Error("Missing refreshed world surface");
    expect(batches.some(batch=>batch.texture.kind==="bind-image"&&batch.texture.image===surface.lightmap||batch.texturing==="pair"&&batch.secondTexture.binding.kind==="bind-image"&&batch.secondTexture.binding.image===surface.lightmap)).toBe(true);
  }finally{sourceTextures.close();destinationTextures.close();f.close();}
});

const q1pak=`${process.env["QFILES_ROOT"]??"/home/buzzkill/Projects/qfiles"}/q1/id1/PAK0.PAK`;
test.skipIf(!existsSync(q1pak))("foreign remaps preserve real Q1 embedded textures and per-face lightmaps, including late worlds",async()=>{
  const archive=await openArchive(q1pak), f=await fixture();
  const read=async(name:string)=>{const entry=archive.findEntries(name,"ascii-insensitive")[0];if(entry===undefined)throw new Error(`Missing original ${name}`);return archive.readEntry(entry);};
  const bytes=await read("maps/start.bsp"), bsp=readQ1Bsp(bytes);
  const paletteBytes=await read("gfx/palette.lmp"), paletteEntry=archive.findEntries("gfx/palette.lmp","ascii-insensitive")[0];
  if(paletteEntry===undefined)throw new Error("Missing original palette entry");
  const archiveDigest=createContentDigest(new Bun.CryptoHasher("sha256").update(await Bun.file(q1pak).arrayBuffer()).digest("hex"));
  const palette=decodePalette(paletteBytes,{id:"resource:q1-remap-palette",requestedPath:"gfx/palette.lmp",byteLength:paletteBytes.length,
    digest:createContentDigest(new Bun.CryptoHasher("sha256").update(paletteBytes).digest("hex")),
    provenance:{kind:"archive",memberPath:"gfx/palette.lmp",memberIndex:paletteEntry.ordinal,mount:{kind:"archive",format:"pak",archivePath:q1pak,archiveDigest,identity:{id:"mount:q1:remap-test",content:"q1:classic:retail:id1",generation:0}}},
    resolution:{kind:"default-order",plan:"mount-plan:q1:remap-test",rank:0}});
  const textures=new SceneTextureLoader(f.images,{read:async()=>null},palette), shaders=new SceneShaderRegistry(textures,f.registrations.provider("q1:classic:retail:map"));
  const world=await WorldScene.load(bsp,shaders);let late:WorldScene|null=null;
  try{
    const surface=world.surfaces.find(value=>value.kind==="legacy"&&value.lightmap!==null&&value.baseTexture!==null);
    if(surface?.kind!=="legacy"||surface.lightmap===null||surface.baseTexture===null)throw new Error("Missing original lightmapped surface");
    f.source.addScript(`foreign/embedded { cull none { map ${surface.shaderName} } { map $lightmap blendFunc filter } { map donor.png blendFunc add } }`);
    const input={...f.input,camera:{...f.input.camera,origin:{x:surface.bounds.min.x,y:surface.bounds.min.y,z:surface.bounds.max.z+32}}};
    const batches=(scene:WorldScene)=>finishSceneOperations(scene.prepareModel(0,{origin:{x:0,y:0,z:0},axis:input.camera.axis},input)).flatMap(operation=>operation.kind==="draw"?operation.batches:[]);
    const sourceImage=(scene:WorldScene)=>batches(scene).some(batch=>batch.texture.kind==="bind-image"&&batch.texture.image.source.kind==="generated"&&batch.texture.image.source.name==="source-only");
    expect(sourceImage(world)).toBe(false);
    expect(await world.remapShader(surface.shaderName,"foreign/embedded",0,{source:f.source,current:()=>true})).toBe("committed");
    expect(surface.shader).toBeNull();expect(sourceImage(world)).toBe(true);
    const selected=batches(world);
    expect(selected.some(batch=>batch.texture.kind==="bind-image"&&batch.texture.image===surface.baseTexture?.image)).toBe(true);
    expect(selected.some(batch=>batch.texture.kind==="bind-image"&&batch.texture.image===surface.lightmap?.image||batch.texturing==="pair"&&batch.secondTexture.binding.kind==="bind-image"&&batch.secondTexture.binding.image===surface.lightmap?.image)).toBe(true);
    late=await WorldScene.load({...bsp},shaders);expect(sourceImage(late)).toBe(true);
    expect(await world.remapShader(surface.shaderName,surface.shaderName,0,{source:f.source,current:()=>true})).toBe("committed");
    expect(sourceImage(world)).toBe(false);expect(sourceImage(late)).toBe(false);
  }finally{late?.close();world.close();textures.close();f.close();await archive.close();}
});

test("missing source replacement is an unchanged result and keeps the previous effective material",async()=>{
  const f=await fixture(async()=>null);
  try{
    await f.world.remapShader("shared/original","shared/white",0,{source:f.source,current:()=>true});
    const before=currentRemap(f.shader);
    expect(await f.world.remapShader("shared/original","unavailable/replacement",0,{source:f.source,current:()=>true})).toBe("unchanged");
    expect(currentRemap(f.shader)).toBe(before);
  }finally{f.close();}
});

test("an already retired source cannot cancel the current pending remap",async()=>{
  const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
  const f=await fixture(async()=>{entered.resolve();await release.promise;return asset;});
  try{
    const current=f.world.remapShader("shared/original","shared/replacement",0,{source:f.source,current:()=>true});
    await entered.promise;
    expect(await f.world.remapShader("shared/original","shared/original",0,{source:f.source,current:()=>false})).toBe("stale");
    release.resolve();expect(await current).toBe("committed");expect(currentRemap(f.shader)?.source).toBe(f.source);
  }finally{release.resolve();f.close();}
});

test("already loaded retail MD3 shader handles follow the effective remap without reloading the model",async()=>{
  const path=`${process.env["QFILES_ROOT"]??"/home/buzzkill/Projects/qfiles"}/q3a/baseq3/pak0.pk3`, archive=await openArchive(path),f=await fixture();
  try{
    const name="models/players/sarge/lower.md3",entry=archive.findEntries(name)[0];if(entry===undefined)throw new Error("Missing original Sarge model");
    const bytes=await archive.readEntry(entry), digest=createContentDigest(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
    const hasher=new Bun.CryptoHasher("sha256");for await(const chunk of Bun.file(path).stream())hasher.update(chunk);
    const archiveDigest=createContentDigest(hasher.digest("hex"));
    const entity:SceneEntity={actor:null,model:toSceneMd3(parseMd3(bytes)),resource:{id:"resource:remap-sarge",requestedPath:name,digest,byteLength:bytes.length,
      provenance:{kind:"archive",memberPath:name,memberIndex:entry.ordinal,mount:{kind:"archive",format:"pk3",archivePath:path,archiveDigest,identity:{id:"mount:q3:remap-model",content:"q3:classic:retail:baseq3",generation:0}}},resolution:{kind:"default-order",plan:"mount-plan:q3:remap-model",rank:0}},
      transform:{origin:{x:64,y:0,z:0},axis:f.input.camera.axis,scale:{x:1,y:1,z:1}},previousOrigin:{x:64,y:0,z:0},pose:{kind:"frame",frame:0,previousFrame:0,backLerp:0},skin:0,color:{x:1,y:1,z:1,w:1},shaderTime:{kind:"seconds",value:0},flags:{kind:"q3",bits:0},lightingOrigin:{x:64,y:0,z:0},shadowPlane:0,attachments:[]};
    const models=new SceneModelRenderer({family:"q3",palette:null,textures:f.destination.textures,shaders:f.destination},f.world),options=()=>({customShader:"shared/original"});
    await models.preload([entity],options);
    const before=sceneModelBatches(models.prepare([entity],f.input,options));expect(before.length).toBeGreaterThan(0);
    await f.world.remapShader("shared/original","shared/white",0,{source:f.source,current:()=>true});
    const after=sceneModelBatches(models.prepare([entity],f.input,options));expect(after[0]?.vertices[0]?.color).toEqual({x:0,y:0,z:1,w:1});
    await f.world.remapShader("shared/original","shared/original");expect(sceneModelBatches(models.prepare([entity],f.input,options))).toEqual(before);
  }finally{f.close();await archive.close();}
});
