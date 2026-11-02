# VERIFY-F — verification of the verify-MED2.txt finding IDs at HEAD fcdc8af5

Method: opened the cited code in the project tree (read only). Re-ran from clean: cloudTexCoord NaN counts, parseSubtitleText, inspectShaderScript, legacy record mappers, fieldOffset microbenchmark, render-audit/order.test.ts, render-audit/font-bomb.ts, vm-audit qc-exp (return-last, engine-string) and qvm-exp (shift), a child-leaf count over retail Q1 BSPs, and objdump of the retail gamex86.dll files. Everything else is by reading. "Re-ran" below marks the run items.

### FORMATS-008
Verdict: confirmed
Corrected severity: Medium
Reason: src/content/archive/zip.ts:115 `inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.byteLength) })`, and :58 takes byteLength from the central directory with only the 0xffffffff ZIP64 rejection at :65. No per-entry or archive budget exists. readEntry (archive/index.ts:60) then digestBytes (mounts/index.ts:321) run on the result.

### FORMATS-009
Verdict: confirmed
Corrected severity: Medium
Reason: src/formats/q3-model/md5.ts:187-190 permits 65535 frames, 256 joints and 0 components; the frames.map below builds localJoints and joints objects for every joint of every frame. Reached from app/bootstrap/model-loader.ts:43,73. The memory figures were not re-measured.

### FORMATS-010
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: PNG (png.ts:69), TGA (tga.ts:18) and PCX (indexed.ts:16-20) have only the 2 GiB rule. The QW skin claim is wrong: src/app/bootstrap/network/qw-skins.ts:41 (the cited path is also wrong) returns null when xmax >= 320 or ymax >= 200 before decodePcx, so the "server-influenced QW skin" impact does not hold. The Q2 skin and other decodePcx callers remain unguarded.

### FORMATS-011
Verdict: confirmed
Corrected severity: Medium
Reason: src/persistence/kex-q2-save.ts:65 `gunzipSync(await Bun.file(path).bytes())` has no maxOutputLength. Only externalDirectories reach it: startup-saves.ts scan of this.directory skips `.pak.gz`, and the external loop collects them, then :103 decodes each uncached row with no user selection.

### FORMATS-012
Verdict: confirmed
Corrected severity: Medium
Reason: src/content/archive/types.ts:61-63 throws RangeError for empty or "." segments, while `a/../b` normalizes. pak.ts:25 and zip.ts:74 call it per entry with no skip. mounts/index.ts:555-558 closes sources and rethrows.

### FORMATS-013
Verdict: confirmed
Corrected severity: Medium
Reason: src/settings/config.ts:136 returns null on non-JSON, and :169-174 loadSeat then yields null. parseSeatSettings (:97-102) throws on a missing required field such as rumble. configuration.ts:100 and input.ts:305 await loadSeat in Promise.all with no guard. The only version logic is `input["version"] !== 1`.

### FORMATS-014
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: src/settings/config.ts:123-131 has no file.sync or directory fsync, contrasting persistence/save-policy.ts:62,64. A truncated or empty file is never valid JSON, so the outcome is only the silent reset branch of config.ts:136, not the "blocks startup" branch the finding adds. Power loss only, settings only, hence Low.

### FORMATS-015
Verdict: confirmed
Corrected severity: Medium
Reason: src/formats/images/jpeg.ts:160-176 uses Map lookups per code length, :743 allocates `pending` per MCU, :977-991 sample() runs per pixel per channel, and scene/textures.ts:232 decodes synchronously. Throughput figure not re-measured.

### GAPCOMPAT-004
Verdict: confirmed
Corrected severity: Medium
Reason: Re-ran: qvmEvent(47, reverse), qvmEntityType(12, reverse) and qvmPowerupBits(1<<9) all throw for q3-1.16n-base. Path is entity-record.ts setters from client-state-record.ts:98 via client-state-syscalls.ts:42. Reach needs a mounted qvm-compatibility.json naming that cgame digest (compat/qvm/compatibility.ts:17-20).

