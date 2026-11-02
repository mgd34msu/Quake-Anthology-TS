# VERIFY-B: adversarial check of High findings (FORMATS, GUEST, PLATFORM, RENDER, VM)

Scope: all 25 High entries. Experiment scripts are in scratchpad/verify-b. "Measured" means I ran it at HEAD from clean; "traced" means I read the path only.
Severity rule for crafted files: Q3 downloads default off (client-download-policy.ts:21), the Q2 download regex excludes jpg/gif/q3 maps (q2-downloads.ts:246), and QW downloads only sound/model/skin (qw-client.ts:63). No crafted-file finding below has a default remote path, so those are limited reach (Medium).

### FORMATS-001
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Code as quoted (jpeg.ts:122-127, 270; no cap in textures.ts:232). Re-measured 4000x4000 from 140 bytes: 482 ms, 192 MB. No legitimate file triggers it, and delivery needs an installed hostile file or opt-in `cl_allowDownload`. The 65500x65500 figure is extrapolated, not run.

### FORMATS-002
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Re-measured 1,520 bytes to 419 MB retained, 465 MB RSS in 195 ms (gif.ts:113, no frame cap). q2-downloads.ts:246 rejects .gif, so the path is local content or an opt-in Q3 pk3. The 290 GB figure is arithmetic only.

### FORMATS-003
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: ibsp44.ts:66-74 is as quoted and the loop runs before any vertex range check. Under `ulimit -v 4000000`, both 1e7 and 2147483647 threw a catchable `Out of memory` at about 650 MB; unlimited behavior was not rerun. Needs a crafted local map or opt-in Q3 download.

### FORMATS-004
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Re-ran q1cycle: `readQ1Bsp` accepted a self-referencing node and `worldPointLeaf` (visibility.ts:30-38) never returned. The guard in q1-map/queries.ts:52 is not on this path. A permanent hang, but Q1 has no map download path (remote-q1.ts:124 requires a local map; qw-client.ts:63), so only a locally installed map reaches it.

### FORMATS-005
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Retention is real but "Q1 client memory climbs" is false for Q1 play. Sole caller is prepare.ts:365, and it receives backLerp 0 on Q1 clocks (see RENDER-001): 0 nonzero keys in 3,600 and 600 measured frames. It grows only on the RENDER-001 cross-game path, capped at 256 per pair (animation.ts:45). Duplicate root cause of RENDER-001.

### FORMATS-006
Verdict: confirmed
Corrected severity: Medium
Reason: Upgraded from traced to measured by patching leaf 0 of real q3dm1.bsp. `parseQ3Bsp` accepted area 20000 and 2147483646 (decode.ts:220). `decodedCollisionMap` (map-resource.ts:535-537) threw catchable OOM at 20000 and hit an uncatchable JSC MemoryExhaustion abort at 2147483646, under the 4 GB limit. Crafted map only.

### FORMATS-007
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Traced as quoted: recipe.ts:24-25, startup.ts:1199, content.ts:451, 484; digest is self-supplied (mounts/index.ts:544). Impact is narrower than High: content.ts:456-480 restricts module/product pairing, native modules run emulated rather than on the host, and the payload file must already be on disk. No malicious save was built. The path leak and install-move breakage stand.

### GUEST-002
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Unproven link settled, measured: on dedicated classic and rerelease startups `sourceCvars() === guest registry` is true (application.ts:561, 1762; runtime.ts:3255). With rcon_password set, the classic `cvar_t.next` walk in guest memory read `hunter2` after 91 hops; rerelease `cvar()` returned it too. Restore path not run. Needs an operator-installed hostile DLL, and source engines grant the same access.

### GUEST-003
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Code as quoted (cvars.ts:18-24, records.ts:30-35); no delete path. Network link traced, not run: q2.ts:366-369 to `host.command`, then classic-guest-world.ts:216-222. Normal chat is negligible at about 4 KiB per line. Only a hostile peer on an opt-in native DLL server matters; I found no rate limit by grep in q2.ts but measured no attack rate.

### GUEST-004
Verdict: confirmed-with-changes
Corrected severity: High
Reason: cpu.ts:53-60 as quoted; bench re-run gave 1.09 MIPS integer, 0.30 MIPS x87 on this load. Real cost now measured, which the finding lacked: base1 with `gamex86.dll` and a local player has median 151 ms, p95 209 ms per 100 ms tick, against 53 ms for the TS source with the same 64x64 CPU renderer. Guest cost is about 100 ms, so no headroom. Empty dedicated: 30 ms.

### GUEST-005
Verdict: confirmed-with-changes
Corrected severity: High
Reason: binary.ts:194 path as quoted; bench re-run 0.92 MIPS vs 7.12 integer. Rerelease `game_x64.dll` on base1 with a player measured median 174 ms per 25 ms tick (7 ms empty dedicated), so it misses real time by several times. "Largest single limit" remains unproven: I did not profile how much of the real frame is soft-float.

### PLATFORM-001
Verdict: confirmed-with-changes
Corrected severity: High
Reason: engine.ts:141-148 and audio.ts:568 as quoted; re-ran throw at generation 65,536. The 50 spawns/s rate is about 4.5x too high: q3dm1 with 4 bots measured 11.2 new actors/s, 75 bodies average, so 30,000 actors at about 45 min and the crash at about 97 min. World replacement resets it (application.ts:2969), so it needs one long world; retail content suffices. Dedicated servers have no audio.

### PLATFORM-002
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Re-ran: `corrupt mix THROWS ... -3`; intact and truncated files pass (vorbis.ts:129). No catch at audio.ts:650. Trigger needs a damaged music file, not normal content.

