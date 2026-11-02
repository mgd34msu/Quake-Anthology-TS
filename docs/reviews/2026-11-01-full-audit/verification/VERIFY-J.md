# VERIFY-J — verification of verify-LOW3.txt at HEAD fcdc8af5

Method: opened the cited code in the project tree at HEAD and tried to falsify each claim. Timing and memory measurements from the original findings were not re-run (VM-014, VM-015, VM-016, VM-018, SIM-014, SIM-015, UI-014, UI-015, UI-016, UI-018 sizes, GUEST-018, PLATFORM-014, PLATFORM-018, PLATFORM-019, TESTS-015, TESTS-016 runner behaviour); for those the code structure was checked and the numbers are carried over.

### GUEST-017
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Unreachable from production, but "grep returns nothing" is slightly wrong: src/guest/runtime/common/format/services.ts:6 has a type-only import of system-v/contracts.ts. No runtime importer exists. elf/index.ts:104-105 zero-fill is uncapped, parse.ts:369-391 re-walks chains per bucket, and SparseGuestMemory.restore/GuestCallbackTable.restore have no src caller.

### GUEST-018
Verdict: confirmed
Corrected severity: Low
Reason: runner.ts:125-134 restores only on success and `finally` only pops #active; depth-0 `saved` is null (:113). classic-guest-source.ts:131-132 and rerelease-guest-source.ts:104-105 then call shutdown and detach from that state, collecting errors.

### GUEST-019
Verdict: confirmed
Corrected severity: Medium
Reason: directories.ts:182 throws when the structure's Size exceeds the directory size, and loader.ts:88 has no guard. The PE spec requires directory size 64 on x86 for XP compatibility while the SafeSEH-era structure Size is larger, so such DLLs are rejected by trace. No sample was run; raised because third-party x86 mods are a supported input, though it fails closed.

### GUEST-020
Verdict: confirmed
Corrected severity: Low
Reason: crt.ts:123-125 uses Math.fround over double Math functions for acosf, sinf, cosf, tanf and atan2f. crt.ts:98-118 qsort is a heap sort, so tie order differs from a quicksort. Actual divergence from UCRT vectors is still unmeasured.

### GUEST-021
Verdict: confirmed
Corrected severity: Low
Reason: cpu.ts:83-162 and :164-269 share the same decode/step structure, with #runManaged adding the executeBlock path. native-mod-provider.ts:75-260 is one function and 1098 lines total; kernel.ts has 38 of 301 lines over 200 columns.

### NET-024
Verdict: confirmed
Corrected severity: Low
Reason: server-browser.ts:387-388 calls q3List and addQ3 per address; addQ3 (:134-136) rebuilds and filters the list, and q3List (:109-110) rebuilds after each generation bump; q3/discovery.ts:32 caps at 256 per packet. discovery.ts:138-143 accepts any source during a broadcast window when challenge is null and adds with no cap.

### NET-025
Verdict: confirmed
Corrected severity: Low
Reason: q3.ts:170 assigns `peer.remote = event.from` before receiveDatagram; routing at admission.ts:213-217 needs only same IP (port ignored) and qport. Delivery reads peer.remote (q3.ts:85). q2.ts:435-440 rebinds only on an accepted message.

### NET-026
Verdict: confirmed
Corrected severity: Medium
Reason: transport.ts:79-80 turns a port-0 source into an error event (endpoint.ts:15 rejects port 0), :120 queues send errors, unified-client.ts:52 throws on either and the catch marks the client rejected and closes. Raised because one ICMP-driven send failure ends the session; delivery of a port-0 datagram through Bun remains unexercised. transport.ts:131 null return ends draining for every caller.

### NET-027
Verdict: confirmed
Corrected severity: Low
Reason: q2-downloads.ts:43-58 and network-qw.ts:189-197 check only path shape, category cvars and canDownloadResource (mounts/index.ts:561-564), with no extension allowlist, unlike the client at q2-downloads.ts:238-239. Exposure depends on mount layout and allow_download (default 0 on classic Q2, 1 on rerelease; q2-downloads.ts:38).

### NET-028
Verdict: confirmed
Corrected severity: Low
Reason: q2.ts:444-450 replies with the raw exception text when peer is undefined. qw-server.ts:286-287 and q3.ts:172 print per packet with no limit. unified-server.ts:105 passes the peer reason to drop, printed unfiltered at :94.

