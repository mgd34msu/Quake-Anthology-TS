# Execution status

Implementation is authorized through the full engine until the user explicitly stops it. This ledger records the lead's dispatches and handoffs. Historical planning-only source assessments remain historical evidence. The current canonical graph contains 74 packages and 303 acceptance dependency edges after the user-directed code-first sequencing change.

The implementation phase started from `6439acd6c5f0d38ca93867ae0f6100ecf4cdbee4`. The latest committed implementation checkpoint is `5278a70bb5579bc8dfd28a05d1693b2acf4db0e3` with tree `ec1587f888a45186cf42676aa241fd929158ea49`. It follows `dd5c4c7` shared application/content composition, `3ef9b4a` combat/save ordering, and `454a5af` interpreted native guest execution. Further edits in the live tree require their own review. W03 remains accepted only for its recorded early tooling scope. Other package states record work underway, not full acceptance. The diagram records acceptance dependencies and cannot supply a completion percentage.

## Current source and runtime state

The lead reports build, typecheck and policy passes for the successor, with 111 unique scoped tests and 1,249 assertions. The lead also ran the same compiled executable on CPU with rerelease Rogue `rboss`, Q1 movement and Q3 Sarge, and on GL with CTF `q2ctf1`, two local seats, Q3 movement and a Q1 character. These are bounded checks of the recorded successor, not full CPU/GL content acceptance. This documentation refresh did not rerun gameplay.

| Work | Confirmed bounded progress | Remaining dependency or evidence |
| --- | --- | --- |
| W73/W74 first playable | Mixed-provider CPU/GL gameplay, firing, local seats and travel have live evidence. | Complete specimen mission, fresh-process and co-op criteria remain subject to formal acceptance. |
| W41–W51 content and composition | Shared application and source combat/save checkpoints are committed. Successor joins include Q2 modes/UI, Q1 Machine bosses/AI, Q2 rerelease monsters/contacts, and the Q3 body/link correction. | Finish source-specific behavior and composition scopes before accepting W50/W51 or W66. File presence does not prove parity. |
| W23 saves | Q1/Q2 capture and restoration are implemented; reported application checks cover CTF/LMCTF save restoration and captures. | Full source-private continuation, all original formats and every provider remain open. Q3 and guest save support are not inferred from Q1/Q2 results. |
| W47 CTF/LMCTF | Modes are connected through Q2 composition, application selection and save restoration. Additional referee, tournament and plasma work landed after the successor snapshot. | Full-match, administration, HUD, voting and pause workflows remain partial and need combined verification. |
| W57/W58 bots and navigation | Production bots move, fire, restart and travel in reported application checks; navigation implementation is being connected to production monster hosts. | Machine path-entity integration and complete map-format navigation remain active. The standalone arena bot check still gets zero shots. |
| W18/W19/W59 presentation | The successor passed the specified compiled CPU and two-seat GL runs. | Generic Q2 dynamic-light shadow metadata/rendering and complete presentation/workflow coverage remain open. |
| W30–W40 guests | Interpreted native loaders/execution are committed; native message/sound and compatibility work continues. | Callback coverage, semantic overrides and full required mod gameplay remain incomplete. W40 is a required later integration gate. |
| W66–W72 integration and release | W66 application integration is underway, with bounded runtime evidence above. | Complete W66, native gameplay W40 and performance W68 before full W67 configuration accounting, Linux artifact qualification, independent review and release closure. |

The main remaining chains are official gameplay → W50/W51 → W60/W66; bots/navigation → W61/W66; and W66 plus native execution → W40. W67 also requires independent evidence W63–W65, content completeness W07 and performance W68. Broad hardening follows imports, live human play and optimization under the user's code-first sequence. No full package is accepted by this refresh.

## Current coordination

The lead assigns exclusive paths and uses Astra at low or medium effort for current recovery tasks. `recover_application_commit` serializes Git changes. Historical owner names and xhigh dispatches below do not assign current ownership or effort. The lead must assign any new work explicitly.

## Historical handoffs at the core checkpoint