### PLATFORM-003
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Guard absent as quoted (bank.ts:33, mixer.ts:202-204). Corpus scan: 141 of 8,530 WAVs are stereo, nearly all music or `tactile/*_vb.wav`. The non-music effects found: `loop_electricity_05.wav`, referenced only from 6 Team Arena ui/*.menu files, and `alliance/quiet.wav`, unreferenced by any scanned bsp, shader, qvm, cfg, menu or arena file. I did not run the menu path or trace haptic files through the mixer. No retail BSP trigger found.

### PLATFORM-004
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: "Ordinary invalid commands" is overstated. Through real `Application.step` with a local-seat context, `bogus`, `map nosuchmap`, `give foo`, `exec nofile`, `fov abc`, and Q1 `impulse foo`/`impulse 999` all survive. Step throws on Q3 `impulse foo` (impulse.ts:37), `+attack 1 abc` (seat.ts:246), `startcamera` and argless `loadcamera` (camera/application.ts:32-35). Used `buffer.append`, not the console UI.

### RENDER-001
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Q1 claim refuted. e1m1 at 60 fps gave 47 keys, 0 nonzero, max 1 per pair in 3,600 frames; with player 53 keys in 600. Q1 clock gives `fixed = null`, so backLerp is 0 (runtime.ts:5158, 5198, 7362); prepare.ts:49 zeroes frame==previous; remote-q1.ts:304 sends none. Real path: Q1 character on a Q2 map, `oldFrame ?? 0` (runtime.ts:7477): 1,800 keys in 1,800 frames, 5 pairs. Real player.mdl costs about 0.3 MB/key, so about 17 MB/s at 60 fps, capped at about 150 MB/pair (about 750 MB idle).

### RENDER-002
Verdict: confirmed-with-changes
Corrected severity: High
Reason: Reproduced in real sessions. textures.ts:162 returns a fresh object and row-parallel.ts:257-262 misses every time. e1m1 at 640x480, static camera: 18 dispatches/frame, RSS 553 to 2,041 MB in 300 frames. q3dm1 passed my 3.5 GB stop within 80 frames. Added gate: rasterizer.ts:1180 needs 4+ triangles and 50,000+ pixels, which fits the flat 320x240 soak in soak-q1-client.log. Software renderer is a menu choice (startup-selection.ts:715).

### RENDER-003
Verdict: refuted
Corrected severity: Low
Reason: Real visibility does not produce the growth. Lit surfaces emit diffuse then a per-face lightmap (legacy.ts:152, 175-180; world.ts:297), so adjacent batches fail `sameTexture` (submissions.ts:143-145) and runs rarely form. Camera tour, 60 Hz, forced `worldSpaceBatches`, real `pack`, no GL context: heap flat at e1m1 283-286 MB, base1 384-388 MB (12,000 frames each), q3dm1 418-429 MB (6,000). Unlit maps may still merge; not measured, hence Low.

### RENDER-004
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Re-ran wire.ts: `batch.space` undefined and no viewProjection (worker-protocol.ts:170-171). presentation.ts:427 does not check for a worker. The visual result is traced only because no GL context is available. `r_smp` defaults to 0 (image-settings.ts:90), so this is opt-in.

### RENDER-005
Verdict: confirmed-with-changes
Corrected severity: High
Reason: Throw re-run (material.ts:1447-1451). The finding's trigger was weak: frequency 100 is absent from retail, whose maximum is 10, and no corpus stretch shader reaches exact zero. Better trigger: time is Q3 server time (q3-client.ts:548; client-state.ts:51), carried across maps (application.ts:2756-2758). Retail `rgbGen wave sin .9 .1 0 10` throws at 2.43 days uptime, measured at material level; 120 of 426 baseq3 waves throw by 7 days. Client-to-server path traced, not run.

### RENDER-008
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: world.ts:601-607 as quoted; any light rebuilds all visible lightmaps. Real frontend cost is far below "a full frame budget": e1m1 at spawn, 335 surfaces, 2.7 to 4.8 ms median; base1, 600 surfaces, 3.0 to 5.9 ms. The 16-25 ms synthetic does not hold there. GL upload cost (about 2 calls per face) is unmeasured, and I sampled spawn views only, so larger views cost more.

### VM-001
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Re-ran churn: threw at 8,191 foreign actors (mod-provider.ts:592-595, memory.ts:47). Real rate of 11.2 actors/s on q3dm1 gives about 12 min if a mod projects them. Applies only to opt-in `--mod` QC components (quakec-mod.ts:7), not the primary QuakeC source.

### VM-002
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Re-ran stale: the read throws (mod-provider.ts:367-369, 580-581; machine.ts:426-430). Common QC idiom, and fatal through VM-004. Same limited reach as VM-001: `QcModProvider` only. No real shipped mod was run against it.

### VM-003
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Re-ran hang: killed by timeout, rc 124. Only budget is the counter evaluation (interpreter.ts:915, 508). Needs a faulty or hostile server/mod QVM; client delivery is off by default (`cl_allowDownload 0`), and the finding itself notes original Q3 had no budget either. `grow` was not rerun.

### VM-004
Verdict: confirmed
Corrected severity: High
Reason: Traced, not run with a live guest fault. Grep of src/app/bootstrap and src/core found no reader of the drop/fatal code. application.ts:4685-4688 rethrows or calls `closeFailedWorld`, which rethrows (:4723-4730); main.ts:89-94 logs and returns 1. A `trap_Error` therefore ends a dedicated server, where id engines drop to console.
