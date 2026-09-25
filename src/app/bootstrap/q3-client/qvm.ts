import type { ActorId } from "../../../contracts/identity.ts";
import type { ContentId } from "../../../contracts/content.ts";
import type { SceneEntity } from "../../../contracts/scene.ts";
import type { Vec4 } from "../../../contracts/math.ts";
import { QvmOpcode } from "../../../compat/qvm/image.ts";
import { QvmCgameImport } from "../../../compat/qvm/abi.ts";
import { QVM_REF_ENTITY_BYTES, readQvmRefEntity } from "../../../compat/qvm/render-record.ts";
import { SharedQvmClientClipModels } from './guest-collision.ts';
import type { QvmClientClipModels } from '../../../compat/qvm/client-collision-syscalls.ts';
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
import { readQvmCompatibility } from '../../../compat/qvm/compatibility.ts';
import { legacyClientCommand } from '../../../compat/qvm/legacy-client-abi.ts';
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
import { q3EquipmentCommand, type Q3EquipmentPresentation } from './equipment.ts';
import { q3EquipmentPresentationProfile } from '../../../content/q3/equipment/cgame-weapon-hud.ts';
import { QvmBodySubmissions } from '../../../compat/qvm/cgame-body.ts';
import { readCgameBodyProfile } from '../../../content/q3/presentation/cgame-body-profile.ts';
import { CgameStatusView } from './status.ts';

