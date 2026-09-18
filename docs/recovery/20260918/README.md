# Paused work, 2026-09-18

The user paused the larger task list to fix a recent movement regression, then commit and push. Do not restart the workers until the user resumes the larger task.

Accepted source is on `main` at d7e4291315184d0a8c9f656694eb829fc3192548. The task ledger reports 21/23 accepted: T12 expansion interoperability is reopened; T19 original GRank transport remains blocked. The current installed qfiles executable has SHA-256 0db38d9f7fdeabc833841291dc64195ec843a1ad95d3d842ec8da8c460cce3a4. Existing verification did not check movement stopping after release.

All workers were completed, errored, or interrupted at pause. The pending q3_server_mod_path worker was interrupted without starting. No worker was resumed for this fix. `agent-sessions.json` retains session IDs and local transcript paths; it contains no transcript bodies or credentials.

## Unfinished work preserved here

These patches preserve unfinished source; they are not accepted implementations. They are relative to the clean d7e4291 tree, except the separately identified protected working-tree patch. Apply individual units in an isolated checkout and inspect them before joining.

- `t12-startup-expansions.patch`: menu selection and tests. Prefer the test file from `t12-startup-expansions-gated.patch`; both test patches are relative to the same base, so do not apply both sequentially. The gate is QTS_TEST_INSTALLED_EXPANSION_ARSENALS=1. Menu tests passed, but the combined source still needs qualification. Source expansion firing/save checks existed separately.
- `team-arena-supply.patch`: eight files for Team Arena supply/regen with foreign arsenals. Pure checks passed. Installed-map checks reached save/restore but their fixture incorrectly admitted a second player after restoration. Resume by checking the restored existing player rather than admitting it again, then rerun the affected check. This unit was not joined.
- `t12-shared-ballistics.patch`: partial proximity implementation, with its design note. Not qualified.
- `protected-working-tree.patch`: unrelated pre-existing live changes in simulation/runtime.ts, a QVM test, and verification records. Kept separate from the movement fix. The untracked assets/assets symlink was left untouched.
- The t12-cadence source directory matches the base; no implementation was recovered. No q3_save_core implementation was found.

Local originals and evidence remain under `.artifacts/resume-20260918/`. The manifest records each changed file and its before/after hashes. The clean base archive remains `.artifacts/resume-20260917/t10-combined/source`.

## Worker ownership for resumption

- mixed_game_performance: Team Arena supply, simulation/runtime.ts and simulation/q3/{runtime,types}.ts. Session 01a0a51a-45b1-7d13-badf-14612ef4a4ee.
- q3_bot_transform: ballistics/proximity/missile/invulnerability, narrow weapon/event codec/effects. Session 01a0a071-962c-7df0-bf43-5cb5dcba518e.
- weapon_binding_defaults: Q1/Q2 weapon cadence hooks. Session 01a0a271-c8b4-7283-9df9-5d0962408419.
- q3_save_core: foreign equipment save design, no recovered implementation. Session 01a0a032-5d38-7f83-80e5-a3eca07272ce.
- complete_order_check: startup expansion menu and gated tests. Session 01a09feb-1431-77c3-a745-ab2f2ba435fd.

Keep tests focused. The user's priority is implementation, with appropriate checks rather than more testing infrastructure.
