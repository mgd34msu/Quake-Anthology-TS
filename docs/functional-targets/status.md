# Functional target status

At accepted and installed source `30ea85dfac940396ef7fa6b60c49d4c47f22d3f4`: **3/23 targets complete; 20/23 open.** These are the functional targets defined in [the shared-engine plan](README.md), not source inventory counts. Integrated source changes do not close a target until its required behavior and public consumers are qualified together.

Installed executable is `30ea85dfac940396ef7fa6b60c49d4c47f22d3f4`, including the prior integrations and current delivery fixes; see [execution status](../execution-status.md#installed-executable-and-recent-fixes) for exact identity and bounded delivery evidence.

The accepted [Application](../../src/app/bootstrap/application.ts) now consumes substantial content, local-input, HUD, progression, mode, campaign, save and tool work. The table separates those integrations from remaining implementation and verification. It does not repeat obsolete blanket instructions to join code that already has callers.

| Target | Function | Status | Accepted progress and remaining work |
|---|---|---|---|
| T01 | Session and resource lifetime | Complete in source | Retained client/profile publication and the current executable are delivered; remaining feature-specific public workflows keep their own acceptance boundaries. |
| T02 | Content and asset loading | Complete in accepted source | Product starts, mounted catalogs, replacement dimensions, add-on management and independent product restrictions are integrated; public add-on and authored arena workflows passed. Delivered in executable `30ea85d`. |
| T03 | Rendering and visual effects | Open | Source effects, shadows, Q64 materials and diagnostics have consumers. The installed proof still shows a black triangular pillar defect. Inspect combined CPU/GL output; remaining fidelity and whole-frame performance are unqualified. |
| T04 | Audio and music | Open | Acoustics, music commands and voice timing are integrated. Generalized jump audio remains in progress: model lookup coverage does not close private Q3 event-routing/Q2 voice-selection defects. The authored Crash run also reports an unbound source `play` command. Qualify that routing, physical output and relative weapon/explosion loudness. |
| T05 | Input and local players | Open | Device assignment, source look controls and live local-seat paths are integrated. Complete joined-seat camera/angle checks and the protocol-specific remote-seat matrix. |
| T06 | Console, cvars and profiles | Open | Shared command/profile consumers are integrated. Finish public library/frontend callers and verify script routing and persistence across source changes. |
| T07 | Network connections and prediction | Open | Retained connection foundations are accepted; additional admission/transport work remains separately qualified. Complete native peers in both directions, prediction and KEX 2023 transport. |
| T08 | Downloads and content acquisition | Complete in accepted source | Public Q2 transfer controls/remount/fallback and QW mod-host policies passed, alongside retained Q3/QW client evidence. Accepted in the check13 composition; delivered in executable `30ea85d`. |
| T09 | Server discovery and administration | Open | Browser/source administration helpers are present. Finish public discovery, query, join, rcon and host-profile workflows against real peers. |
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
