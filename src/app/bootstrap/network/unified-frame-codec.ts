import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { ContentId, ContentDigest, ResolvedResourceReference } from '../../../contracts/content.ts';
import type { DecodedModel, SceneSnapshot, SceneEntity, ModelPose, SceneLight, SceneParticle, SceneLightStyle } from '../../../contracts/scene.ts';
import type { UnifiedIdentityDecoder, UnifiedPresentationFrame } from './unified-types.ts';
import { encodeCheckpointValue, decodeCheckpointValue, SaveReader, namespaced } from '../../../persistence/value.ts';
import { readContentId, readCharacter, readProvider } from '../../../persistence/recipe.ts';
import { readDigest, readFrame, readTime } from '../../../persistence/shared.ts';
import { readInventoryEntry } from '../../../persistence/save-image.ts';
import { wireActor, actor, vector, color, axis, readModel, readCharacterView, readWorldText, readPlayerUi, readPlayerView } from './unified-frame-values.ts';
import { writeUnifiedSimulationEvent, readUnifiedSimulationEvent } from './unified-event-codec.ts';
import { encodeUnifiedPrediction, decodeUnifiedPrediction } from './unified-prediction.ts';

export interface UnifiedResourceKey { readonly content: ContentId; readonly path: string; readonly digest: ContentDigest; readonly byteLength: number; }
export interface UnifiedFrameDecoder extends UnifiedIdentityDecoder {
  readonly world: SceneSnapshot['world'];
  resource(key: UnifiedResourceKey): Promise<ResolvedResourceReference>;
  model(key: UnifiedResourceKey, brushModel: number | null): Promise<DecodedModel>;
}
function resourceKey(resource: ResolvedResourceReference): UnifiedResourceKey {
  return { content:resource.provenance.mount.identity.content,path:resource.requestedPath,digest:resource.digest,byteLength:resource.byteLength };
}
function readKey(r: SaveReader): UnifiedResourceKey {
  const path=r.field('path').string();
  if(path.length===0 || path.includes('\\') || path.startsWith('/') || path.includes('\0') || path.split('/').some(p=>p==='..'||p==='.'||p==='') || /^[a-zA-Z]:/.test(path))return r.fail('invalid relative resource path');
  return {content:readContentId(r.field('content')),path,digest:readDigest(r.field('digest')),byteLength:r.field('byteLength').integer(0)};
}
function matchResource(key: UnifiedResourceKey, resource: ResolvedResourceReference): void {
  if(resource.provenance.mount.identity.content!==key.content || resource.requestedPath!==key.path || resource.digest!==key.digest || resource.byteLength!==key.byteLength)throw new Error('Unified resource differs from locally resolved content');
}
function encodeEntity(entity: SceneEntity): unknown {
  return { actor:entity.actor===null?null:wireActor(entity.actor),resource:resourceKey(entity.resource),brushModel:entity.model.kind==='brush-model'?entity.model.model:null,
    transform:entity.transform,previousOrigin:entity.previousOrigin,pose:entity.pose,skin:entity.skin,color:entity.color,shaderTime:entity.shaderTime,flags:entity.flags,lightingOrigin:entity.lightingOrigin,shadowPlane:entity.shadowPlane,
    ...(entity.opacity===undefined?{}:{opacity:entity.opacity}),attachments:entity.attachments.map(attachment=>({tag:attachment.tag,entity:encodeEntity(attachment.entity)})) };
}
function readPose(r: SaveReader): ModelPose {
  const kind=r.field('kind').choice('frame','skeleton');
  return kind==='frame'?{kind,frame:r.field('frame').integer(),previousFrame:r.field('previousFrame').integer(),backLerp:r.field('backLerp').finite()}
    :{kind,joints:r.field('joints').list(j=>({position:vector(j.field('position')),orientation:color(j.field('orientation')),scale:j.field('scale').finite()}))};
}
async function readEntity(r: SaveReader, context: UnifiedFrameDecoder, depth=0): Promise<SceneEntity> {
  if(depth>32)return r.fail('scene attachment nesting exceeds limit');
  const key=readKey(r.field('resource')),resource=await context.resource(key);matchResource(key,resource);
  const brushModel=r.field('brushModel').nullable(v=>v.integer(0)),model=await context.model(key,brushModel);
  if(brushModel!==null && (model.kind!=='brush-model'||model.model!==brushModel||model.world!==context.world?.geometry))return r.fail('brush model differs from local world');
  if(brushModel===null&&model.kind==='brush-model')return r.fail('unexpected brush model');
  const transform=r.field('transform'),flags=r.field('flags'),opacity=r.field('opacity');
  const attachments=await Promise.all(r.field('attachments').list(async a=>({tag:a.field('tag').string(),entity:await readEntity(a.field('entity'),context,depth+1)})));
  return {actor:r.field('actor').nullable(v=>actor(v,context)),resource,model,transform:{origin:vector(transform.field('origin')),axis:axis(transform.field('axis')),scale:vector(transform.field('scale'))},
    previousOrigin:vector(r.field('previousOrigin')),pose:readPose(r.field('pose')),skin:r.field('skin').integer(),color:color(r.field('color')),shaderTime:readTime(r.field('shaderTime')),
    flags:{kind:flags.field('kind').choice('q1','q2','q3'),bits:flags.field('bits').integer()},lightingOrigin:vector(r.field('lightingOrigin')),shadowPlane:r.field('shadowPlane').finite(),attachments,...(opacity.value===undefined?{}:{opacity:opacity.finite()})};
}
function readLight(r: SaveReader): SceneLight {
  const p=r.field('profile'),kind=p.field('kind').choice('q1','q2','q3');
  const base={origin:vector(r.field('origin')),color:vector(r.field('color')),radius:r.field('radius').finite(),additive:r.field('additive').boolean()};
  if(kind!=='q2')return {...base,profile:{kind}};
  const s=p.field('shadow'),shadow=s.field('kind').choice('none','cast');
  return {...base,profile:{kind,scale:p.field('scale').finite(),cone:p.field('cone').nullable(c=>({direction:vector(c.field('direction')),cosHalfAngle:c.field('cosHalfAngle').finite()})),shadow:shadow==='none'?{kind:shadow}:{kind:shadow,resolution:s.field('resolution').integer(1)}}};
}
function readParticle(r: SaveReader): SceneParticle {
  const kind=r.field('kind').choice('indexed','rgba'),base={origin:vector(r.field('origin')),size:r.field('size').finite()};
  return kind==='indexed'?{...base,kind,paletteIndex:r.field('paletteIndex').integer(0),alpha:r.field('alpha').finite()}:{...base,kind,color:color(r.field('color')),rotation:r.field('rotation').finite()};
}
function readStyle(r: SaveReader): SceneLightStyle { const kind=r.field('kind').choice('q1','q2'),style=r.field('style').integer(0);return kind==='q1'?{kind,style,value:r.field('value').finite()}:{kind,style,rgb:vector(r.field('rgb')),white:r.field('white').finite()}; }