The following table records the earlier core-checkpoint handoff. Agent names are relative to `/root/`. Those dispatches used `gpt-6-astra` with `xhigh` effort and `review_w06_platform` as Git writer. They are retained as history and do not override current lead assignments.

| Work | Current owner | Exclusive paths or bounded handoff |
| --- | --- | --- |
| W23 and W41 state | `w41_actors` | `src/persistence/**`, `src/world/actors/**`, `src/world/gameplay/**`, and corresponding existing checks; real identity and save joins |
| W42 Q1 base | `w42_q1_base` | `src/content/q1/base/**`, `tests/gameplay/q1-base/**` |
| W43 Q1 mission packs | `w59_native_ui` | `src/content/q1/missionpacks/**`, `tests/gameplay/q1-missionpacks/**`; earlier native UI slice handed off |
| W44 Q1 additions | `w49_q3_modes` | `src/content/q1/addons/**` and corresponding checks; running source import |
| W45 Q2 base | `w45_q2_base` | `src/content/q2/base/**` except `player/**` and the completed `entities/**` slice, with matching base checks |
| W45 Q2 player | `w45_q2_player` | `src/content/q2/base/player/**` and matching player checks |
| W46 Q2 mission packs | `w45_q2_entities` | `src/content/q2/missionpacks/**`, `tests/gameplay/q2-missionpacks/**`; earlier 38-entity source slice handed off |
| W46 Q2 mission-pack monsters | `w45_q2_base` | Monster subtrees within `src/content/q2/missionpacks/**` and matching checks, reserved from the W46 parent |
| W48 Q2 rerelease | `w45_q2_player` | `src/content/q2/rerelease/**` except `monsters/**`, and corresponding rerelease checks except monster checks; running source import |
| W48 Q2 rerelease monsters | `plan_validator` | `src/content/q2/rerelease/monsters/**`, `tests/gameplay/q2-rerelease/monsters/**`; source-specific registration over the shared Q2 monster controller |
| W74 Q1 restoration | `w74_q1_foundation` | `src/content/q1/foundation/**` and corresponding existing checks |
| W74 Q2 restoration | `w74_q2_foundation` | `src/content/q2/foundation/**` except the separately owned monster and weapon paths |
| W74 Q2 monsters | `w14_q3_models` | `src/content/q2/foundation/monsters/**` and matching checks; finishing this source slice |
| W54 Q2 network | `w54_q2_network` | `src/network/q2/**`, `tests/network/q2/**` |
| W73 network integration | `w54_q2_network` | `src/app/bootstrap/network/**` |
| W31 PE | `w01_q1_features` | `src/guest/pe/**`, `tests/guest/pe/**` |
| W32 ELF | `w01_q2_features` | `src/guest/elf/**`, `tests/guest/elf/**` |
| W33 i386 | `w02_q1_reference` | `src/guest/x86/**`, `tests/guest/x86/**` |
| W34 x64 | `w02_q2_reference` | `src/guest/x64/**`, `tests/guest/x64/**` |
| W35 floating-point | `w02_q3_reference` | `src/guest/floating-point/**`, `tests/guest/floating-point/**` |
| W36 ABI | `w01_products` | `src/guest/abi/**`, `tests/guest/abi/**`; this dispatch uses `xhigh`, superseding its earlier inventory effort |
| W73 Q3 host | `w49_q3_gameplay` | `src/app/bootstrap/simulation/q3/**`, under the lead's narrow bootstrap handoff |
| W73 effects | `w49_q3_presentation` | `src/app/bootstrap/effects.ts` |
| W73 audio | `w18_cpu` | `src/app/bootstrap/audio.ts` |
| W17 and W15 corrections | `w17_scene_world` | Scene shadow caster and `src/materials/legacy-fog.ts`; other material writes stay with their owner |
| Build and commit writer | `review_w06_platform` | `tools/build.ts`, `src/types/png.d.ts`, and the lead-assigned policy correction. Sole Git writer, staging only reviewed exact paths |
| Execution ledger | Lead-controlled handoff | The bounded refresh by `plan_validator` is complete; that worker now owns W48 monsters. The lead assigns further writes to `docs/work-packages.json`, `docs/project-plan.md`, `docs/execution-status.md`, and `docs/dependency-graph.mmd` |

