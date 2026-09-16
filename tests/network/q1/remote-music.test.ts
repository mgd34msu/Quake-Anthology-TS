import { expect, test } from 'bun:test';
import { NetQuakeDecoder, writeNetQuakeMessage } from '../../../src/network/q1/netquake.ts';
import { SizeBuf } from '../../../src/network/q1/message.ts';
import { Q1RemotePresentation } from '../../../src/app/bootstrap/network/remote-q1.ts';
import { QwRemotePresentation } from '../../../src/app/bootstrap/network/remote-qw.ts';
import { ApplicationAudio } from '../../../src/app/bootstrap/audio.ts';
import { ApplicationMusic } from '../../../src/app/bootstrap/audio/music.ts';
import { LoadedApplicationContent } from '../../../src/app/bootstrap/content.ts';
import { InstalledCatalog } from '../../../src/content/catalog/index.ts';
import { MountedContent } from '../../../src/content/mounts/index.ts';
import type { OpenedResource } from '../../../src/content/mounts/index.ts';
import { SoundBank, UnifiedAudio } from '../../../src/audio/index.ts';
import { readQ1Bsp } from '../../../src/formats/q1-map/index.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { EngineSession } from '../../../src/world/session/session.ts';
import { nextActorGeneration } from '../../../src/world/actors/registry.ts';
import type { QwServerData } from '../../../src/app/bootstrap/network/qw-types.ts';
import type { ExecutableRecipe, ProviderReference, ResolvedResourceReference, ContentId } from '../../../src/contracts/content.ts';
import { createContentDigest, createResourceId, createMountPlanId, createMountIdentity, createMountId } from '../../../src/contracts/content.ts';
function recipe(): ExecutableRecipe {
  const content = "q1:classic:musicmod:fixture";
  const provider = (role: string): ProviderReference => ({ provider: `q1:${role}`, content });
  const raw: Omit<ResolvedResourceReference, "id"> = { requestedPath: "maps/start.bsp", provenance: { kind: "loose", memberPath: "maps/start.bsp", mount: { kind: "loose", identity: { id: "mount:q1:fixture", content, generation: 2 }, rootPath: "/fixture" } },
    digest: createContentDigest("0".repeat(64)), byteLength: 123, resolution: { kind: "default-order", plan: "mount-plan:fixture:1", rank: 0 } };
  const geometry = { ...raw, id: createResourceId(raw) };
  return { schemaVersion: 3, id: "recipe:fixture:1", preset: "recipe:fixture:1", map: { geometryContent: content, geometry, entities: provider("game") }, campaign: { kind: "campaign", mission: provider("mission"), gamecode: provider("game") },
    movement: provider("movement"), character: { definition: provider("character"), appearance: provider("appearance") }, weapons: [provider("weapons")], equipment: { grapple: { kind: "disabled" }, handGrenades: { kind: "disabled" } }, enemies: { kind: "map-defined" },
    presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: content, hud: provider("hud"), effects: provider("effects"), audio: provider("audio") }, engineBehavior: provider("engine"), combat: provider("combat"), inventory: provider("inventory"), match: provider("match"), transition: provider("transition"),
    execution: [{ kind: "typescript", owner: provider("game"), implementation: "q1:official", role: "server-game", api: { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 } }],
    mounts: { id: "mount-plan:fixture:1", mounts: [raw.provenance.mount], defaultOrder: [raw.provenance.mount.identity.id], prefixOrders: [] }, resources: [geometry], timing: [],
    ordering: { kind: "native", traversal: "source-slot-order", clock: { kind: "q1-netquake", minimumFrameSeconds: 0.001, maximumFrameSeconds: 0.1, fixedFrameSeconds: null } } };
}

function musicWave(sample: number): Uint8Array {
  const bytes = new Uint8Array(44 + 64), view = new DataView(bytes.buffer);
  const tag = (offset: number, value: string): void => { bytes.set(new TextEncoder().encode(value), offset); };
  tag(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); tag(8, "WAVE"); tag(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 44100, true); view.setUint32(28, 88200, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, "data"); view.setUint32(40, 64, true);
  for (let offset = 44; offset < bytes.length; offset += 2) view.setInt16(offset, sample, true);
  return bytes;
}

