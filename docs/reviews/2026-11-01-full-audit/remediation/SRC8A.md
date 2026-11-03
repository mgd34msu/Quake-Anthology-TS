# SRC8A remediation
| ID | status | note |
|---|---|---|
| SRC8A-001 | fixed | A bot_report on an empty goal stack reports 'roaming ' with an empty name instead of throwing. No test. |
| SRC8A-002 | fixed | A non-integer where a weight file or chat template needs an integer fails through the normal script error (`expected integer, found ...`) instead of a RangeError. Test: tests/bots/behavior/library/botfile-errors.test.ts (weights); the chat-data twin has no test. |
| SRC8A-003 | fixed | The comment on chooseWeapon's fallback now says it is a deliberate guard, not source behavior. No behavior change. |
