| ID | status | note |
|---|---|---|
| GAPQ12-001 | fixed | presentation-scene.ts: a missing players/<model> asset falls back to players/male/tris.md2 with the grunt skin instead of throwing, for remote and local sources. Still no test (needs a scene and asset harness, which does not exist). |
| GAPQ12-002 | fixed | weapons/player.ts consume(): on a shortfall the shot spends whatever remains instead of throwing. Test added in tests/gameplay/foundation/q2/weapons/weapons.test.ts (ammo dropped mid-fire never throws or goes negative; passes). |
| GAPQ12-003 | fixed | composition/q1/give.ts prints usage/unavailable/unknown-item text to the sender instead of throwing; the QuakeC give in simulation/quakec-source.ts (hostGive) now does the same for no argument, an unknown item and a map with no item template. Covered by tests/first-playable/simulation/qc-grants.test.ts (give, give frobnicate, give item_frobnicate on both QW and Hipnotic VMs; passes). |
| GAPQ12-004 | fixed | ctf/index.ts ctf-menu: join, chase and match entries need a team-less player, and match also needs competition on and phase none. No test. |
| GAPQ12-005 | fixed | lmctf/admin.ts: pausematch, unpausematch and pause_match all require the referee flag ("You are not a Referee"). Upstream LMCTF behavior unverified. No test. |
| GAPQ12-006 | fixed | New server cvar `sv_gate_dev_impulses` (default 0 = id behaviour): when 1, the MG1/MG3 developer impulses (100-105, 111-122, 219, 222, 223, 227, 228) need cheats on deathmatch/coop servers. Test: tests/composition/q1/source.test.ts |
| GAPQ12-007 | fixed | q1/missionpacks/player.ts: state entity cached per player in a Map, released with the actor (state entity removed). No test. |
| GAPQ12-008 | fixed | composition/q2/index.ts quadFireDropUntil: classic drops QuadFire when dmflags 0x10000 is set. No test. |
| GAPQ12-009 | fixed | spheres.ts: doppleganger hunter/vengeance pain assigns wait = now + 15 instead of Math.max. No test. |
| GAPQ12-010 | fixed | rerelease/players.ts coopRespawn no longer clears state.spectator before respawn(), so a previously benched player does not copy a second body (putInServer resets it from requestedSpectator). No test. |
| GAPQ12-011 | fixed | ctf/presentation.ts sayTeam: manual expansion loop stops at the 1023 output cap and caches each expansion per message. Kept the port cap rather than the original 254. No test. |
| GAPQ12-012 | fixed | lmctf/vote.ts start(): ballots are cleared only when no vote is running. No test. |
| GAPQ12-013 | fixed | missionpacks/monsters/state.ts: bind(game) registers an onRelease that drops the actor entry; called from spawn and restore. No test. |
| GAPQ12-014 | no-action | Refuted by verification: dm_ball.c leaves the model drawn (modelindex line commented out), port is faithful. |
| GAPQ12-015 | no-action | Info: info_command running map text matches QC localcmd; no change needed for parity. |
