# NET — Network protocols, services and bootstrap network layer (src/network/**, src/app/bootstrap/network/**)

## Coverage
Audited at HEAD fcdc8af5. Reproductions are in `<scratchpad>/net-repro/` (r1-q2, r2-qw, r3-unified, r5-zip, r6-http, r7-bench) and import from `<scratchpad>/clean`. No live-network or windowed run was made; all servers in repros use loopback or fake transports with the real network classes.

Read in full (about 17,500 lines):
- services: http-downloads, downloads, rankings, online, discovery, admin, rank-codec.
- common: transport, fragments, reliability, session, socks, ipx-dosbox, endpoint, loopback, scheduling.
- unified: channel, packet. Bootstrap unified: unified-control, unified-server, unified-client, remote-unified, unified-content, unified-component-consumer, unified-frame-codec.
- q1: handshake, session, channels, commands, discovery. Bootstrap: q1, q1-client, qw-server, qw-client, qw-downloads, qw-skins.
- q2: channel, handshake, connectionless, client-messages, message, server-messages, frames, gtv, gtv-transport, mvd-broadcast, mvd-recording, mvd-playback, kex/lan, kex/channel, kex/packet, kex/discovery, codecs/zpacket, codecs/clc_batch_move. Bootstrap: q2, q2-downloads, q2-client-receiver, remote, gtv-source, client-download-policy.
- q3: admission, server, netchan, reliable, client, client-message, connectionless, download, authorization, client-authorization, pure, pak-references, snapshot-history, snapshot-store, message, huffman, discovery, game-state. Bootstrap: q3, q3-client, q3-client-downloads, q3-downloads, remote-q3.
- bootstrap: transport, socks-settings. Out-of-scope context read: app/bootstrap/server-browser.ts, platform/files/contained.ts, main.ts:75-95, application.ts step/run.

Sampled: q1/netquake.ts 380-813 of 813; q1/quakeworld.ts 330-726 of 726; q3/server-message.ts 200-521 of 521; q2/codecs/q2repro.ts 1-400 of 1121 plus grep; q2/server-write.ts 230-306 of 306; q2/codec.ts 40-125; q2/codecs/kexdemo.ts 515-570 plus grep of its loops; remote-q1.ts 225-284 of 390.

Grep or scan only, not read (about 9,000 lines, a real coverage gap for client-side decoders): unified-event-codec.ts (1056), q2/codecs r1q2, q2pro, q2pro-fields, mvd, vanilla, kex-write; q1/codecs wide, qw28, qw29, nq15, codec; q3/state-delta, browser-view; remote-qw, unified-components, unified-frame-values, unified-prediction and consumers.

Skipped: constants, anorms, temp types, demo and recording helpers, presentation-only files (q2-layout, q2-effects, q2-mvd-presentation, q1-demo, q2-demo, q3-demo, recorded-source).

Earlier findings: B1 is fixed (524fe0f4). unified-control.ts:60-83 bounds Q3 axes and durations in the decoder, and network-unified.ts:237 re-checks with `unifiedCommandInBounds`. B3 is fixed (fea675d9). http-downloads.ts:61 requests identity encoding and :324 compares length only for identity bodies. Neither is re-reported.

## Strengths
- Download path containment is strong. `openContainedParent` walks directory descriptors with O_NOFOLLOW, staging uses O_EXCL, and publication uses `linkSync`, so existing files cannot be replaced (downloads.ts:75-83, :140). No traversal route was found. Q2 and Q3 clients also apply name allowlists.
- Stufftext is not executed. Q1, QW and Q2 clients act on a small whitelist and print everything else (remote-q1.ts:242-253, qw-client.ts:141-148, q2-client-receiver.ts:105-126), which removes the classic hostile-server console-command attack.
- Unified channel uses a 128-bit CSPRNG token and address binding, bounded fragment and window accounting, and a decoder that derives payload length from the header. Reassembly writes cannot go out of bounds.
- Q3 Huffman, netchan fragments and Q2/KEX/GTV framers are bounded. Zpacket, KEX channel, block download, GTV and unified frame inflates all set output limits (the exceptions are NET-004).
- HTTP redirects stay on the advertised origin and reject credentials. Ranged downloads verify ETag and Content-Range and retry per span.
- Server browser accepts master replies only from the queried address, caps list size and strips control characters from status text. GTV viewer queues are byte-bounded with write backpressure.
- Q3 pure and package downloads verify archive checksums before publication. cl_allowDownload and sv_allowDownload default to 0.
- Ranking service has no active network provider (rankings.ts header; provider is null unless injected), so there is no live trust surface. Its promise chain could grow per frame with a slow provider; this is Info only today.

## Findings

### NET-001 — A silent Q2 client overflows the reliable queue and the exception terminates the server
- **Verification (VERIFY-A): confirmed-with-changes. Final severity: High.** The unguarded throw is real — Q2 `channel.ts:81` throws on overflow and the publish peer loop (q2.ts:~500-540) has no try/catch, unlike the poll loop (q2.ts:444-451). Component repro r1-q2 throws at 1397 bytes. BUT a real `--listen-q2` dedicated server with a silent/stuck client plus a second client flooding `say` survived the full 110s window with no crash (verifyA/n001.log). The "a player losing their link triggers it by accident" Critical framing is not reproduced; it needs sustained reliable traffic to a stuck peer faster than the 1384-byte capacity, which ordinary play did not reach. Fix (guard publish) still valid.
- Severity: Critical
- Category: robustness
- Location: src/app/bootstrap/network/q2.ts:504-535; src/network/q2/channel.ts:80-82; src/app/bootstrap/application.ts:4644, 4685-4687; src/main.ts:82-93
- Confidence: reproduced
- Evidence: channel.ts:81 `if (this.queued.length + bytes.length > this.capacity) throw new RangeError('Q2 reliable message overflow');`. `publish()` calls `peer.channel.queueReliable` at q2.ts:506, 514, 518 and 532 with no try/catch anywhere in the peer loop. The classic capacity is 1384 bytes and the queue only drains when the client acknowledges (channel.ts:127). The poll path catches this (q2.ts:444-451), but publish does not. application.ts:4644 awaits publish inside `step`, whose catch rethrows, `run()` has no catch, and main.ts writes a crash log and returns 1. net-repro/r1-q2.ts used the real Q2ServerNetwork and Q2ClientNetwork: `publish threw out of Q2ServerNetwork after 1397 bytes of prints, 12s of silence: RangeError Q2 reliable message overflow`.
- Impact: Any active client that stops acknowledging within the 125 s timeout (q2.ts:454) brings the server down as soon as about 1.4 KB of reliable events accumulate. A player losing their link on a busy server can trigger it by accident. An attacker can trigger it on purpose with a silent client and a second client sending long `say` lines.
- Remediation: Catch per peer in `publish` and drop the overflowing peer, as native Q2 and qw-server.ts:326-330 do, while still rethrowing `Q2GameCallbackError`.

