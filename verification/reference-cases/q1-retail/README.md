# Q1 retail observation

`bun tools/reference/q1-retail/capture.ts` launches the installed Steam `Quake/Winquake.exe` with the direct Wine binary supplied by Proton Experimental. It copies the executable to `.artifacts`, creates a fresh Wine prefix and real game directories, and links only the two read assets from `../qfiles/q1/id1`. It starts its own Xvfb and limits wineserver cleanup to the private prefix.

`latest.json` records the actual run on 2026-09-11, including executable and asset hashes, exact command and environment, script, console output, and artifact identities. This is independent retail execution evidence. It contains no TypeScript engine comparison.

The retail console reports version 1.09 and build dates of March 21, 1997. The run loaded `start`, established a local player, accepted `host_framerate 0.05`, `sys_ticrate 0.05`, and `cl_forwardspeed 200`, and completed the scripted movement and save/load sequence. The player origin was `544 288 28.031250` before movement, `544 496.843353 12.031250` after movement, and `544 288 28.031250` after reloading. The produced demo is 9,473 bytes. Three PCX screenshots decode at 400 by 300; the window reports 800 by 600 because this retail mode stretches its framebuffer.

The first script's `quit` command reached the quit menu. An explicit `wineserver -k` against this run's private prefix ended the remaining processes after the completion checkpoint. Its exit status was zero, but that does not establish an unassisted game exit. The driver's subsequent cleanup saw no live wineserver and returned one. The owned game, Xvfb, and wineserver PIDs were absent after cleanup. The original driver snapshot remains in the artifact directory and matches the recorded hash.

The current driver adds `toggleconsole` before `quit`, following `WinQuake/host_cmd.c:37`, and writes process logs to files so Wine descendants cannot hold capture pipes open. These fixes were typechecked; this revision has not been run against the retail executable. No additional launch was made after the user redirected work to engine implementation.

The timing schedule and save observations are evidence for this run. They do not establish deterministic replay, demo decoding, numerical parity, a pixel tolerance, mission pack behavior, or rerelease behavior. Screenshots and commercial files remain in ignored `.artifacts` only.
