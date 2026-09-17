# Functional target status

At accepted source `e3eea6a123ddae4ab13c2dd1378cb2f9e1da2333`: **1/23 targets complete; 22/23 open.** These are the functional targets defined in [the shared-engine plan](README.md), not source inventory counts. Candidate implementations are recorded as open until their required consumers work together.

Installed executable: `68219cce77608429be92462a377ccbb07854a524`. The final T01 remote changes are accepted source awaiting executable delivery. The status below does not claim those changes are installed.

| Target | Function | Status | Remaining work or delivery |
|---|---|---|---|
| T01 | Session and resource lifetime | Complete in source | Accepted e3eea6a; final remote configuration/profile changes await the next executable. |
| T02 | Content and asset loading | Open | Join new codecs and product restrictions to launch and renderer consumers; qualify required products and remounting. |
| T03 | Rendering and visual effects | Open | Join source effects, shadows, Q64 material handling and live diagnostics; inspect combined CPU/GL output and measure performance. |
| T04 | Audio and music | Open | Join geometry acoustics, music commands and voice timing; qualify relative weapon/explosion loudness and actual output. |
| T05 | Input and local players | Open | Join device ownership and assignment, source look controls, live seat join/drop and protocol-specific remote seats. |
| T06 | Console, cvars and profiles | Open | Integrate command/script semantics, profile migration and libraries with actual feature commands; check public routing and persistence. |
| T07 | Network connections and prediction | Open | Integrate dialect, admission, prediction and transport changes; native peer matrix remains incomplete, including KEX 2023 transport. |
| T08 | Downloads and content acquisition | Open | Join progress/cancel/retry controls to the remote client; qualify interrupted and missing-content joins with package remounting. |
| T09 | Server discovery and administration | Open | Join browser, master/rcon, host profiles, map eligibility and source administration; qualify real discovery/join/admin flows. |
| T10 | Gamecode and mod execution | Open | Join native Q2 guest services and QuakeWorld spectator behavior; qualify actual modules, required ABIs and lifecycle operations. |
| T11 | Collision, movement and scale | Open | Join source corpse/gib query behavior; finish movement/body and scale qualification without changing native source/world scale. |
| T12 | Combat, rosters, pickups and equipment | Open | Join item visibility and expansion arsenal changes; complete foreign expansion resources, roster mappings and gameplay behavior. |
| T13 | Bots, AI and navigation | Open | Join native bot knowledge, selected arsenal observations and navigation tools; qualify routes, objectives and saved continuation. |
| T14 | Maps, campaigns and authored interactions | Open | Join unit history, revisits, authored starting inventory and campaign presentation; qualify travel and restored world state. |
| T15 | Match modes and objectives | Open | Join source-selected modes/objectives and remaining rerelease item rules; qualify native and mixed mode workflows. |
| T16 | Saves and recovery | Open | Join original Q1 saves and timed/source autosave policies; qualify restoration, transition state and recovery menus. |
| T17 | Menus, HUD and user experience | Open | Join source HUD and guidance, settings, libraries and progression; inspect full menu workflows at supported sizes and seat layouts. |
| T18 | Localization and accessibility | Open | Join language/font fallback, accessibility controls and actual voice/media captions; inspect rendered output. |
| T19 | Progression and player services | Open | Join durable records, postgame flow, product policy and service reporting; qualify persistence and distinguish unavailable external services. |
| T20 | Demos, recording and replay | Open | Join recording and seed capture for all families; complete MVD/GTV, VCR/journals and actual public playback workflows. |
| T21 | Cinematics and animated media | Open | Join qualified OGV decoder to application, world/menu media, audio and captions; qualify skip/completion/map transitions. |
| T22 | Cameras, diagnostics and tools | Open | Join source camera and capture clocks, real diagnostics and tool entry points to the application; qualify actual operations. |
| T23 | LLM assistance | Open | Integrate Responses/provider/model/effort/cancellation changes; real-account sign-in and inference remain unverified. |

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
