# Functional target status

After the accepted T06 console/profile implementation: **7/23 targets complete; 16/23 open. T07 is active.** Installed `5781b0d` includes T05, T06 and the accepted unified/DOSBox IPX slices. These are the functional targets defined in [the shared-engine plan](README.md), not source inventory counts. Integrated source changes do not close a target until its required behavior and public consumers are qualified together.

Installed executable is `5781b0db0d074bb85002c471427a8d9f1bbe7347`, including accepted unified networking, DOSBox IPX, T05, T06 and prior integrations; see [execution status](../execution-status.md#installed-executable-and-recent-fixes) for exact identity and bounded delivery evidence. T05 native source verification passed 39 assertions in 31.7 seconds; T06 existing checks passed 96 tests/918 assertions in 195 ms. The compiled delivery passed `--help` only; no compiled gameplay, physical-audio or FPS qualification is claimed.

The accepted [Application](../../src/app/bootstrap/application.ts) now consumes substantial content, local-input, HUD, progression, mode, campaign, save and tool work. The table separates those integrations from remaining implementation and verification. It does not repeat obsolete blanket instructions to join code that already has callers.

| Target | Function | Status | Accepted progress and remaining work |
|---|---|---|---|
| T01 | Session and resource lifetime | Complete in source | Retained client/profile publication and the current executable are delivered; remaining feature-specific public workflows keep their own acceptance boundaries. |
| T02 | Content and asset loading | Complete in accepted source | Product starts, mounted catalogs, replacement dimensions, add-on management and independent product restrictions are integrated; public add-on and authored arena workflows passed. Delivered in executable `30ea85d`. |
| T03 | Rendering and visual effects | Complete in accepted source | Shared CPU/GL rendering, live hardware profiles, source candle effects and renderer-worker restart/capture are qualified. Worker execution defaults off; exact source `333f011` is installed. No FPS or exhaustive pixel-parity claim. |
| T04 | Audio and music | Complete in accepted source | Shared commands, source voices/music, PCM output and geometry policy are integrated and installed. Quiet-rocket perception and physical listening remain open validation, not claimed fixes. |
| T05 | Input and local players | Complete in accepted source | Local tuning/devices and remote per-seat connections, prediction, views, promotion/rejoin and startup seat preservation are joined. The actual Q2 two-peer workflow passed; physical devices and other native-peer combinations retain their validation limits. |
| T06 | Console, cvars and profiles | Complete in accepted source | Command/profile/library consumers, dedicated binding persistence, actual menu save/exec results and Q1 initial command-line script ordering are joined. Focused combined console/configuration checks passed; exhaustive native-console interaction coverage remains unclaimed. |
| T07 | Network connections and prediction | Active | Mixed-game UDP sessions now negotiate content, predict movement, retain local seats and survive travel/restart. DOSBox IPX is selectable for NQ/Q2/Q3. Native IPX now has Linux and Windows socket bindings, requiring an installed OS provider. KEX 2023 lobby transport remains implementation work; broader native-peer coverage is deferred. |
| T08 | Downloads and content acquisition | Complete in accepted source | Public Q2 transfer controls/remount/fallback and QW mod-host policies passed, alongside retained Q3/QW client evidence. Accepted in the check13 composition; delivered in executable `30ea85d`. |
| T09 | Server discovery and administration | Active | Browser, host launch, rotation/profile selection and authenticated source administration are joined. Local identity, Q1 operator commands, Q2 chase HUD and Q3 pause/capture permissions remain implementation work; broader peer coverage is deferred. |
| T10 | Gamecode and mod execution | Open | Native guest services and world adapters have progressed. Private CTF and Xatrix single-player checks passed; native Application joins, required ABI/lifecycle coverage and additional modules remain. |
| T11 | Collision, movement and scale | Open | Source corpse/gib query behavior is integrated. Complete movement/body and cross-source scale qualification without changing native world scale. |
| T12 | Combat, rosters, pickups and equipment | Open | Expansion supply, arsenal and item-visibility consumers are integrated. Four mixed-expansion flows passed across successive private checks; broader weapons, rosters and resource combinations remain. |
| T13 | Bots, AI and navigation | Open | Selected-arsenal observations, native knowledge and navigation consumers are integrated. Qualify routes, objectives, mixed rosters and saved continuation. |
| T14 | Maps, campaigns and authored interactions | Open | Unit history, revisits, authored starting inventory and campaign presentation are integrated. Qualify full travel chains and restored authored world state. |
| T15 | Match modes and objectives | Open | Source-selected mode/objective and rerelease-item consumers are integrated. Qualify native and mixed mode workflows, including public setup and completion. |
| T16 | Saves and recovery | Open | Original Q1 save and timed/source autosave paths are integrated. Earlier installed `6d6f60b` passed named save/load, exact player-position restoration and fresh input after an 8-second corrective run; separate Main/Quit passed. Older-save compatibility, native-format Application joins and broader recovery remain open. |
| T17 | Menus, HUD and user experience | Open | Source HUD, guidance, settings and postgame menus have callers. Finish public libraries and progression browsing; inspect full workflows at supported sizes and seat layouts. |
| T18 | Localization and accessibility | Open | Font fallback, accessibility controls and media/voice caption consumers are integrated. Verify actual rendered language coverage, control usability and caption timing. |
| T19 | Progression and player services | Open | Durable local records, source arena progression and postgame consumers are integrated. Finish generic progress browsing and TA demo playback callers, then verify fresh-profile persistence. External ranking/native-peer service compatibility remains explicitly limited. |
| T20 | Demos, recording and replay | Open | Recording, playback and seed-capture work has advanced. Finish public library/session joins and required MVD/GTV, VCR/journal and per-family recording/replay qualification. |
| T21 | Cinematics and animated media | Open | Decoder and Application media consumers are integrated. Finish Main movie-library consumers and verify audio, captions, skip/completion and map transitions. |
| T22 | Cameras, diagnostics and tools | Open | Application camera/capture clocks, diagnostics and tool entry points are integrated. Qualify real operations, joined-seat camera behavior and captured output. |
| T23 | LLM assistance | Open | Implemented provider/model/effort, cancellation and validated execution have checks. Real existing-subscription public ask and echo execution passed. Fresh real-provider browser sign-in/callback remains unwitnessed; no implementation defect is currently identified. |

Private evidence remains narrower than whole-target completion. T10's CTF callback-file reconstruction and Xatrix single-player check passed 2 tests with 77 assertions, while native Application joins remain open. The CTF case does not authorize original deathmatch saves: its source reinitializes the player on admission; Xatrix retained living-player continuation. See the machine-local [source boundary](../../.artifacts/resume-20260916/targets/t10/final/source-boundary.md). T12's wave7 passed three mixed-expansion flows and failed the Rogue firing check; wave8 passed that corrected fourth flow. These are successive source checks, not an installed four-flow run. Machine-local evidence: [wave7](../../.artifacts/resume-20260916/targets/t12/wave7/run.qkFJHu/tests.log), [wave8](../../.artifacts/resume-20260916/targets/t12/wave8/run.izKbzF/tests.log).

T23 now has real existing-account evidence: public `llm_ask` and `llm_exec` each received HTTP 200; the generated echo batch was displayed, validated and executed by the ordinary handler. Settings stayed unchanged and both captures were inspected. Controlled callback tests pass, but a fresh real-provider browser authorization through this menu/callback has not been witnessed. This precise verification gap keeps T23 open. Machine-local evidence: [receipt](../../.artifacts/resume-20260916/targets/t23-real-fixed/receipt.md), [reconciliation](../../.artifacts/resume-20260916/targets/t23-real-fixed/reconciliation.md).

The historical 477-row source ledger is unchanged. This update neither re-audits that inventory nor converts reviewed rows into completed functional targets.

## T01 session and resource lifetime

Completed source behavior:

- One retained client keeps seat identities, input/bindings, console programs, canonical settings and renderer/audio ownership across local, remote, demo, save and menu transitions.
- Local and remote configuration is prepared before publication. A server-selected content profile transfers into the existing protocol cvar registry and input/command owners.
- Configuration scripts resume at an ordinary frame boundary. A script containing `wait` or `disconnect` can retire a suspended packet decoder and continue on the frontend.
- Preparation failures preserve the prior published source. Once publication has irreversibly retired it, failures use fatal cleanup rather than claiming rollback. Resource cleanup and pending decoder cancellation are explicit.

Evidence is combined from several runs, not a claim that one run exercised every path:

| Evidence | What it establishes |
|---|---|
| [Compiled retained-client flow](../../.artifacts/resume-20260915/final-shared-borrower11/runtime-proof.json) | Mixed local play, Q1 demo playback, menus, Main Load and resumed saved-world play; 35.196 seconds of controls and 119 frames after restoration. |
| [Compiled console flow](../../.artifacts/resume-20260915/final-shared-console16/runtime-proof.json) | Initial menu remains on Main; ordered console/capture/configuration operations survive world, demo, save and frontend transitions. |
| [Initial remote profile check](../../.artifacts/resume-20260916/remote-config-native2/receipt.json) | Actual Q2 default/config/autoexec before sign-on, preserving borrowed input and command-buffer identities; 15 assertions. |
| [Peer-selected profile check](../../.artifacts/resume-20260916/peer-profile-native1/receipt.json) | Actual base-to-Xatrix profile, script continuation before active input, same-shell disconnect/reconnect and selected-script cancellation; 27 assertions. |
| [Accepted final source](../../.artifacts/resume-20260916/peer-profile3-check/commit-receipt.json) | Exact final file, strict/policy qualification, all 2,194 source inputs, committed and pushed as e3eea6a. |

The existing preparation/publication tests and source review cover their failure boundaries; this record does not claim a separate injected shell-publication failure was exercised in the compiled executable. It also does not close T05's additional local/remote seat features, T07's native protocol matrix, T20's remaining recording formats, or whole-frame performance.


## T02 content and asset loading

The composed source resolves 19 installed official campaign starts and keeps six custom/multiplayer products as separate choices. Active mounts supply arena/bot metadata, source ordering and saved unlocks. Independent Q3 prerelease policy is selected before asset resolution. The shared package catalog supports verified install, update, removal and launch while retaining files borrowed by active worlds. Replacement pixels preserve authored logical dimensions. Production check10 passed strict and policy checks for the composed source.

The authored training/Crash run on check12 passed skill 4, 30 seconds of controls, 157 frames and 28.450 seconds of source time, moving 334.875 units and firing ammo from 100 to 0, then Endgame → Main → Quit. Its 21 assertions passed and all 2,401 inputs remained unchanged. Root inspected the 320×240 CPU capture; this is not graphics-fidelity or performance evidence.

The final check13 add-on run passed 12 assertions in 48.52 seconds: installed `basetohell`, 15 seconds of controls, 187 frames and 139.8 units of movement, then death recovery → Endgame → Main → Q3 tier picker → Main → Quit. All 2,401 inputs and fixture guards remained unchanged. Root inspected the GL 640×480 live scene, tilted death view, Main and authored arena selection. Earlier fixture failures remain recorded. Arena5 production and fixture inputs are identical in check13. Root accepted T02 and the separately qualified T08 in this composition; commit `30ea85d` is now installed; the compiled delivery record is separate from these source runs. Machine-local evidence: [arena run](../../.artifacts/resume-20260916/targets/t02-public-arena5), [add-on run](../../.artifacts/resume-20260916/targets/t02-public-addon2). See the machine-local [integration evidence](../../.artifacts/resume-20260916/targets/t02-close/evidence.md).

The composed fixes generalize nested archive music listing, product-driven configuration/mod discovery and map-only add-on program inheritance while preserving configuration/save identity. They also retain QC/DLL/QVM ancestry and expansion rules/equipment and resolve duplicate pause-menu focus; these are shared behaviors, not one-package exceptions. These changes are included in installed `30ea85d`.

Actual IBSP44 geometry reached both CPU and GL prepared frames; this is format-consumption evidence, not pixel parity. Quake64 and demota media are absent, so their real-media appearance is unqualified. Discovered Xatrix native startup, asynchronous original-file restoration and retained travel passed bounded checks. Its 64.760-second cold launch and 1.376-second first explicit step are loading measurements, not steady FPS; performance remains open under T03/T10.

## T08 downloads and content acquisition

Completed in root-accepted check13 source, retaining the separately qualified standalone frontend/T08 workflows. This combines current checks with retained accepted workflows; it is not a claim that one new run exercised every protocol.

- The shared queue and contained staging retain verification, bounded HTTP concurrency, same-origin redirects, ETag range continuation, cancellation/retry and package remount ordering. The focused adapter/service run passed 52 tests.
- Actual Q2 public progress/cancel/retry passed 1 test with 20 assertions. Cancellation left no final file; retry reached active admission with exact bytes. Same-peer mod travel resolved a downloaded PACK member, and an HTTP404 loose dependency fell back to native transfer. Temporary source profiles explicitly enabled the tested permissions; installed settings were untouched.
- Actual dedicated QW mod hosting passed 1 test with 37 assertions over UDP, using the installed real qwprogs in a temporary user mod. It advertised the selected directory and enforced maps/models/sounds/skins denial then allowance, exact bytes, global denial, archived-map restrictions and traversal rejection. Catalog tests passed 2/25, including a user QW program overlaying an existing classic mod directory.
- Retained Q3 evidence covers first missing-package pure admission at b48bfea, 1/16, and interrupted second-package close/reopen at c578714, 1/134. The first package remained, the second partial was removed, reopen installed exact files, pure admission succeeded, and the guest initialized once.
- Retained QW client evidence at 820173d, 11/187, covers selected mod directories, shared skins, travel, cancellation and reopen. The old historical base-only client limitation is superseded.

Current proof: [Q2 runtime receipt](../../.artifacts/resume-20260916/targets/t08-workflow3/native-checked/receipt.json), [Q2 test log](../../.artifacts/resume-20260916/targets/t08-workflow3/native-checked/tests.log), [QW runtime receipt](../../.artifacts/resume-20260916/targets/t08-qw-host-workflow2/native-checked/receipt.json), and [QW test log](../../.artifacts/resume-20260916/targets/t08-qw-host-workflow2/native-checked/tests.log). All 2,358 Q2 and 2,364 QW source files stayed unchanged during their respective runs; both processes exited successfully and were reaped. Final QW runtime and fixture successors passed strict/policy checks over the qualified frontend7 baseline.

Earlier failed fixtures remain preserved. Q2 initially respected installed CTF settings that disabled sound downloads; explicit temporary profile permissions corrected the test. QW exposed a real stock-id1-only simulation admission guard, corrected to accept validated QW edition identities while retaining native-source constraints. Its next fixture needed ordinary idle user-command submission for active peer packet pacing; no download assertion or timeout was weakened.

Standard NetQuake has no native download opcode. Native retries restart where a verified resumable identity is unavailable; HTTP range continuation uses a strong ETag. No cross-process partial-file cache is claimed. Q3/QW public pause/retry joins have focused adapter coverage; the new actual public control run is Q2. This record does not close T07's external-peer matrix or expand the bounded installed-delivery evidence. The historical source-row ledger is unchanged.


## T03 rendering and visual effects

Root accepted and installed exact `333f011` after check5 strict/policy qualification. Compiled gameplay used check4 with identical worker/Application code; the final two-path candle delta was checked separately. This does not claim a full gameplay session on the final installed binary. The latter completed 30.199 seconds of controls, retained the recipe and binding, advanced source frames 218 → 803 → 1779, accepted fresh serial-mode input and exited through Main/Quit normally. Root inspected ready, gameplay, serial and Main captures. The embedded worker executed with checkout source inaccessible and no worker sidecar. Earlier runner failures are retained. [Machine-local compiled receipt](../../.artifacts/resume-20260917/t03-compiled-check4/proof-worker4/receipt.json).

The shared owner supports CPU/GL worker execution, serial/worker restart, ordered resources and captures, and failure cleanup. Worker execution defaults off; no performance gain is claimed. Live hardware getters reach shared Q3 effects/particles, and the final candle producer delta is source-qualified separately from the compiled check4 run. Six actual Q1/Q2/Q3 CPU/GL light/shadow cases support shared surface consumption. These bounded proofs do not establish every original image, driver or material combination.

The previously reported black pillar patch is authored BSP underside geometry with almost-black baked lightmap data, confirmed by GPU draw attribution and source samples. No renderer fix is justified; original-renderer image parity remains unmeasured. [Source attribution](../../.artifacts/resume-20260917/black-patch-t02-15/RESULT.md). Physical audio, whole-frame performance and full campaigns are not closed by T03 acceptance.


## T04 audio and music

Accepted and installed `ed1ceac` completes the known implementation obligations. Shared source-console commands now reach the existing audio owner, including authored Crash `play`. Strict/policy qualification passed; focused checks passed 6 tests/37 assertions and the actual three-family Application audio/Crash case passed 1 test/33 assertions. Earlier 45 jump routes and the TA fallback consumer are retained in the composed checks; they are not proof of every model in gameplay. [Application log](../../.artifacts/resume-20260917/t04-audio/command-audio3.log), [seven-row reconciliation](../../.artifacts/resume-20260917/t04-audio/remaining.md).

Runtime qualification used source before compilation, not a full session on the final installed binary. Listening validation remains open for the user’s quiet rockets: source-position, voice-lifetime and queue traces do not prove the perceived problem is fixed. Physical output and broader CIN/video behavior remain separate validation. Geometry acoustics is an explicit shared replacement policy, not proprietary A3D SDK identity. Native QC/QW foreign-character/movement admission remains a T10/T11 dependency; audio coverage alone does not support it. No additional T04 implementation gap is currently identified. T05 and T06 are accepted below; T07 is active.


## T05 input and local players

Remote local players now retain separate native connections, input/prediction and views under one client, renderer and audio owner. Players can join, leave and rejoin; removing the primary promotes a survivor without reconnecting it. Startup/browser connections retain the selected player count. Q2 userinfo uses the actual registry, including initial command-line names. Per-seat audio geometry follows its current remote scene.

The actual Q2 UDP workflow passed 39 assertions in 32.07 seconds, covering two admitted/rendered peers, input/fire/chat, primary promotion, rejoin, map change, same-map restart and disconnect. That workflow exposed and fixed a shared player-collision override that kept telefragged Q2 players solid, causing spawn admission to loop. Source solidity and corpse contents now reach shared collision; KillBox also checks remaining solidity independently of damageability. Temporary diagnostics were removed.

[Final source manifest](../../.artifacts/resume-20260917/t05-remote-check3/net-manifest.json), [strict/policy receipt](../../.artifacts/resume-20260917/t05-remote-check3/receipt.json), [runtime log](../../.artifacts/resume-20260917/t05-remote/native/run20.log). This is source implementation acceptance. It does not establish retail-peer interoperability, every protocol/device combination, physical audio or final executable delivery. Protocol compatibility remains T07; recorded playback retains its explicit single-camera policy under T20.


## T06 console, cvars and profiles

Dedicated configuration owns a real binding table without a local player or input device. Trusted console/scripts can bind, query, unbind and write configurations, including named controller buttons/triggers. Profile preparation stages bindings before publication. Writes capture their contents and destination at dispatch and finish before their script owner retires.

The configuration library reports actual saved/failed write results, refreshes its file list, and reports completed/missing/failed direct scripts. Older callbacks cannot replace the current profile or newer save status. Q1 initial profile scripts receive explicit command-line text at stuffcmds; later profiles do not replay it. The combined existing console/configuration checks passed 96 tests and 918 assertions in 195 ms. Strict/policy qualification is recorded in the accompanying check receipt. No new test infrastructure was added.

[Source manifest](../../.artifacts/resume-20260917/t06-console/final-manifest.json), [combined check log](../../.artifacts/resume-20260917/t06-console/combined-check2.log). This closes the known implementation gaps on top of retained command routing, discovery and persistence. It does not claim an exhaustive live replay of every console command or a native UI playthrough of these latest menu-status changes.

## T07 network transport progress

The accepted IPX slice makes DOSBox IPX selectable in NQ, Q2 and Q3 and honors the physical packet ceiling. The later native `AF_IPX` backend is described below and requires an OS provider. Final strict/policy checks passed with 2,425 unchanged inputs; central checks passed 23 tests/188 assertions and Q3 checks passed 23 tests/169 assertions. The slice is now installed in `5781b0d`; no native DOSBox peer run is claimed. The subsequently integrated mixed-game transport is described below. KEX transport keeps T07 active: **7/23 complete, 16 open**. [Qualification receipt](../../.artifacts/resume-20260917/t07-ipx-check2/receipt.json).


## T07 mixed-game connections

The unified transport carries the selected world, movement, character, weapons and roster between this client's instances. It uses explicit public presentation and movement state, canonical resource identities, local content verification, reliable ordered events and replaceable snapshots. Clients reuse the shared movement predictor and do not construct an authoritative simulation. Local seat identity, input and window ownership survive primary-player removal, rejoin, map travel and same-map restart. See [hosting and connecting](../networking-unified.md).

The existing two-seat UDP workflow passed on joined source: a Q1-profile client adopted a Q2 world with Q1 movement and Q3 Sarge, rendered, moved, fired, chatted with its configured name, promoted/rejoined seats, traveled to base2 and restarted base2. Runtime was 29.86 seconds with 41 assertions. Lossless frame compression reduced mean payload from 178,312 to 36,037 bytes across the respective workflow runs; this is a payload-size measurement, not an FPS or throughput claim. Bounded reliable pipelining avoids serial acknowledgement stalls.

Joined strict/policy checks passed. A subsequent reviewed two-file correction makes secondary seats wait for the primary's committed content epoch, preventing them from borrowing the old world's content during asynchronous loading. That final correction was reviewed after the runtime run; the run is not presented as exercising its changed timing. Evidence: [joined receipt](../../.artifacts/resume-20260917/t07-unified-joined-check4/receipt.json), [runtime log](../../.artifacts/resume-20260917/t07-unified/runtime/native/run6.log), [epoch correction](../../.artifacts/resume-20260917/t07-unified/committed-offer-fix1/change.patch).

T07 stays open for KEX 2023's lower lobby/session protocol. Public KEX documentation supplies game-level connection messages but not the required outer transport. Native-peer matrices remain unrun coverage; additional testing infrastructure is deferred while implementation proceeds. Native guest execution and unified recording retain their T10 and T20 boundaries. Installed `5781b0d` passed `--help` only. The 29.86-second two-seat source proof and subsequent reviewed two-file content-epoch correction remain separate evidence; no compiled gameplay, physical-audio or FPS qualification is claimed.


### Native IPX socket backend

Native IPX now binds actual nonblocking OS sockets through the existing transport contract. Linux x64/arm64 uses glibc; Windows x64 uses Winsock. Both implement broadcast, packet type, address conversion, datagram limits, readable notifications and owned cleanup. The library is loaded only when native IPX is selected. DOSBox IPX remains a separately selected transport.

The four changed roots passed strict/policy checking. An actual application-capability bind on this Linux x64 host reached libc and returned `EAFNOSUPPORT (97)`: this kernel has no installed IPX provider. That verifies the explicit unsupported-host path, not an IPX packet exchange. Windows execution and a successful configured native-IPX exchange remain unverified. [Backend receipt](../../.artifacts/resume-20260917/t07-native-ipx/receipt.md), [bind result](../../.artifacts/resume-20260917/t07-native-ipx/bind.log). This backend is accepted source; the installed `5781b0d` executable predates it.

## T09 discovery and administration progress

The menu now selects local play, native-client hosting or mixed-game hosting, with an editable port and an appropriate initial multiplayer mode. Saved server profile paths resolve through their actual settings store. The rotation editor changes the bound source setting. Selected maps receive cached spawn/objective validation when the chosen rules require it, without a full map scan during startup.

Application now joins source rcon, actual command output, filters, master publication and retained operator state. Native rcon dispatch preserves source single-command semantics; limited Q2 administration preserves literal arguments and the source prefix/rate policy. Startup operator commands retain configuration ordering. Q3 master DNS runs outside the frame loop, deduplicates pending work and discards stale results. Source Q3 bans remain at ClientConnect.

The combined production paths passed strict TypeScript and scoped policy checks. The existing actual Q2 UDP Application case passed 65 assertions in 9.53 seconds, including authenticated output and a server cvar update; the selected-map/host settings case passed 39 assertions. Source behavior intentionally retains classic Q2 rcon token reconstruction. These are focused source checks, not compiled gameplay or a retail-peer matrix. [Composition](../../.artifacts/resume-20260917/t09-integration/net-manifest.json), [Application result](../../.artifacts/resume-20260917/t09-integration/rcon-application-check3.log).

T09 remains active for local Q1/Q2 identity propagation, Q1 pause/ping/status, shared Q2 spectator HUD selection and Q3 source pause/levelshot policy. Unrun broader peer coverage is recorded separately from these implementation gaps. The current installed executable remains `5781b0d` until the next delivery.