### NET-002 — One QW datagram with sequence 0x7fffffff makes the server crash at that client's timeout
- **Verification (VERIFY-D): confirmed. Final severity: Critical.** channels.ts:118-120 advances the SERVER's outgoing to a peer-supplied `sequence & 0x7fffffff`; advanceOutgoingSequence (reliability.ts:35) permits exactly 0x7fffffff. The first server transmit then does `outgoing++` → 0x80000000 (reliability.ts:57); every later transmit hits `if (this.outgoing > 0x7fffffff) throw` (reliability.ts:46). The missed guard VERIFY-A sought: in publish() that throw is caught (qw-server.ts:330) and routed to disconnectClient, whose own farewell `transmit` at qw-server.ts:190 is UNGUARDED and re-throws on the exhausted channel → escapes publish() → run loop → process exit. An admitted peer (QW admission is unauthenticated, NET-007) needs one crafted packet plus one normal server frame. Reply-gating does not save it because the disconnect-path transmit is unconditional. Not run live (harness blocked); trace is end-to-end.
- Severity: Critical
- Category: security
- Location: src/network/q1/channels.ts:113, 119-120; src/network/common/reliability.ts:46; src/app/bootstrap/network/qw-server.ts:190, 288, 292, 330, 336
- Confidence: reproduced
- Evidence: channels.ts:119-120 `if (this.side === 'server' && sequence >= this.outgoingSequence) this.reliable.advanceOutgoingSequence(sequence);` copies a client-chosen 31-bit value. Once outgoing passes 0x7fffffff, `transmit` throws at reliability.ts:46 `Channel sequence exhausted; reconnect required`. `disconnectClient` calls `transmit` first (qw-server.ts:190) and removes the peer afterwards (:191). The timeout at :292 is outside the packet try/catch, and :288 and :330 call the same method from inside catch blocks. net-repro/r2-qw.ts: `poll threw at client timeout: RangeError Channel sequence exhausted; reconnect required peers still present: 1`, and a second poll threw again.
- Impact: Any host that completes `getchallenge` and `connect` (one source IP, no spawn) sends one 10-byte packet, and about 65 s later the process exits. No password is needed unless the server sets one. `close()` at :336 also throws, leaving the transport open during shutdown.
- Remediation: Reject sequence jumps beyond a small window, and in `disconnectClient` guard the farewell transmit so peer removal always runs.

### NET-003 — Replaying the unified `connect` handshake lets channel errors escape poll and terminate the server
- **Verification (VERIFY-A): confirmed. Final severity: Critical.** Reproduced against a REAL unified server. `--listen-unified` on q1-classic-id1: replaying the `connect` handshake each frame without acking the offer crashed the process — `Error: Unified reliable retry limit exceeded` at channel.ts:210 → unified-server.ts:82 (flush) → :177 (the unguarded line-177 flush) → application.ts:4538 → run(); exit rc=1 (verifyA/n003.log). Guard at :191-192 is not applied to the :177 flush.
- Severity: Critical
- Category: security
- Location: src/app/bootstrap/network/unified-server.ts:177, 191-192; src/network/unified/channel.ts:97-101, 210
- Confidence: reproduced
- Evidence: unified-server.ts:177 `if (existing !== undefined && existing.nonce === handshake.nonce && sameAddress(existing.address, event.from)) { this.flush(existing, now); continue; }` sits outside any try. `flush` throws from `channel.flush` (`Unified reliable retry limit exceeded` at channel.ts:210, `Unified reliable assembly timed out` at :100) and on a false transport send (:83). The guarded flush at :191 runs later in the same poll, so a replayed connect in the packet loop reaches the limit first. net-repro/r3-unified.ts: `poll threw out of UnifiedServerNetwork at t=10001ms, unadmitted peer, no ready sent: Unified reliable retry limit exceeded`.
- Impact: A peer that has never been admitted crashes the server in about 10 s by not acknowledging the offer and resending one handshake datagram per frame. It needs only its real source address, with no password or game state.
- Remediation: Wrap the line 177 flush in the same try/catch and `drop` used at :191-192. Also guard `transport.send` at :174.

### NET-004 — Q2 stream download and KEX blast inflate without an output limit, so a hostile server can exhaust client memory
- **Verification (VERIFY-A): confirmed. Final severity: High.** server-messages.ts:221 `inflateRawSync(joined, {finishFlush:...})` has no maxOutputLength (the sibling block path at :211 does) and re-inflates the whole accumulated stream per block. Reran r5-zip: 260,916 wire bytes → 268,435,328 delivered, peak RSS 2559 MB, ~1000x amplification, before any download-policy check. kexdemo.ts:529 `inflateSync(compressed)` is likewise unbounded. Client OOM on hostile Q2rePRO/KEX server.
- Severity: High
- Category: security
- Location: src/network/q2/server-messages.ts:217-223, 349, 413; src/network/q2/codecs/kexdemo.ts:525-529, 545-553, 561-573
- Confidence: reproduced (stream path); traced (KEX path)
- Evidence: server-messages.ts:221 `inflateRawSync(joined, { finishFlush: ... })` has no `maxOutputLength`, unlike :211 and zpacket.ts:39. It also re-inflates the whole accumulated stream on every block, which is O(n²). The reader runs this before `Q2DownloadReceiver.receive` can answer `unsolicited`, so `allow_download=0` does not help. net-repro/r5-zip.ts: 260,915 wire bytes in 33 unsolicited messages produced 268 MB delivered, 5.0 s of blocking CPU and 3,791 MB peak RSS. kexdemo.ts:529 `inflateSync(compressed)` is also unbounded. Its config loop makes one record per 3 zero bytes (:548-552), so a 64 KB blast expands to about 64 MB and about 21 million objects.
- Impact: Connecting to a hostile Q2 rerelease or Q2PRO (revision 1021 or later) server, or one in KEX mode, gets the client OOM-killed or frozen. KEX demo playback reaches the same code.
- Remediation: Keep one streaming inflater with a per-block and per-file output cap. Set `maxOutputLength` in `inflateInternal`. Refuse compressed download blocks when no transfer is pending.

