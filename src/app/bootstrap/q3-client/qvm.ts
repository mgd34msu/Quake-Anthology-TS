import type { ApplicationKeyProfile } from "../keys.ts";
import { qvmUiKeySyscall } from "../../../compat/qvm/ui-key-syscalls.ts";
import { ScriptGlobalDefines } from "../../../ui/common/legacy/script/preprocessor.ts";
import { QvmClientScripts, qvmClientScriptSyscall } from "../../../compat/qvm/client-script-syscalls.ts";
import { QvmUiExport } from '../../../compat/qvm/abi.ts';
import { qvmArguments } from '../../../compat/qvm/module.ts';
import { worldMarkProjector } from '../../../content/q3/presentation/mark-projector.ts';
import { qvmClientMarkSyscall } from '../../../compat/qvm/client-mark-syscalls.ts';
import type { SeatId } from '../../../contracts/identity.ts';
import type { CommandContext } from '../../../contracts/common.ts';
import type { Q3PresentationSession } from '../../../content/q3/presentation/client.ts';
import type { Q3CgameEventHandling } from '../../../contracts/ui.ts';
import type { Q3ClientState } from '../../../compat/qvm/client-state.ts';
import type { CommandBuffer } from '../../../core/commands/index.ts';
import type { QvmCvarServices } from '../../../compat/qvm/cvar-syscalls.ts';
import { QvmCgame } from '../../../compat/qvm/cgame.ts';
import { QvmUi } from '../../../compat/qvm/ui.ts';
import type { Q3BrowserView } from '../../../network/q3/browser-view.ts';
import { qvmClientBrowserSyscall } from '../../../compat/qvm/client-browser-syscalls.ts';
import { resolveQvmArtifact } from '../../../compat/qvm/artifacts.ts';
import { qvmCommonSyscall } from '../../../compat/qvm/common-syscalls.ts';
import { qvmClientCinematicSyscall } from '../../../compat/qvm/client-cinematic-syscalls.ts';
import { qvmClientRenderSyscall } from '../../../compat/qvm/client-render-syscalls.ts';
import { qvmClientAudioSyscall } from '../../../compat/qvm/client-audio-syscalls.ts';
import { QvmFiles, qvmFileSyscall } from '../../../compat/qvm/file-syscalls.ts';
import { qvmClientStateSyscall } from '../../../compat/qvm/client-state-syscalls.ts';
import { qvmClientCollisionSyscall } from '../../../compat/qvm/client-collision-syscalls.ts';
import { rejectQvmSyscall } from '../../../compat/qvm/syscalls.ts';
import type { QvmHostCall, QvmHostResult } from '../../../compat/qvm/syscalls.ts';
import type { QvmModuleOptions } from '../../../compat/qvm/module.ts';
import type { ApplicationQ3Assets } from './assets.ts';
import type { ApplicationQ3Services } from './services.ts';
import type { SharedSceneQueries } from '../../../world/collision/index.ts';
import { UserFileStore } from '../../../platform/files/writable.ts';

export type QvmPresentationArtifacts = Readonly<Record<"ui" | "cgame", QvmModuleOptions["artifact"]>>;

export interface ApplicationQvmClientOptions {
  readonly artifacts?: QvmPresentationArtifacts;
  readonly seat: SeatId;
  readonly commandContext: CommandContext;
  readonly services: ApplicationQ3Services;
  readonly media: ApplicationQ3Assets;
  readonly session: Q3PresentationSession;
  readonly connection: Q3ClientState;
  readonly queries: SharedSceneQueries;
  readonly commands: Pick<CommandBuffer, 'executeNow' | 'insert' | 'append'>;
  readonly cvars: QvmCvarServices;
  readonly browser: Q3BrowserView;
  readonly keys: ApplicationKeyProfile;
  readonly map: string;
  readonly now: () => number;
  readonly keyCatcher: () => number;
  removeCommand(name: string): void;
  scalar(call: QvmHostCall, owner: ApplicationQvmClient): QvmHostResult | null;
}

export function qvmClientCommands(commands: ApplicationQvmClientOptions['commands'], context: CommandContext, role: 'ui' | 'cgame') {
  const source: CommandContext = { session: context.session, origin: { kind: 'script', name: `q3-${role}`, caller: context.origin } };
  return { executeNow: (text: string) => { commands.executeNow(text, source); },
    insert: (text: string) => commands.insert(text, source), append: (text: string) => commands.append(text, source) };
}

