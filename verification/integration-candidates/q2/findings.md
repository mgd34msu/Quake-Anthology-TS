# Q2 declaration comparison and inventory join

Report baseline: unified `3dc9ca6ca404dc4522ab9e9669fff458805b0993`; donor clean HEAD `0d73750cbe5683c7411934d0a5d4eb5acd4da676`. In-flight HTTP, PKZ and native download work is outside this baseline and remains WIP, not a newly assigned implementation task. No production code changed or gameplay acceptance run.

Independent Git enumeration retained in `/tmp/quake-integration-q2/independent-files.json` finds 1,181 TS/TSX files: 860 production and 321 tests, with no tracked declaration-only or tool files. The existing 193 Q2 feature IDs cite 70 donor paths. An unanchored declaration or module is a search lead, not a missing-feature count: parent features often own imported implementation modules.

## Concrete source-to-inventory candidates

1. Animated GIF presentation has no dedicated Q2 requirement or anchor. Donor `src/qcommon/gif_beat.ts:30` selects frames, `src/ref_gl/gl_image.ts:879` loads all frames and `src/ref_gl/gl_draw.ts:90` selects them during drawing. The unified `src/formats/images/gif.ts:65` decoder has no production caller at the baseline. Its presence therefore does not prove animated image presentation. Candidate integration paths are the image resource loader and 2D renderer. The donor CPU path deliberately selects only the first frame; that historical limit must not silently become the target capability.
2. Oriented/static world text has no dedicated Q2 requirement or anchor. Donor `src/server/sv_main.ts:1057` delivers debug draws to `src/client/cl_worldtext.ts:58`, `src/client/cl_view.ts:730` copies them into the scene and `src/ref_gl/gl_rmain.ts:1252` draws them. Unified name searches find only `Draw_OrientedWorldText`/`Draw_StaticWorldText` ABI entries in `src/compat/q2/rerelease/api.ts:30`. The ABI declarations alone do not establish host callbacks or rendered output. Candidate paths are the rerelease host adapter, scene commands and text renderer. The other donor debug shapes explicitly lack a renderer, so they remain unresolved source capabilities rather than falsely claimed donor successes.
3. Extended Q2 cvar commands have no dedicated Q2 requirement or anchor. Donor `src/qcommon/cvar.ts:310` calls `Cvar_InitCommands`, whose registration at `src/qcommon/cvar_cmds.ts:359` supplies `setu`, `sets`, `seta`, `toggle`, `inc`, `dec`, `reset`, `resetall`. Unified `src/core/commands/index.ts:395` returns for non-Q3 dialects before the Q3 flag/toggle/reset registration; `inc`, `dec`, `resetall` were not found registered. Candidate integration path is the shared command buffer with explicit Q2 command semantics. A Q3 name match must not erase the Q2 admission difference.

These are grounded source/caller gaps, not completed behavioral proofs. They should receive explicit feature requirements and tests before any done verdict.

## Inventory-to-unified gaps and verdict drift

The feature join retains every existing ID and historical completion row. The baseline completion file describes source cutoff `27c17a9e6bee1e6a50cec1479ef70d2a9d5c66e4`, older than this report baseline. Its verdicts are historical evidence, not current recomputed acceptance.