### NET-029
Verdict: confirmed
Corrected severity: Low
Reason: Word grep finds each named symbol only in its defining file under src; FloodLimiter, PacketScheduler and Q3Rcon have no tests. common/fragments.ts is re-exported by common/index.ts:6, with direct use only in tests/network/common/network.test.ts. online.ts:26,32 use scryptSync and the file has no expiry logic.

### NET-030
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The statement that the overflow grep hits only unified/channel.test.ts is false: tests/network/q1/qw-host-commands.test.ts:144 asserts a server-level QW reliable overflow, and q3/network.test.ts:283 covers configstring overflow. The named gaps hold: no Q2 overflow in tests/network/q2, no QW sequence exhaustion, no decoder bomb (unified/frame.test.ts:89 only tests a wrong schema); retry limit appears only at channel.test.ts:74.

### PLATFORM-013
Verdict: confirmed
Corrected severity: Low
Reason: session.ts:56 awaits #primeNow with no signal, and :103-109 calls transport with no signal inside the serial queue. llm.ts:30-31 aborts and prints cancelled while the warm-up continues.

### PLATFORM-014
Verdict: confirmed
Corrected severity: Low
Reason: auth.ts:74 requires nonempty(refresh_token) on all grants, and refreshSubscription (:168) reaches the same parser. `previous` is used for scopes but not for the refresh token.

### PLATFORM-015
Verdict: confirmed
Corrected severity: Low
Reason: auth-worker.ts:26-28 posts state-mismatch for any GET on the callback path, and auth.ts:120 rejects the login. No Host or Origin check exists. Denial only; the state check still blocks the credential.

### PLATFORM-016
Verdict: confirmed
Corrected severity: Low
Reason: llm-batch.ts:82-85 joins names unescaped; commands/index.ts:512-515 checks alias name length only. session.ts:125-128 places prior turns in instructions, labelled as prior context. Alias length under 32 limits payload per name, but many names can be combined.

### PLATFORM-017
Verdict: confirmed
Corrected severity: Low
Reason: settings.ts:150,169,267,282 parse the existing file before writing, and parsePreferences (:66-71) throws on invalid or missing fields, so the replacing write never runs.

### PLATFORM-018
Verdict: confirmed
Corrected severity: Low
Reason: sdl.ts:166-167 and controller.ts:93-94 throw on SDL_SetHint returning non-1, which SDL returns when the environment variable overrides at default priority. audio.ts:59-65 requiredHint already reads back the value.

### PLATFORM-019
Verdict: confirmed
Corrected severity: Low
Reason: dedicated.ts:30 calls EventRing.admit inside the data handler with a 16384-slot ring (:10), and event-ring.ts:93 throws when full. main.ts:35 handles it as uncaught. `pending` has no bound.

### PLATFORM-020
Verdict: confirmed
Corrected severity: Low
Reason: No handler for 0x1100/0x1101 in src; sdl.ts:419 decodes them as unsupported. engine.ts:547 has no error path. Whether the queue stops draining after removal is still untested and from memory SDL2 may keep consuming, but silence until restart holds in both cases.

### PLATFORM-021
Verdict: confirmed
Corrected severity: Low
Reason: streams.ts:49-60 writes to mkdtemp and removal occurs only in close (:70-77). /tmp currently holds 22 quake-audio entries.

### PLATFORM-022
Verdict: confirmed
Corrected severity: Low
Reason: mixer.ts:818, :826, :828 allocate per pump and block, :1003 builds a gain object per looped sample, :949 copies and filters voices. engine.ts:401-421 and streams.ts:177 allocate output arrays.

### PLATFORM-023
Verdict: confirmed
Corrected severity: Low
Reason: capture/index.ts:64-72 starts at index 0 with mkdir and open per candidate on every unnamed capture. bootstrap/capture.ts:92-93 sends cl_avidemo frames through screenshot with no name.

### PLATFORM-024
Verdict: confirmed
Corrected severity: Low
Reason: session.ts:40-43 getter calls queryConsoleEntries, and discovery.ts:21-31 builds and sorts the full catalog. presentation.ts:511 reads it in the console draw path. It applies only while the console is drawn with a selected completion.

