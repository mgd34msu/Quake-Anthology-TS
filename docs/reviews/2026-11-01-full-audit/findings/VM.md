# VM — QVM interpreter, QuakeC machine, mod hosts and syscall surface

## Coverage
Experiments: scripts in `<scratchpad>/vm-audit/` (`qvm-exp.ts`, `qc-exp.ts`, `qc-exp2.ts`), run against `<scratchpad>/clean` at HEAD.

Read in full (compat/qvm): interpreter.ts 1161, mod-provider.ts 1376, image.ts 222, module.ts 302, memory.ts 115, memory-writes.ts 131, regions.ts 139, operations.ts 110, syscalls.ts 78, symbols.ts 179, registry.ts 145, artifacts.ts 59, file-syscalls.ts 270, common-syscalls.ts 90, memory-syscalls.ts 49, math-syscalls.ts 31, vector-syscalls.ts 83, snap-vector-syscalls.ts 38, cvar-syscalls.ts 96, server-game-syscalls.ts 110, server-info-syscalls.ts 38, client-game-syscalls.ts 46, bot-library-syscalls.ts 199, bot-navigation-syscalls.ts 226, legacy-bot-syscalls.ts 56, client-script-syscalls.ts 158, client-render-syscalls.ts 149, client-state-syscalls.ts 59, client-collision-syscalls.ts 87, client-browser-syscalls.ts 107, client-mark-syscalls.ts 52, client-audio-syscalls.ts 74, client-cinematic-syscalls.ts 38, ui-key-syscalls.ts 42, entity-tokens.ts 44, game-data.ts 169, game.ts 58, cgame.ts 82, ui.ts 71, guest-memory.ts 46, mod-actor-frame.ts 90, mod-clients.ts 183, mod-actors.ts 329, mod-input.ts 191, mod-objectives.ts 29, mod-player-events.ts 136, mod-protection.ts 230, mod-pickups.ts 130.

Read in full (compat/qc): machine.ts 516, mod-provider.ts 967, program.ts 168, memory.ts 172, executor.ts 110, save.ts 113, builtins.ts 174, mod-actors.ts 132, source-call.ts 62, mod-environment.ts 60, mod-messages.ts 146, presentation-host.ts 477, mod-input.ts 92, mod-clients.ts 129, mod-objectives.ts 27, profile.ts 41, entity-host.ts 62, spatial-host.ts 109, world-host.ts 92, message-routing.ts 16, message-effects.ts 31, client-host.ts 75.

