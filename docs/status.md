# Project status

This is the one maintained status page. Every other status, plan, checklist and
comparison page in this directory is a dated record; each carries a banner that
points back here. When this page and one of those disagree, this page is right
unless the code says otherwise.

Last reviewed against the tree at `f855f940` plus the 2026-11-01 audit remediation
(see [the audit](reviews/2026-11-01-full-audit/README.md) and its
[remediation status](reviews/2026-11-01-full-audit/REMEDIATION.md)).

## Where the project is

- Latest tagged release: **1.2.6**. The tree contains later,
  unreleased work (the 2026-10-27 code review fixes B1 to B4 and PERF1 to PERF3, and the audit
  remediation), so `package.json` and `src/version.ts` report the SemVer pre-release
  `1.2.7-dev` (DOCS-010; `tools/release.ts` refuses pre-releases, `tools/build.ts` accepts
  them; `tests/policy/release.test.ts`). See the [changelog](../CHANGELOG.md).
- The T01 to T23 functional targets were accepted in source for the 1.0.0 scope. Acceptance was
  an implementation judgement made on specific dated builds; it is not a claim that every
  original game, mod, device or campaign works. The per-target history is in
  [functional-targets/status.md](functional-targets/status.md), which stops at 1.0.0.
- Release notes: [docs/releases/](releases/) (one page per tag, 1.0.0 to 1.2.6).

## What to use for what

| Question | Page |
| --- | --- |
| How do I run it? | [getting-started.md](getting-started.md), [playing.md](playing.md) |
| What does it support from mods? | [mod-compatibility.md](mod-compatibility.md) |
| How is the source organized? | [architecture.md](architecture.md) |
| Something broke | [troubleshooting.md](troubleshooting.md) |
| Running a server | [server-guide.md](server-guide.md) |
| What changed in a version? | [../CHANGELOG.md](../CHANGELOG.md), [releases/](releases/) |
| Is it safe to run third-party content? | [../SECURITY.md](../SECURITY.md) |

## Known open work

These are the items that are true at the reviewed revision. Each is traced to code or to an
audit finding; none has a tracked issue yet, so this list is the tracker.

### Native Quake II guests with foreign providers

Carried over from [native-interposition-report.md](native-interposition-report.md), re-checked
at HEAD and worked on by audit DOCS3-001 to DOCS3-006:

- Done (DOCS3-001): the touch list handed to the guest `pmove_t` now carries the planes of the
  contacts the provider reported (`simulation/native-pmove-contacts.ts`, written by
  `compat/q2/native-input.ts`), and the rerelease `groundplane` is the last standable contact
  plane the provider reported. Solids the player ended against that the sweep did not name
  (brush entities trace as world hits) are still recovered by overlap, with a plane derived from the
  axis of least penetration. A grounded player that the provider has not yet reported a plane for
  gets a flat plane at the feet. `NATIVE_PMOVE_DISPOSITION` states, per field and edition, what
  is written from the provider, zeroed, left as the guest wrote it (`pm_time`, `delta_angles`,
  `step_clip`, `impact_delta`, `screen_blend`, `rdflags`, `jump_sound`: no foreign provider
  models them) or absent from the classic struct. Trace `fraction`, `endpos`, `contents` and
  `surface` are not filled in.
- Done (DOCS3-002): a guest command interval is quoted to the selected provider in its own
  quanta (`nativeMoveSlices`: whole maxima for NetQuake and QuakeWorld, k fixed steps with the
  remainder carried per client where a fixed step is declared) and Quake III time is the
  player's own command clock instead of host time. Carry is not saved; it resets at a load.
  The drift between host float64 time and the DLL's float32 `level.time` is still unmeasured.
- Done (DOCS3-003): the mirrored combat record is declared in `syncNativeMovementCombat`
  (health, armor and invulnerability follow the guest; mass 200, `canTakeDamage` and a null team
  are constants; not saved). A shared write to a mirrored player is discarded, and the first
  one per client prints a diagnostic. No provider is known to write one today.
- Done (DOCS3-004): `Simulation.selectionConsumption()` reports, per axis (enemies, movement,
  character), whether the guest honored, partly honored or left native the selection. It is
  printed by the Quake II console `status` command and stored as the optional
  `SaveImage.consumption` metadata (schema 4, empty list when nothing was narrowed, ignored on
  restore; older saves migrate to an empty list). Weapons are not reported. A same-clock movement provider from other
  content is reported as guest-native instead of being silently dropped; foreignness itself is
  still decided by clock kind.
- DOCS3-006: the respawn harness runs coop (single player respawn loads a save), waits past
  Cmd_Kill_f's five second guard, kills with `kill` and respawns with a held mouse button. A
  body-queue corpse is now drawn as the selected Quake 1 character (player.mdl frame 60)
  instead of the guest male model; a Quake III character still gets the guest corpse model.
  Test: `q2-native-foreign-character.test.ts` ("coop respawn corpse", classic DLL only). On the
  rerelease DLL the same harness kills the player but no respawn was reached with a held mouse
  button and jump for two seconds, so the rerelease corpse path is unverified (cause unknown).
- DOCS3-005: `q2-native-foreign-dual-run.test.ts` compares the TypeScript lane with the native
  DLL for Quake 1 (8 frames, 1 unit) and Quake III (4 frames). The earlier "8 unit Quake 1
  divergence" was a stair climbed a frame earlier by one lane because the lanes start the run
  at different phases (fixed-fraction versus wall-clock key sampling), not a movement error.
  Quake III lanes drift about 2 units from the fifth frame on; not investigated.