Q1 network source was handed off by `w53_q1_network`, and Q3 network source by `w55_q3_network`; both workers have left the active pool. W62 artwork was handed off by `w01_products`, now assigned ABI work. `w59_native_ui` completed the art-manifest cleanup and its documentation before moving to W43. Those completed source slices remain running at package level until the lead evaluates integration and acceptance. The lead assigns a current writer before corrections to an unowned completed slice. Historical worker names do not reactivate them.

## Bounded live evidence after the core checkpoint

The lead independently ran this actual source command with exit 0, loading Q2 `base1` with Q1 movement and Q3 Sarge:

```bash
env SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy bun run src/main.ts --renderer cpu --hidden --width 160 --height 120 --frames 2
```

That success preceded the Q2 floater registration error and correction recorded above. The command remains the reproducible startup check; this ledger update did not rerun it during concurrent integration.

The retained `/tmp/w73-interaction.ts` script opens the real CPU application, applies movement and fire input, steps the simulation, checks displacement, collects presentation-event kinds, and captures pixels. Its two preset runs retained `/tmp/w73-q2-classic-baseq2.png` and `/tmp/w73-q1-rerelease-id1.png`. The retained `/tmp/w73-menu.ts` script opens the real native menu, checks settings focus, and captures `/tmp/w73-menu.png` and `/tmp/w73-controls.png`. The files were present and the script contents were inspected for this ledger update. Execution success and visual review are lead-reported observations, not fresh runs by the ledger owner.

After the floater-table correction, the lead reports a successful actual application run of `/tmp/w73-travel.ts`. It reloads `base1` while retaining the native window, seat object, and client identity. The emitted result retained 125 health and nine picked-up bullets, replaced actor generation 10 with 21, and rejected the previous handle. The retained script was inspected and explicitly checks identity invalidation, seat/client/window retention, and the bullet count. This is one bounded source travel case, not save-load completion or acceptance of every campaign transition.

The lead also reports CPU and GL startup for both specimens, a two-seat CPU run, and dedicated startup. Exact retained command output for those additional runs is not recorded here. Temporary captures and scripts can disappear, and none supplies the final original-source, campaign, multiplayer, or compiled-release evidence required at W67–W71.

## Earlier dispatch history

This table preserves earlier ownership records and completed handoffs. It is not a fresh dispatch or permission to edit a path that the lead has reassigned. The current handoffs above and later explicit lead assignments take precedence. The earlier `execution_state` assignment does not grant the current ledger owner permission to change validator code or fixtures.

All workers used `gpt-6-astra`. Effort was `high` for `w01_products`, `w06_audio`, `w06_fonts`, `execution_state`, `w04_manifest_tests` and `additional_fixtures`; other dispatches used the package default `xhigh` unless the lead announced an override.