/** Encode public presentation state only; server model bytes and filesystem provenance never enter the wire. */
export function encodeUnifiedFrame(frame: UnifiedPresentationFrame): Uint8Array {
  const snapshot=frame.output.snapshot,scene=snapshot.scene;
  const value = encodeCheckpointValue({schema:'qts-unified-frame',version:2,epoch:frame.epoch,acknowledgedInput:frame.acknowledgedInput,prediction:encodeUnifiedPrediction(frame.prediction),
    output:{snapshot:{frame:snapshot.frame,actors:snapshot.actors.map(a=>({id:wireActor(a.id),owner:a.owner,definition:a.definition})),
      bodies:snapshot.bodies.map(b=>({actor:wireActor(b.actor),body:{...b.body,ground:b.body.ground===null?null:wireActor(b.body.ground)}})),
      inventories:snapshot.inventories.map(i=>({actor:wireActor(i.actor),entries:i.entries})),
      configurations:snapshot.configurations.map(c=>({...c,actor:wireActor(c.actor)})),
      scene:{time:scene.time,world:scene.world===null?null:resourceKey(scene.world.resource),entities:scene.entities.map(encodeEntity),lights:scene.lights,particles:scene.particles,lightStyles:scene.lightStyles,areaBits:scene.areaBits}},
      events:frame.output.events.map(writeUnifiedSimulationEvent)},
    models:frame.models.map(m=>({...m,actor:wireActor(m.actor),...(m.q3GrappleCable===undefined?{}:{q3GrappleCable:{...m.q3GrappleCable,owner:wireActor(m.q3GrappleCable.owner)}})})),characters:frame.characters.map(c=>({...c,actor:wireActor(c.actor)})),worldText:frame.worldText,
    player:{actor:wireActor(frame.player.actor),view:frame.player.view,ui:frame.player.ui}});
  if(value.length>32*1024*1024)throw new RangeError('Unified frame exceeds byte limit');
  return deflateRawSync(value,{level:1});
}

