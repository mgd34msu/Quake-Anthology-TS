# GUEST — Native guest execution layer (src/guest/**, src/compat/q2/**, src/compat/q3/**)
## Coverage
Read in full (src/guest, about 9,170 of 10,924 lines): core/{memory,contracts,callbacks,registers}; x64/{cpu,decoder,plan,integer-kernel}; x86/{cpu,decoder,arithmetic}; pe/{format,image,exports,directories,loader}; elf/{parse,index,relocate,unwind}; abi/{runner,adapter,classify,values}; runtime/windows/{runtime,kernel,crt,contracts,msvc/streams,msvc/locale}; runtime/common/{memory,format,format/arguments,format/services,format/float,format/scan}; runtime/system-v/{contracts,cxx,cxx-data,libc}; floating-point/{x87,raw-sse,contracts,index,trigonometric}.
Read in full (src/compat, about 1,800 of 10,413 lines): q2/native-mod-items (305); q2/rerelease/{deferred-damage,module,imports,messages}; q2/classic/{host,cvars,printf}; q2/classic/records lines 1-170 (whole file); q2/native-mod-entries; q2/native-mod-invocations.
Read in full, outside scope, as callers: app/bootstrap/simulation/{classic-guest-source,classic-guest-files,rerelease-guest-source}; platform/files/contained.ts lines 1-25.
Sampled: q2/native-mod-provider.ts lines 1-913 read, 914-1098 by grep only; q2/rerelease/host.ts lines 1-330 of 476; q2/rerelease/foreign-actors.ts lines 180-200 and 375-407; q2/native-input.ts lines 125-175; q2/native-combat-call.ts lines 1-52; floating-point/binary.ts lines 194-224 of 286; floating-point/sse.ts lines 200-320 of 391; runtime/system-v/stdio.ts lines 1-31 of 232.
Skipped (not read beyond grep for observers and lifetimes): runtime/system-v/{runtime,iostream,locale}; q3/native/* (235 lines, no production caller, see GUEST-017); q2/classic/{layout,combat-binding,inventory,pmove,*-profile}; q2/rerelease/{api,layouts,world-profile,weapon-behavior-profile,source-state,sounds,debug-shapes,world-text,navigation,cgame and similar}; q2/native-mod-{actors,clients,combat,armor,protection,pickups,region,deferred,weapon-stage,client-stages}; q2/native-pickups; q2/native-primary-*. About 7,200 lines of src/compat received grep only.
Not exercised: no retail frame was executed, so all MIPS figures come from synthetic loops, not from a real game frame. Experiment scripts: guest-exp/{bench,leak,real,reconcile}.ts, run from the clean checkout.
## Strengths
- No native execution path exists. `src/guest`, `src/compat/q2` and `src/compat/q3` contain no `bun:ffi`, `dlopen`, `child_process`, `Bun.spawn`, `node:fs` or `Bun.file`. DLL bytes are only ever data for a TypeScript interpreter.
- Guest memory is checked on every path. Mappings are sorted and disjoint, each backed by its own typed array, and addresses stay BigInt until a containment check passes. Host JS offsets are not derived from unchecked guest values (memory.ts:629-640, 763-796).
- The PE parser range-checks every header, directory, section and RVA, rejects overlapping sections, caps images at 256 MiB, and bounds forwarder chains and unwind chains (format.ts:37-41, loader.ts:70-71, exports.ts:15, directories.ts:140).
- Unsupported opcodes fail closed as `unsupported` or `exception` stops, with register and flag rollback. I reviewed the block executor's fault-safety classification (`x64IntegerBlockSafe`) and found no counterexample.
- The file capability is well contained: per-component `O_NOFOLLOW` directory walking through `/proc/self/fd`, and rejection of `..`, `:`, `\` and NUL (contained.ts:3-24, classic-guest-files.ts:8-22). The rerelease guest receives no file capability at all (rerelease-guest-source.ts:62).
- Observer lifetimes checked in this audit are balanced. deferred-damage: `track` is paired with `release` through `foreignActors.released`, plus `clear` in `rebindWorld` and `close` (foreign-actors.ts:196, 386-405). native-mod-items: `release` runs on client release and on `onRelease`, plus `clear`/`close` (native-mod-provider.ts:373, 408-411). I attempted and failed to construct a leak in either.
- The x87 emulation keeps real 80-bit registers, honours precision control and rounding modes, and uses exact rational rounding. The initial control word 0x37f matches Quake 2's own `Sys_SetFPCW` (my recollection of the source, not checked here) rather than the Windows default, so I withdrew my suspicion about it.
- Guest state does not depend on CPU snapshots. Saves go through the DLL's own WriteGame/WriteLevel files or JSON exports, which is robust against interpreter layout changes (rerelease/host.ts WriteGameJson path).
## Findings
### GUEST-001 — Execution model and trust boundary: emulated, but the boundary is wider than the sandbox implies
- **Verification (VERIFY-J): confirmed. Final severity: Info.** classic-guest-source.ts:53-63 and rerelease-guest-source.ts:51-62 use SparseGuestMemory with I386Cpu and X64Cpu, mapped through mapPeImage only. The referenced import grants were not re-traced here.
- Severity: Info
- Category: security
- Location: src/app/bootstrap/simulation/classic-guest-source.ts:53-63; src/app/bootstrap/simulation/rerelease-guest-source.ts:51-62
- Confidence: traced
- Evidence: `new SparseGuestMemory({ module, pointerBytes: 4 })` with `new I386Cpu({ state, memory, hostCall })` runs classic `gamex86.dll`; `SparseGuestMemory.createManaged(...)` with `new X64Cpu(...)` runs rerelease `game_x64.dll`. Only PE is reachable in production (see GUEST-017).
- Impact: A malicious DLL cannot obtain native code execution or read host memory through the interpreter. It can still reach the host through what the imports grant: console commands and all cvars (GUEST-002), file writes in the classic writable directory (GUEST-009), memory and CPU exhaustion (GUEST-006, GUEST-007), and process termination by faulting (GUEST-008). Treat mods as sandboxed against code execution, but not against server takeover or denial of service.
- Remediation: Document this boundary. Do not describe native mods as sandboxed without these qualifications.
### GUEST-002 — A guest DLL holds server-console authority and full read/write access to every cvar, including rcon_password
- **Verification (VERIFY-B): confirmed-with-changes. Final severity: Medium.** Unproven link settled, measured: on dedicated classic and rerelease startups `sourceCvars() === guest registry` is true (application.ts:561, 1762; runtime.ts:3255). With rcon_password set, the classic `cvar_t.next` walk in guest memory read `hunter2` after 91 hops; rerelease `cvar()` returned it too. Restore path not run. Needs an operator-installed hostile DLL, and source engines grant the same access.
- Severity: High
- Category: security
- Location: src/app/bootstrap/application.ts:570, 601; src/compat/q2/classic/host.ts:345-346, 389; src/compat/q2/classic/cvars.ts:48-51; src/compat/q2/rerelease/imports.ts:110, 135-137; src/core/cvars/index.ts:689-694; src/app/bootstrap/server-administration.ts:222; src/app/bootstrap/simulation/runtime.ts:3262 (`this.q2ServerRegistry = cvars`)
- Confidence: traced
- Evidence: `AddCommandString` reaches `owner.append(text, Application.nativeCommandContext(...))`, whose context is `origin: { kind: "server-console" }`. The only producer filters I found at application.ts:3985-3987 concern component `instance` producers and `map`/`gamemap`; a primary game module has no command allowlist. Classic `refresh()` copies `this.registry.snapshots()` (default `flags = 0`, no Private filter) into guest memory on every export call, so `rcon_password` is readable by walking `cvar_t.next`, provided it is in that registry. Administration cvars register on the Q2 source registry (server-administration.ts:216-233, startup-source.ts:42) and the guest receives the server registry (runtime.ts:3262), but I did not prove these are the same instance in every startup path. `cvar_forceset` calls `services.cvars.set(name, value, true)`.
- Impact: A malicious mod can read the rcon password and send it out with `gi.WriteString`, overwrite it, or issue any console command, including `quit`. This is equal to the power native Q2 DLLs historically had, but it defeats the value of the emulation boundary. The rerelease path differs only in that a DLL must request the cvar by name.
- Remediation: Withhold or blank `Q2CvarFlag.Private` cvars at the guest boundary, restrict `cvar_forceset`, and pass AddCommandString through an allowlist with a distinct `game-module` origin. Keep `map`, `gamemap` and the commands legitimate DLLs need.
### GUEST-003 — Interned guest strings grow without bound from client command text (4 KiB per distinct string, never freed)
- **Verification (VERIFY-B): confirmed-with-changes. Final severity: Medium.** Code as quoted (cvars.ts:18-24, records.ts:30-35); no delete path. Network link traced, not run: q2.ts:366-369 to `host.command`, then classic-guest-world.ts:216-222. Normal chat is negligible at about 4 KiB per line. Only a hostile peer on an opt-in native DLL server matters; I found no rate limit by grep in q2.ts but measured no attack rate.
- Severity: High
- Category: leak
- Location: src/compat/q2/rerelease/imports.ts:43, 47-55, 61-62, 108-109; src/compat/q2/classic/cvars.ts:16, 18-24, 41-42; src/compat/q2/classic/host.ts:387-388; src/guest/runtime/common/memory.ts:107-114; call sites src/app/bootstrap/simulation/classic-guest-world.ts:216-222, rerelease-guest-services.ts:119
- Confidence: reproduced (retention); traced to the client-command entry, not to the network decoder
- Evidence: `case "argv": return guestPointer(this.string(this.services.commandArguments()[number(0)] ?? ""));` and `string()` does `allocateNativeMemory(...)` then `this.#strings.set(text, address)`. No code deletes from `#strings`, and neither `rebindWorld` (rerelease/host.ts:196-204) nor classic `rebindWorld` (classic/host.ts:229-234) touches it. Reproduction with the real `RereleaseCoreImports`: 20,000 distinct commands calling `argv` and `args` gave 0 → 20,000 mappings, 81,920,000 guest bytes, +135 MB RSS. Repeating an existing string added 0. The classic path gave 5,000 mappings for 5,000 strings. Cvar values take the same path (imports.ts:61-62), so any cvar whose value changes also adds an entry.
- Impact: Each distinct `say` line or command argument read by the DLL costs at least 4 KiB of backing plus mapping objects for the life of the source, across map changes. A chatty or hostile peer on a long-running native Q2 server grows memory steadily, and growth also lengthens the O(n) mapping splice (GUEST-013).
- Remediation: Use a fixed or per-call scratch allocation for `argv`/`args` that is freed when the ClientCommand or ServerCommand returns, and bound the cvar string cache with per-record storage reuse.
### GUEST-004 — The classic i386 interpreter allocates per instruction and has no decode cache (0.67 MIPS, x87 0.20 MIPS)
- **Verification (VERIFY-P): confirmed-with-changes. Final severity: High.** RETIME-001 confirms this on retail data: 0.72 MIPS at about 83K instructions per frame, so the interpreter needs about 110 ms for a 100 ms server frame with a classic DLL on base2.
- Severity: High
- Category: performance
- Location: src/guest/x86/cpu.ts:53-60; src/guest/x86/decoder.ts:16-20, 36, 68-69, 111; src/app/bootstrap/simulation/classic-guest-source.ts:53, 63, 79
- Confidence: reproduced (synthetic loops)
- Evidence: Every loop iteration runs `registers = this.state.registers.checkpoint()` (new 64-byte array), `flags = this.state.flags.value`, `guestAddress(...)` (frozen object via `memory.pointer`), and `decoder = new X86Decoder(...)` with `bytes: number[]`, then fetches byte by byte through `fetchByte(BigInt...)`. Measured with bench.ts: i386 integer plus load and store 0.67 MIPS; i386 fld/fadd/fmul/fstp 0.20 MIPS; x64 managed equivalent 4.83 MIPS; x64 register-only 10.12 MIPS.
- Impact: Classic mods compile floats to x87, so classic game code lands near the low end. At 0.67 MIPS a 100 ms Q2 frame affords about 67,000 guest instructions. The default budget of 5,000,000 (classic-guest-source.ts:79) represents about 7.5 s of synchronous stall before it aborts. The true cost of a retail frame was not measured.
- Remediation: Port the x64 cached-plan and managed-block design to i386, reuse the checkpoint buffer, and avoid frozen address allocation in the hot path.
### GUEST-005 — x87 and SSE arithmetic run through BigInt rational soft-float on every operation
- **Verification (VERIFY-P): confirmed-with-changes. Final severity: Medium.** RETIME-002 measured retail DLLs in the real Application. The synthetic 7x ratio holds at 7.9x, but floating point takes 18.2% of the classic whole step and 7.8% of the rerelease step, and an FP instruction costs 2.3x a non-FP one in real code. A real cost, but not the main limit; GUEST-004 is.
- Severity: High
- Category: performance
- Location: src/guest/floating-point/binary.ts:194-222; src/guest/floating-point/x87.ts:35, 39, 76, 129; src/guest/x64/integer-kernel.ts:75, 235
- Confidence: reproduced (synthetic loop); cause traced
- Evidence: `arithmetic()` builds `a`/`b` with BigInt shifts and calls `roundRational(...)`; x87 reads go through `decodeBinary(readBits(...))` and writes through `writeBits(encodeBinary(...))`. Measured: x64 managed addss/mulss/movss 0.65 MIPS against 4.83 MIPS for integer load/store, about 7x slower.
- Impact: Vector math dominates Quake game code (traces, movement, AI aiming), and the rerelease default frame is 25 ms (module.ts:82). This is likely the largest single throughput limit for rerelease mods.
- Remediation: Add a fast path for binary32/binary64 with nearest rounding and masked exceptions, using `Math.fround` and doubles, falling back to the exact path for NaN, denormal or flag-sensitive cases. Benchmark it against the existing fidelity tests before adoption.
### GUEST-006 — The instruction budget does not bound wall-clock time: each host service costs one unit regardless of work
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** src/guest/abi/runner.ts:168-170 charges one budget unit per host dispatch. crt.ts:27-29 memset takes count up to 0x10000000 (common/memory.ts:17-21). No wall-clock check exists on this path. The "about an hour" figure stays an extrapolation.
- Severity: Medium
- Category: security
- Location: src/guest/abi/runner.ts:168-170; src/guest/runtime/windows/crt.ts:27-29; src/guest/runtime/common/memory.ts:17-21, 72-79
- Confidence: reproduced
- Evidence: `// Count dispatch as one step so a zero-instruction trap loop remains bounded.` then `frame.remaining - 1`. real.ts looped `memset(buf, 0, 256 MiB)` from guest code with a 600-instruction budget: `600-instruction budget with memset(256MB) took ms 1313`. At that rate (7 instructions per iteration, about 13 ms per memset) the 2,000,000 default budget (module.ts:95) is about an hour of synchronous blocking; this is an extrapolation.
- Impact: A malicious mod can freeze a server or client indefinitely while staying within budget. There is no wall-clock watchdog, and the guest runs synchronously on the main loop.
- Remediation: Charge host services proportionally to bytes or characters processed, for example one unit per 64 bytes, in addition to the dispatch cost.
### GUEST-007 — No aggregate guest memory quota; classic TagMalloc has no per-call limit
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** src/compat/q2/classic/host.ts:329-336 TagMalloc has no upper bound, while rerelease/imports.ts:138-145 and windows/runtime.ts:167-172 cap at 256 MiB. guest/core/memory.ts:200 allocates per mapping with no running total.
- Severity: Medium
- Category: robustness
- Location: src/compat/q2/classic/host.ts:329-336; src/compat/q2/rerelease/imports.ts:138-145; src/guest/runtime/windows/runtime.ts:167-172; src/guest/core/memory.ts:200
- Confidence: reproduced (acceptance of 10 GiB, without touching pages); classic per-call gap traced
- Evidence: classic: `if (!Number.isInteger(requested) || requested < 0) throw ...; const bytes = nativeAllocationBytes(requested);` accepts any uint32 up to 4 GiB, whereas rerelease and the Windows heap cap each call at 256 MiB. `SparseGuestMemory.map` does `new Uint8Array(options.byteLength)` with no running total. real.ts: 40 allocations of 256 MiB all succeeded (10 GiB of guest space; RSS stayed 338 MB because pages were untouched).
- Impact: A DLL that allocates and touches memory can get the whole process OOM-killed. On a host with about 6 GB free this takes seconds. It is a local-mod denial of service, with the guest's own bugs as an additional trigger.
- Remediation: Add a per-module byte quota inside `SparseGuestMemory.map`, raising `GuestMemoryFault` when exceeded, and apply the 256 MiB cap to classic TagMalloc.
### GUEST-008 — Guest faults and game errors terminate the host: no handler exists for GuestCallStopped or import errors
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** grep finds GuestCallStopped and GuestMemoryFault only under src/guest/. session.ts:431-445 is try/finally. The application.ts catch rethrows unless fatalWorldFailure, which guest stops do not set (setters at :2129, :3212-3213, :3455 are world-transition failures). run() has no catch.
- Severity: Medium
- Category: robustness
- Location: src/guest/abi/runner.ts:150; src/compat/q2/classic/host.ts:324; src/compat/q2/rerelease/imports.ts:100; src/world/session/session.ts:431-445; src/app/bootstrap/application.ts catch near 4685, `run()` 4693-4706
- Confidence: traced
- Evidence: A repository-wide grep finds `GuestCallStopped` and `GuestMemoryFault` referenced only under `src/guest/`. `session.stepAsync` has `try { ... } finally`. In `Application.step`, the catch does `if (!this.fatalWorldFailure) { await this.capture?.beforeWorldChange(); throw ... }`, and `run()` has no catch around `await this.step(elapsed)`. Host-side errors thrown while reading guest arguments (`GuestMemoryFault`, `RangeError`, `TypeError`) take the same route. A narrow exception is `RemovedNativeInput`/`SourceItemRetired`, which are caught deliberately.
- Impact: A DLL null dereference, `gi.error`, budget exhaustion or bad `%s` pointer during a client's ClientThink ends a dedicated server's main loop. The native original would also crash, but this layer has the information to drop only the session and report the cause. I did not run an end-to-end shutdown test.
- Remediation: Catch guest stops at the session boundary, close the failed world with a diagnostic, and let the dedicated server process survive or restart the map.
### GUEST-009 — The classic file capability has no quota and can overwrite anything in the writable game directory
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** classic-guest-files.ts:6-22 has no quota and creation 2 truncates. The config chain the finding left plausible holds: application.ts:594 root is the same expression as configurationStore (configuration.ts:336-338), and configurationScriptReader (configuration.ts:344) reads scripts from userContent.root, so a DLL can plant scripts there. It is also the user archive root. The finding's confidence should read traced.
- Severity: Medium
- Category: security
- Location: src/app/bootstrap/simulation/classic-guest-files.ts:6-22, 39-40; src/guest/runtime/windows/kernel.ts:218-223, 234-242
- Confidence: traced (no quota, overwrite); plausible (config chain, because I did not confirm what else lives under `root`)
- Evidence: `CreateFileA` passes guest paths and disposition to `classicGuestFiles`; `options.creation === 2` gives `O_CREAT | O_TRUNC`; `writeSync` has no size or file-count accounting. Containment itself is sound (see Strengths).
- Impact: A malicious classic DLL can fill the disk with repeated 256 MiB writes, and can replace any file under the directory. If an executed config or another mod's data lives there, that becomes persistent console-command execution across restarts.
- Remediation: Enforce a byte and file-count quota, and deny writes to configuration and executable-module extensions.
### GUEST-010 — Unsupported printf conversions in guest formats are fatal instead of printing, including `%` from client-derived text
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Medium.** The throw stands. The retail DLL sources show no client-derived format: baseq2, ctf, rogue and xatrix pass only fixed godmode and notarget strings (g_cmds.c:324,353,385 and siblings). The one exception is map text, original/rogue/g_newfnc.c:149 `gi.centerprintf(other, self->message)`, so a `%` in a Rogue map message hits this. The remote trigger applies to third-party DLLs only. All conversions in those sources pass the regex. Source review: SRCQ2
- Severity: Medium
- Category: robustness
- Location: src/compat/q2/classic/printf.ts:12-13; src/compat/q2/classic/host.ts:137-142, 323
- Confidence: traced (the throw); plausible (remote trigger, which depends on the mod passing client text as a format)
- Evidence: `const match = /^%([-+ #0]*)(\*|\d*)(?:\.(\*|\d*))?(?:l)?([%diuoxXcspfeEgG])/.exec(format.slice(index)); if (match === null) throw new Error("Unsupported API 3 printf conversion ...")`. `%hd`, `%I64d`, `%lld`, `%n` and a trailing `%` all throw. The throw runs inside `variadicLayouts` during import dispatch and propagates per GUEST-008.
- Impact: Older Q2 mods commonly had `gi.cprintf(ent, level, text)` format-string bugs (from memory; no specific DLL was checked). In such a mod, a player chat line or name such as `100%!` ends the server rather than printing garbage. Legitimate `%hd` or `%I64d` debug prints in a mod end the session as well.
- Remediation: Print unrecognised conversions literally, as the classic CRT effectively does, and add the `h`, `ll` and `I64` length modifiers.
### GUEST-011 — A single write observer anywhere degrades every guest store and ends the managed block
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** src/guest/x64/integer-kernel.ts:195 reads the global hasWriteObservers, then takes a register checkpoint and `if (observed || !afterStore()) break;` for every unsafe step regardless of address. memory.ts:138,171 is `#writeObservers.size !== 0`. MIPS figures not re-measured.
- Severity: Medium
- Category: performance
- Location: src/guest/x64/integer-kernel.ts:195-216; src/guest/core/memory.ts:138, 171
- Confidence: reproduced
- Evidence: `const observed = this.memory.hasWriteObservers;` then every non-safe step takes a register checkpoint and `if (observed || !afterStore()) break;`, regardless of address. Measured: x64 managed integer plus load and store 4.83 MIPS, and 3.45 MIPS with one observer on an unrelated page (29% loss). PERF1 indexed notification by page, but this global check was not addressed by that change, so this is new evidence.
- Impact: Rerelease sessions with deferred damage, items, or pickup observers run stores on the slower path throughout play.
- Remediation: Make the rollback and block-exit decision depend on whether the store actually hit a watched page, for example by having `#notifyWrite` report delivery.
### GUEST-012 — Every export call re-reads all cvars and reconciles every edict with fresh allocations
- **Verification (VERIFY-F): confirmed-with-changes. Final severity: Medium.** host.ts:168-170 and cvars.ts:48-51 run per export, and records.ts:150-158 re-runs descriptor per slot via at(). Omitted by the finding: records.ts:151 returns immediately when a projection is set, and native mods always pass one (native-mod-host.ts:145), so the classic edict cost applies only to the primary classic path. Rerelease reconcile (rerelease/host.ts:175,205-209) is unconditional.
- Severity: Medium
- Category: performance
- Location: src/compat/q2/classic/host.ts:168-170; src/compat/q2/classic/cvars.ts:48-51; src/compat/q2/classic/records.ts:81-91, 150-158; src/compat/q2/rerelease/host.ts:175, 208; src/compat/q2/rerelease/module.ts:242-246
- Confidence: reproduced (classic edict reconcile only); remainder traced
- Evidence: `this.cvars.refresh(); ... this.edicts.reconcile();` per classic export. `reconcile` calls `this.#observe(this.at(slot))`, and `at` re-runs `descriptor()` (four guest reads plus `memory.check`), `memory.offset` (frozen address) and `memory.borrow` (Uint8Array, DataView). Measured: 0.413 ms per classic reconcile at 600 edicts, excluding cvar refresh. Rerelease runs its own `reconcile()` after `runFrame`, each `clientThink`, and each engine-driven callback (`finally { this.reconcile(); }`).
- Impact: Roughly 0.4 ms times (clients' commands + frame exports) per server tick, with steady GC pressure, on top of an already constrained frame budget.
- Remediation: Compute the descriptor once per reconcile, keep cached per-slot views invalidated by base/stride change, and refresh only cvars whose modification count changed.
### GUEST-013 — Page-sized mapping per small allocation, per-character frozen addresses, and allocation on every ClientThink
- **Verification (VERIFY-I): confirmed. Final severity: Low.** guest/runtime/common/memory.ts:107-114 rounds up to 4 KiB, core/memory.ts:655 and :753 splice, rerelease/module.ts:203 allocates per clientThink, and classic/records.ts:10-18 and windows/crt.ts:39-43 compute offsets per character. core/memory.ts:295 has findZero.
- Severity: Low
- Category: performance
- Location: src/guest/runtime/common/memory.ts:107-114; src/guest/core/memory.ts:655, 753; src/compat/q2/rerelease/module.ts:203; src/compat/q2/classic/records.ts:10-18; src/guest/runtime/windows/crt.ts:39-43
- Confidence: traced
- Evidence: `Math.max(4096, Math.ceil(logicalBytes / 4096) * 4096)` means each malloc or TagMalloc owns a 4 KiB typed array plus Mapping and DataView objects, inserted with `#mappings.splice` (O(n)). `clientThink` allocates and unmaps a mapping per command. `readClassicString` and CRT `strcmp` call `memory.offset(...)`, which allocates a frozen object per character, although `findZero` exists and the rerelease reader uses it.
- Impact: Allocation-heavy mods waste memory and get O(n) allocation cost. String-comparison loops such as `G_Find` are heavier than necessary.
- Remediation: Use a guest-side bump or free-list arena inside one mapping, and use `findZero` plus a bulk copy for strings.
### GUEST-014 — The x64 decode cache clears entirely at 32,768 instructions
- **Verification (VERIFY-F): confirmed. Final severity: Low.** src/guest/x64/cpu.ts:129,237 clear the map at 32768 entries, and blocks hang off the cleared entries (first.block at :300). No session measurement exists of clear frequency or spike size, and re-decode is lazy, so Medium is not supported by evidence. Re-rate if counting shows recurring clears.
- Severity: Medium
- Category: performance
- Location: src/guest/x64/cpu.ts:129, 237
- Confidence: plausible (retail footprint not measured)
- Evidence: `if (this.#instructions.size >= 32768) this.#instructions.clear();`. `game_x64.dll` has an image size of 2,826,240 bytes (real.ts). At an assumed 3-4 bytes per instruction, the cache holds about 100-130 KiB of code.
- Impact: If a play session touches more distinct instructions than that, which is likely across AI, weapons, and spawn paths, the whole cache and every block are discarded and rebuilt periodically, producing recurring frame spikes.
- Remediation: Count cache clears in a real session first. If they occur, raise the limit or use a direct-mapped page table.
### GUEST-015 — Instruction coverage mismatches between CPUID, x64 and i386
- **Verification (VERIFY-I): confirmed. Final severity: Low.** x64/cpu.ts:662 advertises bit 8 (CX8), but no 0F C7 case exists in the extended decoder, and the :727 range excludes it. x86/cpu.ts has no 0F A2 case. x64 routes 0F 77 through #numeric, which decodes ModRM at :775, while x86/cpu.ts:461 excludes 0x77.
- Severity: Low
- Category: bug
- Location: src/guest/x64/cpu.ts:661-662, 727-731, 774; src/guest/x86/cpu.ts:378-414, 461
- Confidence: traced
- Evidence: x64 CPUID advertises CX8 (`edx = 0x06008101`, comment "CMPXCHG8B"), but `#extended` has no `0xc7` case and falls to `X64Unsupported`; i386 implements it (x86/cpu.ts:408). i386 has no CPUID (`0F A2`) case, whereas x64 does. x64 `#numeric` decodes a ModRM for `0F 77` (EMMS) and so consumes the next instruction's byte, while i386 explicitly excludes 0x77 (x86/cpu.ts:461).
- Impact: Failures are fail-closed, except that the EMMS case desynchronises decoding. Reach is limited: x64 MSVC output rarely uses them, and my linear byte scan found no `0F A2` in the three retail gamex86.dll files. Third-party mods could hit them.
- Remediation: Clear the CX8 bit or implement `0F C7` on x64, add CPUID to i386, and skip ModRM for EMMS.
### GUEST-016 — x87 transcendental and remainder instructions are unsupported although retail DLLs appear to contain them
- **Verification (VERIFY-F): confirmed-with-changes. Final severity: Medium.** x87.ts:270-305 falls through to throw for d9 f0, f2, f5, f8, fd. objdump of baseq2, ctf, rogue and xatrix gamex86.dll decodes only f2xm1, fptan, fprem1 and fscale; the byte-scan hits for fyl2x, fxtract, fprem and fsincos do not decode (false positives). fptan at baseq2 0x2001667f is inline game code, not CRT, so it does not need a `tan` CRT call. Builtin products do not run the DLL (content.ts selectedQ2GameLibrary); turret_driver appears in jail1 and strike.
- Severity: Medium
- Category: bug
- Location: src/guest/floating-point/x87.ts:305; missing `D9 EC, ED, F0, F1, F2, F4, F5, F8, F9, FB, FD`
- Confidence: plausible (linear byte matches, not decoded, may include false positives)
- Evidence: `throw new UnsupportedX87(...)` after the implemented D9 cases. A byte scan of `.text`: baseq2 f2xm1 1, fyl2x 1, fptan 1, fprem1 2, fscale 4; ctf f2xm1 1, fprem1 2, fscale 5, fxtract 1; rogue f2xm1 1, fptan 1, fprem 1, fprem1 2, fscale 3, fsincos 1. These DLLs statically link their CRT (KERNEL32 is their only import), so `pow`, `tan` and `fmod` would be guest code using these instructions.
- Impact: The first mod call into `pow`, `tan` or `fmod` stops with `unsupported` and becomes fatal per GUEST-008.
- Remediation: Implement these opcodes using the existing exact-arithmetic helpers, and first confirm reachability with a decoded scan of the CRT routines.
### GUEST-017 — ELF loader, System V runtime and q3 native are unreachable from production, and the ELF loader lacks an image cap
- **Verification (VERIFY-J): confirmed-with-changes. Final severity: Low.** Unreachable from production, but "grep returns nothing" is slightly wrong: src/guest/runtime/common/format/services.ts:6 has a type-only import of system-v/contracts.ts. No runtime importer exists. elf/index.ts:104-105 zero-fill is uncapped, parse.ts:369-391 re-walks chains per bucket, and SparseGuestMemory.restore/GuestCallbackTable.restore have no src caller.
- Severity: Low
- Category: dead-code
- Location: src/guest/elf/* (976 lines); src/guest/runtime/system-v/* (about 1,280 lines); src/compat/q3/native/* (235 lines); src/guest/elf/index.ts:14-30, 90-105; src/guest/core/memory.ts:604, src/guest/core/callbacks.ts:137
- Confidence: traced
- Evidence: A grep of `src` for imports of `guest/elf`, `runtime/system-v` and `compat/q3/native` outside those directories returns nothing; only tests use them. `ElfLoadOptions` has no `maximumImageBytes`, unlike `mapPeImage`, and `memory.write(..., new Uint8Array(segment.memorySize - segment.fileSize))` would allocate and touch attacker-sized memory. `gnuSymbolCount` re-walks chains per bucket, which is quadratic on crafted input. `SparseGuestMemory.restore` and `GuestCallbackTable.restore` also have no `src` caller outside their own files.
- Impact: About 2,490 lines carry maintenance cost and imply capabilities the product does not ship. The uncapped loader matters only if the code is revived.
- Remediation: Delete it or mark it as an unwired experiment. If it is wired up, add the PE-style image cap first.
### GUEST-018 — Guest stops leave processor state unrestored, and shutdown then runs on the faulted stack
- **Verification (VERIFY-J): confirmed. Final severity: Low.** runner.ts:125-134 restores only on success and `finally` only pops #active; depth-0 `saved` is null (:113). classic-guest-source.ts:131-132 and rerelease-guest-source.ts:104-105 then call shutdown and detach from that state, collecting errors.
- Severity: Low
- Category: robustness
- Location: src/guest/abi/runner.ts:125-134; src/app/bootstrap/simulation/classic-guest-source.ts:131-132; src/app/bootstrap/simulation/rerelease-guest-source.ts:104-105
- Confidence: reproduced
- Evidence: Registers are restored only on the success path, and `finally` only pops `#active`. real.ts: rsp `0x110000` before, `0x10ffb0` after a stop, and a further 0x80 lost by a second stopped call on the same runner. `close()` then calls guest `Shutdown` and DLL detach from that state.
- Impact: After a stack overflow, `Shutdown` cannot enter and an error is collected (handled by `errors.push`). After other faults, shutdown code runs on inconsistent game state. Any future non-fatal fault policy would slowly exhaust the guest stack.
- Remediation: Capture entry state at depth 0 too, and restore it in a helper that the session calls after reporting the fault.
### GUEST-019 — x86 load-configuration validation likely rejects valid SafeSEH DLLs
- **Verification (VERIFY-J): confirmed. Final severity: Medium.** directories.ts:182 throws when the structure's Size exceeds the directory size, and loader.ts:88 has no guard. The PE spec requires directory size 64 on x86 for XP compatibility while the SafeSEH-era structure Size is larger, so such DLLs are rejected by trace. No sample was run; raised because third-party x86 mods are a supported input, though it fails closed.
- Severity: Low
- Category: bug
- Location: src/guest/pe/directories.ts:182, `if (size < 4 || size > table.byteLength) throw new PeError("load-config", ...)` in `readLoadConfiguration`
- Confidence: plausible (toolchain behaviour from memory; no affected sample was available, as the three retail x86 DLLs have no load config)
- Evidence: To my recollection, MSVC linkers of the VS2005-2013 era often record a directory size of 64 while the structure's own `Size` field is larger, for Windows XP compatibility. This check would then reject the image with a PeError.
- Impact: Third-party classic mods built with those toolchains would fail to load, with a clear error. Fail-closed.
- Remediation: Validate against the image bounds using the structure's `Size`, and test against one such DLL before changing it.
### GUEST-020 — CRT math and qsort approximate rather than match UCRT results
- **Verification (VERIFY-J): confirmed. Final severity: Low.** crt.ts:123-125 uses Math.fround over double Math functions for acosf, sinf, cosf, tanf and atan2f. crt.ts:98-118 qsort is a heap sort, so tie order differs from a quicksort. Actual divergence from UCRT vectors is still unmeasured.
- Severity: Low
- Category: bug
- Location: src/guest/runtime/windows/crt.ts:98-118, 123-125
- Confidence: plausible (no differential comparison was run)
- Evidence: `sinf`, `cosf`, `tanf`, `acosf` and `atan2f` compute `Math.fround(fn(value))` through JS doubles. `qsort` is a heap sort, and MSVC's is a quicksort variant, so equal-key ordering differs.
- Impact: Small numeric differences and tie-order differences from native rerelease behaviour, which can matter for replay comparison against original traces. Results are stable for a given host JS engine.
- Remediation: Document the accepted divergence, or compare against captured UCRT vectors for the functions that gameplay uses.
### GUEST-021 — Duplicated execution paths and very dense files raise the risk of divergent CPU behaviour
- **Verification (VERIFY-J): confirmed. Final severity: Low.** cpu.ts:83-162 and :164-269 share the same decode/step structure, with #runManaged adding the executeBlock path. native-mod-provider.ts:75-260 is one function and 1098 lines total; kernel.ts has 38 of 301 lines over 200 columns.
- Severity: Low
- Category: maintainability
- Location: src/guest/x64/cpu.ts:83-162 and 164-269; src/guest/x64/plan.ts:56-181 and src/guest/x64/integer-kernel.ts:181-397; src/guest/runtime/windows/kernel.ts (301 lines, many over 200 columns); src/compat/q2/native-mod-provider.ts:75-260, 1098 lines total
- Confidence: traced
- Evidence: `#runGeneric` and `#runManaged` are near copies of one another. Each instruction's semantics exist up to three times (plan, `execute`, and `executeBlock`). `validateNativeModDeclaration` is a single 185-line function.
- Impact: A semantic fix applied to one path can silently miss another, and differences appear only under managed or observed states. Review cost is high in the code most sensitive to correctness.
- Remediation: Drive a differential test that runs the same instruction streams through generic, managed and block modes, then consolidate where performance allows.