| Package | Owner | Exclusive paths |
| --- | --- | --- |
| W01 | `w01_census` | `verification/source-manifest.json`, `verification/feature-ledger.json`, `tools/inventory/source-census.ts`, `tools/inventory/aggregate-features.ts`, `tests/inventory/source-census.test.ts`, `tests/inventory/feature-ledger.test.ts` |
| W01 | `w01_q1_features` | `verification/features/q1.json` |
| W01 | `w01_q2_features` | `verification/features/q2.json` |
| W01 | `w01_q3_features` | `verification/features/q3.json` |
| W01 | `w01_products` | `verification/product-manifest.json`, `tools/inventory/products.ts` |
| W01 | `w01_lineage` | `docs/reference-contracts.md` |
| W01 | `additional_fixtures` | `verification/additional-fixtures.json`, `tools/inventory/additional-fixtures.ts`; searches user-provided Downloads and Steam locations for missing fixtures |
| W02 | `w02_references` | `tools/reference/environment.ts`, `tools/reference/schema.ts`, `tools/reference/README.md`, shared runner files directly under `tools/reference/`, `verification/reference-environment.json`, `verification/reference-targets.json` |
| W02 | `w02_q1_reference` | `tools/reference/q1/**`, `verification/reference-cases/q1/**` |
| W02 | `w02_q2_reference` | `tools/reference/q2/**`, `verification/reference-cases/q2/**` |
| W02 | `w02_q3_reference` | `tools/reference/q3/**`, `verification/reference-cases/q3/**` |
| W02 | `w02_native_q2`, dispatch assigned | `tools/reference/q2-native/**`, `verification/reference-cases/q2-native/**` |
| W03 | `w03_policy` | `package.json`, `bun.lock`, `tsconfig.json`, `eslint.config.ts`, `tools/check-policy.ts`, `tools/build.ts`, `.github/workflows/**`, `tests/policy/**`, `.gitignore` |
| W05 | `w05_contracts` | `src/contracts/**` except the peer files below, `docs/contracts.md` |
| W05 | `w05_content_contracts`, bounded content interface complete | `src/contracts/content.ts` |
| W05 | `w05_scene_contracts` | `src/contracts/scene.ts`, `src/contracts/render.ts`; frozen except explicit lead correction handoffs |
| W05 contract correction | `w25_q2_movement` | `src/contracts/movement.ts` for Q2 rerelease fields |
| W05 | `w05_execution_contracts` | `src/contracts/protocol.ts`, `src/contracts/execution.ts`, `src/contracts/ui.ts` |
| W03 review | `review_w03_policy` | Read-only; no write paths |
| W04 | `w04_verification` | `tools/verify/**`, `verification/schema/**`, `verification/suites.json`, `tests/verification/**` except the two files reserved below |
| W04 | `w04_manifest_tests` | `tests/verification/product.test.ts`, `tests/verification/schema.test.ts` |
| W06 | `w06_platform` | `src/platform/sdl.ts`, `src/platform/native-libraries.ts`, `src/platform/sdl-render-context.ts`, `src/platform/gl.ts`, `src/platform/gl-programs.ts`, `src/platform/runtime.ts`, `src/platform/index.ts`, `tests/platform/window-native.test.ts`, `tests/platform/window-headless.test.ts`, `tests/platform/window-runner.test.ts`, `tests/platform/native-libraries.test.ts` |
| W06 | `w06_audio` | `src/platform/audio.ts`, `src/platform/vorbis.ts`, `tests/platform/audio.test.ts`, `tests/platform/vorbis.test.ts` |
| W06 | `w06_fonts` | `src/platform/freetype.ts`, `src/platform/freetype-layout.ts`, `tests/platform/freetype.test.ts` |
| W06 | `w06_controllers` | `src/platform/controller.ts`, `tests/platform/controller.test.ts` |
| W08 | `w08_math` | `src/core/math.ts`, `src/core/numeric.ts`, `src/core/qvm-math.ts`, `src/core/renderer-math.ts`, `src/core/common-parse.ts`, `src/core/common-error.ts`, `src/core/binary/**`, `tests/core/math.test.ts`, `tests/core/binary.test.ts`, `tests/core/parse.test.ts` |
| W08 | `w08_commands` | `src/core/commands/**`, `src/core/cvars/**`, `tests/core/commands.test.ts`, `tests/core/cvars.test.ts` |
| W08 | `w08_sessions` | `src/world/session/**`, `src/world/scheduler.ts`, `src/core/diagnostics.ts`, `tests/core/session.test.ts`, `tests/core/scheduler.test.ts` |
| W09 | `w09_archives` | `src/content/archive/**`, `tests/content/catalog/archive.test.ts` |
| W09 | `w09_catalog` | `src/content/catalog/**`, `src/content/mounts/**`, `tests/content/catalog/catalog.test.ts`, `tests/content/catalog/mounts.test.ts` |
| W10 | `w10_q1_maps` | `src/formats/q1-map/**`, `tests/formats/q1-map/**` |
| W11 | `w11_q2_maps` | `src/formats/q2-map/**`, `tests/formats/q2-map/**` |
| W12 | `w12_q3_maps` | `src/formats/q3-map/**`, `tests/formats/q3-map/**` |
| W13 | `w13_q12_models` | `src/formats/q12-model/**`, `tests/formats/q12-model/**` |
| W14 | `w14_q3_models` | `src/formats/q3-model/**`, `tests/formats/q3-model/**`, except the narrow MD5 correction below; original model slice completed, worker now assigned Q2 foundation monsters |
| W14 correction | `w17_scene_models` | `src/formats/q3-model/md5.ts` for `q1Md5AnimationTiming` and its corresponding check in `tests/formats/q3-model/md5.test.ts` |
| W15 | `w15_images` | `src/formats/images/**`, `tests/materials/images.test.ts` |
| W15 | `w15_materials` | `src/materials/**`, `tests/materials/materials.test.ts` |
| W18 | `w18_cpu` | `src/render/cpu/**`, `tests/render/cpu/**` |
| W19 | `w19_gl` | `src/render/gl/**`, `tests/render/gl/**` |
| W16 | `w16_q1_collision` | `src/world/geometry/q1-solid/**`, `src/world/collision/q1/**`, `tests/world/collision/q1/**` |
| W16 | `w16_collision` | `src/world/geometry/**`, `src/world/collision/**`, `src/world/spatial/**`, `tests/world/collision/**`, excluding the Q1 paths above |
| W17 | `w17_scene_world` | `src/render/scene/**` except `models/**` and `particles/**`, `src/render/commands/**`, `tests/render/commands/**` except `models/**` |
| W17 | `w17_scene_models` | `src/render/scene/models/**`, `src/render/scene/particles/**`, `tests/render/commands/models/**` |
| W20 | `w20_audio` | `src/audio/**`, `tests/audio/**` |
| W21 | `w21_media` | `src/media/**`, `tests/media/**` |
| W21 | `w21_text` | `src/text/**` except `truetype.ts`, `tests/text/**` except `truetype.test.ts` |
| W21 | `w13_q12_models`, completed font slice | `src/text/truetype.ts`, `tests/text/truetype.test.ts` |
| W22 | `w22_input` | `src/input/**`, `src/console/**`, `src/settings/**`, `src/capture/**`, `tests/input/**`, `tests/settings/**` |
| W27 | `w27_qc` | `src/compat/qc/**`, `tests/compat/qc/**` |
| W29 | `w29_qvm` | `src/compat/qvm/**`, `tests/compat/qvm/**` |
| W30 | `w30_guest` | `src/guest/core/**`, `tests/guest/core/**` |
| W41 | `w41_actors` | `src/world/actors/**`, `src/world/gameplay/**`, `tests/world/gameplay/**` |
| W08 numeric correction | `w17_scene_models` | `src/core/game-numeric.ts` |
| W24 | `w24_q1_movement` | `src/movement/q1/**`, `tests/movement/q1/**` |
| W25 | `w25_q2_movement` | `src/movement/q2/**`, `tests/movement/q2/**`; movement contract exception recorded above |
| W26 | `w26_q3_movement` | `src/movement/q3/**`, `tests/movement/q3/**` |
| W52 | `w52_network` | `src/network/common/**`, `src/network/services/**`, `tests/network/common/**` |
| W74 | Q1 foundation lane | `src/content/q1/foundation/**`, `tests/gameplay/foundation/q1/**` |
| W74 | Q2 foundation parent lane | `src/content/q2/foundation/**` except `monsters/**` and `weapons/**`; `tests/gameplay/foundation/q2/**` except matching monster and weapon checks |
| W74 | Q3 foundation lane | `src/content/q3/foundation/**`, `tests/gameplay/foundation/q3/**` |
| W74 | `w14_q3_models`, resumed monster assignment | `src/content/q2/foundation/monsters/**` and matching Q2 foundation monster checks |
| W74 | `w74_q2_weapons` | `src/content/q2/foundation/weapons/**` and matching Q2 foundation weapon checks |
| W73 | `w73_bootstrap` | `src/app/bootstrap/**`, `src/main.ts`, `tests/first-playable/**`, `verification/first-playable/**` |
| Lead records | `execution_state` | `docs/work-packages.json`, `docs/dependency-graph.mmd`, `docs/validate-plan.ts`, `docs/test-plan-validator.ts`, `docs/project-plan.md`, `docs/execution-status.md` |

