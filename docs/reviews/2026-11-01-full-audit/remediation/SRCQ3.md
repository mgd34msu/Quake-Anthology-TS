| ID | status | note |
|---|---|---|
| SRCQ3-001 | fixed | `playerDie` sets `self.enemy` to the attacker and the damage death path sets `target.enemy` as `G_Damage` does, so `vtaunt` reaches `death_insult` (death.ts, combat.ts). No test. |
| SRCQ3-002 | no-action | Refuted: id's `ParseShader` returns false for a zero-stage shader and the default shader is used, as the port does. |
| SRCQ3-003 | fixed | Compiled OP_BLOCK_COPY now copies whole words only (count>>2) and strictly forward like vm_x86.c; the range check stays as the deliberate safety deviation (fails clearly instead of masking). tests/compat/qvm/qvm.test.ts 'compiled block copies move whole words forward and refuse out-of-range blocks'. |
| SRCQ3-004 | fixed | Documented in `evaluateQvmBranch` that the branches follow vm_interpreted.c and which of the six float branches differ from the x86 JIT on NaN (operations.ts); no emulation, as the finding says. |
| SRCQ3-005 | fixed | Ladders are a unified-engine extension behind `pmove_ladders`. They default on (rule 5): retail Q3 maps have no SURF_LADDER surfaces, so stock behavior is unchanged, while Q3 movement on Q2 and Q1 maps keeps climbing their ladders. `pmove_ladders 0` turns them off. Tests: tests/movement/q3/ladders.test.ts (default, on and off), tests/first-playable/q2-boss2.test.ts (Q3 movement climbs the boss2 ladder). |
| SRCQ3-006 | fixed | checkDuck applies the posture hull unconditionally as id does; the shared expansion refusal remains only for a client-output body shape (options.bodyBounds). tests/movement/q3/ladders.test.ts dead-to-alive case. |
| SRCQ3-007 | no-action | Info; the loader fails closed with a clear error, JIT also rejects unknown opcodes, and no real mod is rejected. |