### GAPCOMPAT-005
Verdict: confirmed
Corrected severity: Medium
Reason: src/compat/q2/native-mod-provider.ts:994 flush and :1006 `finally { this.refresh(); ... this.observe(); }` bracket every import, and :686-727 rewrites and re-observes all shared fields. :997-998 spread projections for entity imports. native-mod-clients.ts:104 spreads entries per frame(slot) call. Cost not measured.

### GAPCOMPAT-006
Verdict: confirmed
Corrected severity: Medium
Reason: src/compat/q2/rerelease/world-profile.ts:127 spreads a new layout; the fieldOffsets WeakMap is set only in structure(), so layouts.ts:40-44 falls to fields.find. Re-ran, 500k iterations over 147 fields: original 45/47 ns, spread copy 1611/2864 ns for spawn_count/health. source-state.ts:88 calls it per access.

### GAPCOMPAT-007
Verdict: confirmed
Corrected severity: Medium
Reason: src/content/q1/quakec/id1-damage.ts throws at the cited sites for layout.kind "calls" (:262-263 other-actor store, then the store-after-reaction check; :215-216 reaction before health; :110-115 metadata change). id1-program.ts deriveNativeBinding rejects only field, constant and reaction-site shapes, not these store patterns, so they pass load. No QcProgramError catch exists in src.

### GAPCOMPAT-008
Verdict: confirmed
Corrected severity: Medium
Reason: src/compat/q2/native-mod-combat.ts:114-119 observes stride * capacity; :120-132 runs host.entities() per callback. :104 throws when one address is seen under two kinds. bind() also calls ensure for all four kinds, so the same throw fires at actor admission as well as inside a guest store.

### GAPMAT-002
Verdict: confirmed
Corrected severity: Medium
Reason: Re-ran: parseSubtitleText throws on all three cited inputs. sound-captions.ts:37-39 awaits prepare with no catch; ui.ts:135 and presentation.ts:359 await it; application.ts:4431 has no inner catch. The outer step catch near :4685 rethrows unless fatalWorldFailure, and run() does not catch. This closes the trace the finding left open, except main.ts:82 handling, which APP-001 covers.

### GAPMAT-003
Verdict: confirmed
Corrected severity: Medium
Reason: Re-ran cloudTexCoord over 5 faces x 81 points: 0 NaN at +64, 52 at -64, 196 at -512. material.ts skyDirective accepts negative heights (only 0 is replaced, by 512). sky.ts:153 copies the coordinates, world.ts:728 draws them, gl/buffers.ts:181-182 throws on the poisoned maximum. The GL throw itself was traced, not run.

### GUEST-006
Verdict: confirmed
Corrected severity: Medium
Reason: src/guest/abi/runner.ts:168-170 charges one budget unit per host dispatch. crt.ts:27-29 memset takes count up to 0x10000000 (common/memory.ts:17-21). No wall-clock check exists on this path. The "about an hour" figure stays an extrapolation.

### GUEST-007
Verdict: confirmed
Corrected severity: Medium
Reason: src/compat/q2/classic/host.ts:329-336 TagMalloc has no upper bound, while rerelease/imports.ts:138-145 and windows/runtime.ts:167-172 cap at 256 MiB. guest/core/memory.ts:200 allocates per mapping with no running total.

### GUEST-008
Verdict: confirmed
Corrected severity: Medium
Reason: grep finds GuestCallStopped and GuestMemoryFault only under src/guest/. session.ts:431-445 is try/finally. The application.ts catch rethrows unless fatalWorldFailure, which guest stops do not set (setters at :2129, :3212-3213, :3455 are world-transition failures). run() has no catch.