### PLATFORM-025
Verdict: confirmed
Corrected severity: Low
Reason: router.ts:198 calls pointerPosition per motion event regardless of relative mode; router.ts:175 reads two sizes, each allocating Int32Arrays and calling FFI (sdl.ts:638-644, 792-805). :205 updateCapture reaches sdl.ts:772 this.relativeMouse, another FFI call. sdl.ts:816 peeks one event per call.

### PLATFORM-028
Verdict: confirmed
Corrected severity: Low
Reason: Word grep matches the finding for all listed symbols; bindSoundMemory appears only in tests/audio/playback.test.ts, and only writeLinearBlastStereo16 is imported from source-paint.ts (mixer.ts:17). adpcm, wavelet and source-paint total 641 lines.

### PLATFORM-029
Verdict: confirmed
Corrected severity: Low
Reason: tests/console/llm.test.ts has 0 condump/writeconfig hits, no test mentions OV_HOLE, and round-reset.test.ts:24 uses maxActors 3 for reset behaviour. condump is exercised elsewhere (tests/capture/application.test.ts:89) but not as an LLM rejection.

### RENDER-016
Verdict: confirmed
Corrected severity: Low
Reason: visibility.ts:174 creates a new buffer when a second cluster applies, and :205-206 compares by buffer identity, so it always misses. index.cache holds one entry (:218). Results stay correct.

### RENDER-017
Verdict: confirmed
Corrected severity: Low
Reason: worker-protocol.ts:113 and :199 insert; :133 and :253 handle release-image without deleting. The only images.clear is :103 in the encoder clear.

### RENDER-018
Verdict: confirmed
Corrected severity: Low
Reason: world.ts:161,164 strong maps have only get/set (:638,:653,:656,:666); releaseImages (:741) and commitImages (:776-777) do not clear them, and commitImages installs replacement surface objects. Retention ends when the world closes and becomes unreachable.

### RENDER-019
Verdict: confirmed
Corrected severity: Low
Reason: shaders.ts:78 find, :221 and :233 scans, material-registrations.ts:113 spreads and filters, :263 spreads and finds per publish. No timing taken.

### RENDER-020
Verdict: confirmed
Corrected severity: Low
Reason: row-parallel.ts:233-238 blocks on Atomics.wait with a 30 s deadline, with no worker error listener; :248 discards the reason. rasterizer.ts:693 builds a separate SoftwareRenderer, and :1164 creates its pool lazily. tools/build.ts:71 embeds the worker, so this needs a load failure.

### RENDER-021
Verdict: confirmed
Corrected severity: Low
Reason: renderer.ts:442-461 sets only program, texture and color; rasterizer.ts:730-741 uses retainedState. world.ts:720 emits only depth-range before sky-side and q2-sky.ts:79 emits no state at all. Not observed at runtime.

### RENDER-022
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: No production trigger exists, but "only in contract and backends" omits forwarding in worker.ts:200-205 and worker-runtime.ts:102,151-152 and test callers (tests/render/worker-native.test.ts:57,63, cpu/rasterizer.test.ts, gl/smoke.test.ts). Stride mismatch holds: rasterizer.ts:551 versus textures.ts:36 alignment 1.

### RENDER-023
Verdict: confirmed
Corrected severity: Low
Reason: worker-protocol.test.ts and worker-native.test.ts have 0 space/viewProjection hits. visibility.test.ts:30 fixture is q3-bsp with one surface per leaf, so there is no shared-leaf case.

### SIM-014
Verdict: confirmed
Corrected severity: Low
Reason: network.ts:381 calls visibleEntities(player, entityStates(protocol), origin) per client frame. :92-99 rebuilds presentations and states, :143-147 rebuilds byNumber and fat leaves. :153 state.solid mutates the record, as noted.

### SIM-015
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Behaviour holds at physics.ts:399-402,471 and runtime.ts:4019,5595-5601,8561-8580,7347-7358. The citation 4733-4737 is wrong (it is q2WeaponInput): playerClient is at runtime.ts:6733-6737. The linear scans there apply to q2-native and q3-qvm sources only.

### SIM-016
Verdict: confirmed
Corrected severity: Low
Reason: runtime.ts:1818-1833 saves neither adjunctCampaign nor cvars. Flags do change at runtime through addons (content/q1/addons/campaign.ts:93, commands.ts:71), so the gap is live; the primary campaign is saved separately at runtime.ts:8066.

