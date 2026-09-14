import type { ActorId, SeatId } from '../../../contracts/identity.ts';
import type { Axis, Vec3 } from '../../../contracts/math.ts';
import type { Rect, RenderCommand } from '../../../contracts/render.ts';
import type { SceneQueries } from '../../../contracts/scene.ts';
import { Q3SceneRecorder } from '../../../content/q3/presentation/scene.ts';
import type { Q3PresentedScene } from '../../../content/q3/presentation/scene.ts';
import { Q3RendererResources } from '../../../content/q3/presentation/resources.ts';
import { Q3PresentationAudio } from '../../../content/q3/presentation/audio.ts';
import type { Q3ClientSound } from '../../../content/q3/presentation/client.ts';
import { DEFAULT_RAIL_SETTINGS } from '../../../render/scene/particles/primitives.ts';
import { Draw2D, TextCommandSink } from '../../../text/draw2d.ts';
import type { MaterialTextDraw } from '../../../text/draw2d.ts';
import type { ApplicationAudio } from '../audio.ts';
import type { Q3SeatAudioOperation } from '../audio/q3.ts';
import type { ApplicationQ3Assets } from './assets.ts';
import { ApplicationQ3Cinematics } from './cinematics.ts';
import { q3ClientCollision } from './collision.ts';
import { SharedSceneQueries } from '../../../world/collision/index.ts';

export interface ApplicationQ3ServiceOptions {
  readonly media: ApplicationQ3Assets;
  readonly audio: ApplicationAudio;
  readonly seat: SeatId;
  readonly viewport: Rect;
  readonly queries: SceneQueries;
  actorAt(number: number): ActorId;
  readonly clock: { now(): number; frameNumber(): number };
  readonly output: {
    scene(scene: Q3PresentedScene): void;
    command(command: Exclude<RenderCommand, { readonly kind: 'swap-buffers' }>): void;
    text(draw: MaterialTextDraw): void;
    audio(operation: Q3SeatAudioOperation): void;
    listener(origin: Vec3, axis: Axis): void;
  };
}

export async function createApplicationQ3Services(options: ApplicationQ3ServiceOptions) {
  const { media, seat, output } = options;
  const scene = new Q3SceneRecorder({ seat, viewport: options.viewport, farClip: 16384, nearClip: 4, rail: DEFAULT_RAIL_SETTINGS,
    fogSelections: () => media.assets.world.fogSelections, print: text => media.print(text), actor: () => null, publish: value => output.scene(value) });
  const map = media.assets.content.world;
  const clip = options.queries instanceof SharedSceneQueries ? options.queries.nativeQ3ClipModels() : null;
  const resources = new Q3RendererResources(await media.resourceHost(scene), map.kind === 'q3-bsp' && clip !== null
    ? { map, clusterPVS: cluster => clip.world.clusterPVS(cluster) } : undefined);
  const target = new Q3PresentationAudio({ seat, sounds: media.bank, actor: number => options.actorAt(number), frameNumber: options.clock.frameNumber,
    play: sound => output.audio({ kind: 'play', sound }), loop: sound => output.audio({ kind: 'loop', sound }),
    updateActor: (actor, origin) => output.audio({ kind: 'position', actor, origin }), stopLoop: (_seat, actor) => output.audio({ kind: 'stop-loop', actor }) });
  const sound: Q3ClientSound = {
    bank: media.bank,
    startSound: (origin, entity, channel, pcm) => target.startSound(origin, entity, channel, pcm),
    startSourceSound: (pcm, settings) => target.startSourceSound(pcm, settings),
    startLocalSound: (pcm, channel) => target.startLocalSound(pcm, channel),
    addLoopSound: (entity, origin, velocity, pcm, real) => target.addLoopSound(entity, origin, velocity, pcm, real),
    updateSoundPosition: (entity, position) => target.updateSoundPosition(entity, position), stopLoopingSound: entity => target.stopLoopingSound(entity),
    clearLoopingSounds: killAll => output.audio({ kind: 'clear-loops', killAll }),
    setListener: (_client, origin, axis) => output.listener(origin, axis),
    startBackgroundTrack: (intro, loop) => options.audio.playMusic(media.content, `${intro} ${loop}`),
  };
  const draw = new Draw2D(new TextCommandSink(seat, options.viewport, command => {
    if (command.kind === 'swap-buffers') throw new Error('Cgame cannot present the shared framebuffer');
    output.command(command);
  }, value => output.text(value)), 'stretch-640');
  return { scene, resources, sound, draw, collision: q3ClientCollision(options.queries),
    cinematics: new ApplicationQ3Cinematics(media, options.audio, seat, options.clock.now) };
}
export type ApplicationQ3Services = Awaited<ReturnType<typeof createApplicationQ3Services>>;