/** Parse once so an old epoch can be discarded before resolving any resources. */
export function readUnifiedFrame(bytes:Uint8Array) {
  if(bytes.length>4*1024*1024)throw new RangeError('Unified frame exceeds channel byte limit');
  const r=new SaveReader(decodeCheckpointValue(inflateRawSync(bytes,{maxOutputLength:32*1024*1024})),'unified-frame');
  r.field('schema').literal('qts-unified-frame');r.field('version').literal(2);
  return {epoch:r.field('epoch').integer(1),decode:(context:UnifiedFrameDecoder)=>decodeFrameValue(r,context)};
}

export async function decodeUnifiedFrame(bytes:Uint8Array,context:UnifiedFrameDecoder):Promise<UnifiedPresentationFrame> {
  return readUnifiedFrame(bytes).decode(context);
}

/** Resolve all resources into the candidate world before returning a publishable frame. */
async function decodeFrameValue(r:SaveReader,context:UnifiedFrameDecoder):Promise<UnifiedPresentationFrame> {
  const output=r.field('output'),s=output.field('snapshot'),scene=s.field('scene'),w=scene.field('world');
  if(w.value===null){if(context.world!==null)return w.fail('missing negotiated world');}
  else {if(context.world===null)return w.fail('world is not locally loaded');matchResource(readKey(w),context.world.resource);}
  const entities=await Promise.all(scene.field('entities').list(e=>readEntity(e,context)));
  const player=r.field('player');
  return {epoch:r.field('epoch').integer(0),acknowledgedInput:r.field('acknowledgedInput').integer(-1),
    prediction:decodeUnifiedPrediction(r.field('prediction').bytes(),context),
    output:{snapshot:{session:context.session,frame:readFrame(s.field('frame')),
      actors:s.field('actors').list(a=>({id:actor(a.field('id'),context),owner:namespaced(a.field('owner')),definition:namespaced(a.field('definition'))})),
      bodies:s.field('bodies').list(b=>{const state=b.field('body'),bounds=state.field('bounds');return {actor:actor(b.field('actor'),context),body:{origin:vector(state.field('origin')),angles:vector(state.field('angles')),velocity:vector(state.field('velocity')),bounds:{min:vector(bounds.field('min')),max:vector(bounds.field('max'))},ground:state.field('ground').nullable(g=>actor(g,context))}};}),
      inventories:s.field('inventories').list(i=>({actor:actor(i.field('actor'),context),entries:i.field('entries').list(readInventoryEntry)})),
      configurations:s.field('configurations').list(c=>({actor:actor(c.field('actor'),context),movement:readProvider(c.field('movement')),character:readCharacter(c.field('character')),weapons:c.field('weapons').list(readProvider),inventory:readProvider(c.field('inventory'))})),
      scene:{session:context.session,time:readTime(scene.field('time')),world:context.world,entities,lights:scene.field('lights').list(readLight),particles:scene.field('particles').list(readParticle),lightStyles:scene.field('lightStyles').list(readStyle),areaBits:scene.field('areaBits').nullable(v=>v.bytes())}},
      events:output.field('events').list(e=>readUnifiedSimulationEvent(e.value,context))},
    models:r.field('models').list(m=>readModel(m,context)),characters:r.field('characters').list(c=>readCharacterView(c,context)),worldText:r.field('worldText').list(readWorldText),
    player:{actor:actor(player.field('actor'),context),view:readPlayerView(player.field('view')),ui:readPlayerUi(player.field('ui'))}};
}