class MusicMemoryMounts extends MountedContent {
  constructor(readonly content: ContentId, private readonly files: ReadonlyMap<string, Uint8Array>) {
    super({ id: createMountPlanId("music-memory", content.replaceAll(":", "-")), mounts: [], defaultOrder: [], prefixOrders: [] }, []);
  }
  override async open(path: string): Promise<OpenedResource | null> {
    this.assertOpen();
    const bytes = this.files.get(path); if (bytes === undefined) return null;
    const record: Omit<ResolvedResourceReference, "id"> = { requestedPath: path, byteLength: bytes.length,
      digest: createContentDigest(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")),
      provenance: { kind: "loose", memberPath: path, mount: { kind: "loose", rootPath: "/music-memory",
        identity: createMountIdentity(createMountId("music-memory", this.content.replaceAll(":", "-")), this.content, 0) } },
      resolution: { kind: "default-order", plan: this.plan.id, rank: 0 } };
    return { bytes, reference: { ...record, id: createResourceId(record) } };
  }
}

class MusicContent extends LoadedApplicationContent {
  override async forContent(content: ContentId): Promise<MountedContent> {
    if (content !== this.recipe.map.entities.content) throw new Error('Wrong music content owner');
    return this.mounts;
  }
}
function fixture() {
  const selected = recipe(), bytes = new Uint8Array(124); new DataView(bytes.buffer).setInt32(0, 29, true);
  const owner = selected.map.entities.content;
  const mounts = new MusicMemoryMounts(owner, new Map([['music/06.wav', musicWave(1000)], ['music/09.wav', musicWave(2000)]]));
  const catalog = new InstalledCatalog('/unused', [{ id: owner, expectation: { id: 'musicmod', family: 'q1', edition: 'classic', campaign: 'musicmod', title: 'Music fixture', contentDirectory: 'q1/musicmod', baseProduct: null, requiredContentArchives: [], requiredPrograms: [], mapWitness: null, unresolvedReason: null }, availability: { kind: 'installed' }, archives: [], looseRoot: null, userContent: null, maps: [], diagnostics: [] }], [], 0);
  const content = new MusicContent(catalog, selected, readQ1Bsp(bytes), mounts);
  const identity = createIdentityOwner('remote music'), session = new EngineSession(identity, { kind: 'headless' });
  const options = { identity, session, client: session.createClient(0), nextGeneration: (slot: number) => nextActorGeneration(session.session, slot), content: null,
    loadContent: async () => content, sendCommand() {}, print() {} };
  return { content, session, options };
}
const serverData = (serverCount: number): QwServerData => ({ kind: 'server-data', protocol: { kind: 'q1-quakeworld', version: 28 }, serverCount, gameDirectory: 'musicmod', playerSlot: 0, spectator: false, level: 'fixture',
  moveVariables: { gravity: 800, stopSpeed: 100, maxSpeed: 320, spectatorMaxSpeed: 500, accelerate: 10, airAccelerate: 0.7, waterAccelerate: 10, friction: 4, waterFriction: 4, entityGravity: 1 } });

async function activate(remote: Q1RemotePresentation): Promise<void> {
  const zero = { x: 0, y: 0, z: 0 };
  await remote.receive([{ kind: 'set-view', entity: 1 }, { kind: 'entity', state: { number: 1, origin: zero, angles: zero, modelIndex: 0, frame: 0, colorMap: 0, skin: 0, effects: 0, alpha: 0, scale: 16, lerpFinishSeconds: 0, step: false } },
    { kind: 'client-data', weaponAlpha: 0, data: { viewHeight: 22, idealPitch: 0, punchAngles: zero, velocity: zero, items: 0, onGround: false, inWater: false, weaponFrame: 0, armor: 0, weaponModel: 0, health: 100, ammo: 0, shells: 0, nails: 0, rockets: 0, cells: 0, activeWeapon: 0 } }], 12000);
}

test('NQ wire CD cues reach the shared mixer with content provenance, selected loops and stop', async () => {
  const { content, session, options } = fixture(), remote = new Q1RemotePresentation(options), printed: string[] = [];
  const audio = new ApplicationAudio(content, () => 0, 1, '', text => { printed.push(text); return undefined; }, { deferOutput: true });
  const decoder = new NetQuakeDecoder();
  try {
    await remote.receive([{ kind: 'server-info', protocol: { kind: 'q1-netquake', version: 15 }, maxClients: 1, gameType: 0, level: 'fixture', models: ['maps/music.bsp'], sounds: [] }, { kind: 'time', seconds: 12 }], 12000);
    await activate(remote);
    let sequence = 0;
    for (const track of [6, 9, 0]) {
      const packet = new SizeBuf(16);
      writeNetQuakeMessage(packet, { kind: 'q1-netquake', version: 15 }, { kind: 'cd-track', track, loopTrack: track === 6 ? 9 : 6 });
      await remote.receive(decoder.decode(packet.bytes()), 12000);
      const events = remote.drainPresentationEvents();
      expect(events).toEqual([{ kind: 'music', event: { kind: 'cd-track', track }, content: content.recipe.map.entities.content, seconds: 12, sequence: sequence++ }]);
      await audio.receive(events);
      const expected = track === 6 ? 250 : track === 9 ? 500 : 0;
      expect([...new Set(audio.engine.mix(256))]).toEqual([expected]);
      expect([...new Set(audio.engine.mix(256))]).toEqual([expected]);
      expect(remote.drainPresentationEvents()).toEqual([]);
    }
    expect(printed).toEqual([]);
    expect(audio.engine.outputState).toBe('detached');
  } finally { audio.close(); session.close(); await content.close(); }
});

test('QW retains preworld music, resets it at serverdata, and emits after world load', async () => {
  const { content, session, options } = fixture(), order: string[] = [];
  const remote = new QwRemotePresentation({ ...options, loadContent: async () => { order.push('world-loaded'); return content; }, prepareServerData: async () => {}, mapChecksum: async () => 0,
    skinOptions: { read: async () => null, noskins: () => 1, baseskin: () => 'base', allskins: () => '' } });
  try {
    await remote.serverData(serverData(1));
    await remote.receive([{ kind: 'cd-track', track: 2 }, { kind: 'cd-track', track: 6 }], 100);
    expect(remote.drainPresentationEvents()).toEqual([]);
    await remote.gameState(serverData(1), ['maps/music.bsp'], []);
    expect(order).toEqual(['world-loaded']);
    await activate(remote.shared);
    expect(remote.drainPresentationEvents().filter(value => value.kind === 'music').map(value => value.event)).toEqual([{ kind: 'cd-track', track: 6 }]);
    await remote.serverData(serverData(2));
    await remote.receive([{ kind: 'cd-track', track: 8 }], 200);
    await remote.serverData(serverData(3));
    await remote.gameState(serverData(3), ['maps/next.bsp'], []);
    await activate(remote.shared);
    expect(remote.drainPresentationEvents()).toEqual([]);
    await remote.receive([{ kind: 'cd-track', track: 0 }], 300);
    expect(remote.drainPresentationEvents().filter(value => value.kind === 'music').map(value => value.event)).toEqual([{ kind: 'cd-track', track: 0 }]);
  } finally { session.close(); await content.close(); }
});

test('shared Q1 music repeats the selected track and zero stops the mixer', async () => {
  const content: ContentId = 'q1:classic:musicmod:fixture';
  const mounts = new MusicMemoryMounts(content, new Map([['music/06.wav', musicWave(1000)], ['music/09.wav', musicWave(2000)]]));
  using engine = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
  const music = new ApplicationMusic(engine, () => undefined, 'immediate');
  try {
    await music.play({ content, family: 'q1', edition: 'classic', campaign: 'musicmod' }, new SoundBank(mounts), '6');
    expect([...new Set(engine.mix(256))]).toEqual([250]);
    expect([...new Set(engine.mix(256))]).toEqual([250]);
    await music.play({ content, family: 'q1', edition: 'classic', campaign: 'musicmod' }, new SoundBank(mounts), '0');
    expect(engine.mix(256).every(sample => sample === 0)).toBe(true);
  } finally { music.stop(); mounts.close(); }
});