### NET-005 — Any malformed server datagram terminates the client process instead of disconnecting
- **Verification (VERIFY-A): confirmed. Final severity: High.** Traced and consistent with the demonstrated APP-001 behavior (every live crash above exited rc=1 via main.ts:82-93). NetQuakeChannel.receive throws PacketError on short/mismatched datagrams; Q1/Q2 client poll paths have no catch; advanceSource/step rethrow. Source match is only sameAddress, so an off-path spoofer who knows server addr + client port can kill the client process rather than returning to menu.
- Severity: High
- Category: robustness
- Location: src/app/bootstrap/network/q1-client.ts:96, 108, 114; qw-client.ts:176, 179; q2.ts:651-674; q3-client.ts:120, 139; unified-client.ts:52, 90; src/network/q1/channels.ts:43-46; src/app/bootstrap/remote-application.ts:796, 2286, 2322; src/app/bootstrap/startup.ts:1384; src/main.ts:82-93
- Confidence: traced
- Evidence: `NetQuakeChannel.receive` throws `PacketError` on a short or length-mismatched datagram, and Q1ClientNetwork.poll has no catch around it. Q2ClientNetwork.poll has no catch around `receiver.receive`, and `readQ2Challenge` throws on bad decimals. Q3 and unified clients call `disconnected` and then rethrow. `advanceSource` rethrows (`if (result.kind === "failed") throw result.error;`), `step` rethrows at :2286, and neither `run()` nor startup.ts:1384 catches. main.ts writes a crash log and returns 1. Source matching is only `sameAddress`, so a spoofer who knows the server address and the client's UDP port can send the datagram.
- Impact: A hostile server, or an off-path spoofer, kills the whole game (including the front end) rather than returning to the menu. Crash logs also accumulate from routine bad peers.
- Remediation: In the live source path, treat decoder and channel exceptions as a session disconnect and return to the front end. Ignore malformed datagrams in the channel layer rather than throwing.

### NET-006 — No per-client movement time budget allows speed cheats and CPU exhaustion through commands
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: High.** For Q1, the original QW has no msec budget either (sv_user.c:1380-1415 only chops and clamps), so "no budget" alone matches QW and is not a deviation. The real QW deviation is the command count: sv_user.c:1609-1610 returns on a second clc_move in a packet, while app/bootstrap/network/qw-server.ts:234-241 processes every decoded move. The Q2 half was not compared here. Source review: SRCQ1
- Severity: High
- Category: security
- Location: src/app/bootstrap/network/q2.ts:137, 379-383; src/network/q2/client-messages.ts:197-221; src/network/q2/codecs/q2pro.ts:369-378; src/app/bootstrap/network/unified-server.ts:137-141, 210-214; unified-control.ts:136; qw-server.ts:237-241; application.ts:4629
- Confidence: traced
- Evidence: A grep of src for `commandMsec|enforcetime|commandBudget` has zero matches. Native Q2 `SV_ClientThink` charges `commandMsec` under sv_enforcetime; this port has no equivalent. Each Q2PRO or rerelease batch datagram carries up to 3 frames of 31 commands (`readBatchMoveFrames`, `numDups < 3`), each with msec up to 255, and all of them enter the unbounded `this.pending`. Each unified datagram batch may hold 64 commands, and only `q1-netquake` is coalesced per frame (unified-server.ts:197, 210-214). Everything is then passed to `stepAsync({ commands: [...localCommands, ...remote] })`. I did not measure pmove cost per command.
- Impact: A client gains arbitrary movement speed. A flood of up to 256 datagrams per poll (about 23,000 commands in Q2 batch form, each at full trace cost) can stall the authoritative frame for all players.
- Remediation: Add a per-client accumulated-milliseconds budget per family (sv_enforcetime semantics) and a command count limit per poll at the network boundary.

### NET-007 — NetQuake connect has no challenge: spoofed packets take slots, reflect traffic and allow command injection
- **Verification (VERIFY-A): confirmed. Final severity: High.** q1.ts:115 `this.host.admit(packet.from)` runs on the first connect-request with no challenge/round-trip; handshake.ts holds the player ~65s retransmitting fragments; sequenced packets are authenticated only by source address (channels.ts). Reflection/slot-exhaustion/command-injection as described; inherited design but on open UDP.
- Severity: High
- Category: security
- Location: src/app/bootstrap/network/q1.ts:110-128, 134-153, 163-176; src/network/q1/handshake.ts:170-176; src/network/q1/channels.ts:50-55
- Confidence: traced
- Evidence: q1.ts:115 `const admitted = this.host.admit(packet.from);` runs on the first `connect-request` from any source, with no round-trip proof. The player is held for 65 s (:164). During that time the server retransmits a fragment of up to 1024 bytes each second to that address (:173-175, reliability.ts:97). Sequenced packets are authenticated only by source address (`peers.get(addressKey(packet.from))`). A spoofed unreliable packet with sequence 0xffffffff also blinds the channel (channels.ts:51-54).
- Impact: A few small spoofed packets per minute keep a server full with no real client. Each slot reflects up to about 66 KB at a third party per 12-byte packet (up to about 5000x, capped by maxClients). Moves and commands can be injected into a known player's session. This matches the original design, but the port runs it on open internet sockets with no mitigation.
- Remediation: Add a stateless cookie or an address-validation round trip before `admit`, and for native clients that cannot answer one, restrict to LAN or add a per-source connect limit and a much shorter pre-signon timeout.

