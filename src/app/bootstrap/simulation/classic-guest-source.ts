import { validateNativePrimary } from "../../../compat/q2/native-primary-validation.ts";
import { readNativeCompatibility } from "../../../compat/q2/compatibility.ts";
import type { NativePrimaryDeclaration, NativePrimaryProfile } from "../../../compat/q2/native-primary.ts";
import { nativeModuleIdentity } from "./q2-native-world.ts";
import type { ResolvedExecutionModule } from '../../../contracts/content.ts';
import type { GuestCallContext, ModuleIdentity } from '../../../contracts/execution.ts';
import type { MountedContent } from '../../../content/mounts/index.ts';
import { ClassicQ2GuestHost, CLASSIC_Q2_ABI } from '../../../compat/q2/classic/index.ts';
import type { ClassicQ2GuestHostOptions } from '../../../compat/q2/classic/host.ts';
import type { ClassicQ2EngineServices } from '../../../compat/q2/classic/index.ts';
import { GuestCallRunner } from '../../../guest/abi/index.ts';
import { createGuestProcessorState, GuestCallbackTable, SparseGuestMemory } from '../../../guest/core/index.ts';
import type { MappedGuestMemory } from '../../../guest/core/index.ts';
import { mapPeImage, parsePe, resolvePeExport } from '../../../guest/pe/index.ts';
import type { PeImage } from '../../../guest/pe/index.ts';
import { WindowsGuestRuntime } from '../../../guest/runtime/windows/index.ts';
import type { WindowsCapabilities, WindowsFile } from '../../../guest/runtime/windows/contracts.ts';
import { I386Cpu } from '../../../guest/x86/index.ts';

type NativeExecution = Extract<ResolvedExecutionModule, { readonly kind: 'native' }>;
export interface PreparedClassicGuest { readonly edition: "classic"; readonly primary?: NativePrimaryDeclaration<Extract<NativePrimaryProfile, { readonly edition: "classic" }>>; readonly execution: NativeExecution; readonly bytes: Uint8Array; }
export async function prepareClassicGuest(execution: NativeExecution, mounts: MountedContent): Promise<PreparedClassicGuest> {
  if (execution.role !== 'server-game' || execution.api.kind !== 'q2-classic-game' || execution.api.version !== 3
    || execution.profile.kind !== 'windows-i386') throw new Error('Classic Q2 guest requires Windows i386 game API 3');
  const bytes = await mounts.read(execution.artifact);
  const pe = parsePe(bytes);
    if (pe.abi.kind !== execution.profile.kind) throw new Error('Classic native artifact ABI differs from the selected profile');
  const primary = await readNativeCompatibility(mounts, execution);
    if (primary !== null) validateNativePrimary(primary.profile, pe);
    if (primary !== null && primary.profile.edition !== "classic") throw new Error("Native declaration edition differs from selected API");
    return { edition: "classic", execution, bytes, ...(primary === null || primary.profile.edition !== "classic" ? {} : { primary: { declaration: primary.declaration, profile: primary.profile } }) };
}
export interface ClassicGuestSourceOptions {
  readonly importBoundary?: ClassicQ2GuestHostOptions['importBoundary'];
  services(memory: MappedGuestMemory): ClassicQ2EngineServices;
  readonly capabilities: WindowsCapabilities;
  readonly instructionBudget?: number;
}

/** The selected DLL owns game bytes; all world and presentation services are supplied by the session. */
export class ClassicGuestSource {
  get imageBase() { return this.image.base; }
  entry(name: string) { return resolvePeExport(this.image, { kind: 'name', name, version: null }, () => null).address; }
  private phase: 'created' | 'initializing' | 'running' | 'closed' = 'created';
  private constructor(readonly host: ClassicQ2GuestHost, readonly runtime: WindowsGuestRuntime,
    readonly memory: SparseGuestMemory, private readonly image: PeImage, private readonly context: GuestCallContext,
    private readonly budget: number, private readonly files: Set<WindowsFile>) {}

