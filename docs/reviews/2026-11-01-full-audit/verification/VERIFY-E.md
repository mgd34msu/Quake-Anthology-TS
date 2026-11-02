# VERIFY-E — adversarial verification of Medium findings, batch MED1 (round 3)

Method: opened each cited location in <scratchpad>/clean (HEAD fcdc8af5) and looked for an outer guard, a removal path, or a wrong branch.
Run here: APP-005, APP-007, APP-012 (real main/writeCrashLog), SIM-009 (real writeQuakeWorldMessage), NET-011 (fetch body abort), GAPNET-004 (real SaveReader on JSON NaN), GAPSIM-008 (allocation timing).
All other verdicts are code-traced. Timings quoted from an original finding were not re-measured. No server or flood harness was run.

### APP-005
Verdict: confirmed
Corrected severity: Medium
Reason: main.ts:21 logs only `error.stack ?? error.message`. Rerun: the log for an AggregateError and an Error with `cause` contained neither root string. main.ts:34-35,92 use the same format on stderr.

### APP-006
Verdict: confirmed
Corrected severity: Medium
Reason: main.ts:82-86 has no catch, so a throw from `application.close()` in finally replaces the run error. close() returns the cached rejected promise (application.ts:4718), so the "World publication and shutdown failed" aggregate from :4728 is discarded.

### APP-007
Verdict: confirmed
Corrected severity: Low
Reason: Rerun: `--width abc` prints a stack and `--bogus-option` gives `Missing value for --bogus-option` (options.ts:176-177), and both append to crash.log (main.ts:37,91). The harm is a noisy message and log with no gameplay impact, so it is minor.

### APP-008
Verdict: confirmed
Corrected severity: Low
Reason: crash-log.test.ts:10 calls main() with no directory override and main.ts:91 uses the default directory. There is no bunfig or HOME override, and it is the only `main([` call in tests. Real test pollution, but it affects only a diagnostic log.

### APP-010
Verdict: confirmed
Corrected severity: Medium
Reason: remote-application.ts:1597 and startup.ts:1337 have no catch, mapResourcePath (options.ts:142) and parseLoadRequest (save-requests.ts:10) throw, and commands/index.ts:268 rethrows. Reach is wider than the title: with no world, startup.ts:526 forwards to frontendCommand and routeCommand the same way, so the menu console is affected too.

### APP-011
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The uncorrected elapsed time and missing Q2 clamp are real (application.ts:4699-4702, startup.ts:1351, frame-time.ts Q2 branch). The cited loop runtime.ts:5103-5104 is the Q3 guest (:5082), which is clamped. The Q2 unbounded loop is the native one at :7182, and it can yield frames between ticks (:7139-7142). Non-guest Q2 runs at most 200 ms per step with debt retained (:5172-5173), so "50 ticks on the first frame" does not apply there.

### APP-012
Verdict: confirmed
Corrected severity: Medium
Reason: main.ts:20 writes argv verbatim. Rerun: `hunter2` appears in the log and the file mode is 644. Exposure to other local users also depends on home directory permissions, which the code does not control.

### APP-013
Verdict: confirmed
Corrected severity: Low
Reason: audio.ts:563-566 is quadratic and remote-application.ts:2254,2279 always duplicates the primary snapshot. By the finding's own numbers, 256 actors doubled costs about 1 ms per frame. The 12 ms figure needs a 1024-actor world, which is not typical.

### APP-020
Verdict: confirmed
Corrected severity: Medium
Reason: Rechecked 4817 and 2515 lines, 364196 bytes, 17 and 16 lines over 300 characters, and constructor counts 3/1/1, 3/1/1, 3/1/1, 4/1/1, 2/2/0. reportedEffectGaps clears at application.ts:3131 with no clear in remote; closingDuringStep is at remote-application.ts:2359; run() copies match.

### GAPAPP-002
Verdict: confirmed
Corrected severity: Medium
Reason: q3-client.ts:267 force-sets every systeminfo pair and :483 repeats it per frame. After publish the registry is the live owner (remote-application.ts:1395 adoptCvars). Correction to the cost note only: an unchanged value returns early (cvars/index.ts:485), so per-frame cost is the split and comparison.

### GAPAPP-003
Verdict: confirmed
Corrected severity: Medium
Reason: server-browser.ts:75,81,87,93,95 reject with no per-file tolerance beyond non-JSON text, and startup.ts:211 closes and rethrows. readDirectServers rejects `{}` at server-browser-addresses.ts:19-20. No fallback path to a disabled browser exists.

