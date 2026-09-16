import { expect, test } from 'bun:test';
import { createIdentityOwner } from '../../src/contracts/identity.ts';
import type { SimulationPresentationEvent } from '../../src/app/bootstrap/simulation/types.ts';
import { SimulationQ1Fog } from '../../src/app/bootstrap/simulation/q1-fog.ts';
import { Q1MapFog } from '../../src/app/bootstrap/q1-fog.ts';
import { SoftwareRenderer } from '../../src/render/cpu/index.ts';
import type { DrawBatch, RendererImage } from '../../src/contracts/render.ts';
import { stageFragmentShader } from '../../src/render/gl/programs.ts';
import { CPU_OPAQUE_STATE } from '../../src/render/cpu/index.ts';
import { fogSceneOperations } from '../../src/render/scene/q1-fog.ts';

const content = 'q1:classic:id1:base';
const ids = createIdentityOwner('fog'), actor = ids.actor(1, 0), other = ids.actor(2, 0);
function event(owner: SimulationQ1Fog, player: typeof actor | null, seconds: number, density: number, duration: number): readonly SimulationPresentationEvent[] {
  return owner.update({ content, sequence: 0, seconds, sourceEntity: null }, { kind: 'fog', player, density, color: { x: 1, y: 0, z: 0 }, duration, skyFactor: 0.25 });
}
test('Q1 fog source time, interrupted transitions, seat targeting and fresh world reset', () => {
  const owner = new SimulationQ1Fog({ content, entities: '{"classname" "worldspawn" "_fog " "0.2 0 0 1"}', alive: () => true });
  const first = new Q1MapFog('{"classname" "worldspawn" "_fog " "0.2 0 0 1"}', actor, content);
  const second = new Q1MapFog('{}', other, content);
  first.receive(event(owner, other, 10, 1, 0));
  expect(first.current(10).density).toBe(0.2);
  first.receive(event(owner, actor, 10, 1, 4));
  expect(first.current(12).density).toBeCloseTo(0.6);
  first.receive(event(owner, actor, 12, 0, 2));
  expect(first.current(13).density).toBeCloseTo(0.3);
  expect(first.current(14).density).toBe(0);
  second.receive(event(owner, null, 20, 0.8, 0));
  expect(second.current(20).density).toBe(0.8);
  expect(new Q1MapFog('{}', actor, content).current(20).density).toBe(0);
});

test('Q1 fog shades translucent fragments at their own depth before blending, within the seat', () => {
  const owner = { identity: Symbol('fog'), session: ids.session, generation: 0 };
  const renderer = new SoftwareRenderer(4, 2, owner);
  const image: RendererImage = { owner, ordinal: 0, source: { kind: 'generated', name: 'white' }, width: 1, height: 1 };
  try {
    renderer.applyImageResource({ kind: 'create-image', image, content: { kind: 'rgba8', borderColor: { x: 0, y: 0, z: 0, w: 0 }, levels: [{ width: 1, height: 1, pixels: new Uint8Array([255,255,255,255]) }] }, sampling: { filter: 'nearest', wrap: 'repeat' } });
    renderer.beginView({ viewport: { x: 0, y: 0, width: 4, height: 2 }, clipPlane: null, clear: { color: { x: 0, y: 1, z: 0, w: 1 }, depth: 0.9, stencil: false } });
    renderer.beginView({ viewport: { x: 0, y: 0, width: 2, height: 2 }, clipPlane: null, clear: null });
    const fog = new Q1MapFog('{"fog" "0.5 1 0 0"}', actor, content);
    const batch: DrawBatch = { primitive: 'triangles', texturing: 'single', lighting: { kind: 'vertex' }, texture: { kind: 'bind-image', image }, indices: [0,1,2,0,2,3],
      state: { ...CPU_OPAQUE_STATE, cull: 'none', blend: { source: 'src-alpha', destination: 'one-minus-src-alpha' }, depthWrite: false },
      vertices: [{x:-64,y:-64},{x:64,y:-64},{x:64,y:64},{x:-64,y:64}].map(p=>({position:{...p,z:0,w:64},texCoord:{x:0,y:0},color:{x:0,y:0,z:1,w:0.5}})) };
    const operations = fogSceneOperations([{ kind: 'draw', batches: [batch] }], fog.current(0));
    const operation = operations[0];
    if (operation?.kind !== 'draw') throw Error('missing draw');
    const prepared = operation.batches[0]; if (prepared === undefined) throw Error('missing batch');
    renderer.draw(prepared);
    const amount = 1-Math.exp(-0.25);
    expect(renderer.pixels[0]).toBe(Math.round(255*amount*0.5));
    expect(renderer.pixels[1]).toBe(128);
    expect(renderer.pixels[2]).toBe(Math.round(255*(1-amount)*0.5));
    expect(renderer.pixels[8]).toBe(0);
    expect(renderer.pixels[9]).toBe(255);
    expect(renderer.readDepthPixel(0,0)).toBeCloseTo(0.9);
    renderer.beginView({ viewport: { x: 0, y: 0, width: 2, height: 2 }, clipPlane: null, clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false } });
    const sky: DrawBatch = { ...batch, state: { ...CPU_OPAQUE_STATE, cull: 'none' }, fog: { kind: 'constant', color: { x: 1, y: 0, z: 0 }, amount: 0.25 },
      vertices: batch.vertices.map(v => ({ ...v, color: { x: 0, y: 0, z: 1, w: 1 } })) };
    renderer.draw(sky);
    expect([...renderer.pixels.slice(0,3)]).toEqual([64,0,191]);
    expect(renderer.readDepthPixel(0,0)).toBe(0.5);
    renderer.beginView({ viewport: { x: 0, y: 0, width: 2, height: 2 }, clipPlane: null, clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false } });
    const line: DrawBatch = { ...sky, primitive: 'lines', lineWidth: 1, indices: [0,1], fog: { kind: 'exp2', density: 0.5, color: { x: 1, y: 0, z: 0 } },
      vertices: [-32,32].map(x => ({ position: { x, y:0, z:0, w:64 }, texCoord: { x:0,y:0 }, color: { x:0,y:0,z:1,w:1 } })) };
    renderer.draw(line);
    expect(renderer.pixels.some((v,i) => i%4===0 && v===Math.round(255*amount))).toBe(true);
  } finally { renderer.close(); }
});