### NET-008 — Connectionless traffic has no rate limit: status amplification and unthrottled replies across all protocols
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Medium.** id has no rate limit either (`server/sv_main.c:307,520`), and `SVC_RateLimit` is absent from this tree. Hardening gap, not a divergence. Source review: SRCQ3
- Severity: Medium
- Category: security
- Location: src/network/q1/handshake.ts:280-289; src/app/bootstrap/network/qw-server.ts:219; q2.ts:211-221; q3.ts:64-68; src/network/q3/discovery.ts:66-73; src/network/services/admin.ts:46-58
- Confidence: traced
- Evidence: `FloodLimiter` is defined at admin.ts:46 and has no caller in src or tests. QW `status` replies `n${this.host.status()}`. Q3 `getstatus` calls `this.host.status` and sends up to about 16 KB (`encodeQ3Status` allows rows to 16384) for a request of about 14 bytes. There is no per-source limit before any of these replies.
- Impact: Public servers act as UDP reflectors (up to roughly 1000x on full Q3 servers), a known real-world abuse of this protocol family. Reply generation also costs CPU per spoofed packet.
- Remediation: Wire `FloodLimiter` (with its `expire`) in front of all connectionless replies, per IP plus a global budget, as ioquake3's SVC_RateLimit does.

### NET-009 — Slot and handshake exhaustion: no signon deadline, no per-IP limit, and a spoofable unified pending table
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** unified-server.ts:146,171 allow the pending-table lockout, :156 refreshes any matching packet, and :179 caps peers at maxClients + 8. qw-server.ts:73,78 and q3 admission have no per-IP cap, and mvd-broadcast.ts:60-62 holds a slot with a 90 s socket timeout before authorization.
- Severity: Medium
- Category: security
- Location: src/app/bootstrap/network/unified-server.ts:146, 171, 179, 156, 190; qw-server.ts:73, 78; q2.ts:243; src/network/q3/admission.ts:185; src/network/q2/mvd-broadcast.ts:60-62
- Confidence: traced
- Evidence: unified-server.ts:171 `if (old === undefined && this.pending.size >= 256) continue;` with 10 s retention means about 26 spoofed `hello` packets per second block every new connection, and state is allocated before any address proof. Unified peers cap at `maxClients + 8` and any valid ack refreshes `lastReceived` (:156), so an unadmitted peer stays forever. QW, Q2 and Q3 admit many qports from one IP and have no deadline for reaching active state. GTV holds a viewer slot before authentication for up to 90 s per idle period (mvd-broadcast.ts:60-62).
- Impact: One host can hold every slot indefinitely. On the unified path, a spoofer with no reply capability locks out new players.
- Remediation: Use a stateless HMAC cookie for the unified challenge, add a per-IP connection cap and a signon deadline, and authenticate GTV viewers within a short timer.

### NET-010 — Q2 challenge is 15 bits, never expires and allows unlimited guesses; QW uses Math.random
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Medium.** The 15 bits, absent expiry and capacity eviction are original: sv_main.c:235-252 `rand() & 0x7fff` with oldest-slot replacement, and :322 replies "Bad challenge". This is inherited weakness, not a port regression. The hardening advice stands. Source review: SRCQ2
- Severity: Medium
- Category: security
- Location: src/network/q2/handshake.ts:249, 253; src/app/bootstrap/network/q2.ts:234-237; src/network/q1/handshake.ts:231-232, 242, 246; src/app/bootstrap/application.ts:1845
- Confidence: traced
- Evidence: handshake.ts:249 `const value = this.random() & 0x7fff;`, keyed by IP with no expiry except capacity eviction. Each wrong guess only returns `Bad challenge`. QW is wired to `random: () => Math.trunc(Math.random() * 0x7fffffff)` while Q2 and Q3 use `crypto.getRandomValues` (application.ts:1841). Both tables are evicted by 1024 spoofed `getchallenge` packets.
- Impact: An attacker can spoof `getchallenge` for a victim IP and then brute-force at most 32768 spoofed connects, gaining a slot under that IP. This defeats the IP-ban and address-proof purpose of the challenge. Evicting a legitimate pending challenge also causes connect failures.
- Remediation: Derive challenges as a keyed hash of source address and time window (32 bits or more), expire them in seconds, and use the CSPRNG for QW too.

### NET-011 — Whole-request 30 s timeout aborts healthy HTTP downloads
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** http-downloads.ts:46 passes the timeout signal to fetch, and body reads at :131,:331 fall under it. Rerun with a 1.5 s timeout and a slow local stream: TimeoutError during the body at 1501 ms. Ranged spans make progress across attempts (:108-110), so the non-ranged path is the certain failure.
- Severity: Medium
- Category: bug
- Location: src/network/services/http-downloads.ts:46, 112, 131, 314, 331
- Confidence: reproduced
- Evidence: http-downloads.ts:46 `signal: AbortSignal.any([signal, AbortSignal.timeout(30000)])` is passed to `fetch`, and it also governs the response body stream, not only headers. net-repro/r6-http.ts served a steady 1 KiB/s for 45 s and got `result fallback HTTP download and response cleanup failed after 30.0 s`.
- Impact: Any Q2 asset or package whose transfer takes over 30 s never completes over HTTP. Packages have no native fallback (q2-downloads.ts:221 comment, :173), so they are lost and progress is thrown away. Ranged spans have three 30 s attempts each and may also fail on slow links.
- Remediation: Apply the deadline to response headers and use an idle timeout reset per chunk for the body.

### NET-012 — Server-supplied filelist has no count or aggregate limit, and pump cost is quadratic
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** q2-downloads.ts:207,217,232 have no entry cap, :166 allows 0x7fffffff per file with no total quota, and http-downloads.ts:259-264 re-resolves all pending entries per schedule (:281). client-download-policy.ts:24-25 defaults on.
- Severity: Medium
- Category: security
- Location: src/app/bootstrap/network/q2-downloads.ts:166, 207-232, 325; src/network/services/http-downloads.ts:259-264, 281
- Confidence: traced
- Evidence: A 1 MiB filelist (`1 << 20`, :207) can name over 100,000 short valid paths. Each one is enqueued by `Promise.all([...assets.keys()].map(...))`. Each file may be `maximumBytes: 0x7fffffff`, with no total quota. `pump()` calls `await this.options.resolved(path)` (a mount open and read) for every pending entry on every schedule, and `start` reschedules after each completion, which is O(n²) mount lookups. Each bad line also prints. Every asset first sends a HEAD because the 2 GiB limit exceeds `rangeThreshold` (http-downloads.ts:85).
- Impact: Connecting to a hostile server can fill the disk permanently with files that are never removed, and stall loading for a very long time, with HTTP downloads on by default (client-download-policy.ts:24-25).
- Remediation: Cap filelist entries and total bytes per server session, resolve each path once when it is enqueued, and use per-category size limits.

