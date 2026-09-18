# September 18 integration evidence

This record reconciles the original functional targets with actual production callers. It records source implementation and bounded execution separately from executable delivery, full playthroughs, physical audio, native peers, and overall frame rate.

| Target | Implemented behavior and current evidence |
|---|---|
| T10 | Original QuakeC, native Q2 game modules, and Q3 QVMs use the shared world and host services. Independent declared projectile behaviors preserve original code and exact module identity. QC, QVM and API2023 Windows x64 native declarations have external package-loading paths; native saves also retain the full normalized profile. Public Homefix, Copper, Instagib, native Faster rockets, and QVM homing workflows include firing and saved continuation. Early client/UI adapters have source coverage; matching legacy client artifacts remain unwitnessed. |
| T13 | Authored navigation, train approach/ride/exit, objective ownership, rerelease path queries, identities, chat, and saved bot state have consumers. Three actual native/mixed bot save-continuation cases passed. |
| T14 | Authored spawn points, next-server travel syntax, unit history, revisits, starting inventory, campaign media, help, and completion statistics reach the Application. No per-map exceptions were added. |
| T15 | Eligibility follows the selected rule source. Objective preflight checks the final game type before expensive startup and rejects maps missing required anchors. Source mode and round consumers remain joined. |
| T16 | Public save/load supports shared mixed state and original Q1 v5/v6 export/import. Actual original-format exports restored the source position and accepted fresh movement. Native rerelease and independent guest component continuation passed their separate workflows. |
| T17 | Source pickup preferences, authored default-binding reset, mounted libraries, progression, HUD, and postgame controls have public consumers. Reset uses the selected product and preserves per-seat ownership. Opaque source modules retain control of their own pickup policy. |
| T18 | Per-seat language is archived and reaches live localized text, prompts, sound captions, and media captions. Existing glyph fallback, accessibility, and independent scale controls retain their consumers. |
| T19 | Durable progress browsing, Q2 match records, authored arena progress, Team Arena demo lookup/play, and Q3 ranking reports/account controls are implemented. The retained client now owns prepared lobby rooms, readiness, actual launch, return, and next-session state. Native classic reports follow authenticated module command provenance; rerelease reports use explicit public intermission fields. Original GRank SDK transport and service compatibility remain unavailable in this client. |
| T20 | Public recording/replay, source libraries, MVD/GTV, KEX recorded views, server recording, VCR/journal ownership, and ordered shutdown have consumers. Actual public record/stop/replay preserved seat/client/session identity and returned to the frontend at EOF. |
| T21 | Fullscreen stills, cinematic decoding/audio/captions, Q2 campaign transitions, Q3 system cinematics, and shader video maps have consumers. Actual OGV decoding and public campaign skip/EOF checks remain the bounded evidence. |
| T22 | Source capture clocks, screenshots/readback, camera/view handling, and diagnostics reach their public owners. Remote capture now shares the source capture clock. Public replay produced an inspected complete rendered frame. |
| T23 | Provider selection, model/effort choices, callback flow, cancellation, command documentation, and validated execution have consumers. Existing-account public ask/exec passed. A fresh real-provider sign-in remains manual validation. |

## Actual mod and save workflows

- [Public QVM homing](../../.artifacts/resume-20260918/public-qvm-homing/receipt.json): original authored Q3 homing code attached to a Q2 rocket, public save/load, and matching resumed trajectory through retirement. The package retains author sources and build provenance.
- [Public native rocket component](../../.artifacts/resume-20260918/public-native-rocket2/RESULT.md): actual native Q2Eaks Faster rockets attached to a Q3 rocket, private source state, and saved continuation.
- [Public external native declaration](../../.artifacts/resume-20260918/public-native-declaration/receipt.json): public `declare-native` installation of a distinct authored profile, actual Q2Eaks trajectory on a Q3 launcher, exact declaration retention, and matching public save/load continuation. The 58.236-second source workflow retained 2,582 unchanged inputs.
- [Native rerelease restore](../../.artifacts/resume-20260918/t13-rr-continuation/receipt.json): exact saved source position and resumed movement/fire. Opening took 155.206 seconds; this remains slow.
- [Original Q1 saves](../../.artifacts/resume-20260918/public-original-save/receipt.json): v5 and v6 public export/import, exact restored position, and 500 ms of fresh movement per format. This was same-process restoration.
- [Native bot saves](../../.artifacts/resume-20260918/public-original-save/native-bot-receipt.json): Q1 rerelease, Q2 rerelease, and Q1 with Q2 movement/Q3 character, with exact saved decision/state continuation in fresh simulations.
- [Public demo ownership](../../.artifacts/resume-20260918/public-demo-owner/receipt.md): recorded 11,041 bytes, replayed 19 advancing source frames, matched final camera/position, inspected CPU-rendered output, and preserved the retained client through EOF.
- [Public lobby ownership](../../.artifacts/resume-20260918/public-lobby-owner/receipt.md): keyboard room creation and readiness, actual listening host, retained membership/client/seat on return, a second match generation, and explicit leave/teardown. This uses the local service, not a retail platform lobby.

