import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { IdentityOwner } from '../../contracts/identity.ts';
import type { Q2ProtocolIdentity } from '../../contracts/protocol.ts';
import type { SimulationOutput } from '../../contracts/session.ts';
import { remoteContentSelection } from '../../content/catalog/index.ts';
import { CvarFlag, type CvarRegistry } from '../../core/cvars/index.ts';
import { nextActorGeneration } from '../../world/actors/registry.ts';
import type { EngineSession, SessionSeat } from '../../world/session/index.ts';
import { CollisionMapSettings } from '../../world/collision/q3/settings.ts';
import type { ApplicationTransport, ApplicationNetworkAddress } from './network/transport.ts';

import { quakeWorldMapChecksum2 } from '../../network/q1/checksum.ts';
import { q3InfoValue } from '../../network/q3/admission.ts';
import type { Q3ClientConnection } from '../../network/q3/client.ts';
import type { Q3ClientAuthorization } from '../../network/q3/client-authorization.ts';
import { ServerPakSet } from '../../network/q3/pak-references.ts';
import { compareQ3Packages } from '../../network/q3/pure.ts';
import type { LoadedApplicationContent, RemoteContentMounts } from './content.ts';
import type { PresentationTime } from './frame-clock.ts';
import { mapResourcePath, type ApplicationOptions } from './options.ts';
import type { ClientDownloadPermission, ClientDownloadProgress } from './network/client-download-policy.ts';
import { Q1ClientNetwork } from './network/q1-client.ts';
import { QwClientNetwork } from './network/qw-client.ts';
import { Q2ClientNetwork } from './network/q2.ts';
import { Q3ClientNetwork } from './network/q3-client.ts';
import { Q1RemotePresentation, type Q1RemoteWorld } from './network/remote-q1.ts';
import { QwRemotePresentation } from './network/remote-qw.ts';
import { Q2RemotePresentation } from './network/remote.ts';
import { Q3RemotePresentation } from './network/remote-q3.ts';
import type { Q2ApplicationGameState } from './network/types.ts';
import type { QwServerData } from './network/qw-types.ts';
import { QwDownloadReceiver } from './network/qw-downloads.ts';
import { Q3ApplicationClientDownloads, q3DownloadPath } from './network/q3-client-downloads.ts';
import { Q3ApplicationPackages } from './network/q3-downloads.ts';
import { Q3ClientContent } from './network/q3-client-content.ts';

export type RemoteSeatPresentation = Q1RemotePresentation | QwRemotePresentation | Q2RemotePresentation | Q3RemotePresentation;
export type RemoteSeatNetwork = Q1ClientNetwork | QwClientNetwork | Q2ClientNetwork<ApplicationNetworkAddress> | Q3ClientNetwork;
export interface RemoteSeatSourceHooks {
  options(): ApplicationOptions;
  mounts(): LoadedApplicationContent['mounts'];
  content(): LoadedApplicationContent;
  currentContent(): RemoteContentMounts | null;
  selectContent(selection: ReturnType<typeof remoteContentSelection>, assertCurrent: () => void): Promise<RemoteContentMounts>;
  refreshContent(assertCurrent: () => void): Promise<RemoteContentMounts>;
  loadQ1World(world: Q1RemoteWorld, refreshContent: boolean): Promise<LoadedApplicationContent>;
  loadQ2World(state: Q2ApplicationGameState): Promise<LoadedApplicationContent>;
  loadQ3World(world: Q1RemoteWorld, connection: Q3ClientConnection, preparedContent: LoadedApplicationContent): Promise<LoadedApplicationContent>;
  initializeQ3(connection: Q3ClientConnection): Promise<void>;
  shutdownQ3(): Promise<void>;
  readonly cinematic: { start(name: string, ended: () => void): Promise<void>; stop(): void };
  publish(output: SimulationOutput): void;
  disconnected(reason: string): void;
  print(text: string): void;
  recording(): boolean;
}
interface RemoteSeatSourceCommon {
  readonly identity: IdentityOwner;
  readonly session: EngineSession;
  readonly seat: SessionSeat;
  readonly cvars: () => CvarRegistry;
  readonly clock: PresentationTime;
  readonly transport: ApplicationTransport;
  readonly address: ApplicationNetworkAddress;
  readonly qport: number;
  readonly downloadPermission: ClientDownloadPermission | null;
  readonly hooks: RemoteSeatSourceHooks;
}
export type RemoteSeatSourceOptions = RemoteSeatSourceCommon & (
  { readonly family: 'q1' } | { readonly family: 'qw' }
  | { readonly family: 'q2'; readonly protocol: Q2ProtocolIdentity }
  | { readonly family: 'q3'; readonly authorization: Pick<Q3ClientAuthorization, 'request'> }
);