test('GL stage fog clamps active fog after lighting and preserves normal alpha', () => {
  expect(stageFragmentShader).toContain('64.0 * gl_FragCoord.w');
  expect(stageFragmentShader).toContain('color.rgb = mix');
  const clamp = stageFragmentShader.indexOf('if (u_fog_mode != 0) color.rgb = clamp(color.rgb, 0.0, 1.0)');
  expect(clamp).toBeGreaterThan(stageFragmentShader.indexOf('color = modelShadow(texel)'));
  expect(clamp).toBeLessThan(stageFragmentShader.indexOf('color.rgb = mix'));
  expect(stageFragmentShader).toContain('if (u_fog_mode == 4 || u_fog_mode == 5) color.a *= 1.0 - fogAmount');
  expect(stageFragmentShader.indexOf('color.a *= 1.0 - fogAmount')).toBeLessThan(stageFragmentShader.indexOf('if (alphaMode == 1'));
});

test('fog metadata survives worker transfer and sky/additive batches retain their distinct equations', () => {
  const owner = { identity: Symbol('fog-meta'), session: ids.session, generation: 0 };
  const image: RendererImage = { owner, ordinal: 0, source: { kind: 'generated', name: 'white' }, width: 1, height: 1 };
  const base: DrawBatch = { primitive: 'triangles', texturing: 'single', lighting: { kind: 'vertex' }, texture: { kind: 'bind-image', image },
    indices: [], vertices: [], state: CPU_OPAQUE_STATE };
  const fog = { kind: 'q1', density: 0.5, color: { x: 1, y: 0, z: 0 }, skyFactor: 0.25 } satisfies import('../../src/contracts/render.ts').SceneFog;
  const sky: DrawBatch = { ...base, fog: { kind: 'constant', color: fog.color, amount: fog.skyFactor } };
  const additive: DrawBatch = { ...base, state: { ...base.state, blend: { source: 'src-alpha', destination: 'one' } } };
  const op = fogSceneOperations([{ kind: 'draw', batches: [sky, additive] }], fog)[0];
  if (op?.kind !== 'draw') throw Error('missing draw');
  expect(op.batches[0]).toBe(sky);
  expect(op.batches[0]?.state.depthRange).toEqual([0,1]);
  expect(op.batches[1]?.fog?.color).toEqual({ x: 0, y: 0, z: 0 });
  expect(structuredClone({ fog: op.batches[1]?.fog, fogDepthScale: 64 })).toEqual({ fog: op.batches[1]?.fog, fogDepthScale: 64 });
});

test('Q1-world fog composes legacy lightmaps before fog without changing the no-fog passes', async () => {
  const { createQ1Material, createQ2Material, prepareLegacyMaterialBatches } = await import('../../src/materials/legacy.ts');
  const owner = { identity: Symbol('fog-material'), session: ids.session, generation: 0 };
  const image: RendererImage = { owner, ordinal: 0, source: { kind: 'generated', name: 'base' }, width: 1, height: 1 };
  const direct: RendererImage = { ...image, ordinal: 1, source: { kind: 'generated', name: 'direct-lightmap' } };
  const geometry = { indices: [0,1,2], vertices: [{x:0,y:0,z:0},{x:1,y:0,z:0},{x:0,y:1,z:0}].map(position=>({ position, normal:{x:0,y:0,z:1}, texCoord:{x:0,y:0}, lightmapCoord:{x:0,y:0}, color:{x:255,y:255,z:255,w:255} })) };
  const material = createQ1Material('stone', image, { kind:'lightmap',image,styles:[0] });
  const context = { time:0,animationFrame:0,alternateAnimation:false,fullbright:null,q1LightmapEncoding:'rgb',cull:'none',depthRange:[0,1],translucentLightmap:direct,
    project:(p:import('../../src/contracts/math.ts').Vec3)=>({...p,w:1}) } satisfies import('../../src/materials/legacy.ts').LegacyMaterialDrawContext;
  expect(prepareLegacyMaterialBatches(material,geometry,context)).toHaveLength(2);
  const fogged = prepareLegacyMaterialBatches(material,geometry,{...context,q1FogActive:true});
  expect(fogged).toHaveLength(1);
  expect(fogged[0]?.texturing).toBe('pair');
  const foreign = createQ2Material('stone',[image],{kind:'lightmap',image,styles:[0]});
  expect(prepareLegacyMaterialBatches(foreign,geometry,{...context,q1FogActive:true})[0]?.texturing).toBe('pair');
});