export interface QvmHeldWeapon {
  readonly content: ContentId;
  readonly parent: SceneEntity & { readonly actor: ActorId };
  readonly passes: { readonly shader: string | null; readonly color: Vec4; readonly shaderTime: number }[];
}
interface HeldWeaponInvocation { readonly frame: number; readonly end: number; readonly gun: number; readonly held: QvmHeldWeapon; }

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
  readonly equipmentWeapon?: () => Q3EquipmentPresentation | null;
  readonly heldWeaponActor?: (entity: number) => ActorId | null;
  readonly bodyOverrides?: { active(): boolean; hidden(entity: number): boolean; };
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
  private readonly collisionModels: QvmClientClipModels;
  private readonly globals = new ScriptGlobalDefines();
  private readonly scripts: { readonly cgame: QvmClientScripts; readonly ui: QvmClientScripts };
  private readonly marks: ReturnType<typeof worldMarkProjector>;
  private arguments: readonly string[] = [];
  private retired = false;
  private ready = false;
  private readonly artifacts = new Map<"ui" | "cgame", QvmModuleOptions["artifact"]>();
  private cgame: QvmCgame | null = null;
  private bodySubmissions: QvmBodySubmissions | null = null;
  private ui: QvmUi | null = null;
  private equipment: Q3EquipmentPresentation | null = null;
  private equipmentProfile: ReturnType<typeof q3EquipmentPresentationProfile> = null;
  private readonly equipmentStatusObservers: (() => void)[] = [];
  private equipmentHeldObserver: (() => void) | null = null;
  private readonly heldInvocations: HeldWeaponInvocation[] = [];
  private readonly heldWeapons: QvmHeldWeapon[] = [];
  get sharedHeldWeapons(): readonly QvmHeldWeapon[] { return this.heldWeapons; }
  private equipmentViewObserver: (() => void) | null = null;
  private equipmentViewVisible = false;
  private equipmentSelector: (() => void) | null = null;
  private equipmentHudRequested = false;
  private readonly status: CgameStatusView;
  get sharedEquipmentHud(): boolean { return this.equipmentHudRequested; }
  get sharedEquipmentViewVisible(): boolean | null { return this.equipmentProfile === null ? null : this.equipmentViewVisible; }

  private constructor(readonly options: ApplicationQvmClientOptions) {
    this.status = new CgameStatusView(options.cvars, () => options.session.statusVisible?.() !== false);
    this.commandServices = { ui: qvmClientCommands(options.commands, options.commandContext, 'ui'),
      cgame: qvmClientCommands(options.commands, options.commandContext, 'cgame') };
    this.generation = options.connection.generation;
    this.collisionModels = options.queries.nativeQ3ClipModels() ?? new SharedQvmClientClipModels(options.queries, options.cvars);
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
    if (call.kind === "engine" && call.role === "cgame" && call.code === QvmCgameImport.CG_R_ADDREFENTITYTOSCENE) {
      const invocation = this.heldInvocations.at(-1), pointer = call.words.getInt32(4, true);
      if (invocation !== undefined && pointer >= invocation.frame && pointer + QVM_REF_ENTITY_BYTES <= invocation.end) {
        if (pointer === invocation.gun) {
          const ref = readQvmRefEntity(call.guest.view(pointer, QVM_REF_ENTITY_BYTES));
          const shader = typeof ref.customShader === "number" ? this.options.services.resources.shaderForHandle(ref.customShader) : ref.customShader;
          invocation.held.passes.push({ shader: shader?.name ?? null, color: ref.shaderRGBA, shaderTime: ref.shaderTime });
        }
        return 0;
      }
    }
    if (this.bodySubmissions?.suppress(call)) return 0;
    if (call.role !== 'cgame' && call.role !== 'ui') return rejectQvmSyscall(call);
    if (call.role === 'cgame') { const result = this.status.syscall(call.words, call.guest); if (result !== null) return result; }
    const o = this.options, session = o.session;
    const common = { cvars: call.role === 'cgame' ? this.status.cvars : o.cvars, print: session.print, milliseconds: o.now, arguments: () => this.arguments };
    const commands = this.commandServices[call.role];
    return qvmCommonSyscall(call, call.role === 'cgame'
      ? { ...common, role: 'cgame', commands: { append: commands.append, register: session.registerCgameCommand,
        remove: o.removeCommand, reliable: session.addReliableCommand } }
      : { ...common, role: 'ui', commands })
      ?? qvmFileSyscall(call, this.files[call.role])
      ?? qvmClientScriptSyscall(call, this.scripts[call.role])
      ?? qvmClientRenderSyscall(call, o.services.resources, o.services.draw)
      ?? qvmClientAudioSyscall(call, { role: call.role, sound: o.services.sound, print: session.print })
      ?? qvmClientStateSyscall(call, { connection: o.connection, snapshots: {
        current: () => session.snapshots.current(), read: number => session.snapshots.read(number),
      }, userCommand: number => { const command = o.connection.commands.read(number); return command === null ? null : q3EquipmentCommand(command, this.equipment); }, snapshotPing: number => o.connection.snapshotPing(number),
        getServerCommand: async number => { const argv = await o.connection.getServerCommand(number); this.assertCurrent(); if (argv !== null) this.arguments = legacyClientCommand(argv, call.abiProfile ?? "q3-modern"); return argv; },
        setUserCommandValue: session.setUserCommandValue })
      ?? qvmClientCollisionSyscall(call, { models: () => this.collisionModels, loadMap: name => { if (name !== o.map) throw new Error(`Cgame requested a different collision map: ${name}`); this.assertCurrent(); } })
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
    const abiProfile = await readQvmCompatibility(this.options.media.provider.mounts, { artifactPath: path, digest: opened.reference.digest }, role);
    this.assertCurrent();
    const artifact = resolveQvmArtifact({ abiProfile, module: { id: `q3:${role}`, artifactPath: path, digest: opened.reference.digest,
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
      const cgameOptions = await owner.module('cgame');
      owner.cgame = new QvmCgame(options.seat, cgameOptions, {
        assertCurrentOperation: () => owner.assertCurrent(), current: () => ({ generation: options.connection.generation, serverMessageNumber: options.connection.serverMessageSequence, dropped: null }),
        beginLoading: () => { owner.ready = false; return undefined; }, prime: () => { owner.ready = true; return undefined; },
      });
      owner.equipmentProfile = q3EquipmentPresentationProfile(cgameOptions.artifact);
      const view = owner.equipmentProfile?.view;
      if (view !== undefined) owner.equipmentViewObserver = owner.cgame.module.bindInvocation({ kind: "qvm", module: cgameOptions.artifact.module, instructionIndex: view.entry }, call => {
        call.branches([{ instructionIndex: view.decision, decide: originalTaken => {
          if (originalTaken) owner.equipmentViewVisible = true;
          return originalTaken;
        } }]);
        return call.execution === "asynchronous" ? call.proceedAsync() : call.proceed();
      });
      const status = owner.equipmentProfile?.status;
      if (status?.kind === "regions") for (const entry of status.entries) {
        owner.equipmentStatusObservers.push(owner.cgame.module.bindInvocation({ kind: "qvm", module: cgameOptions.artifact.module, instructionIndex: entry.entry }, call => {
          if (owner.equipment !== null) {
            call.branches([{ instructionIndex: entry.decision, decide: originalTaken => { if (originalTaken) owner.equipmentHudRequested = true; return originalTaken; } }]);
            call.regions(entry.ammo.map(region => ({ ...region, run: () => "skip" })));
          }
          return call.execution === "asynchronous" ? call.proceedAsync() : call.proceed();
        }));
      } else if (status?.kind === "functions") for (const entry of status.entries) {
        owner.equipmentStatusObservers.push(owner.cgame.module.bindInvocation({ kind: "qvm", module: cgameOptions.artifact.module, instructionIndex: entry }, call => {
          if (owner.equipment === null) return call.execution === "asynchronous" ? call.proceedAsync() : call.proceed();
          owner.equipmentHudRequested = true; return 0;
        }));
      }
      const warning = owner.equipmentProfile?.warning;
      if (warning !== undefined) owner.equipmentStatusObservers.push(owner.cgame.module.bindInvocation({ kind: "qvm", module: cgameOptions.artifact.module, instructionIndex: warning.entry }, call => {
        if (owner.equipment === null) return call.execution === "asynchronous" ? call.proceedAsync() : call.proceed();
        const state = call.guest.view(warning.state, 4), original = state.getInt32(0, true);
        state.setInt32(0, owner.equipment.warning === "empty" ? 2 : owner.equipment.warning === "low" ? 1 : 0, true);
        if (call.execution === "asynchronous") return (async () => { try { return await call.proceedAsync(); } finally { state.setInt32(0, original, true); } })();
        try { return call.proceed(); } finally { state.setInt32(0, original, true); }
      }));
      const held = owner.equipmentProfile?.held;
      if (held !== undefined && cgameOptions.artifact.kind === "bytecode") {
        const enter = cgameOptions.artifact.image.instructions[held.entry];
        if (enter?.opcode !== QvmOpcode.OP_ENTER) throw new Error("Original held-weapon entry is invalid");
        owner.equipmentHeldObserver = owner.cgame.module.bindInvocation({ kind: "qvm", module: cgameOptions.artifact.module, instructionIndex: held.entry }, call => {
          const proceed = () => call.execution === "asynchronous" ? call.proceedAsync() : call.proceed();
          if (call.words.getInt32(4, true) !== 0) return proceed();
          const number = call.guest.view(call.words.getInt32(8, true), 4).getInt32(0, true);
          const actor = options.heldWeaponActor?.(number) ?? null;
          if (actor === null) return proceed();
          const ref = readQvmRefEntity(call.guest.view(call.words.getInt32(0, true), QVM_REF_ENTITY_BYTES));
          if (ref.kind !== "model") throw new Error("Original weapon parent is not a model");
          const model = typeof ref.model === "number" ? options.services.resources.modelForHandle(ref.model) : ref.model;
          if (model.kind !== "model") throw new Error("Original weapon parent has no decoded model");
          const parent: SceneEntity & { readonly actor: ActorId } = { actor, resource: model.resource, model: model.model,
            transform: { origin: ref.origin, axis: ref.axis, scale: { x: 1, y: 1, z: 1 } }, previousOrigin: ref.oldOrigin,
            pose: { kind: "frame", frame: ref.frame, previousFrame: ref.oldFrame, backLerp: ref.backLerp },
            color: { x: 1, y: 1, z: 1, w: 1 }, skin: ref.skinNum, shaderTime: { kind: "seconds", value: ref.shaderTime },
            lightingOrigin: ref.lightingOrigin, shadowPlane: ref.shadowPlane, flags: { kind: "q3", bits: ref.renderFlags }, attachments: [] };
          const end = call.words.byteOffset - call.memory.byteOffset - 8, frame = end - enter.operand;
          const invocation: HeldWeaponInvocation = { frame, end, gun: frame + held.gun, held: { content: options.media.content, parent, passes: [] } };
          owner.heldInvocations.push(invocation);
          const finish = () => { if (owner.heldInvocations.pop() !== invocation) throw new Error("Original weapon attachment scopes unwound out of order"); };
          const complete = (value: number): number => { if (invocation.held.passes.length !== 0) owner.heldWeapons.push(invocation.held); return value; };
          if (call.execution === "asynchronous") return (async () => { try { return complete(await call.proceedAsync()); } finally { finish(); } })();
          try { return complete(call.proceed()); } finally { finish(); }
        });
      }
      const bodies = await readCgameBodyProfile(cgameOptions.artifact, options.media.provider.mounts);
      owner.assertCurrent();
      if (bodies !== null) owner.bodySubmissions = new QvmBodySubmissions(owner.cgame.module, cgameOptions.artifact, bodies, entity => options.bodyOverrides?.hidden(entity) ?? false);
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
    const hideBodies = this.options.bodyOverrides?.active() ?? false;
    if (hideBodies && this.bodySubmissions === null) throw new Error('This cgame needs an artifact-matched cgame-presentation.json declaration for body replacements');
    this.bodySubmissions?.enable(hideBodies);
    this.equipment = this.options.equipmentWeapon?.() ?? null;
    if (this.equipment !== null && this.equipmentProfile === null)
      throw new Error("Selected weapon presentation requires a qualified original cgame HUD boundary");
    if (this.equipment !== null && this.equipmentProfile !== null && this.equipmentSelector === null)
      this.equipmentSelector = this.cgame.module.bindFunction({ kind: "qvm", module: this.cgame.module.profile.module, instructionIndex: this.equipmentProfile.hud },
        () => 0);
    else if (this.equipment === null) { this.equipmentSelector?.(); this.equipmentSelector = null; }
    this.equipmentHudRequested = false; this.equipmentViewVisible = false; this.heldWeapons.length = 0;
    await this.cgame.drawActiveFrame(time, 'center', demoPlayback);
    if ((this.options.keyCatcher() & 2) !== 0) await this.ui?.refresh(Math.trunc(this.options.now()));
  }
  refreshStatus(): void { if (!this.retired) { this.assertCurrent(); this.status.refresh(); } }
  async command(argv: readonly string[]): Promise<boolean> { this.assertCurrent(); if (await this.cgame?.consoleCommand(argv)) return true; return await this.ui?.consoleCommand(Math.trunc(this.options.now()), argv) ?? false; }
  async keyEvent(key: number, down: boolean): Promise<void> { this.assertCurrent(); if ((this.options.keyCatcher() & 2) !== 0) await this.ui?.keyEvent(key, down); else if (this.cgame?.supportsInputEvents) await this.cgame.keyEvent(key, down); }
  async mouseEvent(x: number, y: number): Promise<void> { this.assertCurrent(); if ((this.options.keyCatcher() & 2) !== 0) await this.ui?.mouseEvent(x, y); else if (this.cgame?.supportsInputEvents) await this.cgame.mouseEvent(x, y); }
  get capturesInput(): boolean {
    const catcher = this.options.keyCatcher();
    return this.cgame?.supportsInputEvents ? catcher !== 0 : (catcher & 2) !== 0;
  }
  async eventHandling(mode: Q3CgameEventHandling): Promise<void> {
    this.assertCurrent();
    if (mode === 'none' && this.cgame !== null && !this.cgame.supportsInputEvents) return;
    await this.cgame?.eventHandling(mode);
  }
  async shutdown(): Promise<void> { if (this.retired) return; try { await this.cgame?.shutdown(); await this.ui?.shutdown(); } finally { this.close(); } }
  close(): void {
    if (this.retired) return;
    this.retired = true; this.ready = false;
    const failures: unknown[] = [];
    for (const cleanup of [() => { this.bodySubmissions?.close(); this.bodySubmissions = null; this.equipmentSelector?.(); this.equipmentSelector = null; this.equipmentViewObserver?.(); this.equipmentViewObserver = null; this.equipmentHeldObserver?.(); this.equipmentHeldObserver = null; for (const remove of this.equipmentStatusObservers.splice(0)) remove(); this.heldWeapons.length = 0; this.equipmentViewVisible = false; this.equipment = null; }, () => this.cgame?.retire(), () => this.ui?.retire(),
      () => this.files.cgame.closeAll(), () => this.files.ui.closeAll(),
      () => this.scripts.cgame.closeAll(), () => this.scripts.ui.closeAll(), () => this.globals.clear()]) {
      try { cleanup(); } catch (error) { failures.push(error); }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'QVM client cleanup failed');
  }
}