  static create(prepared: PreparedClassicGuest, options: ClassicGuestSourceOptions): ClassicGuestSource {
    if (prepared.execution.role !== 'server-game' || prepared.execution.api.kind !== 'q2-classic-game' || prepared.execution.api.version !== 3 || prepared.execution.profile.kind !== 'windows-i386')
      throw new Error('Classic guest source requires selected Windows i386 API 3');
    const module: ModuleIdentity = nativeModuleIdentity(prepared);
    const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
    let source: ClassicGuestSource | null = null;
    const files = new Set<WindowsFile>();
    try {
      const image = mapPeImage({ bytes: prepared.bytes, memory });
      const stack = memory.allocate({ byteLength: 1_048_576, alignment: 16n, label: 'classic game stack' });
      const returned = memory.allocate({ byteLength: 16, permissions: 'read-execute', label: 'classic game return' });
      const callbacks = new GuestCallbackTable(memory);
      const state = createGuestProcessorState({ architecture: 'i386', instructionPointer: 0n, stackPointer: stack.byteOffset + 1_048_560n,
        flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
      const cpu = new I386Cpu({ state, memory, hostCall: address => callbacks.enter(address) });
      let host: ClassicQ2GuestHost | null = null;
      const runner = new GuestCallRunner({ cpu, callbacks, returnAddress: returned, variadicLayouts: (callback, fixed) => {
        if (host === null) throw new Error('Classic API imports have not been bound');
        return host.variadicLayouts(callback, fixed);
      } });
      const runtime = new WindowsGuestRuntime({ memory, callbacks, capabilities: { ...options.capabilities, openFile: (path, mode) => {
        const file = options.capabilities.openFile?.(path, mode) ?? null;
        if (file === null) return null;
        const owned: WindowsFile = { read: (offset, length) => file.read(offset, length), write: (offset, bytes) => file.write(offset, bytes),
          size: () => file.size(), truncate: length => file.truncate(length), flush: () => file.flush(),
          close: () => { if (files.delete(owned)) file.close(); } };
        files.add(owned); return owned;
      } } }); runtime.attachRunner(runner);
      const game = resolvePeExport(image, { kind: 'name', name: 'GetGameAPI', version: null }, () => null).address;
      const context: GuestCallContext = { module, callback: { kind: 'native-guest', module, address: game, abi: CLASSIC_Q2_ABI }, parent: null, self: null, other: null };
      const budget = options.instructionBudget ?? 5_000_000;
      host = new ClassicQ2GuestHost({ runner, provider: prepared.execution.owner.provider, services: options.services(memory), instructionBudget: budget,
        ...(options.importBoundary === undefined ? {} : { importBoundary: options.importBoundary }) });
      source = new ClassicGuestSource(host, runtime, memory, image, context, budget, files);
      runtime.initialize(image, { context, instructionBudget: budget });
      host.getGameApi(game);
      return source;
    } catch (error) {
      try { if (source !== null) source.discard(); else { closeFiles(files); releaseMemory(memory); } }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'Classic native guest construction and cleanup failed'); }
      throw error;
    }
  }

  init(): void {
    if (this.phase !== 'created') throw new Error('Classic guest Init requires a fresh source');
    this.phase = 'initializing';
    try { this.host.init(); this.phase = 'running'; }
    catch (error) {
      try { this.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Classic guest initialization and cleanup failed'); }
      throw error;
    }
  }
  async initLoading(nextFrame: () => Promise<void>): Promise<void> {
    if (this.phase !== 'created') throw new Error('Classic guest Init requires a fresh source');
    this.phase = 'initializing';
    try { await this.host.initLoading(nextFrame); this.phase = 'running'; }
    catch (error) {
      try { this.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Classic guest initialization and cleanup failed'); }
      throw error;
    }
  }

  /** Candidate disposal runs no game exports or DLL detach callbacks. */
  discard(): void {
    if (this.phase === 'closed') return;
    if (this.host.options.runner.depth !== 0) throw new Error('Classic guest disposal requires a completed game call');
    this.phase = 'closed';
    const errors: unknown[] = [];
    for (const actor of this.host.options.services.engine.actors.ownedBy(this.host.options.provider)) {
      try { this.host.options.services.engine.actors.release(actor); } catch (error) { errors.push(error); }
    }
    try { closeFiles(this.files); } catch (error) { errors.push(error); }
    try { releaseMemory(this.memory); } catch (error) { errors.push(error); }
    if (errors.length !== 0) throw new AggregateError(errors, 'Classic guest discard failed');
  }

  close(): void {
    if (this.phase === 'closed') return;
    if (this.host.options.runner.depth !== 0) throw new Error('Classic guest shutdown requires a completed game call');
    const initialized = this.phase !== 'created', errors: unknown[] = [];
    if (initialized) { try { this.host.shutdown(); } catch (error) { errors.push(error); } }
    try { this.runtime.detach(this.image, { context: this.context, instructionBudget: this.budget }); } catch (error) { errors.push(error); }
    try { this.discard(); } catch (error) { errors.push(error); }
    if (errors.length !== 0) throw new AggregateError(errors, 'Classic native guest shutdown failed');
  }
}
function releaseMemory(memory: SparseGuestMemory): void {
  for (const mapping of memory.mappings()) {
    const address = memory.pointer(mapping.base); if (address !== null) memory.unmap(address, mapping.byteLength);
  }
}

function closeFiles(files: Set<WindowsFile>): void {
  const errors: unknown[] = [];
  for (const file of [...files]) { try { file.close(); } catch (error) { errors.push(error); } }
  if (errors.length !== 0) throw new AggregateError(errors, 'Classic guest file cleanup failed');
}