### SIM-017
Verdict: confirmed
Corrected severity: Low
Reason: physics.ts:713-734 retries up to 3 more pushEntity calls after zero fraction, with a comment stating this is deliberate. :670 sets only ground, and no later code snaps origin or zeroes velocity.z for the grounded case, unlike source M_CheckGround.

### SIM-019
Verdict: confirmed
Corrected severity: Low
Reason: foreign-deathball.test.ts:58-62 writes the ball to the goal directly. checkpoint/restore/disconnect grep is 0 in all three files. foreign-lmctf.test.ts:108 waits for a carrier to clear, but no reset-after-goal or token-return assertion exists.

### TESTS-009
Verdict: confirmed
Corrected severity: Low
Reason: My grep reproduces 46 writes in 26 files to fixed /tmp names and 17 mkdtemp calls. protocol-host.test.ts:89-90, binding-actions.test.ts:86, game-prompt.test.ts:31-32 and startup.test.ts:34-37 match.

### TESTS-014
Verdict: confirmed
Corrected severity: Low
Reason: worker-transport.test.ts:49,57,68 use the quoted catch-only form; :42 and :95 check identity but still accept no throw. cpu.test.ts:29 skips if the exception kind changes. A rough grep gives 221 lines in 112 files, similar to the reported count.

### TESTS-015
Verdict: confirmed
Corrected severity: Low
Reason: mounts.test.ts:133-134 are unawaited and followed by rm at :135. equipment.test.ts:156,158 are unawaited too but have no cleanup to race. A grep finds these 4 sites only; server-browser-persistence.test.ts:160 is a different form.

### UI-014
Verdict: confirmed
Corrected severity: Low
Reason: preprocessor.ts:1427-1436 creates the frame, then deletes it on recursion without disposing its lexer. :1701 frees the expression chain only on the success path after evaluate. menu.ts:1262,1338 dispose cursors outside finally.

### UI-015
Verdict: confirmed
Corrected severity: Low
Reason: runtime.ts:755-773 activate, :1172-1178 runScript, :1259 open and :1349-1352 scriptOpen recurse with no depth counter and no suspending await before the descent.

### UI-016
Verdict: confirmed
Corrected severity: Low
Reason: runtime.ts:1773,1781,2114,2172 require the pointer inside the rect. input.ts:104 sends MouseWheel keys, but no MouseWheel handling exists in runtime.ts. input.ts:20-28 maps pad buttons to the same keys.

### UI-017
Verdict: confirmed
Corrected severity: Low
Reason: controller.ts:171 only submits, and SDL_StartTextInput is the only text path. :282-289 cancels only on keyboard Escape while pad buttons are captured. :359-360 rebuilds the Map per event with no repeat, while the axis path at :367-368 has repeat.

### UI-018
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: fitUi throws (layout.ts:8-9), but a zero window drawable throws earlier at sdl.ts:803, so fitUi sees zero only through seatViewport truncation (presentation.ts:62-68). No SDL_SetWindowMinimumSize exists in src, so "minimum window 320x200" is not an enforced limit. Unreadable split-screen text stands.

### UI-019
Verdict: confirmed
Corrected severity: Low
Reason: Neither controller construction (ui.ts:163-170, startup-menu.ts:120-122) passes localize, and ui.ts:327 passes identity. controller.ts:468,500-501 bypass localize, and :405,:409 fit before localizing.

### UI-020
Verdict: confirmed
Corrected severity: Low
Reason: All ten cited button helpers exist at the cited lines. settings/server.ts:20-27 wraps at 60 with no long-word handling. Other wrappers and menu.ts ranges were sampled, not exhaustively compared.

### UI-021
Verdict: confirmed
Corrected severity: Low
Reason: library/match.ts:9,27 gives y=436, bottom 466, against panel bottom 456 (24+432, menu-theme.ts:39). menuPanel uses fitUi without scale (:38-40), while controller.ts:378 uses menuScale.

### UI-022
Verdict: confirmed
Corrected severity: Low
Reason: q2-native-hud.ts:28-30 stores ops only when environment is defined, and :49 re-parses otherwise. q2-native.ts:41 tokenizes on each call.

### UI-023
Verdict: confirmed
Corrected severity: Low
Reason: runtime.ts:1155-1159 throws in cgame, reached from :2633 via paintBind when text is set (:2653-2655), and from :1722. mission-hud.ts:325-329 is the only UiRuntime.create in src and passes kind cgame.

