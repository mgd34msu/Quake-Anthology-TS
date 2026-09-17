# Functional target status

At accepted source `6103c976f2abd315176206ebe190661173204fb4`: **1/23 targets complete; 22/23 open.** These are the functional targets defined in [the shared-engine plan](README.md), not source inventory counts. Integrated source changes do not close a target until its required behavior and public consumers are qualified together.

Installed executable is `6103c976f2abd315176206ebe190661173204fb4`, including the prior integrations and current delivery fixes; see [execution status](../execution-status.md#installed-executable-and-recent-fixes) for exact identity and bounded delivery evidence.

The accepted [Application](../../src/app/bootstrap/application.ts) now consumes substantial content, local-input, HUD, progression, mode, campaign, save and tool work. The table separates those integrations from remaining implementation and verification. It does not repeat obsolete blanket instructions to join code that already has callers.

| Target | Function | Status | Accepted progress and remaining work |
|---|---|---|---|
| T01 | Session and resource lifetime | Complete in source | Retained client/profile publication and the current executable are delivered; remaining feature-specific public workflows keep their own acceptance boundaries. |
| T02 | Content and asset loading | Open | Codecs, product policy and restricted-content resolution are integrated. Qualify required products, remounting and public frontend selection, including independent prerelease rules. |
| T03 | Rendering and visual effects | Open | Source effects, shadows, Q64 materials and diagnostics have consumers. The installed proof still shows a black triangular pillar defect. Inspect combined CPU/GL output; remaining fidelity and whole-frame performance are unqualified. |
| T04 | Audio and music | Open | Acoustics, music commands and voice timing are integrated. Generalized jump audio remains in progress: model lookup coverage does not close private Q3 event-routing/Q2 voice-selection defects. Qualify physical output and relative weapon/explosion loudness. |
| T05 | Input and local players | Open | Device assignment, source look controls and live local-seat paths are integrated. Complete joined-seat camera/angle checks and the protocol-specific remote-seat matrix. |
| T06 | Console, cvars and profiles | Open | Shared command/profile consumers are integrated. Finish public library/frontend callers and verify script routing and persistence across source changes. |
| T07 | Network connections and prediction | Open | Retained connection foundations are accepted; additional admission/transport work remains separately qualified. Complete native peers in both directions, prediction and KEX 2023 transport. |
| T08 | Downloads and content acquisition | Open | Remote progress/cancel/retry presentation is prepared. Finish public caller qualification, interrupted downloads, missing-content joins and package remounting. |
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
