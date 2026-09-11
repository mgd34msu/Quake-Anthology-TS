# Verification interfaces

W04 provides expected-case contracts, a full-product generator, process execution, and evidence accounting. The current tests prove the tooling. They do not establish engine behavior, playability, source fidelity, or release completion.

`verification/schema/contracts.ts` defines the interfaces. `parse.ts` validates external JSON. `verification/suites.json` retains eight mandatory behavior obligations with unbound commands and schedules. That registry is incomplete as a release domain: W01 and behavior owners still need to supply the complete product dimensions and executable case contracts.

The command interfaces are:

```bash
bun tools/verify/cli.ts --profile dev --changed
bun tools/verify/cli.ts --profile integration --manifest verification/fixtures.json
bun tools/verify/cli.ts --profile full --manifest verification/suites.json --shard 0/16 --resume
bun tools/verify/cli.ts --profile release --manifest verification/fixtures.json --executable dist/quake-typescript
bun tools/verify/cli.ts --manifest verification/fixtures.json --reconcile --resume /absolute/run/report.json
bun tools/verify/generate.ts --domain domain.json --count
bun tools/verify/generate.ts --domain domain.json --output expected-cases.json --max-cases 100000
bun test tests/verification
```

`verification/fixtures.json`, `domain.json`, and the compiled engine are future owner-supplied inputs. The mandatory suite registry currently reports missing schedule inputs. No engine runs through it.

`dev` and `integration` select cases by their declared profiles. `--changed` restricts dev selection to paths from the current Git status. `full` and `release` select every declared case before deterministic sharding. Unselected rows receive `NOT_RUN`. `selectedComplete` describes only this selection. `completeRequiredManifest` requires every expected row to pass. An all-tooling manifest never reports `gameplayComplete`.

`--resume REPORT.json` considers the named prior report. Bare `--resume` selects the most recently written completed report in the output parent. Changed fingerprints trigger a fresh attempt with a link to the prior record. Existing attempts remain intact. Runs use separate directories under `--output-root`, whose default is `.artifacts/verification`.

`generateComposition()` is lazy and `compositionSize()` returns a bigint. Axis and suite ordering uses code units, independent of locale. Configuration IDs depend on declared value IDs. Missing fixture hashes do not remove values or change IDs. An empty axis is an error. The file generator refuses a product above its explicit size limit before writing output.

Commands use `{bun}`, `{executable}`, `{snapshot}`, `{output}`, `{home}`, `{data}`, `{case}`, `{result}`, `{input:ID}`, and `{port:N}` placeholders. A compiled candidate requires a neighboring `EXECUTABLE.build.json` with `schemaVersion: 1`, `sourceSha256`, and `executableSha256`. The runner checks these against its source snapshot and copied candidate.

A driver writes `DriverOutput` JSON to `VERIFY_RESULT_PATH`. It records assertions tied to expected contract IDs, checkpoints, and relative artifact paths. The runner retains raw output, standard output, standard error, and launch details. Driver-supplied statuses and skips are rejected. `PASS` requires exit code zero and each contract's minimum assertion count. Missing expected hashes or files block the case; changed pinned inputs fail it.

Owned snapshots include source and installed dependencies. Child processes receive separate homes, temporary directories, input copies, and leased ports. Headless and offscreen modes specify their SDL driver. The private Xvfb provider has implementation but no qualification evidence yet. These controls are process isolation conventions, not a hostile-code security boundary.

Work deferred after the instruction to prioritize engine coding includes complete catalogue binding, cross-shard report merging, broad interruption and retry qualification, display and device qualification, and complete machine/library provenance for gameplay. Baseline process tests cover all five statuses, zero-assertion rejection, and unchanged-pass reuse. Independent schema/product tests cover finite enumeration and malformed input. Required runtime and release evidence remains unexecuted.