### UI-024
Verdict: confirmed
Corrected severity: Low
Reason: art-manifest.ts:36 omits title.png, used by splash.ts:1. assets/ui/manifest.ts:1 omits mainMenuBackground, docs/ui-art-review.md:3 says three assets, prompt:3 cites /tmp/codex-clipboard, prompt:5 asks 1920x1080, menu-theme.ts:31 hard-codes the ratio. No test imports inspect.ts or manifest.ts.

### VM-014
Verdict: confirmed
Corrected severity: Low
Reason: memory-writes.ts:37-49 loops all watches and ranges on each store. mod-player-events.ts:72 and mod-provider.ts:721-723 add watches, and interpreter.ts:542 routes through the observed view. Figures not re-run; 64 watches is above normal client counts, so 25% at 8 is the realistic end.

### VM-015
Verdict: confirmed
Corrected severity: Low
Reason: interpreter.ts:1016 invokes the resolver on each call with a fresh data view. mod-actors.ts:107 binds it and :204-215 does up to four map lookups. The 3x figure is a call-only microbenchmark, not re-run.

### VM-016
Verdict: confirmed
Corrected severity: Low
Reason: mod-provider.ts:367-373 runs fields.some per word, :630-634 loops fields. builtins.ts:143-155 runs prepareEntities and fields.find on each find, scanning to entities.count.

### VM-017
Verdict: confirmed
Corrected severity: Low
Reason: memory-syscalls.ts:8-14 rejects any intersection, including equal pointers, and is applied at :36 and :45. No retail case observed.

### VM-018
Verdict: confirmed
Corrected severity: Low
Reason: image.ts:12 allows 0x40000000 and :198-207 sizes allocation from BSS with no file backing. interpreter.ts:393 fills it, module.ts:280 slices it. Lazy commit figure not re-run.

### VM-019
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Unguarded calls hold at mod-provider.ts:1358-1365, but `closed` is set after clientOutputs.close (:1358-1359), so a throw there leaves close retryable; the early-return leak applies only to the later unguarded calls. QC: machine.ts:502-504 and mod-provider.ts:952-953 hold, though executor.ts:75-84 does check some fields before mutating, after closeClientBindings has already run.

### VM-020
Verdict: confirmed
Corrected severity: Low
Reason: module.ts:79,84 is the only src constructor call and passes compiled; interpreter.ts:241 defaults to interpreted. module.ts:19 and registry.ts:121 still say interpreted.

### VM-021
Verdict: confirmed
Corrected severity: Low
Reason: runaway/infinite/instruction-budget grep hits only three tests/compat/qc files, with no budget hits in tests/compat/qvm. `shift` count in qvm.test.ts is 0. The cited stale throws are at tests/compat/qc/mod-clients.test.ts:116 and qc/mod-input.test.ts:129.

### APP-009
Verdict: confirmed
Corrected severity: Info
Reason: git log --all -S and git grep at HEAD find nothing for "not yet wired". main.ts:20 header records only version; version.ts first read 1.2.6 at 1b703833. The fsck sample and worktree checks were not repeated.

### APP-024
Verdict: confirmed
Corrected severity: Info
Reason: application.ts:2651 calls loadApplicationContent(options, recipe) with no catalog, so content.ts:439 discovers again. 58-80 ms figure not re-run.

### AUDIT-014
Verdict: confirmed
Corrected severity: Info
Reason: docs/reviews/2026-11-01-full-audit/evidence/soak-q3.log shows median step 12.09 ms and travel about 6.7-6.9 s in the final cycles, up to 9.3 s max; soak-q1.log shows travel about 0.5-0.7 s. --version and compiled binary figures not re-run.

### CONTENT1-020
Verdict: confirmed
Corrected severity: Info
Reason: content/q3/presentation/entities.ts:143-146 discards both apos evaluations, and :147 carries the FIXME comment. Translation only is applied at :148.

### CONTENT1-021
Verdict: confirmed-with-changes
Corrected severity: Info
Reason: The untraced consumer is now traced: reports flow to ApplicationQ3Rankings (q3-rankings.ts:26-31) and RankingLifecycle, which need options.rankings (application.ts:247). No production code supplies that option or implements RankingServiceProvider, so reports have no live sink. rankings.ts is 704 lines.