### NET-013 — dlserver is unrestricted and downloaded packages stay mounted, by default
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** q2/handshake.ts:154-162 checks only scheme and credentials, so private and loopback hosts pass. q2-downloads.ts:169 validates a package only by opening the archive, with no digest. client-download-policy.ts:24-26 defaults on.
- Severity: Medium
- Category: security
- Location: src/network/q2/handshake.ts:154-162; src/app/bootstrap/network/q2-downloads.ts:169, 213-222; client-download-policy.ts:24-26
- Confidence: traced
- Evidence: `readQ2DownloadServer` accepts any http(s) host, including loopback, RFC 1918 and link-local addresses. The client then issues GET and HEAD to `<server>/<game>.filelist` and to asset paths chosen by the server. Plain HTTP is allowed. Packages are only checked with `openArchive` and are then published into the game directory and refreshed. There is no digest, so the content is unauthenticated and on-path modification is possible.
- Impact: A hostile server gets blind SSRF from the player's machine (paths limited by the extension allowlist). It can also leave a persistent pak that shadows assets in later sessions and feeds every format parser with hostile data.
- Remediation: Refuse non-global addresses unless the server itself is on that network. Default package download off or prompt once, and keep server-supplied packages in a per-server directory.

### NET-014 — Server-side download requests are unbounded: concurrent whole-file reads, blocking awaits and synchronous hashing
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** q2.ts:284 is fire-and-forget and q2-downloads.ts:81-85 cannot cancel an in-flight open. q2.ts:328-345 has no active check. qw-server.ts:248 awaits in the packet loop and q3-downloads.ts:55-57 hashes synchronously per open. Classic Q2 defaults to off (q2-downloads.ts:38), so reach is rerelease or enabled servers.
- Severity: Medium
- Category: performance
- Location: src/app/bootstrap/network/q2.ts:277-288, 343-345; q2-downloads.ts:38, 55, 77-88; qw-server.ts:246-249; src/app/bootstrap/simulation/network-qw.ts:189-197; src/app/bootstrap/network/q3-downloads.ts:55-58; q3.ts:116
- Confidence: traced
- Evidence: `Q2PeerDownload.begin` closes the previous sender but cannot cancel an in-flight `mounts.open`, and `beginDownload` is fire-and-forget, so each `download big.pak` string command starts another whole-file read with no concurrency limit and no `peer.active` check. Rerelease defaults `allow_download` to 1 (q2-downloads.ts:38). QW awaits `prepareDownload` inside the packet loop (qw-server.ts:248), which stalls the host frame. Q3 `openDownload` reads and SHA-256 hashes the entire pk3 synchronously on each new open (q3-downloads.ts:55-58), and `download`/`stopdl` are not flood limited. This applies only with sv_allowDownload on.
- Impact: An unspawned peer can drive memory use to many times the file size or stall all players on the server.
- Remediation: Allow one in-flight open per peer, debounce or deny repeated requests, cache a verified digest per mount generation, and move reads off the frame path.

### NET-015 — Q3 client accepts `challengeResponse` from any source and redirects the connection
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** id takes the source address as the new server: `clc.serverAddress = from` with the proxy comment (`client/cl_main.c:1797-1799`). The port's comment is accurate, and the weakness is inherited. Source review: SRCQ3
- Severity: Medium
- Category: security
- Location: src/network/q3/admission.ts:75-86; src/app/bootstrap/network/q3-client.ts:140-145
- Confidence: traced
- Evidence: admission.ts:80-84 handles `challengeresponse` in `connecting` with no source check: `this.address = copyAddress(from); // Original Q3 permits a proxy to hand off the challenge.`. The client then sends `connect` with its full userinfo, including any `password` value, to that address and accepts `connectResponse` from it. q3-client.ts:141 also prints `print` packets from any source.
- Impact: A racing attacker who knows the client's ephemeral port moves the client to a hostile server (reaching the decoder issues above) and collects its userinfo. Requires winning a short race. Other families check the source (q2 handshake.ts:201).
- Remediation: Require the source to match the requested server, or accept handoff only with a client-generated nonce echoed by the server. Apply the source check to `print`.

### NET-016 — Q3 CD key is sent in cleartext to a hard-coded legacy authorization domain on every WAN connect
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** client-authorization.ts:25,44 send the key over plain UDP to a hard-coded domain, and q3-client.ts:108-112 does so for non-LAN connects with no opt-in. Server side is authorization.ts:23,40, and admission.ts:151 trusts source IP alone. Domain ownership was not checked (off-localhost).
- Severity: Medium
- Category: security
- Location: src/network/q3/client-authorization.ts:25, 33-44; src/network/q3/authorization.ts:23, 40; src/network/q3/admission.ts:149-156; src/app/bootstrap/network/q3-client.ts:108-113
- Confidence: traced
- Evidence: client-authorization.ts:44 `send(this.address, encodeConnectionlessText(`getKeyAuthorize ${anonymous} ${key}`));` with the address resolved from `authorize.quake3arena.com`. The server side also sends each client's IP to the same domain, and it trusts `ipAuthorize` by UDP source IP alone. I could not check who controls that domain today, since off-localhost requests were out of bounds.
- Impact: Whoever controls the domain or the path receives players' retail keys and IP addresses, and a spoofer who knows the challenge can deny a player. Dead authority also delays each WAN admission by over 5 s (admission.ts:144).
- Remediation: Make key authorization opt-in and off by default, and do not send keys unless a user-configured authority is set.