Sampled (partial read or targeted grep): compat/qvm mod-presentation.ts (lines 1-120 of 532), render-record.ts (60-102 of 102), game-combat-binding.ts, game-combat-scope.ts, game-combat.ts, game-weapons.ts, game-pickups.ts, game-input.ts, game-equipment-movement.ts, mod-items.ts (grep for growth and scratch use only); compat/qc mod-items.ts, mod-protection.ts, mod-pickups.ts (grep only); content/q1/quakec/* 2205 lines (grep only).

Skipped (not opened, about 5,000 lines): compat/qvm abi.ts 846, entity-record, player-record, shared-entity-record, client-state-record, bot-navigation-records, script-record, trace-record, legacy-bot-abi, legacy-presentation, legacy-client-abi, primary-*-profile, grapple-*, item-*, weapon-behavior-profile, game-inventory, mod-weapon-stage, mod-presentation-checkpoint, cgame-body, body-scope, compatibility, client-state, allocation, index; compat/qc movement-host, pusher-host, quakeworld-presentation, mod-combat, borrowed-actors, actor-state, compatibility, weapon-behavior-profile, mod-commands, mod-pickups body, index.

Outside scope, opened only to trace reachability: application.ts step/run, main.ts, quakec-source.ts, quakec-weapon-behavior.ts, network-qw.ts, qw-server.ts, q3-client/qvm.ts, client-download-policy.ts, writable.ts, contained.ts, source-slots.ts.

## Strengths
- QVM memory safety holds by construction. LOAD/STORE mask to `dataMask`, every other access goes through `range()`, `targetPC()` or `codeWord()`, and bad PCs, stacks and pointers throw. I found no out-of-bounds path into host memory.
- `parseQvm` validates section bounds, code/data overlap, opcode set, branch targets and the code-size cap before allocating.
- Compiled semantics keep return addresses on a host-side array (`returns`), so guest stack writes cannot redirect control flow.
- Syscall arguments go through `QvmMemory.span/view/readString/writeString`, with one mask on the base and full bounds checks. Every handler I read uses them or an equivalent check.
- The interpreter is fast once warm: 52.5 M ops/s on an arithmetic loop, 35 M ops/s with guest calls, about 1.4 µs per syscall round trip (reproduced). The generator design does not cripple it, and the QC machine reached 54 M statements/s.
- QC has a per-call statement budget, a 32-frame limit, a local-stack limit and checked word, entity and pointer access. Branch, Not*, NeS and stack-depth semantics match pr_exec.c on inspection.
- Checkpoints: QVM restore preflights through `hostImage`/`validateQvmModCheckpoint` before mutating. File and script handles are capped at 63 slots and closed with the owner.
- Mod file writes are sandboxed under `.mods/<product>/<id>` (`world/session/mod-files.ts:17`). `contained.ts` rejects traversal and anchors on directory descriptors with O_NOFOLLOW.
- Q3 `cl_allowDownload` defaults to 0 (`client-download-policy.ts:21`), so unknown QVMs are not auto-fetched by default.

## Findings

### VM-001 — QC mods burn a new edict for every foreign actor and die at 8192
- **Verification (VERIFY-B): confirmed-with-changes. Final severity: Medium.** Re-ran churn: threw at 8,191 foreign actors (mod-provider.ts:592-595, memory.ts:47). Real rate of 11.2 actors/s on q3dm1 gives about 12 min if a mod projects them. Applies only to opt-in `--mod` QC components (quakec-mod.ts:7), not the primary QuakeC source.
- Severity: High
- Category: leak
- Location: src/compat/qc/mod-provider.ts:592-595, :609, :630; src/compat/qc/memory.ts:46-49; src/world/actors/source-slots.ts:71-79
- Confidence: reproduced
- Evidence: `reference()` allocates `slot = clientSlot ?? this.machine.entities.count` and then calls `setCount(slot + 1)`. Release (`:609`) only does `this.projections.delete(actor); this.actorsBySlot.delete(slot); ...bytes.fill(0)`, so the slot is never reused. `SourceActorSlots.allocate` also cannot reclaim it, because it reuses only slots whose prefix `free` flag is set, and foreign slots never set that flag. `prepareEntities()` (`:630`) projects every live session actor on each `find`, `nextent`, `findradius` and `aim`, so a QC mod that merely calls `find()` consumes a slot for each projectile or gib any other provider creates. `qc-exp.ts churn` allocated, invoked and released foreign actors: count grew 1:1, then `threw after 8191 foreign actors (count=8192): RangeError: Invalid QC entity count`.
- Impact: A QC component running alongside another game's actors fails after about 8K actor creations on one map. That is a plausible count on a long deathmatch map. The fault reaches `Application.step` and exits the process (VM-004). `advance`, `find`, `nextent` and `findradius` also slow down over the session because they scan to the high-water `count`. The primary QuakeC source (`quakec-source.ts`) does not use this path.
- Remediation: Keep a free list of retired foreign projection slots, or mark them free in the edict prefix so allocation reuses them after the cooldown.

### VM-002 — Reading a field of a removed edict throws in QC mods, unlike id's engine
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Medium.** WQ pr_exec.c:571-582 reads without a free check. Correction: fields are not "cleared". ED_Free (pr_edict.c:122-139) zeroes only model, takedamage, modelindex, colormap, skin, frame, origin, angles and solid, and sets nextthink to -1. `health`, `absmin` and others keep their last values, so the remediation's "return zeroed words" would also differ from id: `self.enemy.health` on a freed edict returns the old health. Source review: SRCQ1
- Severity: High
- Category: bug
- Location: src/compat/qc/mod-provider.ts:367-369, :580-581, :556, :609; src/compat/qc/machine.ts:426-430
- Confidence: reproduced
- Evidence: Every `LoadF`/`LoadV` calls `validateEntityAccess`, which calls `this.actor(reference)`: `if (actor === undefined || !this.services.actors.isLive(actor)) throw new Error("Gameplay mod references an absent or expired actor projection")`. Releasing an actor deletes `actorsBySlot[slot]`. `qc-exp.ts stale` stored an entity in a global, released the actor, then ran `LOAD_F kept.health`: `stale read threw: Error: Gameplay mod references an absent or expired actor projection`. In pr_exec.c this read succeeds and returns the free edict's cleared fields. QuakeC commonly keeps stale references in `.enemy`, `.owner`, `.goalentity` and similar fields and reads them later.
- Impact: Ordinary mod code such as `if (self.enemy.health <= 0)` after the enemy was removed becomes a runtime error that terminates the process (VM-004). Applies to `QcModProvider`, not the primary source.
- Remediation: For reads of a slot within `count` with no live actor, skip the actor lookup and return the edict's zeroed words. Keep the strict check for writes.

### VM-003 — QVM has no instruction budget: bytecode can hang the process or grow memory without bound
- **Verification (VERIFY-B): confirmed-with-changes. Final severity: Medium.** Re-ran hang: killed by timeout, rc 124. Only budget is the counter evaluation (interpreter.ts:915, 508). Needs a faulty or hostile server/mod QVM; client delivery is off by default (`cl_allowDownload 0`), and the finding itself notes original Q3 had no budget either. `grow` was not rerun.
- Severity: High
- Category: robustness
- Location: src/compat/qvm/interpreter.ts:913-1151 (loop), :915 (the only budget, counter evaluations only), :893 and :1019 (`returns` growth)
- Confidence: reproduced
- Evidence: `grep runaway|budget` finds a limit only in `evaluateCounter` (`remaining: 100000`). `qvm-exp.ts hang` (`ENTER 64; CONST 1; JUMP`) never returned and was killed by `timeout` (rc=124). The loop is synchronous, so the event loop, network and watchdogs all stop. `qvm-exp.ts grow` (`ENTER 0; CONST 0; CALL`, self-call with no stack descent, so the stack check never fires) reached 1.24 GB RSS in 3.5 s through `returns?.push(sp, returnPC)`, heading for OOM.
- Impact: A faulty or malicious mod hangs or OOMs a dedicated server. A client with `cl_allowDownload 1` can be hung by a server-supplied `vm/cgame.qvm`. The QC machine has the equivalent protection (`machine.ts:377`), so the two VMs are inconsistent. Original Q3 also lacked this, but the brief treats this bytecode as untrusted.
- Remediation: Add a per-root-invocation instruction budget, checked on backward jumps and calls, and cap `returns` depth (for example 64K frames). Raise a VM fault when either limit is hit.

### VM-004 — Any VM fault terminates the process; `Com_Error(ERR_DROP)` semantics are not implemented
- **Verification (VERIFY-Q): confirmed. Final severity: High.** `CG_ERROR` and `G_ERROR` are ERR_DROP (`client/cl_cgame.c:422-423`, `server/sv_game.c:322-323`). Source review: SRCQ3
- Severity: High
- Category: robustness
- Location: src/core/common-error.ts:4-10; src/compat/qvm/common-syscalls.ts:49-50; src/compat/qc/builtins.ts:112; src/app/bootstrap/application.ts:4685-4688, :4723-4730; src/main.ts:89-94
- Confidence: traced
- Evidence: The QVM code throws `CommonError("drop", ...)` for `trap_Error`, block-copy range and bad handles, and plain `Error`/`RangeError` for bad pointers, unterminated strings, division by zero and unbound syscalls. Grepping `src/app/bootstrap`, `src/network/q3` and `src/core` for code that reads a CommonError's `.code` (drop/fatal/disconnect) found none; `spawn.ts:217` and `weapons.ts:990` only rethrow. `Application.step` catches, then either rethrows or calls `closeFailedWorld`, which rethrows; `run()` has no guard, and `main()` writes a crash log and returns 1. The QW per-peer path (`qw-server.ts:277`) is the kind of narrow guard that exists elsewhere.
- Impact: `trap_Error`, QC `error()`/`objerror()`, or a single guest bug takes down a dedicated server and every connected client, where id's engines drop to the console or restart the map. Every other VM finding here is worse because of this. A guest can also raise `"fatal"` directly (`memory.ts:13`, negative `size` to `Q_strncpyz`), though no code distinguishes it today.
- Remediation: Catch guest faults at the VM boundary (provider invoke or game frame), retire the guest, and return to a map-ended or disconnected state. Honor `CommonError.code` and reserve process exit for engine invariants.

### VM-005 — Primary and client QVMs can write any file under the product user root, including packages and configs
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Medium.** `FS_CheckFilenameIsMutable` is absent from id's tree, so id has this exposure too. The port matches id here; the finding is a hardening gap, not a divergence. Source review: SRCQ3
- Severity: Medium
- Category: security
- Location: src/compat/qvm/file-syscalls.ts:108-113; src/app/bootstrap/q3-client/qvm.ts:135; src/app/bootstrap/application.ts:619; src/platform/files/contained.ts; src/compat/qvm/cvar-syscalls.ts:40; src/compat/qvm/common-syscalls.ts:64
- Confidence: traced
- Evidence: `openWrite` passes the guest path to `UserFileStore.open`, and the only filter is `containedFileParts` (traversal). There is no extension policy; ioquake3's `FS_CheckFilenameIsMutable` blocks `.qvm`, `.pk3` and shared libraries for this reason. The root is `userContent.root`, which is also the download root and the source of `userContent.archives` (`content.ts:71`, `catalog/index.ts:45`), so a written pk3 is discovered on the next start. Guests can also force any cvar (`cvars.set(name, value, true)`) and run arbitrary console text. `read` blocks `q3key`, but `openWrite` does not.
- Impact: With `cl_allowDownload 1`, a server-supplied cgame or UI can persist across sessions by dropping a pk3, `vm/*.qvm` or a config, overwrite `q3key`, and change protected settings. It is not native RCE, but it escapes the session. The mod path is already sandboxed (`.mods/`), so the gap is only the primary and client paths.
- Remediation: Refuse guest writes to `.pk3`, `.qvm`, `q3key` and config names, or point guest writes at a sandbox subdirectory as mods do. Add a protected flag for sensitive cvars.

### VM-006 — Stock Q3 UI `$modlist` request rejects instead of returning a list
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: High.** Reach is wider than the finding says. `FS_GetFileList` handles `$modlist` (`qcommon/files.c:2014-2015`). Stock q3_ui calls it from the Mods menu (`q3_ui/ui_mods.c:167`), and also from `UI_TeamArenaExists` (`q3_ui/ui_menu.c:238-246`), which `UI_MainMenu` (:269) calls at :368. Retail `pak8.pk3 vm/ui.qvm` contains the string. The port throws at `compat/qvm/file-syscalls.ts:211`, so activating the stock main menu rejects, not only opening Mods. I did not trace whether the port's startup ever activates `UIMENU_MAIN` on a QVM UI; `compat/qvm/ui.ts:11` maps it. Source review: SRCQ3
- Severity: Medium
- Category: bug
- Location: src/compat/qvm/file-syscalls.ts:211; src/app/bootstrap/q3-client/qvm.ts:169, :325
- Confidence: traced
- Evidence: `if (path.toLowerCase() === "$modlist") throw new Error("QVM $modlist requires an installed-mod catalog owner")`. `grep -F '$modlist'` finds no intercept in `q3-client`; the only other hit is a test asserting the rejection (`tests/compat/qvm/client-file.test.ts:134`). Stock q3_ui's Mods menu calls `trap_FS_GetFileList("$modlist", ...)`, per my knowledge of the id source (not in this repo). The rejection propagates through the awaited `ui.keyEvent`. I did not run this end to end with a retail UI QVM.
- Impact: Opening Mods in the original UI faults the QVM, and likely the process (VM-004).
- Remediation: Return count 0 until a catalog owner exists, or wire the installed-mod catalog into this trap.

### VM-007 — QC `RETURN` of the last global word faults on legal programs
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** WQ pr_exec.c:639-642 copies a, a+1 and a+2 with no bound. Source review: SRCQ1
- Severity: Medium
- Category: bug
- Location: src/compat/qc/machine.ts:486-488; src/compat/qc/memory.ts:15-17, :25-28
- Confidence: reproduced
- Evidence: `g.copyWords(g, a, 1, 3)` always copies three words with bounds checks. id's OP_RETURN copies `a`, `a+1` and `a+2` unconditionally from memory that continues past the table. qcc can place a scalar operand in the final global, such as the last function's local. `qc-exp.ts return-last` (Return with a = numGlobals-1): `threw: QcProgramError: progs.dat: word 30 outside 30-word storage`.
- Impact: A valid progs whose final def is a returned scalar fails only when that function returns.
- Remediation: Treat words past the end as zero for the RETURN copy, or pad the globals allocation by two words at load.

### VM-008 — QVM shift counts outside 0..31 throw, though the module runs compiled semantics
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** The JIT emits `shl`, `sar`, `shr` by `cl`, which x86 hardware masks to 5 bits (`qcommon/vm_x86.c:948-961`). The interpreter uses plain C shifts (`qcommon/vm_interpreted.c:830-840`). Source review: SRCQ3
- Severity: Medium
- Category: bug
- Location: src/compat/qvm/operations.ts:45-48, :72-74; src/compat/qvm/module.ts:84
- Confidence: reproduced
- Evidence: `if (word < 0 || word > 31) throw new RangeError("QVM shift count outside 0..31")`. `QvmModule` selects `"compiled"`, and the x86 JIT's `shl/sar/shr cl` masks the count to 5 bits (from my knowledge of vm_x86, not checked in this repo). The C interpreter on x86 behaves the same in practice. `qvm-exp.ts shift` (`1 << 32`): `threw RangeError: QVM shift count outside 0..31`.
- Impact: A mod with an out-of-range variable shift, such as `1 << (n - 1)` with n = 0, works on real Q3 and terminates the process here (VM-004).
- Remediation: JavaScript's `<<`, `>>` and `>>>` already mask to 5 bits, so remove the check.

### VM-009 — QC engine strings freeze their capacity on first use, so a later longer value throws
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** Re-ran qc-exp.ts engine-string: throw reproduced. memory.ts:125-137 fixes capacity at creation, while mod-provider.ts:642 passes a growing one. The finding's refutation holds: setinfo and signon spawn (network-qw.ts:211, qw-server.ts:254,277) fail only that peer. A 32+ character name is therefore dropped at spawn too, via quakec-source.ts:754.
- Severity: Medium
- Category: bug
- Location: src/compat/qc/memory.ts:125-137, :112; src/compat/qc/mod-provider.ts:642, :337; src/app/bootstrap/simulation/quakec-source.ts:660, :754; src/app/bootstrap/simulation/network-qw.ts:225-228
- Confidence: reproduced (string layer); traced (callers)
- Evidence: `setEngine` uses the caller's `capacity` only when creating an entry, then `encode` throws `"engine string exceeds its buffer"`. `mod-provider.ts:642` passes `Math.max(128, value.length + 1)` as if capacity could grow. `qc-exp.ts engine-string` (first value "short", then 200 chars with capacity 201): `threw: QcProgramError: engine string exceeds its buffer`. A peer controls the value through `setinfo`. In a mod with a `userinfo` binding the throw occurs during a QC field read inside the simulation step, so a remote client can reach VM-004. Only a test fixture uses that binding today (`tests/compat/qc/mod-clients.test.ts`). In the primary QW source, `setEngine("qw-name:n", name, 32)` does not truncate. QW's server truncates names to 31 characters, while here `setinfo name <32+ chars>` is caught by `qw-server.ts:277` and fails that peer's command. Refuted as a process crash on that path. `engines` also has a linear `findIndex`, and `mod-infokey:${reference}:${key}` entries are permanent, reaching the MAX_PRSTR throw at 1023 distinct pairs.
- Impact: Remote-triggered process exit for mods with `userinfo` bindings. QW players with long names are failed instead of truncated.
- Remediation: Reallocate an entry when the value outgrows it (aliases are per-frame, as with `pr_string_temp`) or truncate as id does. Truncate `qw-name` to 31.

### VM-010 — QC weapon behavior leaks string arena on every projectile launch and think
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** src/app/bootstrap/simulation/quakec-weapon-behavior.ts:119 allocates two strings per target, reached from :132 and :163. src/compat/qc/memory.ts:120-124 is append-only and :99-110 doubles the arena. Machine lifetime across worlds remains unconfirmed, as the finding states.
- Severity: Medium
- Category: leak
- Location: src/app/bootstrap/simulation/quakec-weapon-behavior.ts:119, :132, :163; src/compat/qc/memory.ts:99-110, :120-124
- Confidence: traced
- Evidence: `refreshTargets` runs per launch (`:132`) and per projectile think (`:163`), and for each target calls `strings.allocate(target.classname)` and `strings.allocate(target.name)`. `allocate` is append-only with no free or dedupe path; `reserve` doubles the arena and the only limit is the 2^31 throw. Retention scales with launches and thinks times targets, for the machine's lifetime. The snapshot serializes all `used` bytes.
- Impact: Roughly 30 bytes per target per refresh. Arena and save size grow on long-running maps with busy projectiles (for example 8 targets at 100 refreshes/s is about 86 MB/hour). The growth is bounded by map change, assuming the source is rebuilt per world (I did not confirm its lifetime).
- Remediation: Use a stable `setEngine` key per slot, or cache offsets per string value.

### VM-011 — QvmModProvider resynchronizes every projected actor on every engine syscall
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** src/compat/qvm/mod-provider.ts:1298 flush and publish, and the refresh closure before the return at :1314-1316 rewrites and re-observes per syscall. :1250 actorAt spreads projections. mod-player-events.ts:88-92 fully decodes playerState per tracked client. Not measured.
- Severity: Medium
- Category: performance
- Location: src/compat/qvm/mod-provider.ts:1298, :1314, :757-788, :792, :1250, :1285, :1291; src/compat/qvm/mod-player-events.ts:88-92
- Confidence: traced (not measured end to end)
- Evidence: `syscall()` runs `this.flush(); this.playerEvents?.publish();` before dispatch, then `refresh()`, which rewrites all shared fields for all projections, then `frame.observations = this.observe()`, a nested loop over projections, records and fields where each field allocates `bytes.slice(...)`. `publish()` fully decodes `playerState` for each tracked client. `actorAt` is `[...this.projections].find(...)`, which copies the map on every trace and point-contents call. Only the intrinsics (memset, math) bypass this.
- Impact: Cost is roughly syscalls × actors × fields, with allocation throughout. With 64-1024 projections and hundreds of traps per frame, this dominates mod frame time and generates GC pressure.
- Remediation: Use the existing write observers or dirty tracking instead of full rescans, add a `slot → actor` array for `actorAt`, and skip `publish` when the sequence word is unchanged.

### VM-012 — QC message buffers run through throwing decoders; unsupported effects are fatal and the buffer stays stuck
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Medium.** PF_WriteByte forwards verbatim (WQ pr_cmds.c:1539-1542), so split messages are legal. Correction: "client-side no-op" is wrong for the stock engine; an unknown TE hits `Sys_Error("CL_ParseTEnt: bad type")` (WQ cl_tent.c:291). The fatal-on-server behavior and the stuck buffer are still port faults. Source review: SRCQ1
- Severity: Medium
- Category: robustness
- Location: src/compat/qc/presentation-host.ts:392, :405, :429-437, :442-455; src/compat/qc/message-effects.ts:11, :28; src/compat/qc/mod-provider.ts:807
- Confidence: traced
- Evidence: id forwards `WriteByte` bytes verbatim. Here `flush()` decodes them at the end of each depth-1 invocation. Unknown `TE_*` values throw (`Unsupported QC point effect`, `Unsupported QC beam`), as do truncated messages. `this.routeBuffer(...)` runs before `this.routedBuffers.delete(key)`, so a throw leaves the bad buffer in place to throw again on the next invocation. Flushing per top-level callback, rather than per frame, also makes a message built across two callbacks look truncated.
- Impact: Mods using extended TE types or splitting message writes across callbacks hit fatal errors (VM-004) instead of a client-side no-op.
- Remediation: Delete the buffer before routing, and log and drop unsupported or partial messages. Flush at frame end.

### VM-013 — Both mod-provider.ts files are dense god classes with very long constructors
- **Verification (VERIFY-F): confirmed. Final severity: Low.** Re-counted lines over 160 columns: 117/301, 64/286, 15/237, 11/274, all exact. hostImage (qvm/mod-provider.ts:232) and the inline restore (:390+) decode the checkpoint separately. Constructors at qvm :337 and qc :237. No behavioral defect is shown here and the linked bugs are reported separately, so Low.
- Severity: Medium
- Category: maintainability
- Location: src/compat/qvm/mod-provider.ts:337-553, :83-230, :375-441; src/compat/qc/mod-provider.ts:237-559, :66-201; src/compat/qvm/interpreter.ts:733-862, :864-1160
- Confidence: traced
- Evidence: Lines over 160 columns: qvm/mod-provider 117 (max 301), qc/mod-provider 64 (max 286), interpreter 15 (max 237), machine 11 (max 274). The QC constructor is about 320 lines and wires 14 subsystems through inline closures. The QVM constructor is about 215 lines, with the host-state restore inline. `hostImage` (`:232-274`) and the inline restore (`:390-440`) decode the same checkpoint twice with separate schemas. `validateQvmMod` and `validateQcMod` repeat pickup, callback and client validation in parallel, with subtle differences. Interpreter `execute` is a 300-line generator mixing counter evaluation, regions, branches and debug handling inside the hot loop.
- Impact: Lifetime bugs such as VM-001 and VM-002 are hard to see, because allocation, release and access checks sit far apart inside closures. Save-format drift between the two restore paths is an ongoing risk.
- Remediation: Extract projection tables, checkpoint codecs and engine syscall handlers into separate modules, using one reader for validation and restore. Share validation between QC and QVM where semantics match.

### VM-014 — QVM write observers are scanned linearly on every guest store
- **Verification (VERIFY-J): confirmed. Final severity: Low.** memory-writes.ts:37-49 loops all watches and ranges on each store. mod-player-events.ts:72 and mod-provider.ts:721-723 add watches, and interpreter.ts:542 routes through the observed view. Figures not re-run; 64 watches is above normal client counts, so 25% at 8 is the realistic end.
- Severity: Low
- Category: performance
- Location: src/compat/qvm/memory-writes.ts:37-49; src/compat/qvm/interpreter.ts:542, :1069, :1077; src/compat/qvm/mod-player-events.ts:72; src/compat/qvm/mod-provider.ts:721-723
- Confidence: reproduced
- Evidence: Any active watch routes all stores through `QvmWritableView`, then `before()` loops over all watches and ranges. Measured on the arithmetic loop: 52.5 M ops/s with none, 45.4 with 1, 39.1 with 8, 21.3 with 64 non-matching watches. `QvmModPlayerEvents` holds one permanent watch per client; `observePickup` adds a watch covering all projections. This is the QVM-side analogue of PERF1, whose fix indexed the guest layer's observers only.
- Impact: 25-60% interpreter slowdown in mods with several clients.
- Remediation: Index watches by page or use a coarse bitmap, as PERF1 did.

### VM-015 — Function resolver adds per-CALL allocation in actor-semantic mods
- **Verification (VERIFY-J): confirmed. Final severity: Low.** interpreter.ts:1016 invokes the resolver on each call with a fresh data view. mod-actors.ts:107 binds it and :204-215 does up to four map lookups. The 3x figure is a call-only microbenchmark, not re-run.
- Severity: Low
- Category: performance
- Location: src/compat/qvm/interpreter.ts:1016; src/compat/qvm/mod-actors.ts:107, :204-215
- Confidence: reproduced (empty resolver only)
- Evidence: Each guest call does a binary search (`sourceInstruction`) and builds a `QvmWritableView`, even when the resolver returns `undefined`. Measured: 35.2 M ops/s without a resolver, 12.8 with a no-op resolver. The real `callback()` then does up to four `Map.get` calls plus `memory.view` allocations.
- Impact: Roughly 3× or worse slowdown of call-heavy code in mods with combat or callbacks.
- Remediation: Resolve only for entries in a precomputed set of possible callback targets, and pass a reusable view.

### VM-016 — QC provider field access and entity scans are costly
- **Verification (VERIFY-J): confirmed. Final severity: Low.** mod-provider.ts:367-373 runs fields.some per word, :630-634 loops fields. builtins.ts:143-155 runs prepareEntities and fields.find on each find, scanning to entities.count.
- Severity: Low
- Category: performance
- Location: src/compat/qc/mod-provider.ts:367-373, :630-634; src/compat/qc/machine.ts:154-156, :238-240; src/compat/qc/builtins.ts:143-155
- Confidence: reproduced (read path); traced (scans)
- Evidence: `qc-exp2.ts`, per 4-statement loop iteration: bare machine reads 88 ns, `QcModProvider` reads 610 ns with one bound field; calls 207 vs 339 ns. `refresh` and `fields.some` scale with the number of declared fields. `find` also runs `prepareEntities` over all actors on each call, plus a `fields.find` and name-map lookups per slot; it scans to the high-water count (VM-001).
- Impact: Noticeable only in large, field-heavy QC mods.
- Remediation: Precompute a word-to-binding table and cache `find`'s definition.

### VM-017 — memcpy and strncpy traps reject overlap, including identical pointers
- **Verification (VERIFY-J): confirmed. Final severity: Low.** memory-syscalls.ts:8-14 rejects any intersection, including equal pointers, and is applied at :36 and :45. No retail case observed.
- Severity: Low
- Category: bug
- Location: src/compat/qvm/memory-syscalls.ts:8-14, :36, :45
- Confidence: traced
- Evidence: `rejectOverlap` throws for any intersection, including `dest == src`. The native traps call C `memcpy`/`strncpy`, for which self-copy and small overlaps work in practice on the shipped runtime, even though C leaves them undefined.
- Impact: A mod with a self-copy runs on Q3 and terminates here (VM-004). No case observed in retail code.
- Remediation: Treat `dest == src` as a no-op, and consider `copyWithin` for overlap.

### VM-018 — A 52-byte QVM declares a 1 GiB allocation with no cap
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** id's data size comes from the header and goes through `Hunk_Alloc` (`qcommon/vm.c:520-526`), which has a limit the port lacks. Source review: SRCQ3
- Severity: Low
- Category: security
- Location: src/compat/qvm/image.ts:12, :198-207; src/compat/qvm/interpreter.ts:255, :393; src/compat/qvm/module.ts:280
- Confidence: reproduced
- Evidence: `qvm-exp.ts bomb`: `file bytes 52 allocatedDataLength 1073741824 ... rss delta MB 2`. Pages are lazily committed, so loading is cheap, but `checkpoint()` does `bytes.slice()` and `restart()` does `fill`, each touching the full size. The source Hunk limit has no equivalent here.
- Impact: Saves or map restarts with a crafted QVM spike by 1 GiB per module.
- Remediation: Apply a sane data cap (retail QVMs are a few MB), with an override for mods that need more.

### VM-019 — Provider close paths and QC restore are not failure-safe
- **Verification (VERIFY-J): confirmed-with-changes. Final severity: Low.** Unguarded calls hold at mod-provider.ts:1358-1365, but `closed` is set after clientOutputs.close (:1358-1359), so a throw there leaves close retryable; the early-return leak applies only to the later unguarded calls. QC: machine.ts:502-504 and mod-provider.ts:952-953 hold, though executor.ts:75-84 does check some fields before mutating, after closeClientBindings has already run.
- Severity: Low
- Category: robustness
- Location: src/compat/qvm/mod-provider.ts:1351, :1358-1365, :1371-1372; src/compat/qc/machine.ts:502-504; src/compat/qc/mod-provider.ts:952-953
- Confidence: traced
- Evidence: In QVM `close()`, `clientOutputs.close()`, `playerEvents.close()`, `unsubscribe()`, `clientBindings.close()` and `input.close()` are unguarded while their neighbors are wrapped. A throw skips `files.closeAll()` and `module.retire()`, and because `closed` is already true, a second `close()` returns early, leaking write descriptors. In QC restore, `strings.restore` then `entities.restore` can fail partway, and `closeClientBindings()` runs before any checkpoint validation. There is no QC preflight comparable to `validateQvmModCheckpoint`.
- Impact: A failed cleanup or corrupt save leaves a partially restored or leaked guest.
- Remediation: Use `CleanupStack` throughout close, and validate QC checkpoints before mutating.

### VM-020 — Numeric profile and labels say "interpreted" while production always runs compiled semantics
- **Verification (VERIFY-J): confirmed. Final severity: Low.** module.ts:79,84 is the only src constructor call and passes compiled; interpreter.ts:241 defaults to interpreted. module.ts:19 and registry.ts:121 still say interpreted.
- Severity: Low
- Category: dead-code
- Location: src/compat/qvm/module.ts:19, :84; src/compat/qvm/interpreter.ts:241, :1092-1099, :1108-1109, :142-144; src/compat/qvm/registry.ts:121
- Confidence: traced
- Evidence: `id: "q3:qvm-interpreted"` sits beside `new QvmInterpreter(..., "compiled", ...)`. `module.ts` is the only `src/` caller of the constructor, and it always passes `"compiled"`; the other callers are tests. The `"interpreted"` branches (block copy, `complementPrevious`, guest-return PC) are therefore test-only in production, and `printInfo` reports "interpreted". The `"interpreted"` default parameter is misleading.
- Impact: Readers may assume the wrong semantics, as with VM-008. Code and tests are carried for a mode that never ships.
- Remediation: Remove the mode, or expose it deliberately, and rename the profile.

### VM-021 — Riskiest VM behaviors have no tests
- **Verification (VERIFY-J): confirmed. Final severity: Low.** runaway/infinite/instruction-budget grep hits only three tests/compat/qc files, with no budget hits in tests/compat/qvm. `shift` count in qvm.test.ts is 0. The cited stale throws are at tests/compat/qc/mod-clients.test.ts:116 and qc/mod-input.test.ts:129.
- Severity: Low
- Category: test-gap
- Location: tests/compat/qvm/*, tests/compat/qc/*
- Confidence: traced
- Evidence: A `runaway|infinite|instruction budget` grep of `tests/compat` hits only QC files, so nothing covers a non-terminating QVM. I found no test for foreign-slot churn or reuse, or for out-of-range shifts (`shift` grep of `qvm.test.ts`: no hits). The stale-edict grep shows only the stale-actor throws being asserted as desired (`mod-clients.test.ts:116`, `mod-input.test.ts:129`). Several provider tests also skip without retail content (`test.skipIf(!await Bun.file(path).exists())`), so synthetic-progs coverage of `QcModProvider` is thin.
- Impact: VM-001, VM-002, VM-003 and VM-008 could persist or regress unnoticed.
- Remediation: Add the synthetic harnesses in `<scratchpad>/vm-audit/` as regression tests.
