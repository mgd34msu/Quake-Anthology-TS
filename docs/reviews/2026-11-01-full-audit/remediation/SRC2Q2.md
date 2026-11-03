| ID | status | note |
|---|---|---|
| SRC2Q2-001 | fixed | movers.ts: door `use` clears message/touch only for non-buttons, as door_use does. Test: foundation.test.ts "a touch-fired func_button keeps its touch callback ...". |
| SRC2Q2-002 | fixed | commands.ts: weapnext walks up the weapon table and weapprev down; comment removed. The per-weapon "No ammo" prints of the original are not ported. No test (tests/console only parse the command names). |
| SRC2Q2-003 | fixed | commands.ts team(): model part under DF_MODELTEAMS (128), skin part otherwise. No test. |
| SRC2Q2-004 | fixed | base/player/index.ts setInventory resets ammo capacity to the catalog value when zeroing on a deathmatch/dead respawn; carried entries are re-applied afterwards so coop keeps its pack. No test. |
| SRC2Q2-005 | fixed | items.ts new syncPowerArmor: the active kind follows the inventory, shield first; use() picks the kind that way, pickups re-sync, and commands.ts drop re-syncs so dropping the last unit switches protection off. No test. |
| SRC2Q2-006 | fixed | base/player/index.ts: FL_POWER_ARMOR and powered protection are cleared in recordDeath (first death) instead of clearPowerups, so they survive putInServer and intermission. No test. |
| SRC2Q2-007 | fixed | scenery.ts misc_deadsoldier serverFlags |= 6 (SVF_MONSTER|SVF_DEADMONSTER). No test. |
| SRC2Q2-008 | fixed | items.ts new Q2ItemHooks.pickedUp, called after a taken pickup; composition/q2/index.ts sets bonusAlpha 0.25 and selects usable items for every edition. No test. |
| SRC2Q2-009 | fixed | items.ts: items/damage.wav, items/protect.wav, misc/power1/power2.wav on use, "No cells for power armor." print; the "Power armor <kind>" print hooks in simulation/runtime.ts (two sites) are now no-ops. No test. |
| SRC2Q2-010 | no-action | Refuted by verification: ballistics.ts:236 matches retail gamex86.dll and ORIG/RR source; the proposed change would diverge. |
| SRC2Q2-011 | fixed | ballistics.ts fireBlaster sets serverFlags bit 2 (SVF_DEADMONSTER) on bolts. Effect not measured; no test. |
| SRC2Q2-012 | fixed | commands.ts kill: damage is applied with the player as attacker and inflictor (obituary says "killed himself"), amount equals current health so it never gibs, and it does nothing when already dead. No test. |
| SRC2Q2-013 | fixed | commands.ts: score returns early in single player and toggles otherwise; help in deathmatch runs the same toggle. No test. |
| SRC2Q2-014 | fixed | base/player/index.ts: the scoreboard is sent on first deathmatch death and obituary() sets entity.enemy to the killing player (null for self/world). Whether any presentation consumer uses `killer` was not traced. No test. |
| SRC2Q2-015 | fixed | Done: 'entered the game' print and q2:login effect on non-spectator admission (composition/q2/index.ts admit). Now also: Q2PlayerMovement.upMove (MovementPlayer.upMove, set from each command in players.ts) lets a spectator's jump press (upmove >= 10, PMF_JUMP_HELD via Q2PlayerState.jumpHeld) step the chase target in afterClientThink. The 14-unit hold on spectator respawn is already carried by the teleport event. No test for the jump path. |
| SRC2Q2-016 | fixed | commands.ts: weapon filter uses item.weapon (grenades included), inventory cycles in itemlist order, use no longer writes selectedItem, invdrop with nothing selected says "No item to drop.", and selection is revalidated after use and drop. No test. |
| SRC2Q2-017 | fixed | movers.ts TrainState.wait is set in trainNext and read by trainWait (checkpointed as optional `wait`, old saves read 0). No test. |
| SRC2Q2-018 | fixed | base/entities/movers.ts func_object clipMask is MASK_MONSTERSOLID (0x2020003). No test. |
| SRC2Q2-019 | fixed | movers.ts: point_combat is removed in deathmatch and uses a z +/-16 box; path_corner keeps +/-8. No test. |
| SRC2Q2-020 | fixed | movers.ts doorSound: start/end sound and middle loop only from the team master; door and secret-door message sound play on the touching player. No test. |
| SRC2Q2-021 | fixed | scenery.ts barrel_touch uses an M_walkmove-style step (18 up, 36 down, SV_CheckBottom via new ai.ts checkEntityBottom, monster solid mask) instead of a flat trace. No test. |
| SRC2Q2-022 | fixed | network/q2/client-messages.ts reads but drops string commands after the seventh in a packet (MAX_STRINGCMDS). The throws on a second move or bad checksum are kept on purpose: this port drops the peer for protocol faults. No test. |