### GAPAPP-004
Verdict: confirmed
Corrected severity: Medium
Reason: rows() (server-browser.ts:262-282) has no cache and is called at startup-menu.ts:338,935,936. controller.ts:39 documents that factories rerun before each input event and draw, and :75-80 does so. Limited to the browser menu with a large list.

### GAPAPP-005
Verdict: confirmed
Corrected severity: Medium
Reason: presentation-scene.ts:196,221 are unguarded and assets.ts:325 throws; precache.ts:107-108 treats the same failure as optional; assets.ts:338 evicts the rejection. The guards at presentation-scene.ts:157-178 do not check for existence. Remote Q2 reaches this too (remote.ts:291-297), which GAPQ12 already covers.

### GAPAPP-006
Verdict: confirmed
Corrected severity: Medium
Reason: server-master-list.ts:26 maps directServerText with a throw on whitespace (addresses.ts:12). server-browser.ts:237 uses Promise.all, and addresses are added only after the loop (:241), so one failure discards everything.

### GAPAPP-007
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The admission gap (server-browser.ts:408-409) and save-time rejection (cache.ts:41-44,99) are real. "Any server in the list" is too broad: cache.ts:95-96 saves only master, secondary-master and favorite entries, so LAN and direct-only entries cannot trigger it. Only Q3 is affected.

### GAPAPP-008
Verdict: confirmed
Corrected severity: High
Reason: remote-q1.ts:155-156 accepts any time, the published time derives from it (:356-358), effects.ts:252 throws, and remote-application.ts:2246 sits in a step whose catch rethrows. One well-formed message from an untrusted server exits the client, the same class and reach as NET-005 (High).

### GAPAPP2-003
Verdict: confirmed
Corrected severity: Medium
Reason: weapon-hud.ts:65 throws on a null texture and is reached from seat-hud-state.ts:58,66,71 through ui.ts:132 with no catch. The unset-index throw is at q2-rerelease-hud-events.ts:15-17. Limited to rerelease content.

### GAPAPP2-004
Verdict: confirmed
Corrected severity: High
Reason: diagnostic-tools.ts:30 throws per frame and application.ts:1341 registers cl_avidemo with flags 0. The hostile path holds: q3-client.ts:267 writes the owner adopted at remote-application.ts:1395, which is the registry read at :2154-2157, and that step's catch rethrows. One systeminfo string from an untrusted server exits the client.

### GAPAPP2-005
Verdict: confirmed
Corrected severity: Medium
Reason: q2-service-presentation.ts:64,76 and muzzle.ts:579 are as quoted and particles.ts:103-104 throws, with no drop path in translation. native-q2-client.ts:41 also has no local catch. The finding already notes the Q1 length-0 case is parity.

### GAPAPP2-006
Verdict: confirmed
Corrected severity: Medium
Reason: sound-captions.ts:18-22 subscribes unconditionally, the only deletion is in prepare (:27), and ui.ts:117-121 returns before the only call at :135. Bounded by world replacement, as the finding states.

### GAPAPP2-007
Verdict: confirmed
Corrected severity: Medium
Reason: effects/q3.ts:151 calls activeEntities() per reference, and local-entities.ts:117-121 allocates and freezes a new array each call. :180 and :198 are as quoted. The timing was not re-measured.

### GAPNET-004
Verdict: confirmed
Corrected severity: Medium
Reason: unified-event-codec.ts:1044 uses plain JSON. Rerun: SaveReader `.finite()` on a JSON round-tripped NaN throws `expected a number`. unified-client.ts:74 is inside the handler whose catch at :90 disconnects and rethrows, and unified-server.ts:237 does not validate.

### GAPNET-005
Verdict: confirmed
Corrected severity: Medium
Reason: remote-unified.ts:84-85,88-90 insert per slot and generation, the only clear is on offer (:101), and numberOf (:215) is a linear scan with string splitting, used by PresentationState (:55). Slot and generation are unbounded (unified-event-codec.ts:22,24).

### GAPNET-006
Verdict: confirmed
Corrected severity: Medium
Reason: remote-q1.ts:167,309 and recording.ts have no statics cap. q1-client.ts:115 and qw-client.ts:180 observe unconditionally. qw-recording.ts:72 leaves keys, pairs and pairSlots uncleared, with a linear scan at :60. remote-qw.ts:157 copies the map per message.

### GAPNET-007
Verdict: confirmed
Corrected severity: Medium
Reason: unified-frame-values.ts:54 accepts any finite segmentLength and prepare.ts:171 throws on a negative one (0 maps to 30). unified-event-codec.ts:606 and text/world.ts:29 behave likewise. :749-750 checks vectors, while unified-components.ts:102 calls the same reader without that check.