### NET-017 — Classic Q2 and QW rcon have no throttle; comparison is plain and the password travels in cleartext
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Medium.** Plain strcmp with no throttle is original (sv_main.c Rcon_Validate). Inherited, not a regression. Source review: SRCQ2
- Severity: Medium
- Category: security
- Location: src/network/q2/connectionless.ts:159-165; src/network/q1/handshake.ts:290-292, 301; src/network/services/admin.ts:114-120
- Confidence: traced
- Evidence: connectionless.ts:159 applies the rate limit only `if (host.profile === 'rerelease' ...)`. QW handshake.ts:291 compares `args[1] !== this.host.rconPassword` per packet with no limit, and the operation is awaited inside the server packet loop (qw-server.ts:219). Comparisons are non-constant-time, and `Bad rcon_password` is reflected to spoofed sources. Q3 RconService uses one global 500 ms slot (admin.ts:114-117), so any spoofed `rcon` packet stream denies the real admin.
- Impact: Online password guessing at packet rate on QW and classic Q2, leading to full server console access. On Q3, spoofed traffic can lock out administration.
- Remediation: Per-source failure backoff, a global attempt budget, an audit log, and an admin allowlist option. Use `timingSafeEqual` on hashes.

### NET-018 — Q3 peer can force a full gamestate rebuild per datagram and queue up to 64 MiB
- **Verification (VERIFY-E): confirmed-with-changes. Final severity: Medium.** The trigger (q3/server.ts:89-91) and queue (:146-147, :53) are real. "Overflow silently drops" is wrong: event-ring.ts:91-93 throws RangeError when full. That throw is caught and printed at q3.ts:172, so the result is a logged failed resend, not a silent drop.
- Severity: Medium
- Category: performance
- Location: src/network/q3/server.ts:53, 89-92, 146-151, 158-167; src/app/bootstrap/network/q3.ts:86, 131
- Confidence: traced
- Evidence: server.ts:89-91: a wrong `serverId` with `messageAcknowledge > gamestateMessageNumber` calls `host.resendGamestate()`. The client chooses both fields. Each call runs `host.gameState`, a 16 KiB writer, and a fragmented send. While fragments are pending, plaintext is `this.queuedMessages.admit(plaintext)` into `EventRing(4096)`. The return value of `admit` is ignored, so overflow silently drops messages. Native Q3 has the same trigger, with its own queue.
- Impact: One admitted client can burn the server frame and retain up to about 64 MiB per connection while receiving a high-amplification stream of gamestate fragments.
- Remediation: Rate-limit resends per client to once per gamestate acknowledgement window and replace the queue instead of appending when a newer gamestate supersedes it.

### NET-019 — Q3 unauthenticated `getchallenge` scans 1024 entries with string keys, and the per-packet slot table is rebuilt
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** admission.ts:135-136 scans up to 1024 entries, and endpoint.ts sameAddress builds two strings per call. q3.ts:80-84,169 rebuild the slot table per sequenced datagram, with occupiedSlots() per free slot. No limiter precedes this (see NET-008).
- Severity: Medium
- Category: performance
- Location: src/network/q3/admission.ts:129, 135-138, 173; src/network/common/endpoint.ts:47-57; src/app/bootstrap/network/q3.ts:80-84, 169
- Confidence: reproduced
- Evidence: admission.ts:135-136 runs `sameAddress` for each candidate, and each call builds two strings (`addressKey`). net-repro/r7-bench.ts: `0.270 ms/packet; 256 per frame = 69 ms`. Every sequenced datagram also runs `this.slots()` (q3.ts:169), which allocates `maxClients` objects and calls `occupiedSlots().includes` per free slot.
- Impact: A spoofed flood of small packets consumes most of a server frame with no authentication. Normal play pays per-packet allocation for every client datagram.
- Remediation: Index challenges and active peers in a Map by address key, and maintain the slot table incrementally.

### NET-020 — Unified channels allocate a full message for one datagram and apply the 4 MiB limit to input lanes
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** channel.ts:122 allocates totalBytes on first sight, :143 allows the 4 MiB default (:16) for all lanes, and :174-176 starts a new assembly per higher frame sequence. unified-server.ts:182 sets no smaller limits, and unified-control.ts:134 limits only after assembly. A handshake token is required, but not admission.
- Severity: Medium
- Category: security
- Location: src/network/unified/channel.ts:16, 121-123, 143, 157-158, 174-176; src/app/bootstrap/network/unified-server.ts:158-161; unified-control.ts:134
- Confidence: reproduced
- Evidence: channel.ts:122 `payload: new Uint8Array(packet.totalBytes)` is allocated on the first fragment, and a frame with a new sequence replaces the assembly each time. A last-fragment datagram satisfies the decoder at 49 bytes. net-repro/r3-unified.ts: `datagram 49 bytes claims 4193281 bytes; 2000 datagrams took 211 ms = 0.105 ms each; 256 per poll = 27 ms; allocated 7.8 GiB`. RSS stayed at 117 MB because the zero pages were untouched, so the memory impact is smaller than the ratio suggests. Reliable assemblies retain up to 8 MiB per peer for 30 s. Client inputs are limited to 65536 bytes by the decoder, but the channel accepts 4 MiB for them.
- Impact: A single unadmitted peer adds about 27 ms per poll and drives allocator churn. Retained memory scales to about 12 MiB times (maxClients + 8).
- Remediation: Give server inbound channels small limits (64 KiB frames, control limit before `ready`) and allocate after a second fragment or a size-class pool.

### NET-021 — Encoder hot paths allocate heavily per message and per peer
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** q3/message.ts:98-99 allocates per scalar, q2/server-write.ts:54 with message.ts:508-513 allocates 32 KiB per event, q2.ts:553 clones per peer per frame, and q1.ts:207 with netquake.ts writeNetQuakeEntity builds a buffer and codec per entity. The Huffman tree itself is cached (huffman.ts:179). Timings were not re-measured.
- Severity: Medium
- Category: performance
- Location: src/network/q3/message.ts:97-120; src/network/q2/server-write.ts:54; src/network/q2/message.ts:508-513; src/app/bootstrap/network/q2.ts:301-309, 553; src/network/q1/netquake.ts:487, 552; q1.ts:207-208; src/network/q1/quakeworld.ts:506
- Confidence: reproduced (Q3 and Q2 timings); traced (others)
- Evidence: q3 `writeBits` allocates an array and closure per scalar and stores individual bits; r7-bench: `Q3 MessageWriter 1400 byte message: 1.07 ms`, per snapshot per client. `encodeQ2ServerEvent` allocates `createMessage()` (32 KiB) per event; r7-bench: `7.3 us each`, and `signonPage` re-encodes every configstring per request (`2080 strings = 15.2 ms, 65 MiB allocated`). q2.ts:553 runs `structuredClone(frame)` per peer per frame. `writeNetQuakeEntity` builds a codec and `new SizeBuf(128)` per entity per peer per frame (q1.ts:207-208).
- Impact: A busy server spends frame budget and GC time scaling with peers times entities. At 64 Q3 clients and full packets, encoding alone exceeds a frame budget.
- Remediation: Use reusable scratch buffers and precomputed Huffman code tables, cache one codec per peer, and retain immutable frame records instead of cloning.