W03 owns every build and package registration. Other workers submit registration requests. Its early build proof compiles real implemented TypeScript tools through the production Bun build pipeline. The production runtime entry arrives in W73. W03 requires no placeholder engine entry and does not wait on W73. Production engine compilation and gameplay remain W73, W66 and W69 obligations.

## Handoffs and acceptance

Each bounded handoff names its source revision, exact changed paths, commands and results, retained evidence, unresolved findings, reviewer and commit disposition. The lead appoints the sole Git writer before staging exact reviewed paths. A progress commit records its bounded result; it does not accept a package automatically.

Only the lead changes a package to accepted after evaluating its acceptance requirements and independent review against the combined tree. An accepted task includes an `acceptanceRecord` with `acceptedBy: "lead"`, full `sourceRevision` and `commit` revisions, and nonempty `evidence` and `review` references. The validator checks the record's shape and requires accepted prerequisites for review and accepted states. Running work may use concrete published inputs while prerequisites remain unfinished; a failed or blocked prerequisite rejects dependent running work. The lead judges actual input readiness and assigns exclusive paths. It does not authenticate the author, inspect those commits, or prove the referenced runtime results. Reopening a prerequisite requires the lead to invalidate dependent active or accepted states and stale evidence before the graph passes again.

| Handoff | Source revision | Evidence and review | Commit disposition |
| --- | --- | --- | --- |
| Initial dispatch of W01/W02/W03/W04/W06 | `6439acd6c5f0d38ca93867ae0f6100ecf4cdbee4` | Work running; package acceptance evidence and independent reviews pending | No implementation commit recorded here |
| Execution records and validator v1.1.0 | Same starting revision plus the scoped working-tree changes | `bun docs/validate-plan.ts`: PASS, 74 tasks/309 edges; `bun docs/test-plan-validator.ts`: PASS, 20 negative cases and synthetic accepted-prerequisite progression; `bun run typecheck`: PASS. `review_dependency_graph` independently passed all 20 negative checks; the lead accepted this bounded execution-state code review. No W01/W02/W03/W04/W06 acceptance follows from it. Full policy check reported three findings in concurrently edited `tools/verify/` files and no findings in these docs scripts; those findings were sent to W03. | Lead review accepted for execution-state code only; included in foundation checkpoint `e291921df44b5778a9dd5189c1f383e5752a8b02`. No Git mutations by this worker |