/** One live source channel and its content transfers; frontend ownership stays with the caller. */
export class RemoteSeatSource {
  readonly remote: RemoteSeatPresentation;
  readonly network: RemoteSeatNetwork;
  private qwDownloads: QwDownloadReceiver | null = null;
  private q3Downloads: Q3ApplicationClientDownloads | null = null;
  private q3Content: Q3ClientContent | null = null;
  private downloadGeneration = 0;
  private closed = false;
  private closing: Promise<void> | null = null;
  private allSkins = '';

  constructor(private readonly owner: RemoteSeatSourceOptions) {
    const { hooks, identity, session, seat, clock, transport, address } = owner;
    const nextGeneration = (slot: number): number => nextActorGeneration(session.session, slot);
    const common = { identity, session, client: seat.client, nextGeneration, content: null,
      presentationTime: () => clock.milliseconds, publish: (output: SimulationOutput) => hooks.publish(output),
      print: (text: string) => hooks.print(text), sendCommand: (text: string) => this.network.command(text),
      disconnected: (reason: string) => hooks.disconnected(reason) };
    const qport = owner.qport;
    if (owner.family === 'qw') {
      if (address.kind === 'ipx') throw new Error('QuakeWorld requires UDP');
      const remote = new QwRemotePresentation({ ...common, seat: seat.id,
        cameraOptions: { hightrack: () => owner.cvars().variableValue('cl_hightrack'), chasecam: () => owner.cvars().variableValue('cl_chasecam') },
        skinOptions: { read: async path => (await hooks.mounts().open(path))?.bytes ?? null,
          noskins: () => owner.cvars().variableValue('noskins'), baseskin: () => owner.cvars().variableString('baseskin'), allskins: () => this.allSkins },
        downloads: { request: (path, category) => this.requireQwDownloads().request(path, category),
          receive: result => this.requireQwDownloads().receive(result), close: () => this.closeQwDownloads() },
        prepareServerData: data => this.prepareQwDownloads(data),
        loadContent: world => hooks.loadQ1World(world, true),
        mapChecksum: async world => quakeWorldMapChecksum2(await hooks.content().mounts.read(world.map)) });
      this.remote = remote;
      this.network = new QwClientNetwork({ transport: transport.udpSocket(), remote: address, host: remote, qport,
        userinfo: () => owner.cvars().propagatedInfo('client-userinfo') });
    } else if (owner.family === 'q1') {
      const remote = new Q1RemotePresentation({ ...common, loadContent: world => hooks.loadQ1World(world, false) });
      this.remote = remote;
      this.network = new Q1ClientNetwork({ transport: transport, remote: address, host: remote,
        seat: { name: owner.cvars().variableString('name') || 'Player', color: owner.cvars().get('color')?.integerValue ?? 0, spawnParameters: '', extensionFlags: null } });
    } else if (owner.family === 'q3') {
      if (address.kind !== 'ipv4' && address.kind !== 'ipx') throw new Error('Native Q3 remote requires IPv4');
      const remote = new Q3RemotePresentation({ ...common,
        timescale: () => owner.cvars().variableValue('timescale'), timeNudge: () => owner.cvars().get('cl_timeNudge')?.integerValue ?? 0,
        userinfo: () => owner.cvars().infoString(CvarFlag.UserInfo),
        loadContent: (world, connection) => this.loadQ3World(world, connection), initialize: connection => hooks.initializeQ3(connection),
        shutdown: () => hooks.shutdownQ3(), downloads: {
          prepare: connection => this.prepareQ3Downloads(connection), publishSize: size => this.requireQ3Downloads().publishSize(size),
          receive: block => this.requireQ3Downloads().receive(block), close: () => this.closeQ3Downloads() } });
      remote.bindCollisionSettings(new CollisionMapSettings(owner.cvars()));
      this.remote = remote;
      this.network = new Q3ClientNetwork({ transport: transport, remote: address, host: remote, cvars: owner.cvars(), qport, authorization: owner.authorization });
    } else {
      if (owner.downloadPermission === null) throw new Error('Q2 remote client has no download policy');
      const remote: Q2RemotePresentation = new Q2RemotePresentation({ ...common, seat: seat.id, cinematic: hooks.cinematic,
        downloadPermission: owner.downloadPermission,
        protocol: owner.protocol,
        userinfo: () => owner.cvars().infoString(CvarFlag.UserInfo),
        prepareServerData: (data, assertCurrent) => hooks.selectContent(remoteContentSelection(remote.protocol.kind === 'q2-rerelease' || remote.protocol.kind === 'q2-kex' || remote.protocol.kind === 'q2-kex-demo' ? 'q2-rerelease-baseq2' : 'q2-classic-baseq2', data.gamedir), assertCurrent),
        loadContent: state => hooks.loadQ2World(state), refreshDownloads: assertCurrent => hooks.refreshContent(assertCurrent) });
      this.remote = remote;
      this.network = new Q2ClientNetwork({ transport, remote: address, host: remote, qport });
    }
  }

