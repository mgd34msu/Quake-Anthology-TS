# SRC9 remediation
| ID | status | note |
|---|---|---|
| SRC9-002 | fixed | The guest observation table starts a never-seen slot from the empty record (zero origin and ltime), so first-sight interval and lastvisorigin follow the C slot; entityInfo returns an empty record with the entity number instead of null; model index, type and weapon reads and the mover scan use stale records. No test. |
| SRC9-003 | fixed | The guest table is invalidated at each BotLibStartFrame, and BotLibUpdateEntity returns BLERR_LIBRARYNOTSETUP (1) when not set up and prints and returns BLERR_INVALIDENTITYNUMBER (2) for an out-of-range entity. The numeric values are from be_interface.h as remembered (the finding names the codes, not the numbers); no id source is on this machine to check them, and no stock path reads the return. No test. |
| SRC9-004 | fixed | Mission HUD menu text goes through a COM_Compress equivalent (compressScriptText) before tokenizing. No test. |
| SRC9-005 | fixed | guest-bots.ts now takes a brush entity's bounds from the collision model (a radius box once any angle is nonzero) as AAS_UpdateEntity does, and leaves mins, maxs and angles at their last values for a solid that is neither SOLID_BBOX nor SOLID_BSP. Typecheck clean; tests/app/q3-guest-records.test.ts and q3-guest-runtime.test.ts pass; no direct test of the radius rule. |
| SRC9-006 | fixed | Setting bot_saveroutingcache now prints that routing cache files are unsupported before it resets. No test. |
| SRC9-007 | no-action | Info: no port of be_aas_debug.c is needed for parity. |