`w02_references` also resumed inventory of retail binaries in the Steam source supplied by the user. Its existing write boundary remains unchanged.

The synthetic acceptance fixture uses invented revisions and evidence text only inside a temporary fixture directory. It proves validator behavior and accepts no real package. This ledger is a passive file maintained through exclusive ownership; no daemon or shared task service coordinates workers.

## Code-first steering

The user directed code imports first, then live human play and optimization, followed by extended hardening and regression infrastructure. W05 is now running from the existing reviewed `docs/reference-contracts.md` and `verification/source-manifest.json`; W01 exhaustive inventory continues in parallel. The lead removed W01 completion as a W05 prerequisite. No package was marked accepted by this change.

W42–W49 no longer wait for W73. W42, W45 and W49 directly require W74 permanent behavior foundations, with expansions inheriting those foundations through their base packages. W73 remains a required real integration milestone, and W66 retains its bootstrap ownership handoff. W02 initial source cases and actual Q2 references are sufficient code inputs. W03 retains practical build/type guards; W04 retains a basic runner. Broad retail/performance capture, extended hardening, regression infrastructure and final real runtime qualification remain mandatory at W67–W71 and release.

This authorized graph change removes W01 → W05 and eight W73 → W42–W49 edges, then adds W74 → W42/W45/W49: 74 packages and 303 edges. The earlier 309-edge validator and review results above describe the previous snapshot only.