  get qport(): number { return this.owner.qport; }
  get transport(): ApplicationTransport { return this.owner.transport; }
  setAllSkins(value: string): void { this.allSkins = value; }
  pureCommand(serverId: number): string | null { return this.q3Content?.referencedPureCommand(serverId) ?? null; }
  get downloadProgress(): readonly ClientDownloadProgress[] {
    if (this.remote instanceof Q2RemotePresentation) return this.remote.downloadProgress;
    return this.qwDownloads?.progress ?? this.q3Downloads?.progress ?? [];
  }
  cancelDownloads(): void {
    if (this.remote instanceof Q2RemotePresentation) this.remote.cancelDownloads();
    this.qwDownloads?.cancel(); this.q3Downloads?.cancel();
  }
  async retryDownloads(): Promise<void> {
    if (this.remote instanceof Q2RemotePresentation) this.remote.retryDownloads();
    await this.qwDownloads?.retry(); this.q3Downloads?.retry();
  }
  private requireQwDownloads(): QwDownloadReceiver {
    if (this.qwDownloads === null) throw new Error('QW download before serverdata');
    return this.qwDownloads;
  }
  private requireQ3Downloads(): Q3ApplicationClientDownloads {
    if (this.q3Downloads === null) throw new Error('Q3 download has no content owner');
    return this.q3Downloads;
  }
  private closeQwDownloads(): void { this.downloadGeneration++; this.qwDownloads?.close(); this.qwDownloads = null; }
  private closeQ3Downloads(): void { this.q3Downloads?.close(); this.q3Downloads = null; }
  private assertOpen(): void { if (this.closed) throw new Error('Remote seat source is retired'); }

  private async prepareQwDownloads(data: QwServerData): Promise<void> {
    this.closeQwDownloads();
    const generation = this.downloadGeneration;
    const current = (): boolean => !this.closed && generation === this.downloadGeneration;
    const assertCurrent = (): void => { if (!current()) throw new Error('QW directory selection was cancelled'); };
    const prepared = await this.owner.hooks.selectContent(remoteContentSelection('q1-quakeworld', data.gameDirectory), assertCurrent);
    assertCurrent();
    const gameRoot = prepared.writeRoot, skinRoot = prepared.baseWriteRoot;
    this.qwDownloads = new QwDownloadReceiver({ gameRoot, skinRoot,
      exists: async (path, category) => {
        if (!current()) return false;
        const mounts = this.owner.hooks.mounts();
        try { return existsSync(join(category === 'skin' ? skinRoot : gameRoot, path)) || await mounts.resolve(path) !== null; }
        catch (error) { if (!current()) return false; throw error; }
      }, sendCommand: text => { assertCurrent(); this.network.command(text); }, print: text => this.owner.hooks.print(text),
      noskins: () => this.owner.cvars().variableValue('noskins'), demoRecording: () => this.owner.hooks.recording(), demoPlayback: () => false });
  }