### NET-022 — KEX LAN admits spoofed joins and kicks without a handshake
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** lan.ts:94-96 creates peers for kinds 128 and 129, :130-133 reserves players, and q2.ts:234 accepts lan.admitted as proof. channel.ts receive accepts flags 0 for any kind, and lan.ts:114 handles 254 before the admitted check at :115. The 25 s matches 5 s keepalive plus 40 retries at 500 ms in tick().
- Severity: Medium
- Category: security
- Location: src/network/q2/kex/lan.ts:92-99, 104, 114, 124-141; src/network/q2/kex/channel.ts:11; src/app/bootstrap/network/q2.ts:234
- Confidence: traced
- Evidence: lan.ts:94-96 creates a peer for unsequenced kinds 128 and 129 from any source, up to 256, and each `KexChannel` allocates an 8192-slot `EventRing`. `join` reserves players with no address proof, and q2.ts:234 treats `lan.admitted` as enough for `connect` (no challenge). lan.ts:114: kind 254 is accepted as unsequenced from a spoofed address and removes that peer with attacker-supplied reason text. Inflate runs before admission once a peer exists (:98-99).
- Impact: On any network that can reach the KEX port, an attacker fills the lobby, blocks the peer table for about 25 s per burst, and kicks named players by spoofing them.
- Remediation: Add a stateless cookie to join, and require the sequenced reliable path for disconnect.

### NET-023 — Peer-triggered exceptions in host callbacks are rethrown as fatal by design
- Severity: Medium
- Category: robustness
- Location: src/app/bootstrap/network/unified-server.ts:25-27, 111, 114, 127, 129, 163; q2.ts:445; q3.ts:172; tests/network/unified/server.test.ts ("authoritative command failures retain their original cause")
- Confidence: plausible
- Evidence: unified-server.ts:163 `if (error instanceof UnifiedHostFailure) throw error.cause;` makes any throw from `host.command`, `host.userinfo`, `host.admit` or `componentCommand` exit the poll, and those calls carry peer-controlled text. Q2 and Q3 do the same for game callback errors. simulation/runtime.ts `playerCommand` contains several `throw new Error` paths on state assumptions (for example "Q2 player entity missing"). I did not find a specific argument that triggers one. Also, a `hostCall` inside `drop` at :92 thrown from a catch block (:163, :192) escapes wrapped as `UnifiedHostFailure`, without the cause being unwrapped.
- Impact: Any reachable validation gap in game or mod code becomes remote termination, rather than a dropped peer.
- Remediation: Separate game-state corruption errors from peer-input errors using a typed error, and drop the peer for the latter. Audit command handlers with a fuzzer against the fixture.

### NET-024 — Hostile master or LAN responders cause quadratic browser work and uncapped entries
- **Verification (VERIFY-J): confirmed. Final severity: Low.** server-browser.ts:387-388 calls q3List and addQ3 per address; addQ3 (:134-136) rebuilds and filters the list, and q3List (:109-110) rebuilds after each generation bump; q3/discovery.ts:32 caps at 256 per packet. discovery.ts:138-143 accepts any source during a broadcast window when challenge is null and adds with no cap.
- Severity: Low
- Category: performance
- Location: src/app/bootstrap/server-browser.ts:134-138, 386-390; src/network/services/discovery.ts:137-143, 149
- Confidence: traced
- Evidence: server-browser.ts:387 calls `q3List` (rebuilt after each `addQ3` generation bump) and `addQ3` filters then scans with `addressKey`, for each of up to 256 addresses per packet against up to 8192 entries. discovery.ts:138 lets any source answer inside a broadcast window when `challenge === null` (Q1, QW, Q2), adding `this.add(address, "lan", now)` with no size cap. `ServerBrowser.receiveMaster` and `add` have no cap at the service level; the app layer caps master lists only.
- Impact: A chosen hostile master can freeze the menu thread. LAN spoofing can flood the list during scans.
- Remediation: Build the entries once per packet, keep a Set per source, and cap LAN entries.

### NET-025 — Q3 updates a peer's return address before validating the packet
- **Verification (VERIFY-J): confirmed. Final severity: Low.** q3.ts:170 assigns `peer.remote = event.from` before receiveDatagram; routing at admission.ts:213-217 needs only same IP (port ignored) and qport. Delivery reads peer.remote (q3.ts:85). q2.ts:435-440 rebinds only on an accepted message.
- Severity: Low
- Category: security
- Location: src/app/bootstrap/network/q3.ts:169-170; src/network/q3/admission.ts:213-217
- Confidence: traced
- Evidence: q3.ts:170 `peer.remote = event.from; const result = await peer.connection.receiveDatagram(bytes);`. Routing needs only same IP and a 16-bit qport. Q2 rebinds only after an accepted message (q2.ts:435-440). Native Q3 has this behavior too.
- Impact: A spoofer with the victim's IP and a guessed qport redirects that client's snapshots until its next packet, using a rejected packet.
- Remediation: Rebind only when the channel accepts the packet.

