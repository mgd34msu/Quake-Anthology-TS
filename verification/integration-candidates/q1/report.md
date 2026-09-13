# Q1 mechanical source comparison

The comparison is a review queue, not a completion score. It reads Git object bytes at donor `6bc6a8bf29b66981e3b6ce7251ebbc6413120270` and unified `3dc9ca6ca404dc4522ab9e9669fff458805b0993`. Later integration and dirty worktree files are outside this snapshot.

Reproduce the complete local artifacts:

```sh
bun tools/inventory/integration-candidates.ts --game q1 --donor-revision 6bc6a8bf29b66981e3b6ce7251ebbc6413120270 --out /tmp/quake-integration-q1
```

`inventory.json` preserves every Git TS/TSX/MTS/CTS file, including zero-declaration files, with hashes, classifications, diagnostics and skipped-file reasons. The existing census parser visits the AST once. Its original function records are checked against the expanded extraction. Named classes, interfaces, types, enums, variables, properties and bindings are retained alongside functions, methods, accessors, constructors, arrows, callbacks and bodyless signatures. Signatures contain written syntax, not synthesized inferred types. Export flags describe lexical modifiers; import/export bindings are records, but re-export resolution is not performed.

`candidates.json` retains every donor declaration and all candidate groups for exact name, signature-token hash, body-token hash, basename and import-specifier hints. Group lists avoid repeating Cartesian pairs. Resolve a declaration's `groupIds` through `groups` and take their union to obtain all candidates. `unmatched`, `single-candidate` and `ambiguous` describe this mechanical union only. Generic names and common imports produce broad groups by design.

`feature-join.json` retains the complete three existing feature inventories, their input hashes and every feature ID, including empty joins. Declaration `evidenceIds` mean overlapping source lines, not ownership or behavioral acceptance. `anchor-inventory.json` lists accepted and rejected location anchors; rejected raw evidence also remains in the full feature inventory. `historical-completion.json` retains the older completion record and its own cutoff without updating its verdicts. Unanchored declarations remain in the raw inventory.

## Concrete follow-up checks

These bounded examples demonstrate what deeper review must inspect. They are not the exhaustive queue; no raw declarations or candidate groups are omitted.

| Lead | Pinned donor implementation and caller | Unified comparison and next check |
| --- | --- | --- |
| Network-driver VCR replay | `src/common/net_vcr.ts:129` installs replay methods; `net_main.ts:899` selects that driver. Recording hooks include connect/get-message/send/can-send timestamps and sessions. | `src/network/q1/demos.ts` reads `.dem` and `.qwd` packet/command records. Trace startup and network-driver selection to determine whether deterministic VCR operation/session replay has an equivalent. No VCR source anchor appears in the existing Q1 inventory. Demo codecs alone do not establish this separate behavior. |
| Chase-camera controls | `src/client/chase.ts:97` computes offset and traced aim; `src/client/view.ts:1036` invokes it when `chase_active` is enabled. | Existing feature `q1.tools.chase-camera-diagnostics` already covers this. The baseline has shared `src/render/scene/view.ts` camera transforms and Q2 chase-menu wording, but a search for the Q1 chase controls found no baseline registration. Trace the Q1 camera producer and command configuration before judging integration. |
| Remote prompt presentation and input | `src/client/cl_parse.ts:209` accumulates prompt state, server-message dispatcher calls it at line 1279; `screen.ts:358` draws choices and `keys.ts:908` handles digit input. | Existing feature `q1.events.prompts` covers local behavior. `src/network/q1/netquake.ts:392` already decodes prompt events, refuting a missing-parser conclusion from the unmatched donor function name. Trace these events through the remote application into the HUD and choice impulses. Local CTF prompt support in `src/app/bootstrap/simulation/runtime.ts:1284` does not by itself prove the remote path. |

## Combining the three runs

Generate Q2 and Q3 with the same tool, pinned donor revisions from their reports, and sibling `/tmp/quake-integration-q2` and `/tmp/quake-integration-q3` output directories. The same 477 feature IDs are retained in each `feature-join.json`; combine declaration joins by feature ID and repository-qualified declaration ID, deduplicating unified IDs. Keep historical completion rows separate from new candidates. Generate the combined artifact with the checked merge tool:

```sh
bun tools/inventory/merge-integration-candidates.ts --input /tmp --out /tmp/quake-integration-combined
```

`combined.json` merges declaration IDs under all 477 original feature IDs, retains the full original feature rows, pins `docs/comparison-q1.md`, `docs/comparison-q2.md` and `docs/comparison-q3.md` by Git revision and SHA-256, and references every complete raw input artifact by path and hash. It rejects mismatched snapshots, missing IDs, duplicate IDs within a run and disagreeing feature rows. Historical completion and raw candidate groups remain separately referenced, without rewriting verdicts.

## Validation and counts

The final Q1 snapshot contains 568 donor files and 84,022 declarations; the unified snapshot contains 1,687 files and 203,489 declarations. The original census subsets contain 14,540 and 31,643 functions respectively. Every recorded path and file SHA-256 was independently checked against Git object bytes. Every declaration ID is unique; every donor declaration has exactly one candidate record. No source files were skipped or syntactically unparseable. All 477 existing feature IDs remain available.

Mechanical statuses: 15,319 unmatched, 1,054 single-candidate, 67,649 ambiguous. These counts include tests, tools, type declarations and local bindings, so they must not be read as feature totals.

The owned tools pass strict TypeScript checking. At extraction time, the broader working-tree typecheck reported an unrelated `tests/content/catalog/mounts.test.ts:233` overload error; its correction is now committed. No behavioral completeness claim follows from extraction validation.