- `q2-native-foreign-movement.test.ts` and `q2-native-foreign-character.test.ts` need game data
  and skip without it.
- Quake III authoring roles (map compiler, QVM assembler, SDK/archive tools) are not part of
  this runtime port; `tools/navigation/aas.ts` covers the AAS compile role. `q3.source-applications.role-accounting`
  stays open for them.

### Features recorded as joined that are not

- Quake VCR (`-record`/`-playback` VCR streams) and the Quake III event/config journal do not
  exist in `src`. They were listed under T20 in earlier status pages; that was wrong (audit
  DOCS2-001). They are open.
- The Quake III external message-of-the-day service (`getmotd`) is not implemented. `g_motd`
  the configstring is separate and works (DOCS2-002).
- Referee selection by vote in LMCTF is not implemented; `lmctf/vote.ts` offers only skip and
  yes/no (DOCS4-008).
- Rerelease DeathBall-style objectives, LMCTF and CTF synthesize their entities from
  deathmatch spawns on any world; Horde is the exception and needs an authored
  `horde_manager` on TypeScript Quake II worlds (see [playing.md](playing.md)).
- Linux native game modules are not playable. The ELF loader and System V runtime
  (`src/guest/elf`, `src/guest/runtime/system-v`), the Quake Live and Q3 native module
  wrappers (`src/compat/q3/native`) and MD3 LOD registration (`src/formats/q3-model/lod.ts`)
  are tested but not reachable from `src/main.ts`; they are the only entries in
  `tools/unreachable-modules.json`, and `bun run policy` fails for any other unreachable
  `src` module (AUDIT-010).
- `load` accepts an absolute path outside the save directory from the local console (it
  imports original saves; id's engines accept no such path). Scripts, game or client modules
  and remote clients are refused unless the server is started with `--allow-load-paths`
  (DOCS2-003; `tests/app/load-path-policy.test.ts`). `save` is contained to the save directory.

### Documentation

- The completion ledger ([completion-status.md](completion-status.md),
  [functional-targets/remaining-source-rows.md](functional-targets/remaining-source-rows.md),
  `remaining-source-rows.json`) was re-derived on 2026-11-02: each of the 184 requirements the
  2026-09-15 ledger left open was checked against the code. 164 are now `done`, 20 stay open
  with a current gap and none is an open owner question; none is descoped. The 293 rows that were
  already `done` were not re-checked, the untouched cutoff paragraph at the top of the ledger is
  historical, and a `done` verdict is a code-reading judgement, not a runtime acceptance claim.
  The 61.4 percent figure is superseded (the ledger now totals 457 of 477 done). Still open:
  `q1.execution.entity-properties`, `q1.multiplayer.chat`, `q1.network.hosting-lifecycle`, `q1.network.nq-wire`, `q1.network.qw-prediction`, `q1.network.retail-kex-boundary`, `q1.saves.autosave`, `q1.seats.qw-native-extension`, `q2.admin.status-kick`, `q2.content.server-map-lists`, `q2.hud.centerprints-notifications`, `q2.hud.powerup-wheel`, `q2.navigation.dynamic-obstacles`, `q2.save.autosave-transition`, `q3.bots.aas-reachability-clustering`, `q3.modes.foreign-objective-adaptation`, `q3.services.rankings-lifecycle`, `q3.source-applications.role-accounting`, `q3.ui.base-settings`, `q3.ui.team-arena-scripts-feeders-visibility`.
- The 232 `.artifacts/...` evidence links in the dated pages were replaced by the text
  "evidence file not retained" (the files are gitignored and gone), and the 1,689
  `#Lnnn` line anchors in source links were removed because they were not pinned to a
  commit and at least 40 percent pointed at blank or unrelated lines (audit DOCS-009). The
  claims those pages make ("passed N assertions") cannot be re-checked from the tree.

## Reading order for the dated records

Older pages stay in place so links keep working. They are history, not guidance:

| Page | Covers | Cutoff |
| --- | --- | --- |
| [project-plan.md](project-plan.md), [source-assessment.md](source-assessment.md), [verification-plan.md](verification-plan.md) | The original plan before implementation | Pre-1.0 |
| [project-status-2026-09-11.md](project-status-2026-09-11.md), [project-status-current.md](project-status-current.md) | Status at two September commits | 2026-09 |
| [completion-status.md](completion-status.md), [implementation-checklist.md](implementation-checklist.md), [implementation-priorities.md](implementation-priorities.md) | The requirement ledger and its ordering | 2026-09-15 |
| [execution-status.md](execution-status.md), [remaining-work.md](remaining-work.md) | Installed-build evidence and the 1.0.0 patch list | 1.0.0 |
| [comparison-q1.md](comparison-q1.md), [comparison-q2.md](comparison-q2.md), [comparison-q3.md](comparison-q3.md), [menu-source-comparison.md](menu-source-comparison.md), [source-inventory-reconciliation.md](source-inventory-reconciliation.md) | Source-to-port comparisons | 2026-09 to 2026-10 |
| [tick-execution.md](tick-execution.md), [functional-targets/](functional-targets/README.md) | Frame-cycle description and target plans | 1.0.0 |

The `verification/` directory, `work-packages.json`, `dependency-graph.mmd`,
`validate-plan.ts` and `completion-status.json` that these pages cite were deleted in
commit `949c337c`. Paths such as `../the Q1 reference port/...` are placeholders left by a
path scrub, and bare `src/...` paths in the comparison pages often name donor-project files,
not files in this tree.