  private async prepareQ3Downloads(connection: Q3ClientConnection): Promise<boolean> {
    const generation = connection.generation;
    const assertCurrent = (): void => {
      this.assertOpen();
      if (!(this.network instanceof Q3ClientNetwork) || this.network.native !== connection || generation !== connection.generation)
        throw new Error('Q3 package download belongs to a retired connection');
    };
    assertCurrent(); this.closeQ3Downloads();
    const hooks = this.owner.hooks;
    const selected = remoteContentSelection('q3-baseq3', q3InfoValue(connection.gameState.get(1) ?? '', 'fs_game') || 'baseq3');
    const seed = await hooks.selectContent(selected, assertCurrent);
    const root = dirname(seed.writeRoot), packages = await Q3ApplicationPackages.open(seed, connection.checksumFeed);
    assertCurrent();
    if (hooks.currentContent() !== seed) throw new Error('Q3 package content selection was replaced');
    const info = connection.gameState.get(1) ?? '', referenced = new ServerPakSet();
    referenced.setChecksums(q3InfoValue(info, 'sv_referencedPaks')); referenced.setNames(q3InfoValue(info, 'sv_referencedPakNames'));
    const downloads = new Q3ApplicationClientDownloads(root, { assertCurrent: () => { assertCurrent(); if (this.q3Downloads !== downloads) throw new Error('Q3 package download was replaced'); },
      permission: request => this.owner.downloadPermission?.(request) === true,
      reliable: text => connection.reliable.add(text), sendPacket: () => { assertCurrent(); if (this.network instanceof Q3ClientNetwork) this.network.sendPacket(); },
      progress: (name, count, size) => { if (count === 0 || count === size) hooks.print(`Downloading ${name}: ${count}/${size} bytes\n`); },
      reloadPackages: async () => { await hooks.refreshContent(() => { assertCurrent(); if (this.q3Downloads !== downloads) throw new Error('Q3 package refresh was cancelled'); }); } }, seed);
    this.q3Downloads = downloads;
    const loadedChecksums = packages.packs.map(pack => pack.pack.checksum), exists = (path: string): boolean => existsSync(join(root, path));
    if (this.owner.downloadPermission?.({ transport: 'native', category: 'package' }) !== true) {
      const missing = compareQ3Packages(referenced.snapshot(), loadedChecksums, path => exists(q3DownloadPath(path, seed)), false);
      if (missing.length !== 0) hooks.print(`Missing server packages: ${missing}\nDownloads are disabled. Enable cl_allowDownload to download server packages.\n`);
      return false;
    }
    const pending = downloads.begin(referenced.snapshot(), loadedChecksums, exists);
    if (pending) { await mkdir(root, { recursive: true }); assertCurrent(); if (this.q3Downloads !== downloads) throw new Error('Q3 download setup was cancelled'); }
    return pending;
  }

  private async loadQ3World(world: Q1RemoteWorld, connection: Q3ClientConnection): Promise<LoadedApplicationContent> {
    const hooks = this.owner.hooks, generation = connection.generation, seed = hooks.currentContent();
    if (seed === null) throw new Error('Q3 world loading requires its selected content owner');
    const assertCurrent = (): void => { this.assertOpen(); if (generation !== connection.generation || hooks.currentContent() !== seed) throw new Error('Remote Q3 content loading was cancelled'); };
    assertCurrent();
    const prepared = await Q3ClientContent.open({ ...hooks.options(), map: mapResourcePath(world.map) }, connection.gameState.get(1) ?? '', connection.checksumFeed, seed);
    try {
      assertCurrent();
      const content = await hooks.loadQ3World(world, connection, prepared.content);
      assertCurrent();
      const previous = this.q3Content; this.q3Content = prepared;
      await previous?.close();
      return content;
    } catch (error) { await prepared.close(); throw error; }
  }

  close(): Promise<void> {
    if (this.closing !== null) return this.closing;
    this.closed = true;
    this.closeQwDownloads(); this.closeQ3Downloads();
    this.closing = (async () => {
      try { await this.network.close(); }
      finally { await this.q3Content?.close(); this.q3Content = null; }
    })();
    return this.closing;
  }
}