### NET-026 — Transport edge cases: port-0 datagrams kill unified clients, and a bad SOCKS relay datagram ends draining early
- **Verification (VERIFY-J): confirmed. Final severity: Medium.** transport.ts:79-80 turns a port-0 source into an error event (endpoint.ts:15 rejects port 0), :120 queues send errors, unified-client.ts:52 throws on either and the catch marks the client rejected and closes. Raised because one ICMP-driven send failure ends the session; delivery of a port-0 datagram through Bun remains unexercised. transport.ts:131 null return ends draining for every caller.
- Severity: Low
- Category: robustness
- Location: src/network/common/transport.ts:79-80, 120, 130-131; src/app/bootstrap/network/unified-client.ts:52
- Confidence: traced
- Evidence: A UDP source port of 0 makes `ipAddress(host, port)` throw, which is pushed as an `error` event (transport.ts:79-80). Failed sends also enqueue errors (:120). unified-client.ts:52 `if(packet.kind==='error')throw packet.error;` treats either as fatal. transport.ts:131 returns `null` for a malformed relay datagram, and every caller reads `null` as an empty queue, ending the drain for that tick. With SOCKS enabled, non-relay datagrams still pass through unfiltered (:128-133). Datagrams from a port-0 source were not exercised because that needs a raw socket.
- Impact: A single off-path packet or a transient ICMP-driven send failure disconnects a unified client, followed by NET-005 termination.
- Remediation: Drop port-0 datagrams silently, log send errors without fatal handling, loop past malformed relay datagrams, and reject non-relay sources under SOCKS.

### NET-027 — Native Q2 and QW server download has no file-type allowlist
- **Verification (VERIFY-J): confirmed. Final severity: Low.** q2-downloads.ts:43-58 and network-qw.ts:189-197 check only path shape, category cvars and canDownloadResource (mounts/index.ts:561-564), with no extension allowlist, unlike the client at q2-downloads.ts:238-239. Exposure depends on mount layout and allow_download (default 0 on classic Q2, 1 on rerelease; q2-downloads.ts:38).
- Severity: Low
- Category: security
- Location: src/app/bootstrap/network/q2-downloads.ts:43-58; src/content/mounts/index.ts:561-564; src/app/bootstrap/simulation/network-qw.ts:189-197
- Confidence: plausible
- Evidence: `allowed` requires a `/` and rejects dot-prefixed names, then serves anything the mounts resolve. `canDownloadResource` only blocks Q2 archive maps. I did not enumerate what real mounts expose. If a mounted loose directory holds `cfg/server.cfg`, it would be served with its `rcon_password`.
- Impact: Possible disclosure of admin config or other non-asset files in a mounted subdirectory. It requires downloads enabled and such a file layout.
- Remediation: Apply the same asset extension allowlist already used by the client (q2-downloads.ts:238-239).

### NET-028 — Error text and attacker strings are reflected or logged per packet
- **Verification (VERIFY-J): confirmed. Final severity: Low.** q2.ts:444-450 replies with the raw exception text when peer is undefined. qw-server.ts:286-287 and q3.ts:172 print per packet with no limit. unified-server.ts:105 passes the peer reason to drop, printed unfiltered at :94.
- Severity: Low
- Category: robustness
- Location: src/app/bootstrap/network/q2.ts:444-450; qw-server.ts:286-287; q3.ts:172; unified-server.ts:94, 105
- Confidence: traced
- Evidence: q2.ts:450 replies with `print\n${reason}\n` to an unauthenticated sender, where `reason` is any exception message. Malformed packets are printed per packet on QW and Q3 with no limit. The unified peer-supplied disconnect reason is printed unfiltered at :94 (bounded to 1024 by the decoder, but control characters are not removed).
- Impact: Internal error text is disclosed to anyone. Logs and consoles can be flooded, or terminal escape sequences injected.
- Remediation: Reply with a fixed string, rate-limit diagnostics, and strip control characters from peer text before printing.

### NET-029 — Unused security and service code gives a false impression of protection
- **Verification (VERIFY-J): confirmed. Final severity: Low.** Word grep finds each named symbol only in its defining file under src; FloodLimiter, PacketScheduler and Q3Rcon have no tests. common/fragments.ts is re-exported by common/index.ts:6, with direct use only in tests/network/common/network.test.ts. online.ts:26,32 use scryptSync and the file has no expiry logic.
- Severity: Low
- Category: dead-code
- Location: src/network/services/admin.ts:46 (FloodLimiter); downloads.ts:166, 213 (DownloadWindow, downloadHttp); online.ts:20, 133 (LocalAuthorization, LocalRankingService); common/scheduling.ts:18 (PacketScheduler); q3/rcon.ts:16 (Q3Rcon); q2/connectionless.ts:114 (Q2ConnectionlessServer); common/session.ts:85 (NetworkSession); common/fragments.ts:33; q1/channels.ts:125 (QuakePeer)
- Confidence: traced
- Evidence: Word-boundary greps found zero callers in src outside the defining file for each. FloodLimiter, PacketScheduler and Q3Rcon also have no tests. Q3Rcon duplicates `RconService`, and Q2ConnectionlessServer duplicates the live switch in q2.ts:201-273, so a fix applied to the live path leaves the tested copy unchanged, and the reverse. LocalAuthorization also has synchronous scrypt and non-expiring tokens that would be a problem if it were ever wired in.
- Impact: Readers may assume flood limiting exists, and tests pass against code that production does not run.
- Remediation: Wire or delete each item.

### NET-030 — Test gaps on the fatal network paths
- **Verification (VERIFY-J): confirmed-with-changes. Final severity: Low.** The statement that the overflow grep hits only unified/channel.test.ts is false: tests/network/q1/qw-host-commands.test.ts:144 asserts a server-level QW reliable overflow, and q3/network.test.ts:283 covers configstring overflow. The named gaps hold: no Q2 overflow in tests/network/q2, no QW sequence exhaustion, no decoder bomb (unified/frame.test.ts:89 only tests a wrong schema); retry limit appears only at channel.test.ts:74.
- Severity: Low
- Category: test-gap
- Location: tests/network/q2/, tests/network/q1/qw-host-transport.test.ts, tests/network/unified/server.test.ts
- Confidence: traced
- Evidence: A grep of tests for the overflow and exhaustion messages finds only tests/network/unified/channel.test.ts (channel level). No test covers server-level Q2 reliable overflow in `publish`, QW sequence exhaustion at disconnect, handshake replay during retry-limit, or decoder bombs. The fixtures in net-repro/r1 to r3 show each can be written in under 40 lines.
- Impact: NET-001 to NET-004 went unnoticed, and fixes have no regression guard.
- Remediation: Add these repros as tests, and add a seeded fuzz test feeding random datagrams to each server `poll` and client `poll` that asserts no rejection escapes.