These cases do not establish automatic extraction of arbitrary mod semantics. Exact source artifacts and declared private layouts remain necessary where the original module has no standard component interface. Community maps use their original BSP or full PK3 and companion files; loading checks are not full-map playthroughs.

## Performance changes

MD5 joint poses are reused between shadow and color passes for one view. Indexed cache keys retain model/frame/interpolation identity without a linear search. Three paired component measurements improved by 21.8–25.7%, with exact geometry and pass behavior.

Shadow-only preparation skips unused color computation while retaining geometry, alpha, and deformation inputs. Three paired component measurements improved by 4.2–8.3%. Final shadow silhouettes and depth operations were unchanged. These measurements overlap in workload and must not be added together.

The native interpreter classifies canonical addresses with exact range comparisons rather than a BigInt shift on every check. Complete CPU-state/fault parity passed. The later paired interpreter samples improved by 9.1% and 9.3%. None of these component results establishes a whole-game FPS or native-load-time improvement.

Evidence: [MD5 cache](../../.artifacts/resume-20260918/md5-frame-pose-indexed), [shadow preparation](../../.artifacts/resume-20260918/shadow-color-skip2/RESULT.md), [address classification](../../.artifacts/resume-20260918/canonical-address-range/RESULT.md).

## Remaining T19 service boundary

The original Quake III server calls external GRank SDK functions for login, match creation and submission. The current client implements the typed lifecycle and source reports, but it does not bundle a compatible SDK transport/provider. Enabling that service reports its unavailability. Local lobby rooms and durable progress records do not establish compatibility with the original online service. [Original server interface](https://github.com/id-Software/Quake-III-Arena/blob/master/code/server/sv_rankings.c).

## Latest executable delivery

Installed `71f0e4` includes external native declarations/full saved identity, qualified model/GL/native-memory optimizations, the player-preference registration fix, and movement selection by family, exact product, or `qw` with common catalog/menu/restore normalization. Build/source guards and `--help` passed. The exact executable also passed direct `--movement qw` on Q1 classic geometry with Q3 Ranger and default Q1 weapons, fresh controls, a public save retaining the selected movement, and normal Quit. See [execution status](../execution-status.md#installed-executable-and-recent-fixes) for exact identity and runtime evidence. The [GL pixel/depth check](../../.artifacts/resume-20260918/gl-layout-native/RESULT.md) and [native scalar-store workflow](../../.artifacts/resume-20260918/scalar-store-native/receipt.json) remain separate source qualifications.

The earlier `065259c` executable passed the [bounded mixed-game GL follow-up](../../.artifacts/resume-20260918/compiled-mixed-065259c/RESULT.md): complete Custom summary, two five-second control segments, an inspected visible scene, menu return and normal Quit. Source/assets/binary guards passed and processes were reaped. This is separate from the source native component save/load proof; it does not claim every model replacement, physical audio, whole campaigns, or improved desktop FPS.

## Projectile behavior picker correction

The Custom game projectile picker previously filtered discovery to Q1 products, despite the shared discovery service supporting declared QVM and native rerelease components. It now enumerates every installed provider. Existing declaration validation, disabled-choice reasons, and selection rejection remain in use. A focused installed-content check selected QC, QVM, and rerelease-native entries, rejected an unavailable choice, and preserved selection through a second `prepareMaps()` call (1 test, 13 assertions). The check is explicitly opt-in because it requires the installed example mod declarations.

The final two menu paths passed strict TypeScript and scoped policy checks with 1,951 loaded files and 2,578 unchanged input guards. [Source and retained check](../../.artifacts/resume-20260918/behavior-menu-all-providers/README.md). This correction and exact-envelope collision reuse are newer than installed `71f0e4`; the current delivery remains recorded in [execution status](../execution-status.md#installed-executable-and-recent-fixes).