### GAPSIM-005
Verdict: confirmed
Corrected severity: Medium
Reason: quakec-weapon-behavior.ts:104 inserts into slots and no delete exists. free.add occurs only for projectile paths (:141,145,171) and checkpoint restore (:185,200). :121 only zeroes fields, and memory.ts setCount throws above 8192 (:83).

### GAPSIM-006
Verdict: confirmed
Corrected severity: Medium
Reason: bot-rerelease.ts:63-66 scans linearly and inserts. A repository grep shows only set and has on `observations`, with no delete, and :217 writes all rows to checkpoints.

### GAPSIM-007
Verdict: confirmed
Corrected severity: Medium
Reason: q3/runtime.ts:651 tests a carry list that nothing consumes, runtime.ts:4170 calls it for every admission, and client-admission.ts:284 skips initializeClient when firstTime is false. disconnectPlayer (:670-673) does not clear the carry.

### GAPSIM-008
Verdict: confirmed
Corrected severity: Low
Reason: rerelease-guest-services.ts:32 allocates at :199,290,300 as quoted. Measured 7.3 us per allocate-and-slice here, so the finding's 800 per second costs about 6 ms per second (0.6%). This is GC churn, not a meaningful frame cost.

### NET-008
Verdict: confirmed
Corrected severity: Medium
Reason: FloodLimiter has no caller in src or tests, and no limit precedes handshake.ts:284-285, q2.ts:211-221 or q3.ts:65-67. The Q3 reply is capped by transport.ts:10,104 at 16383 bytes. The 1000x ratio needs a full status list, so typical servers amplify less.

### NET-009
Verdict: confirmed
Corrected severity: Medium
Reason: unified-server.ts:146,171 allow the pending-table lockout, :156 refreshes any matching packet, and :179 caps peers at maxClients + 8. qw-server.ts:73,78 and q3 admission have no per-IP cap, and mvd-broadcast.ts:60-62 holds a slot with a 90 s socket timeout before authorization.

### NET-010
Verdict: confirmed
Corrected severity: Medium
Reason: q2/handshake.ts:249,253 use 15 bits with no age check, and q2.ts:234-236 allows unlimited guesses. application.ts wires QW to Math.random. The QW value is 30 bits (q1/handshake.ts:242), so the 32768-guess attack applies to Q2 only.

### NET-011
Verdict: confirmed
Corrected severity: Medium
Reason: http-downloads.ts:46 passes the timeout signal to fetch, and body reads at :131,:331 fall under it. Rerun with a 1.5 s timeout and a slow local stream: TimeoutError during the body at 1501 ms. Ranged spans make progress across attempts (:108-110), so the non-ranged path is the certain failure.

### NET-012
Verdict: confirmed
Corrected severity: Medium
Reason: q2-downloads.ts:207,217,232 have no entry cap, :166 allows 0x7fffffff per file with no total quota, and http-downloads.ts:259-264 re-resolves all pending entries per schedule (:281). client-download-policy.ts:24-25 defaults on.

### NET-013
Verdict: confirmed
Corrected severity: Medium
Reason: q2/handshake.ts:154-162 checks only scheme and credentials, so private and loopback hosts pass. q2-downloads.ts:169 validates a package only by opening the archive, with no digest. client-download-policy.ts:24-26 defaults on.

### NET-014
Verdict: confirmed
Corrected severity: Medium
Reason: q2.ts:284 is fire-and-forget and q2-downloads.ts:81-85 cannot cancel an in-flight open. q2.ts:328-345 has no active check. qw-server.ts:248 awaits in the packet loop and q3-downloads.ts:55-57 hashes synchronously per open. Classic Q2 defaults to off (q2-downloads.ts:38), so reach is rerelease or enabled servers.

### NET-015
Verdict: confirmed
Corrected severity: Medium
Reason: admission.ts:80-84 has no source check and repoints the address, and :88 then trusts that address. q3-client.ts:141 prints `print` from any source. By contrast q2/handshake.ts:201 checks the source.

### NET-016
Verdict: confirmed
Corrected severity: Medium
Reason: client-authorization.ts:25,44 send the key over plain UDP to a hard-coded domain, and q3-client.ts:108-112 does so for non-LAN connects with no opt-in. Server side is authorization.ts:23,40, and admission.ts:151 trusts source IP alone. Domain ownership was not checked (off-localhost).

### NET-017
Verdict: confirmed
Corrected severity: Medium
Reason: connectionless.ts:159 limits only rerelease, and q1/handshake.ts:291 has no limit and compares plainly. admin.ts:114-117 has one global 500 ms slot taken before the password check, so spoofed packets can starve the real admin on Q3.