### GUEST-009
Verdict: confirmed
Corrected severity: Medium
Reason: classic-guest-files.ts:6-22 has no quota and creation 2 truncates. The config chain the finding left plausible holds: application.ts:594 root is the same expression as configurationStore (configuration.ts:336-338), and configurationScriptReader (configuration.ts:344) reads scripts from userContent.root, so a DLL can plant scripts there. It is also the user archive root. The finding's confidence should read traced.

### GUEST-010
Verdict: confirmed
Corrected severity: Medium
Reason: src/compat/q2/classic/printf.ts:12-13: the regex allows one optional `l` and no `h` or `I64`, and rejects `%!`, `%n` and a trailing `%`, then throws. host.ts:137-142 runs it during variadic dispatch at runner.ts, outside any catch. The remote trigger remains conditional on a mod passing client text as a format.

### GUEST-011
Verdict: confirmed
Corrected severity: Medium
Reason: src/guest/x64/integer-kernel.ts:195 reads the global hasWriteObservers, then takes a register checkpoint and `if (observed || !afterStore()) break;` for every unsafe step regardless of address. memory.ts:138,171 is `#writeObservers.size !== 0`. MIPS figures not re-measured.

### GUEST-012
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: host.ts:168-170 and cvars.ts:48-51 run per export, and records.ts:150-158 re-runs descriptor per slot via at(). Omitted by the finding: records.ts:151 returns immediately when a projection is set, and native mods always pass one (native-mod-host.ts:145), so the classic edict cost applies only to the primary classic path. Rerelease reconcile (rerelease/host.ts:175,205-209) is unconditional.

### GUEST-014
Verdict: confirmed
Corrected severity: Low
Reason: src/guest/x64/cpu.ts:129,237 clear the map at 32768 entries, and blocks hang off the cleared entries (first.block at :300). No session measurement exists of clear frequency or spike size, and re-decode is lazy, so Medium is not supported by evidence. Re-rate if counting shows recurring clears.

### GUEST-016
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: x87.ts:270-305 falls through to throw for d9 f0, f2, f5, f8, fd. objdump of baseq2, ctf, rogue and xatrix gamex86.dll decodes only f2xm1, fptan, fprem1 and fscale; the byte-scan hits for fyl2x, fxtract, fprem and fsincos do not decode (false positives). fptan at baseq2 0x2001667f is inline game code, not CRT, so it does not need a `tan` CRT call. Builtin products do not run the DLL (content.ts selectedQ2GameLibrary); turret_driver appears in jail1 and strike.

### PLATFORM-005
Verdict: confirmed
Corrected severity: Medium
Reason: src/llm/settings.ts:367 aborts the shared controller when users reach 0; :351 checkRequestAbort and the signal passed to write at :357 then drop the already rotated token. refreshSubscription's result is persisted nowhere else. Fake-endpoint run not repeated.

### PLATFORM-006
Verdict: confirmed
Corrected severity: Medium
Reason: src/console/llm-batch.ts:5 is a ten-name deny list, and :42-51 otherwise accepts any registered name. llm.ts:71-72 executes immediately. commands.ts:42-48 condump writes any name (Q2 forces .txt). startup-config.ts:62 executes autoexec.cfg from the seat scope. remote-application.ts:1462 and demo-commands.ts:46 run cvar text as commands.

### PLATFORM-009
Verdict: confirmed
Corrected severity: Medium
Reason: src/console/llm.ts:84, input.ts:698 and startup.ts:805 call primeLlmConsoleSession unprompted; session.ts:103-109 sends a real transport request. settings.ts:399 only checks configured provider and model. startup.ts:803 comments show this is deliberate warm-up, but no opt-in exists.

### PLATFORM-010
Verdict: confirmed
Corrected severity: Medium
Reason: src/audio/mixer.ts:509 extends the voices array when no slot is free, and :236 documents growth. The :498 scan runs only when random is non-null. remote-q1.ts:211 turns each sound message into a play without a cap. Timing table not re-measured.