/** The actual guest modules share the same media, scene, input and connection owners as source cgame. */
export class ApplicationQvmClient {
  private readonly commandServices: { readonly ui: ReturnType<typeof qvmClientCommands>; readonly cgame: ReturnType<typeof qvmClientCommands> };
  private readonly files: { readonly cgame: QvmFiles; readonly ui: QvmFiles };
  private readonly generation: number;
  private readonly globals = new ScriptGlobalDefines();
  private readonly scripts: { readonly cgame: QvmClientScripts; readonly ui: QvmClientScripts };
  private readonly marks: ReturnType<typeof worldMarkProjector>;
  private arguments: readonly string[] = [];
  private retired = false;
  private ready = false;
  private readonly artifacts = new Map<"ui" | "cgame", QvmModuleOptions["artifact"]>();
  private cgame: QvmCgame | null = null;
  private ui: QvmUi | null = null;

  private constructor(readonly options: ApplicationQvmClientOptions) {
    this.commandServices = { ui: qvmClientCommands(options.commands, options.commandContext, 'ui'),
      cgame: qvmClientCommands(options.commands, options.commandContext, 'cgame') };
    this.generation = options.connection.generation;
    this.marks = worldMarkProjector(options.media.assets.world);
    const userContent = options.media.assets.content.catalog.product(options.media.content).userContent;
    const fileOptions = { mounts: options.media.provider.mounts, writable: userContent === null ? null : new UserFileStore(userContent.root),
      print: options.session.print, assertCurrent: () => this.assertCurrent() };
    this.files = { cgame: new QvmFiles(fileOptions), ui: new QvmFiles(fileOptions) };
    const scriptOptions = { mounts: fileOptions.mounts, globals: this.globals, assertCurrent: fileOptions.assertCurrent, print: options.session.print };
    this.scripts = { cgame: new QvmClientScripts(scriptOptions), ui: new QvmClientScripts(scriptOptions) };
  }
  private assertCurrent(): undefined {
    this.options.session.assertCurrent();
    if (this.retired || this.options.connection.generation !== this.generation) throw new Error('QVM presentation belongs to a retired gamestate');
    return undefined;
  }
  private host(call: QvmHostCall): QvmHostResult {
    this.assertCurrent();
    if (call.role !== 'cgame' && call.role !== 'ui') return rejectQvmSyscall(call);
    const o = this.options, session = o.session;
    const common = { cvars: o.cvars, print: session.print, milliseconds: o.now, arguments: () => this.arguments };
    const commands = this.commandServices[call.role];
    return qvmCommonSyscall(call, call.role === 'cgame'
      ? { ...common, role: 'cgame', commands: { append: commands.append, register: session.registerCgameCommand,
        remove: o.removeCommand, reliable: session.addReliableCommand } }
      : { ...common, role: 'ui', commands })
      ?? qvmFileSyscall(call, this.files[call.role])
      ?? qvmClientScriptSyscall(call, this.scripts[call.role])
      ?? qvmClientRenderSyscall(call, o.services.resources, o.services.draw)
      ?? qvmClientAudioSyscall(call, { role: call.role, sound: o.services.sound, print: session.print })
      ?? qvmClientStateSyscall(call, { connection: o.connection, snapshots: session.snapshots, snapshotPing: number => o.connection.snapshotPing(number),
        getServerCommand: async number => { const argv = await o.connection.getServerCommand(number); this.assertCurrent(); if (argv !== null) this.arguments = argv; return argv; },
        setUserCommandValue: session.setUserCommandValue })
      ?? qvmClientCollisionSyscall(call, { models: () => {
        const models = o.queries.nativeQ3ClipModels(); if (models === null) throw new Error('Native QVM collision requires a Q3 map'); return models;
      }, loadMap: name => { if (name !== o.map) throw new Error(`Cgame requested a different collision map: ${name}`); this.assertCurrent(); } })
      ?? qvmClientMarkSyscall(call, this.marks)
      ?? qvmClientCinematicSyscall(call, { cinematics: o.services.cinematics, draw: o.services.draw, developerPrint: session.print })
      ?? qvmClientBrowserSyscall(call, o.browser)
      ?? qvmUiKeySyscall(call, { keys: o.keys, gameDirectory: () => o.keys.gameDirectory, assertCurrent: () => this.assertCurrent() })
      ?? o.scalar(call, this) ?? rejectQvmSyscall(call);
  }
  private async module(role: 'cgame' | 'ui'): Promise<QvmModuleOptions> {
    const retained = this.options.artifacts?.[role];
    if (retained !== undefined) {
      if (retained.role !== role) throw new Error('Retained presentation artifact has the wrong role');
      this.artifacts.set(role, retained);
      return { artifact: retained, host: call => this.host(call) };
    }
    const path = `vm/${role}.qvm`, opened = await this.options.media.provider.mounts.open(path);
    this.assertCurrent();
    if (opened === null) throw new Error(`Missing native module: ${path}`);
    const artifact = resolveQvmArtifact({ module: { id: `q3:${role}`, artifactPath: path, digest: opened.reference.digest,
      revision: `${opened.reference.provenance.mount.identity.id}:${opened.reference.provenance.mount.identity.generation}` }, role, bytes: opened.bytes });
    if (artifact.kind !== 'bytecode' || artifact.known !== null && artifact.known.product !== 'baseq3') throw new Error(`Unsupported native baseq3 module: ${path}`);
    this.artifacts.set(role, artifact);
    return { artifact, host: call => this.host(call) };
  }
  static async create(options: ApplicationQvmClientOptions): Promise<ApplicationQvmClient> {
    const owner = new ApplicationQvmClient(options);
    try {
      owner.ui = await QvmUi.create(options.seat, await owner.module('ui'), () => owner.assertCurrent());
      await owner.ui.init(true);
      owner.cgame = new QvmCgame(options.seat, await owner.module('cgame'), {
        assertCurrentOperation: () => owner.assertCurrent(), current: () => ({ generation: options.connection.generation, serverMessageNumber: options.connection.serverMessageSequence, dropped: null }),
        beginLoading: () => { owner.ready = false; return undefined; }, prime: () => { owner.ready = true; return undefined; },
      });
      await owner.cgame.init(options.session.serverMessageSequence, options.session.lastExecutedServerCommand, options.session.clientNumber);
      owner.assertCurrent(); return owner;
    } catch (error) {
      try { owner.close(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'QVM initialization and cleanup failed'); }
      throw error;
    }
  }
  presentationArtifacts(): QvmPresentationArtifacts {
    const ui = this.artifacts.get("ui"), cgame = this.artifacts.get("cgame");
    if (ui === undefined || cgame === undefined) throw new Error("Presentation modules are not initialized");
    return { ui, cgame };
  }
  async updateScreen(call: QvmHostCall): Promise<void> {
    this.assertCurrent();
    if (call.role === 'ui') await call.invokeAsync(qvmArguments([QvmUiExport.UI_DRAW_CONNECT_SCREEN, 1]));
    else await this.ui?.drawConnectScreen(true);
  }
  async draw(time: number, demoPlayback: boolean): Promise<void> {
    this.assertCurrent();
    if (!this.ready || this.cgame === null) throw new Error('QVM cgame has not initialized');
    await this.cgame.drawActiveFrame(time, 'center', demoPlayback);
    if ((this.options.keyCatcher() & 2) !== 0) await this.ui?.refresh(Math.trunc(this.options.now()));
  }
  async command(argv: readonly string[]): Promise<boolean> { this.assertCurrent(); if (await this.cgame?.consoleCommand(argv)) return true; return await this.ui?.consoleCommand(Math.trunc(this.options.now()), argv) ?? false; }
  async keyEvent(key: number, down: boolean): Promise<void> { this.assertCurrent(); if ((this.options.keyCatcher() & 2) !== 0) await this.ui?.keyEvent(key, down); else await this.cgame?.keyEvent(key, down); }
  async mouseEvent(x: number, y: number): Promise<void> { this.assertCurrent(); if ((this.options.keyCatcher() & 2) !== 0) await this.ui?.mouseEvent(x, y); else await this.cgame?.mouseEvent(x, y); }
  async eventHandling(mode: Q3CgameEventHandling): Promise<void> { this.assertCurrent(); await this.cgame?.eventHandling(mode); }
  async shutdown(): Promise<void> { if (this.retired) return; try { await this.cgame?.shutdown(); await this.ui?.shutdown(); } finally { this.close(); } }
  close(): void {
    if (this.retired) return;
    this.retired = true; this.ready = false;
    const failures: unknown[] = [];
    for (const cleanup of [() => this.cgame?.retire(), () => this.ui?.retire(),
      () => this.files.cgame.closeAll(), () => this.files.ui.closeAll(),
      () => this.scripts.cgame.closeAll(), () => this.scripts.ui.closeAll(), () => this.globals.clear()]) {
      try { cleanup(); } catch (error) { failures.push(error); }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'QVM client cleanup failed');
  }
}
