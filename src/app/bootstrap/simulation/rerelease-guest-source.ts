import type { ResolvedExecutionModule } from '../../../contracts/content.ts';
import type { GuestCallContext, ModuleIdentity } from '../../../contracts/execution.ts';
import type { MountedContent } from '../../../content/mounts/index.ts';
import { RereleaseQ2GuestHost } from '../../../compat/q2/rerelease/host.ts';
import type { RereleaseQ2HostOptions } from '../../../compat/q2/rerelease/host.ts';
import type { RereleaseCoreServices } from '../../../compat/q2/rerelease/imports.ts';
import { retailRereleaseEntries } from '../../../compat/q2/rerelease/native-entries.ts';
import { rereleaseAbi } from '../../../compat/q2/rerelease/api.ts';
import { GuestCallRunner } from '../../../guest/abi/index.ts';
import { createGuestProcessorState, GuestCallbackTable, SparseGuestMemory } from '../../../guest/core/index.ts';
import type { MappedGuestMemory } from '../../../guest/core/index.ts';
import { mapPeImage, parsePe, resolvePeExport } from '../../../guest/pe/index.ts';
import type { PeImage } from '../../../guest/pe/index.ts';
import { WindowsGuestRuntime } from '../../../guest/runtime/windows/index.ts';
import type { WindowsCapabilities } from '../../../guest/runtime/windows/contracts.ts';
import { X64Cpu } from '../../../guest/x64/index.ts';

type NativeExecution = Extract<ResolvedExecutionModule, { readonly kind: 'native' }>;
export interface PreparedRereleaseGuest { readonly edition: "rerelease"; readonly execution: NativeExecution; readonly bytes: Uint8Array; }
export async function prepareRereleaseGuest(execution: NativeExecution, mounts: MountedContent): Promise<PreparedRereleaseGuest> {
    if (execution.role !== 'server-game' || execution.api.kind !== 'q2-rerelease-game' || execution.profile.kind !== 'windows-x86-64')
        throw new Error('Rerelease guest requires the native Windows x64 game API 2023');
    const artifact = await mounts.open(execution.artifact.requestedPath);
    if (artifact === null || artifact.reference.id !== execution.artifact.id || artifact.reference.digest !== execution.artifact.digest)
        throw new Error('Selected native artifact no longer matches its resolved identity');
    if (parsePe(artifact.bytes).abi.kind !== execution.profile.kind) throw new Error('Native artifact ABI differs from the selected profile');
    return { edition: "rerelease", execution, bytes: artifact.bytes };
}
export interface RereleaseGuestSourceOptions extends Omit<RereleaseQ2HostOptions, 'runner' | 'getGameApi' | 'getCgameApi' | 'services'> {
    services(memory: MappedGuestMemory): RereleaseCoreServices;
    readonly clock: Required<Pick<WindowsCapabilities, 'nowMilliseconds' | 'performanceCounter' | 'performanceFrequency'>>;
}
/** Owns only the guest address space and ABI lifetime; supplied engine authorities own the world. */
export class RereleaseGuestSource {
    private closed = false;
    private constructor(readonly host: RereleaseQ2GuestHost, readonly runtime: WindowsGuestRuntime,
        readonly memory: SparseGuestMemory, private readonly image: PeImage, private readonly context: GuestCallContext, private readonly budget: number) {}
    static create(prepared: PreparedRereleaseGuest, options: RereleaseGuestSourceOptions): RereleaseGuestSource {
        const module: ModuleIdentity = { id: prepared.execution.owner.provider, artifactPath: prepared.execution.artifact.requestedPath,
            digest: prepared.execution.artifact.digest, revision: prepared.execution.artifact.digest };
        const memory = new SparseGuestMemory({ module, pointerBytes: 8 });
        let source: RereleaseGuestSource | null = null, host: RereleaseQ2GuestHost | null = null;
        try {
            const image = mapPeImage({ bytes: prepared.bytes, memory, base: 0x280000000n });
            const stack = memory.allocate({ byteLength: 1_048_576, alignment: 16n, label: 'native game stack' });
            const returned = memory.allocate({ byteLength: 16, permissions: 'read-execute', label: 'native game return' });
            const callbacks = new GuestCallbackTable(memory);
            const state = createGuestProcessorState({ architecture: 'x86-64', instructionPointer: 0n, stackPointer: stack.byteOffset + 1_048_576n,
                flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
            const cpu = new X64Cpu({ state, memory, isHostCall: address => callbacks.enter(address) });
            const runner = new GuestCallRunner({ cpu, callbacks, returnAddress: returned });
            const runtime = new WindowsGuestRuntime({ memory, callbacks, capabilities: options.clock }); runtime.attachRunner(runner);
            const game = resolvePeExport(image, { kind: 'name', name: 'GetGameAPI', version: null }, () => null).address;
            const cgame = resolvePeExport(image, { kind: 'name', name: 'GetCGameAPI', version: null }, () => null).address;
            const context: GuestCallContext = { module, callback: { kind: 'native-guest', module, address: game, abi: rereleaseAbi }, parent: null, self: null, other: null };
            const budget = options.instructionBudget ?? 5_000_000;
            const nativeEntries = options.foreignDamage === undefined ? undefined : retailRereleaseEntries({ memory }, image.base);
            host = new RereleaseQ2GuestHost({ ...options, ...(nativeEntries === undefined ? {} : { nativeEntries }), runner, getGameApi: game, getCgameApi: cgame, services: options.services(memory) });
            source = new RereleaseGuestSource(host, runtime, memory, image, context, budget);
            runtime.initialize(image, { context, instructionBudget: budget });
            return source;
        } catch (error) {
            try { if (source !== null) source.close(); else { host?.shutdown(); releaseMemory(memory); } }
            catch (cleanup) { throw new AggregateError([error, cleanup], 'Native guest construction and cleanup failed'); }
            throw error;
        }
    }
    init(): void {
        if (this.closed) throw new Error('Native guest source is closed');
        try { this.host.init(); }
        catch (error) {
            try { this.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Native guest initialization and cleanup failed'); }
            throw error;
        }
    }
    async initLoading(nextFrame: () => Promise<void>): Promise<void> {
        if (this.closed) throw new Error('Native guest source is closed');
        try { await this.host.initLoading(nextFrame); }
        catch (error) {
            try { this.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Native guest initialization and cleanup failed'); }
            throw error;
        }
    }
    close(): void {
        if (this.closed) return;
        if (this.host.options.runner.depth !== 0) throw new Error("Native guest shutdown requires a completed game call");
        this.closed = true;
        const errors: unknown[] = [];
        try { this.host.shutdown(); } catch (error) { errors.push(error); }
        try { this.runtime.detach(this.image, { context: this.context, instructionBudget: this.budget }); } catch (error) { errors.push(error); }
        try { releaseMemory(this.memory); } catch (error) { errors.push(error); }
        if (errors.length !== 0) throw new AggregateError(errors, 'Native guest shutdown failed');
    }
}
function releaseMemory(memory: SparseGuestMemory): void {
    for (const mapping of memory.mappings()) {
        const address = memory.pointer(mapping.base); if (address !== null) memory.unmap(address, mapping.byteLength);
    }
}