### CONTENT2-017
Verdict: confirmed-with-changes
Corrected severity: Info
Reason: Totals match (32,924 lines, 1,393,535 bytes) and generate-tables.ts has no external reference. rerelease boss32.ts does not literally equal base: cmp differs, with Math.fround wrappers, an extra frame table and 32099 vs 29298 bytes; all 12 moves match only after normalising. The 349, 83 and 14 counts were not recomputed.

### CORE-019
Verdict: confirmed
Corrected severity: Info
Reason: q2/index.ts:108 begins before commandDuration at the later physics call (:30), and q3/provider.ts:122 copies mod output through q3Command (:23-28) with no check; move.ts:509-514 validates only at entry. Upstream bounds in world/session/mod-client-input.ts remain untraced, so it stays conditional.

### DOCS-017
Verdict: confirmed
Corrected severity: Info
Reason: Origin is lowercase; README.md:10,30, getting-started.md:27 and the review doc use Quake-Anthology-TS. foundation.md:4 links quake-anthology, and foundation.md:33-34,143,156 cite THE- tickets.

### DOCS-019
Verdict: confirmed
Corrected severity: Info
Reason: The review doc has no match for fixed, resolved or landed, and its table at :15-21 lists items without status. bde6c9ae confirmed as the B4 fix; other commit IDs not opened individually.

### FORMATS-027
Verdict: confirmed
Corrected severity: Info
Reason: settings/config.ts:120 and archive/loose.ts:21 hardcode "../", while mounts/paths.ts:16 uses sep. roots.ts:137 has B:/~BUN/, and contained.ts:12 throws off Linux.

### GAPQ12-015
Verdict: confirmed-with-changes
Corrected severity: Info
Reason: hipnotic-misc.ts:72 emits map text and application.ts:1500-1503 appends it unfiltered, but the target is the source-bound sourceCommands buffer (:1221), not necessarily every application console command. The reachable command set was not enumerated.

### GAPQ12C-008
Verdict: confirmed
Corrected severity: Info
Reason: A grep of src, tests and tools finds only the definition at rerelease/monsters/index.ts:53, which closes the original gap on tests and tools.

### GAPQ3B-010
Verdict: confirmed
Corrected severity: Info
Reason: save-state.ts:173-182 covers three types, and the five aliases at save-values.ts:255-399 are plain Pick lists. An AST comparison found no loss: cmd and teamState are saved at save-state.ts:112-113, teamScores at save-level.ts:5. MatchState inherited fields and EntityStateFields were not compared.

### GUEST-001
Verdict: confirmed
Corrected severity: Info
Reason: classic-guest-source.ts:53-63 and rerelease-guest-source.ts:51-62 use SparseGuestMemory with I386Cpu and X64Cpu, mapped through mapPeImage only. The referenced import grants were not re-traced here.

### PLATFORM-026
Verdict: confirmed
Corrected severity: Info
Reason: auth.ts:5,140, codex.ts:30-35 and models.ts:131-132 hold the fixed client ID, originator pi, private endpoint and pinned client_version. Terms not assessed.

### PLATFORM-027
Verdict: confirmed
Corrected severity: Info
Reason: freetype.ts:112, theora.ts:50,77 and vorbis.ts:82 pass content to system libraries in process. No version check found at those sites.

### RENDER-024
Verdict: confirmed
Corrected severity: Info
Reason: presentation.ts:427 restricts worldSpaceBatches to GL, rasterizer.ts:484 throws on stereo buffers. lighting.ts:27 has the stray `{}` and :39-44 has identical branches. The claim of parity for other features was not re-checked.

### TESTS-016
Verdict: confirmed
Corrected severity: Info
Reason: retail.test.ts:89 and controller.test.ts:249 are test.skip placeholders, main.ts:34-35 listeners exist, .artifacts/snapshots holds 23 entries at 1.8 GB, and player-service-status.ts and core/diagnostics.ts have no importer in src, tools or tests. Runner behaviour not re-run.

### UI-025
Verdict: confirmed
Corrected severity: Info
Reason: runtime.ts:2652-2657 keeps "FIXME" unless text is defined, and :2646 keeps the unused value read. This matches my recollection of Item_Bind_Paint; no source copy was available to compare.
