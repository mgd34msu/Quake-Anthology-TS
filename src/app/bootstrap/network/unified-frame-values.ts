import { readSourceItemIcon } from "../../../content/item-icon.ts";
import { readHeldWeaponDeclaration } from "../../../content/held-weapon.ts";
import type { ActorId } from '../../../contracts/identity.ts';
import type { Vec3, Vec4, Axis } from '../../../contracts/math.ts';
import type { PlayerUi, PlayerView, SimulationPresentation } from '../simulation/types.ts';
import type { Q3CharacterView } from '../../../content/q3/foundation/presentation.ts';
import type { WorldText } from '../../../text/world.ts';
import type { UnifiedIdentityDecoder } from './unified-types.ts';
import { SaveReader, namespaced } from '../../../persistence/value.ts';
import { readContentId, readProvider } from '../../../persistence/recipe.ts';
import { readArmor, readInventoryEntry } from '../../../persistence/save-image.ts';

export function wireActor(actor: ActorId) { return { slot: actor.slot, generation: actor.generation }; }
export function actor(r: SaveReader, identity: UnifiedIdentityDecoder): ActorId { return identity.actor(r.field('slot').integer(0), r.field('generation').integer(0)); }
export function vector(r: SaveReader): Vec3 { return { x: r.field('x').finite(), y: r.field('y').finite(), z: r.field('z').finite() }; }
export function color(r: SaveReader): Vec4 { return { ...vector(r), w: r.field('w').finite() }; }
export function axis(r: SaveReader): Axis { const values = r.list(vector); const [a,b,c] = values; if (values.length !== 3 || a === undefined || b === undefined || c === undefined) return r.fail('expected three axes'); return [a,b,c]; }
function optional<T>(r: SaveReader, name: string, read: (r: SaveReader) => T): T | undefined { const value = r.field(name); return value.value === undefined ? undefined : read(value); }
export function readPlayerView(r: SaveReader): PlayerView {
  const blend = optional(r,'blend',color), damageBlend = optional(r,'damageBlend',color), kickAngles = optional(r,'kickAngles',vector), fieldOfView = optional(r,'fieldOfView',v=>v.finite());
  const death = optional(r,'foreignCharacterDeath',v=>v.literal(true));
  const drift = optional(r,'pitchDrift',v=>({ grounded:v.field('grounded').boolean(), idealPitch:v.field('idealPitch').finite(), disabled:v.field('disabled').boolean() }));
  return { origin:vector(r.field('origin')),angles:vector(r.field('angles')),viewHeight:r.field('viewHeight').finite(),
    ...(blend===undefined?{}:{blend}),...(damageBlend===undefined?{}:{damageBlend}),...(kickAngles===undefined?{}:{kickAngles}),...(fieldOfView===undefined?{}:{fieldOfView}),
    ...(death===undefined?{}:{foreignCharacterDeath:death}),...(drift===undefined?{}:{pitchDrift:drift}) };
}
export function readPlayerUi(r: SaveReader): PlayerUi {
  const selectedArsenal=optional(r,'selectedArsenal',v=>v.literal(true));
  const nativeInventory=optional(r,'nativeInventory',v=>{
    const presentation=optional(v,'presentation',p=>{
      const source=readProvider(p.field('source')),kind=p.field('kind').choice('weapon','ammunition','item');
      return kind==='item'?{source,kind,icon:p.field('icon').nullable(value=>readSourceItemIcon(value,source.content))}
        :{source,kind,weapon:namespaced(p.field('weapon'))};
    });
    return {items:v.field('items').list(row=>({item:namespaced(row.field('item')),label:row.field('label').string(),count:row.field('count').finite()})),
      selected:v.field('selected').nullable(namespaced),...(presentation===undefined?{}:{presentation})};
  });
  return { ...(selectedArsenal===undefined?{}:{selectedArsenal}), ...(nativeInventory===undefined?{}:{nativeInventory}), health:r.field('health').finite(), armor:readArmor(r.field('armor')), activeWeapon:r.field('activeWeapon').nullable(namespaced),
    ammo:r.field('ammo').nullable(v=>({item:namespaced(v.field('item')),count:v.field('count').finite()})),
    inventory:r.field('inventory').list(readInventoryEntry), arsenalWarning:r.field('arsenalWarning').choice('none','low','empty'),
    powerups:r.field('powerups').list(v=>({item:namespaced(v.field('item')),label:v.field('label').string(),remainingSeconds:v.field('remainingSeconds').finite()})),
    items:r.field('items').list(v=>({id:namespaced(v.field('id')),label:v.field('label').string(),kind:v.field('kind').choice('weapon','powerup'),sourceOrdinal:v.field('sourceOrdinal').integer(),owned:v.field('owned').boolean(),hasAmmo:v.field('hasAmmo').boolean(),count:v.field('count').nullable(n=>n.finite()),warningCount:v.field('warningCount').finite()})),
    weaponStatus:r.field('weaponStatus').nullable(v=>{
      const a=v.field('ammo'), kind=a.field('kind').choice('unmetered','finite');
      return {source:readProvider(v.field('source')),item:namespaced(v.field('item')),label:v.field('label').string(),ammo:kind==='unmetered'?{kind}:{kind,item:namespaced(a.field('item')),count:a.field('count').finite(),hasAmmoToStart:a.field('hasAmmoToStart').boolean(),low:a.field('low').boolean()}};
    }) };
}
export function readModel(r: SaveReader, identity: UnifiedIdentityDecoder): SimulationPresentation {
  const heldWeapon=optional(r,"heldWeapon",readHeldWeaponDeclaration),nativeHeldWeapon=optional(r,"nativeHeldWeapon",v=>v.literal(true)),weaponItem=optional(r,"weaponItem",namespaced);
  const flare=optional(r,'flare',v=>({image:v.field('image').string(),fadeStart:v.field('fadeStart').finite(),fadeEnd:v.field('fadeEnd').finite(),scale:v.field('scale').finite(),color:vector(v.field('color')),rimColor:v.field('rimColor').nullable(vector),lockAngle:v.field('lockAngle').boolean()}));
  const backLerp=optional(r,'backLerp',v=>v.finite()),skinPath=optional(r,'skinPath',v=>v.nullable(s=>s.string()));
  const indexedSkin=optional(r,'indexedSkin',v=>{const width=v.field('width').integer(1),height=v.field('height').integer(1),pixels=v.field('pixels').bytes();if(pixels.length!==width*height)return v.fail('indexed skin length differs');return {name:v.field('name').string(),width,height,pixels};});
  const playerColors=optional(r,'playerColors',v=>({top:v.field('top').integer(),bottom:v.field('bottom').integer()}));
  const previousOrigin=optional(r,'previousOrigin',vector),modelBeam=optional(r,'modelBeam',v=>({segmentLength:v.field('segmentLength').finite()})),alpha=optional(r,'alpha',v=>v.finite());
  const shaderBeam=optional(r,'shaderBeam',v=>({path:v.field('path').string(),end:vector(v.field('end')),width:v.field('width').integer(1)}));
  const modelAttachments=optional(r,'modelAttachments',v=>v.list(entry=>({path:entry.field('path').string(),tag:entry.field('tag').string()})));
  const modelAnchor=optional(r,'modelAnchor',v=>({path:v.field('path').string(),tag:v.field('tag').string(),offset:vector(v.field('offset')),fovOffset:{above:v.field('fovOffset').field('above').integer(1),scale:v.field('fovOffset').field('scale').finite()}}));
  const replacesBody=optional(r,'replacesBody',v=>v.literal(true));
  const renderOwner=optional(r,'renderOwner',v=>v.literal('source-client'));
  const q3GrappleCable=optional(r,'q3GrappleCable',v=>({owner:actor(v.field('owner'),identity),ownerOrigin:vector(v.field('ownerOrigin')),ownerAngles:vector(v.field('ownerAngles')),viewHeight:v.field('viewHeight').finite(),offhand:v.field('offhand').boolean(),attached:v.field('attached').boolean(),flight:v.field('flight').string(),pull:v.field('pull').string(),hold:v.field('hold').string(),segmentLength:v.field('segmentLength').integer(1)}));
  const q3Weapon=optional(r,'q3Weapon',v=>({timeMilliseconds:v.field('timeMilliseconds').finite(),torsoAnimation:v.field('torsoAnimation').integer(),lastFireMilliseconds:v.field('lastFireMilliseconds').nullable(n=>n.finite()),firing:v.field('firing').boolean(),horizontalSpeed:v.field('horizontalSpeed').finite(),bobCycle:v.field('bobCycle').finite(),weapon:v.field('weapon').integer()}));
  return { actor:actor(r.field('actor'),identity),content:readContentId(r.field('content')),family:r.field('family').choice('q1','q2','q3'),path:r.field('path').string(),
    frame:r.field('frame').integer(),oldFrame:r.field('oldFrame').integer(),skin:r.field('skin').integer(),effects:r.field('effects').integer(),renderFlags:r.field('renderFlags').integer(),origin:vector(r.field('origin')),angles:vector(r.field('angles')),scale:r.field('scale').finite(),visible:r.field('visible').boolean(),viewWeapon:r.field('viewWeapon').boolean(),...(replacesBody===undefined?{}:{replacesBody}),...(renderOwner===undefined?{}:{renderOwner}),
    ...(heldWeapon===undefined?{}:{heldWeapon}),...(nativeHeldWeapon===undefined?{}:{nativeHeldWeapon}),...(weaponItem===undefined?{}:{weaponItem}),...(flare===undefined?{}:{flare}),...(backLerp===undefined?{}:{backLerp}),...(skinPath===undefined?{}:{skinPath}),...(indexedSkin===undefined?{}:{indexedSkin}),...(playerColors===undefined?{}:{playerColors}),...(previousOrigin===undefined?{}:{previousOrigin}),...(modelBeam===undefined?{}:{modelBeam}),...(shaderBeam===undefined?{}:{shaderBeam}),...(modelAttachments===undefined?{}:{modelAttachments}),...(modelAnchor===undefined?{}:{modelAnchor}),...(q3GrappleCable===undefined?{}:{q3GrappleCable}),...(alpha===undefined?{}:{alpha}),...(q3Weapon===undefined?{}:{q3Weapon}) };
}
export function readCharacterView(r: SaveReader, identity: UnifiedIdentityDecoder): Q3CharacterView {
  const a=r.field('animation'),scale=optional(r,'scale',v=>v.finite()),opacity=optional(r,'opacity',v=>v.finite());
  return {actor:actor(r.field('actor'),identity),origin:vector(r.field('origin')),angles:vector(r.field('angles')),velocity:vector(r.field('velocity')),movementDirection:r.field('movementDirection').integer(),
    animation:{kind:a.field('kind').literal('q3'),legs:a.field('legs').integer(),torso:a.field('torso').integer(),legsTimerMilliseconds:a.field('legsTimerMilliseconds').finite(),torsoTimerMilliseconds:a.field('torsoTimerMilliseconds').finite()},
    sourceFlags:r.field('sourceFlags').integer(),powerups:r.field('powerups').integer(),team:r.field('team').nullable(v=>v.choice('red','blue')),color:color(r.field('color')),...(scale===undefined?{}:{scale}),...(opacity===undefined?{}:{opacity})};
}
export function readWorldText(r: SaveReader): WorldText {
  const o=r.field('orientation'),kind=o.field('kind').choice('billboard','fixed'),distanceCullFactor=optional(r,'distanceCullFactor',v=>v.finite());
  return {content:readContentId(r.field('content')),text:r.field('text').string(),origin:vector(r.field('origin')),color:color(r.field('color')),cellSize:r.field('cellSize').finite(),orientation:kind==='billboard'?{kind}:{kind,angles:vector(o.field('angles'))},depthTest:r.field('depthTest').boolean(),font:r.field('font').choice('classic','selected'),...(distanceCullFactor===undefined?{}:{distanceCullFactor})};
}

export function readNativeCameraView(r: SaveReader): import("../../../world/session/mod-client-presentation.ts").NativeModCameraView {
  const native = r.field("native"), edition = native.field("edition").choice("classic", "rerelease"), view = readPlayerView(r);
  if (edition === "classic" && view.damageBlend !== undefined) return r.fail("Classic camera cannot publish rerelease damage blend");
  return { ...view, native: { edition, movementOrigin: vector(native.field("movementOrigin")), renderFlags: native.field("renderFlags").integer(0),
    positionPrediction: native.field("positionPrediction").boolean(), angularPrediction: native.field("angularPrediction").boolean(),
    weaponVisible: native.field("weaponVisible").boolean() } };
}