### NET-018
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The trigger (q3/server.ts:89-91) and queue (:146-147, :53) are real. "Overflow silently drops" is wrong: event-ring.ts:91-93 throws RangeError when full. That throw is caught and printed at q3.ts:172, so the result is a logged failed resend, not a silent drop.

### NET-019
Verdict: confirmed
Corrected severity: Medium
Reason: admission.ts:135-136 scans up to 1024 entries, and endpoint.ts sameAddress builds two strings per call. q3.ts:80-84,169 rebuild the slot table per sequenced datagram, with occupiedSlots() per free slot. No limiter precedes this (see NET-008).

### NET-020
Verdict: confirmed
Corrected severity: Medium
Reason: channel.ts:122 allocates totalBytes on first sight, :143 allows the 4 MiB default (:16) for all lanes, and :174-176 starts a new assembly per higher frame sequence. unified-server.ts:182 sets no smaller limits, and unified-control.ts:134 limits only after assembly. A handshake token is required, but not admission.

### NET-021
Verdict: confirmed
Corrected severity: Medium
Reason: q3/message.ts:98-99 allocates per scalar, q2/server-write.ts:54 with message.ts:508-513 allocates 32 KiB per event, q2.ts:553 clones per peer per frame, and q1.ts:207 with netquake.ts writeNetQuakeEntity builds a buffer and codec per entity. The Huffman tree itself is cached (huffman.ts:179). Timings were not re-measured.

### NET-022
Verdict: confirmed
Corrected severity: Medium
Reason: lan.ts:94-96 creates peers for kinds 128 and 129, :130-133 reserves players, and q2.ts:234 accepts lan.admitted as proof. channel.ts receive accepts flags 0 for any kind, and lan.ts:114 handles 254 before the admitted check at :115. The 25 s matches 5 s keepalive plus 40 retries at 500 ms in tick().

### SIM-006
Verdict: confirmed
Corrected severity: Medium
Reason: runtime.ts:5828 writes with no link, and body.ts write only updates the snapshot, unlike spawnTagToken's link at :5932. Touch is trigger-based (:5929-5930). The omitted +16 is real: :5928 adds it, :5828 does not, and :5920 supplies only the +24.

### SIM-007
Verdict: confirmed
Corrected severity: Medium
Reason: Grep shows no delete or clear for lmctfTeams, deathballTeams, lmctfHealth, lmctfRegenAt or tagHealth, and :6129,:6275 count all entries. :6151 nulls the holder, while spawnLmctfRune is called only at :6116 and :6181, so a departed holder's rune is not respawned.

### SIM-008
Verdict: confirmed
Corrected severity: Medium
Reason: quakec-source.ts:660 allocates for NetQuake on each call, reached from network-q1-quakec.ts:179-184. memory.ts allocate and reserve have no free path and overflow only at 2 GiB. The QW branch uses setEngine. No command rate limit appears on this path.

### SIM-009
Verdict: confirmed
Corrected severity: Medium
Reason: network-qw.ts:226-229 has no length limit, and :67,:120 encode the full userinfo into SizeBuf(1400). Rerun with the real writer: a 1500-byte userinfo throws `Quake message overflow`. qw-server.ts:286-288 catches it and disconnects the joiner, so the server survives.

### SIM-010
Verdict: confirmed
Corrected severity: Medium
Reason: application.ts:4698 is the only limiter on the dedicated path (main.ts:75-76). frame-time.ts Q1 clamp is 1-100 ms, and runtime.ts:5158,5162,5174 run one tick per step when `fixed` is null. Grep finds no sys_ticrate or host_maxfps. The tick rate was traced, not measured.

### SIM-011
Verdict: confirmed
Corrected severity: Medium
Reason: runtime.ts:7308-7311 returns before :7313-7314, while the q2-native branch at :7306 makes both calls. The skipped calls are certain. The reconnect effect remains plausible, as the finding states, and it applies only to mixed QC compositions.

### SIM-013
Verdict: confirmed
Corrected severity: Medium
Reason: quakec-source.ts:299-300 re-encodes every live routed batch on each new batch, and presentation-host.ts:364 allocates SizeBuf(8000) per call (message.ts:10 allocates at construction). Not measured.

### SIM-018
Verdict: confirmed
Corrected severity: Medium
Reason: Rechecked 8591 lines, 759 `source.kind`, 272 lines over 200 characters, 5 over 400, longest 943. `var sliceTouches` is at :7091 and imports after the class at :8556-8557. The method and field counts and duplicate ranges were not recounted.