- The five `q2.download.*` requirements already existed. Their old not-done reasons identify unjoined queues, filelists, mount rescans and UDP fallback. Active HTTP/PKZ/native-download work is WIP outside this report cutoff; do not rediscover these as absent inventory requirements.
- `q2.content.native-starts` and `q2.content.start-map-discovery` already require authored mapdb metadata. Donor `src/qcommon/mapdb.ts:286` is unanchored directly but is called by anchored `src/client/menu_content.ts:284`. This is a clear example where an unanchored function is already represented by existing requirements. No MapDB production caller was found under the pinned unified application; the catalog/startup candidates need authored unit/start-item verification.
- The six `q2.demo.*` requirements already distinguish client/server/MVD recording, protocol playback, GTV and view/seat controls. Codec declaration matches cannot establish a recorder/player/application workflow. Existing historical not-done rows remain unresolved in the join.
- `q2.capture.screenshots` already requires a saved image, not readback alone. The pinned `src/console/commands.ts` defines screenshot/levelshot handlers, but `registerConsoleCommands` has no pinned application caller. This remains a concrete application join to prove.
- Browser rows demonstrate stale verdicts. The old completion rows say no startup browser construction; pinned `src/app/bootstrap/startup.ts:73` now calls `StartupServerBrowser.open`, whose implementation constructs `ServerBrowser` at `src/app/bootstrap/server-browser.ts:31`. The old missing-constructor reason is refuted at this baseline. Full discovery/favorites/filter/status acceptance remains unresolved until behavior is exercised.
- Config rows also need fresh per-workflow review: pinned application/startup now construct ConfigStore for server/controller/browser preferences. This is evidence of progress, not proof that arbitrary archived cvars and per-seat binds have complete startup/shutdown persistence.

All candidates remain open unless a separate source/caller and runtime investigation establishes their disposition. Exact hashes, matching names, feature anchors and historical done rows each answer different questions; none is an automatic equivalence verdict.

## Reproduction and artifacts

Run from the unified repository:

```sh
bun tools/inventory/integration-candidates.ts --game q2 --donor-revision 0d73750cbe5683c7411934d0a5d4eb5acd4da676 --out /tmp/quake-integration-q2
```

The same compiler-based extractor serves all three families. `inventory.json` retains source declarations, locations, written signatures, token hashes, lexical exports, enclosing declarations and module imports. `candidates.json` retains every donor row and all candidate groups, including ambiguous and unmatched rows. Group IDs index unified declaration IDs; resolve those IDs through the unified repository in `inventory.json` for candidate paths. `feature-join.json` retains all three original feature inventories and their declaration joins. `historical-completion.json` preserves the older completion inventory and its own cutoff. `independent-files.json` independently records all Q2 Git paths and SHA-256 hashes, including same-file related feature IDs.

Feature declaration IDs currently mean lexical evidence-line overlap. Same-file related IDs do not mean function-level coverage. An anchor in a parent declaration can overlap nested functions; neither relationship establishes semantic ownership or runtime equivalence. The source set hashes describe this tool's TS-family Git file manifest, which differs from the older census's broader source set hash.

## Final extraction checks

The completed run retained 261,496 donor AST declarations, including 38,433 census functions, across all 1,181 files. Production files contain 208,744 declarations. Counts include local variables, parameters and import bindings; they are not feature counts. Required categories are present: 329 classes, 685 interfaces, 325 type aliases, 106,886 variable declarations, 14,851 arrows and 4,937 methods. Four zero-declaration modules remain in the file inventory. Nothing was skipped or syntactically unparseable, and no feature evidence anchor was rejected.

All donor declaration IDs appear exactly once in the candidate inventory: 116,536 unmatched, 5,433 single-candidate and 139,527 ambiguous. All 193 Q2 feature IDs have at least one lexical declaration overlap. The full feature join also retains all 180 Q1 and 104 Q3 IDs with empty declaration matches in this Q2 run; the Q1/Q3 runs supply their own donor joins. There are 259,831 unanchored Q2 declarations, retained for review without claiming missing functionality.

Independent Git file paths and SHA-256 hashes match the compiler inventory for every donor file. The corrected declaration ID includes repository, path, start offset, end offset and SyntaxKind. Independent checks found 261,496 donor records and unique IDs, 203,489 unified records and unique IDs, and 261,496 candidate records and unique donor IDs. Candidate and declaration ID sets are equal. All 135,458 candidate groups contain unique IDs resolving to unified declarations, and every donor group reference resolves. The donor manifest hash is `9b9dc56bc16834933058c177b38a8955941bdb80f905c2a7dbac42b8afaa1f95`; unified manifest hash is `2be25c00ece9a77d4e62006f7c9041b0cc5a393933152432c4cbea020bf3e22e`. The compact generated totals are retained in `summary.json`; full raw artifacts occupy about 470 MB under `/tmp/quake-integration-q2`.