### PLATFORM-011
Verdict: confirmed
Corrected severity: Medium
Reason: src/input/router.ts:202 forwards preciseY, and src/input/seat.ts:195 `for (count = 0; count < Math.abs(delta.y); count++)` runs once for any nonzero fraction. sdl.ts:413 decodes integer y, which the router ignores. Actual event sizes vary by device, as the finding says.

### PLATFORM-012
Verdict: confirmed
Corrected severity: Medium
Reason: src/platform/controller.ts:305 calls discover on ADDED, and :270 `required(api.SDL_GameControllerOpen(index), ...)` throws on null with no per-device catch before the open. input.ts:764 and startup.ts:1363 iterate pollEvents with no catch. The failure trigger stays plausible, not observed.

### RENDER-006
Verdict: confirmed
Corrected severity: Medium
Reason: Re-ran render-audit/order.test.ts: visible order [0, 1], draw positions [32, 128], depthWrite false, src-alpha. world.ts:522 is a stable class-only sort, visibility.ts:249-250 pops front first, and prepareView's deferred list (world.ts ~550-562) keeps insertion order with no reversal.

### RENDER-007
Verdict: confirmed
Corrected severity: Medium
Reason: src/render/scene/visibility.ts:118 sets unsafe on a repeated leaf and records.ts:72 decodes solid children to leaf 0. Re-ran on retail PAK0 node lumps, upgrading the retail claim from traced to reproduced: start 1397, e1m1 1278, e1m2 1392 children map to leaf 0, and no other leaf is shared.

### RENDER-009
Verdict: confirmed
Corrected severity: Medium
Reason: Re-ran render-audit/font-bomb.ts: 6 self-referencing components 324 ms (~6^9 calls), metric bomb 16000x16000 and 256,000,000 bytes. truetype.ts:272-273 limits depth only and the cache applies only at depth 0 (:1182-1205). atlas.ts:84-86 passes the parsed font to buildFontAtlas with no cap. CFF path traced only.

### RENDER-010
Verdict: confirmed
Corrected severity: Medium
Reason: Re-ran: a script with one stray `}` between shaders gives ShaderParseError "Expected shader name" from inspectShaderScript. material.ts:1271 fail is not recovered by parse(true), and shaders.ts:107-108 `catch { return; }` discards all entries with no output. Its doc comment claims sibling retention and its catch comment covers only unlexable files.

### RENDER-011
Verdict: confirmed
Corrected severity: Medium
Reason: shadows.ts:269,315 keep signatures, and only close() (:333) clears them. Atlas passes are "depth-atlas" operations, not journal image operations (image-journal.ts:37-54), so replay at renderer.ts:171,255 restores the all-1 creation. video-restart.ts retains the game, and its published hook (startup.ts:483) only records the preference. Not run end to end.

### RENDER-012
Verdict: confirmed
Corrected severity: Medium
Reason: cpu/textures.ts:58-63 returns stable levels[0], a plain Float32Array slice (:75). row-parallel.ts:276-280 posts it once per object, which structured-clones it, and row-worker.ts:149-151 keeps that copy. rasterizer.ts:706 mutates only the coordinator's copy, while coordinator bands (row-parallel.ts:314-319) use current data. Traced, not run.

### RENDER-013
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Copies verified at image-journal.ts:9-20,43, gl/textures.ts:101-104,137, worker-protocol.ts:134-139, worker-runtime.ts:81 and scene/textures.ts:94; the worker journal replays only for SoftwareRenderer (:99). Category is wrong: this is bounded retention released with the image, not a leak. The "three to five times" multiplier was not measured.

### RENDER-014
Verdict: confirmed
Corrected severity: Medium
Reason: src/render/scene/world.ts:509 computes visibility before the :510-511 cache check. presentation-scene.ts:370-373 and q3-client.ts:576-577 call prepareWorldOperations, then prepareView, which traverses again at :542-543. world.ts:821 adds a third for portals. Cost not measured.