W50 also consumes the existing source census and comparison rather than requiring the unfinished exhaustive feature ledger as an import input. Final feature-ledger reconciliation remains required. `bun docs/validate-plan.ts` passes the revised 74-package/303-edge graph with W01–W06 running and none accepted. The existing 20 negative validator cases and synthetic progression case pass after updating their dependent-package fixture from W05 to W07. No new hardening tests were added.

## Published-input dispatch

The lead now starts source ports against concrete published interfaces while prerequisite packages finish. Acceptance dependency edges still govern review and accepted states. No foundation package is marked accepted merely to dispatch downstream code. W05 math, identity, numeric and time contracts are on disk, with content, scene and execution interfaces being implemented under published names. W02/W03/W06 code and reference inputs are frozen for the next imports. The lead is dispatching W08 common services and W09–W15 raw format ports under exclusive ownership.

Validator v1.2.0 rejects running work only when a direct prerequisite is failed or blocked; it leaves concrete-input readiness to the lead. Review and acceptance still require accepted prerequisites. Existing fixture coverage is updated for this scheduling rule, without adding a readiness framework or new hardening suite.

## Foundation checkpoint and active ports

The lead committed and verified foundation checkpoint `e291921df44b5778a9dd5189c1f383e5752a8b02`. W03 is accepted only for EARLY_TOOLING under its current criteria, using that revision for both source and commit identity. The lead reports passing live typecheck, policy, 32 combined tests and the actual compiled validator; the W03 owner also verified compiled tool relocation. `review_w03_policy` closed its tooling review, and the lead independently executed the artifact. This accepts no production engine runtime or release behavior.

W01, W02, W04, W05 and W06 remain running. W08–W15, W18 and W19 are now running under the exclusive assignments above. W05 content interface work is complete as a bounded handoff; the package remains running while its parent and scene/execution peers finish. W06 platform work resumed for the minimal shader FFI extension in `gl.ts` and `gl-programs.ts`. No other package acceptance is recorded.

## Collision, scene and execution imports

W16, W17, W20, W21, W22, W27, W29, W30 and W41 are running under the assignments above. W03 remains accepted only for its recorded early tooling scope. Several format and component owners have completed bounded implementations; their packages remain running until integration and the lead's explicit acceptance. Acceptance order and final feature/runtime requirements are unchanged.

This checkpoint follows the user's code-first direction with limited checks: update the passive ledger and run the basic live validator. It adds no readiness framework, verification framework or fixture suite.

`w08_math` owns the shared `src/core/common-parse.ts`, `src/core/common-error.ts` and `tests/core/parse.test.ts`. The materials owner migrates its callers and removes its own private copies after those shared modules land. The resumed `w13_q12_models` worker owns only the TrueType files within the W21 text split; W21 remains running.

## Core, content and formats checkpoint

Checkpoint `393833a821230bef2b2420f98b22e56a8f1b840e` records 121 files of core, content and format implementation. The lead reports independent snapshot type and policy checks, 90 passing checks and one explicit MD4 skip, plus 73 root-run tests and snapshot TypeScript checking. The skip is retained as a limit of that checkpoint. These results record completed code slices; they do not accept the full packages or establish live engine gameplay.

W24, W25, W26, W52, W74 and W73 entered running state at this checkpoint. Actual source behavior imports target Q1 rerelease `e1m1`, with 428 authored entities across 41 classes, and Q2 `base1`, with 634 entities across 60 classes. The earlier Q1 count of 460 was incorrect; `src/content/q1/foundation/README.md` records the corrected count. Q2 foundation monsters belonged to the resumed `w14_q3_models` worker, and Q2 weapons to `w74_q2_weapons`. The completed font worker `w13_q12_models` was not assigned weapons: the attempted resume failed at the tool thread limit.

W06 gained GL framebuffer work with an actual smoke run. W03 had a bounded allowlist correction, while its accepted early tooling scope remained distinct from final runtime qualification. W73 had started joining the real components at that checkpoint. The current source and runtime section above supersedes that startup status. Neither the checkpoint nor the later bounded live results accept W73 or W74.

This ledger checkpoint uses only the basic live validator. No additional framework, fixture suite or package acceptance was added.
