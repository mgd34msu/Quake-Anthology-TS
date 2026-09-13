# Q3 source declaration comparison

Pinned donor `8453c49824eb7a5ed5aee452f74e19336965d1f8`; unified `3dc9ca6ca404dc4522ab9e9669fff458805b0993`. The historical completion file uses `27c17a9e6bee1e6a50cec1479ef70d2a9d5c66e4`, so its reasons need re-review at this newer cutoff.

The final shared TypeScript parser captured all 1,135 donor files: 530 runtime, 569 test, 36 tool, zero declaration-only. It retained 209,188 declarations and signatures, including 45,634 historical census functions, with no parse errors or skipped files. Unified has 1,687 files and 203,489 declarations. Candidate matching retains all 1,050 unmatched, 126 single-candidate and 208,012 ambiguous rows. Broad name/import/basename hints explain much of the ambiguity; none are integration verdicts.

`inventory.json` preserves source hashes, classifications, offsets, signatures, hashes and imports. Named kinds include 814 classes, 1,261 interfaces, 599 type aliases, 118 enums and 67,811 variable declarations, plus callable declarations, properties, parameters and import/export bindings. `verification.json` lists every kind.

`candidates.json` stores every candidate in deduplicated groups. `feature-join.json` retains all three full inventories and every ID: Q1 180, Q2 193, Q3 104, including empty joins. `anchor-inventory.json` records admitted/rejected anchors, while `historical-completion.json` preserves historical cutoff and verdicts. `joined-candidates.json` retains every Q3 declaration row and module with symbol/line and broader module associations. There are 5,074 direct symbol/line associated declarations, 22,853 with module context, and 1,035 modules lacking feature source anchors. The shared extractor's line-only join leaves 204,121 declarations unanchored. These ratios are investigation clues, not feature-coverage or completion verdicts.

Verification confirms 209,188 unique donor IDs and 203,489 unique unified IDs, all candidate/group references resolve, all three inventory ID sets remain complete, and requested named declaration kinds exist. An earlier same-offset AST collision was found and corrected by including node kind and end offset in IDs before these final artifacts were accepted.

Concrete caller review found:

- SOCKS5 is a feature-inventory omission and an application-join candidate. Donor `src/platform/unix-io.ts:454-488` registers settings and calls `connectSocks`. Unified `src/network/common/transport.ts:91` and `socks.ts:41` preserve implementation, but pinned production source has no caller or `net_socks` settings. It is a candidate for shared network support across families.
- Event/config journaling is an inventory omission. Donor `src/engine/common-console.ts:153-154` initializes the journal and `common-frame.ts:220` routes system events through `CommonJournal`. `common-journal.ts` writes/replays `journal.dat` and `journaldata.dat`. Pinned unified journal references are unrelated save/finale text. Decide common deterministic-reproduction requirements and native LP64-format compatibility before integration.
- External MOTD is another unanchored source capability. Donor `client-motd.ts:23` is called by `client.ts:917,1074,1197`. Unified server `g_motd` display is different. The engine request encoding, response parsing and challenge checks are separable from the external service-dependent MOTD behavior. Review whether that service workflow is wanted. No public endpoint was contacted.
- The historical `q3.execution.qvm-roles` absence reason is stale. At the requested cutoff, `src/app/bootstrap/q3-client.ts:192-195` constructs `ApplicationQvmClient`. All role selection, syscall coverage and bytecode execution still need review. This finding changes the next investigation, not the completion verdict.

`review-findings.json` has the concrete review queue and `review-search-evidence.json` records exact pinned Git commands/output. Newer Q3 download work and current worktree modifications are outside this snapshot. No production code, tests, Git state or public service was changed. No behavior/parity/completion claim follows from declaration matching.

Reproduce the extraction:

```sh
bun tools/inventory/integration-candidates.ts --game q3 --donor-revision 8453c49824eb7a5ed5aee452f74e19336965d1f8 --out /tmp/quake-integration-q3
```

## Review locations and freshness check

The input requirements are [Q1](../../features/q1.json), [Q2](../../features/q2.json) and [Q3](../../features/q3.json). The earlier narrative is [comparison-q3.md](../../../docs/comparison-q3.md), and the carried status is [completion-status.json](../../../docs/completion-status.json). [summary.json](summary.json) records the extraction pins and counts. Full declaration lists, groups, joins, admitted and rejected anchors, and raw search evidence remain in `/tmp/quake-integration-q3/`.

Pinned donor evidence can be reproduced with `git -C /home/buzzkill/Projects/quake-3-ts grep -n -E 'connectSocks|net_socks|common.journal.getEvent|common.journal.initialize|ClientMotd|getmotd' 8453c49824eb7a5ed5aee452f74e19336965d1f8 -- src`. The named caller lines above come from that donor revision.

The matching unified search is `git grep -n -E 'connectSocks|net_socks|CommonJournal|journaldata.dat|ClientMotd|getmotd' 3dc9ca6ca404dc4522ab9e9669fff458805b0993 -- src`. It returns only `src/network/common/transport.ts:91`, the `connectSocks` declaration. Source text searches support these review leads but cannot exclude renamed or differently structured equivalents without deeper caller review.

A limited freshness check at current HEAD `2b025db5db8a1d333edb450b0d1570ed37e84760` searched those same names plus `ApplicationQvmClient.create`. Results remain the transport declaration at line 91 and the QVM application constructor at `src/app/bootstrap/q3-client.ts:196`. No post-baseline correction to these named leads was found. This check does not change the pinned extraction or audit newer download work.
