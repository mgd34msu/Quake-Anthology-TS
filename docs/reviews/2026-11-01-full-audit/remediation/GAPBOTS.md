# GAPBOTS remediation
| ID | status | note |
|---|---|---|
| GAPBOTS-001 | no-action | Refuted by verification: the suicidal-fight latch is id's behavior. |
| GAPBOTS-002 | fixed | A FUNCBOB reachability whose model has no entity prints the BotFuncBobStartEnd message and ends the reachability (failure, reachabilityTime 0) instead of throwing. No test. |
| GAPBOTS-003 | no-action | Refuted by verification: the port matches the source condition. |
| GAPBOTS-004 | fixed | BotWeaponTactics gains closeRangeAimPenalty: the four source weapons for native roles, the old speed test only for roleless foreign weapons; ai-combat uses it. No test. |
| GAPBOTS-005 | fixed | Source pickup bindings are found through a slot:generation index instead of scanning all of them. Bindings stay for the map on purpose: goal numbers are referenced from saves and bot goal stacks, so dropping one would invalidate them. No test. |
| GAPBOTS-006 | fixed | The per-frame entity scan asks a cheap `observable(number)` first, so absent, unlinked and hidden slots are no longer deep-copied; present entities are copied because the observation table owns detached records. No test. |
| GAPBOTS-007 | fixed | A bot_* cvar value over 255 characters is cut to 255 instead of throwing. No test. |
| GAPBOTS-008 | fixed | Added tests/bots/behavior/ai-decision.test.ts: table-driven aiEnter* node selection, the avoid-memory and chase-clock resets, the FIGHTSUICIDAL latch (set by AIEnter_Battle_SuicidalFight and, as in id, never cleared by later entries), the observer node leaving to stand, and the respawn node timer/respawn/return sequence. 5 tests pass. |