### RENDER-015
Verdict: confirmed
Corrected severity: Low
Reason: Sites verified: submissions.ts:87, material-registrations.ts:205-208, world.ts:633-636, models/prepare.ts:107-112, gl/renderer.ts:280, cpu/rasterizer.ts:93-108. The finding itself says no line dominates and nothing was profiled, and submissions.ts:87 runs only for source-ordered ranges. Unmeasured GC churn does not support Medium.

### VM-005
Verdict: confirmed
Corrected severity: Medium
Reason: src/compat/qvm/file-syscalls.ts:108-113 passes guest paths to UserFileStore.open (platform/files/writable.ts:73-86), which only applies containment. :138 blocks q3key on read only. q3-client/qvm.ts:135 and application.ts:619 use userContent.root, which catalog/index.ts:45 also treats as an archive source. cvar-syscalls.ts:40 forces any cvar.

### VM-006
Verdict: confirmed
Corrected severity: Medium
Reason: src/compat/qvm/file-syscalls.ts:211 throws; grep -F finds only that line and the test at tests/compat/qvm/client-file.test.ts:134. The stock q3_ui call is from knowledge of the id source and no retail UI run was done.

### VM-007
Verdict: confirmed
Corrected severity: Medium
Reason: Re-ran vm-audit/qc-exp.ts return-last: `word 30 outside 30-word storage`. src/compat/qc/machine.ts:486-488 copies 3 words and memory.ts:15-17 bounds-checks each. Whether any shipped progs has this layout was not scanned.

### VM-008
Verdict: confirmed
Corrected severity: Medium
Reason: Re-ran vm-audit/qvm-exp.ts shift: `QVM shift count outside 0..31`. src/compat/qvm/operations.ts:45-48,72-74. The JIT masking behavior comes from knowledge of vm_x86, not this repo. No test asserts this throw.

### VM-009
Verdict: confirmed
Corrected severity: Medium
Reason: Re-ran qc-exp.ts engine-string: throw reproduced. memory.ts:125-137 fixes capacity at creation, while mod-provider.ts:642 passes a growing one. The finding's refutation holds: setinfo and signon spawn (network-qw.ts:211, qw-server.ts:254,277) fail only that peer. A 32+ character name is therefore dropped at spawn too, via quakec-source.ts:754.

### VM-010
Verdict: confirmed
Corrected severity: Medium
Reason: src/app/bootstrap/simulation/quakec-weapon-behavior.ts:119 allocates two strings per target, reached from :132 and :163. src/compat/qc/memory.ts:120-124 is append-only and :99-110 doubles the arena. Machine lifetime across worlds remains unconfirmed, as the finding states.

### VM-011
Verdict: confirmed
Corrected severity: Medium
Reason: src/compat/qvm/mod-provider.ts:1298 flush and publish, and the refresh closure before the return at :1314-1316 rewrites and re-observes per syscall. :1250 actorAt spreads projections. mod-player-events.ts:88-92 fully decodes playerState per tracked client. Not measured.

### VM-012
Verdict: confirmed
Corrected severity: Medium
Reason: src/compat/qc/presentation-host.ts:434-435 runs routeBuffer before routedBuffers.delete, so a throw retains the buffer. The non-routed branch at :439-440 also decodes before buffer.clear. message-effects.ts:11,28 throw on unknown types. mod-provider.ts:807 flushes at depth 1.

### VM-013
Verdict: confirmed
Corrected severity: Low
Reason: Re-counted lines over 160 columns: 117/301, 64/286, 15/237, 11/274, all exact. hostImage (qvm/mod-provider.ts:232) and the inline restore (:390+) decode the checkpoint separately. Constructors at qvm :337 and qc :237. No behavioral defect is shown here and the linked bugs are reported separately, so Low.
