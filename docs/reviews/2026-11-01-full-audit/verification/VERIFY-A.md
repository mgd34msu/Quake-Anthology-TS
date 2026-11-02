# VERIFY-A — adversarial verification of Critical/High findings

Method: opened each cited file at HEAD fcdc8af5; reran net-repro/{r1,r2,r3,r5}; wrote live
attacks that run a REAL `--dedicated` server from <scratchpad>/clean against <game-data>
(HOME/XDG under scratchpad, SDL dummy). Live-attack harnesses and logs are in <scratchpad>/verifyA/.

### NET-001
Verdict: confirmed-with-changes
Corrected severity: High (was Critical)
Reason: The unguarded throw is real — Q2 `channel.ts:81` throws on overflow and the publish peer loop
(q2.ts:~500-540) has no try/catch, unlike the poll loop (q2.ts:444-451). Component repro r1-q2 throws at
1397 bytes. BUT a real `--listen-q2` dedicated server with a silent/stuck client plus a second client
flooding `say` survived the full 110s window with no crash (verifyA/n001.log). The "a player losing their
link triggers it by accident" Critical framing is not reproduced; it needs sustained reliable traffic to a
stuck peer faster than the 1384-byte capacity, which ordinary play did not reach. Fix (guard publish) still valid.

### NET-002
Verdict: confirmed-with-changes
Corrected severity: High (was Critical); production trigger UNVERIFIED
Reason: Code path is real: channels.ts:119-120 copies the client sequence, reliability.ts:35/46 allows
outgoing=0x7fffffff then throws only when outgoing>0x7fffffff. Component repro r2-qw throws. BUT two live
QW `--listen` servers survived past the 65s timeout with no runtime crash (verifyA/n002.log, n002b.log); the
only throw was an AggregateError during my own shutdown (the farewell-transmit, matching the secondary close()
claim). The crash needs a successful transmit (peer.reply=true) to push outgoing to 0x80000000 before the
timeout transmit; reply-gating may prevent it. My harness's QW peer admission could not be confirmed from logs,
so this is inconclusive, not a clean refutation — orchestrator should re-verify with a confirmed admitted peer.

### NET-003
Verdict: confirmed
Corrected severity: Critical (unchanged)
Reason: Reproduced against a REAL unified server. `--listen-unified` on q1-classic-id1: replaying the
`connect` handshake each frame without acking the offer crashed the process — `Error: Unified reliable retry
limit exceeded` at channel.ts:210 → unified-server.ts:82 (flush) → :177 (the unguarded line-177 flush) →
application.ts:4538 → run(); exit rc=1 (verifyA/n003.log). Guard at :191-192 is not applied to the :177 flush.

### NET-004
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: server-messages.ts:221 `inflateRawSync(joined, {finishFlush:...})` has no maxOutputLength (the sibling
block path at :211 does) and re-inflates the whole accumulated stream per block. Reran r5-zip: 260,916 wire
bytes → 268,435,328 delivered, peak RSS 2559 MB, ~1000x amplification, before any download-policy check.
kexdemo.ts:529 `inflateSync(compressed)` is likewise unbounded. Client OOM on hostile Q2rePRO/KEX server.

### NET-005
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: Traced and consistent with the demonstrated APP-001 behavior (every live crash above exited rc=1 via
main.ts:82-93). NetQuakeChannel.receive throws PacketError on short/mismatched datagrams; Q1/Q2 client poll
paths have no catch; advanceSource/step rethrow. Source match is only sameAddress, so an off-path spoofer who
knows server addr + client port can kill the client process rather than returning to menu.

### NET-006
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: `grep -rn 'commandMsec|enforcetime|commandBudget' src` returns nothing; there is no sv_enforcetime
equivalent. q2pro.ts:369-378 admits up to 3 frames × 31 commands per batch datagram (msec≤255 each) into the
unbounded pending; unified-server.ts coalesces only q1-netquake. No per-client time budget at the net boundary.

### NET-007
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: q1.ts:115 `this.host.admit(packet.from)` runs on the first connect-request with no challenge/round-trip;
handshake.ts holds the player ~65s retransmitting fragments; sequenced packets are authenticated only by source
address (channels.ts). Reflection/slot-exhaustion/command-injection as described; inherited design but on open UDP.

### SIM-001
Verdict: confirmed
Corrected severity: Critical (unchanged)
Reason: Reproduced against a REAL `--listen-unified` q1 server. An admitted peer sending one input with
`arsenal:{provider:'x:y',weapon:'x:y'}` crashed the process: input() copies arsenal unchecked
(network-unified.ts:232-239), prepareArsenalCommand throws "Arsenal command belongs to a different provider"
(runtime.ts:4900) inside step → run → exit rc=1 (verifyA/s/..., stack shown in run). Validation missing in input().

### SIM-002
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: runtime.ts:5501 `if (this.source.kind === "q3") { ...runActor...; continue; }` executes before
scheduler.run/physics.step; q3/runtime.ts:586-589 runActor returns early when `records.byActor` is null.
Runtime-spawned adjunct actors (DeathBall, spawnCharacterGib) have no Q3 record, so they never move or expire.
Gameplay-correctness + a per-gib growth path until map change. Traced in source; niche cross-engine mode.

### SIM-003
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: runtime.ts:6281-6286 resets the ball with `bodies.write(...)` and no following `bodies.link`, so the
collision link stays at the goal position; and Q1 spawn has no out-of-world/kill-plane recovery (6250-6256).
Author reproduced the fall and the stale link; code confirmed. Exotic-mode gameplay bug, not security.

### BOTS-001
Verdict: confirmed
Corrected severity: Critical (unchanged)
Reason: chat.ts:378 `capture(...).offset = (pointer<<24)>>24` and :403 `if (variable.offset < 0) throw`. Retail
baseq3 botfiles/match.c line 28 `"(",NETNAME,")",PLACE,": ",ADDRESSEE," help "|" meet ",TEAMMATE` ends in a
variable AND has an earlier attacker-controlled variable (ADDRESSEE), so a ~130-char filler before " help x"
within MAX_SAY_TEXT=150 pushes the final variable's offset past 127 → negative → throw out of the bot frame →
process exit. Template shape and code both verified (I extracted match.c from pak0.pk3). Requires native Q3
bots + team game (legitimate config).

### BOTS-002
Verdict: confirmed
Corrected severity: Critical (unchanged)
Reason: ai-command.ts:521 `if (checkpoint === null) throw`; ai-navigation.ts:122 returns null when freeWaypoints
is empty; the replaced `old` is marked `inuse=false` but never returned to freeWaypoints (515-520). Retail
match.c:169 `...": ","checkpoint "|"waypoint ",NAME," is at gps ",POSITION = (MSG_CHECKPOINT, 0)` is
unaddressed and NAME is attacker-controlled, so ~128 checkpoint chats exhaust the shared heap → throw → exit.

### BOTS-003
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: ai-command.ts:288 and :687 throw on null netname ("uninitialized source ..."). In botMatchHelpAccompany
the "someone else" branch leaves netname null and a failed locate falls to the whereis/whereareyou throw; in
botMatchLeadTheWay teammate==self leaves netname null. Reachable when an addressed teammate is unlinked/connecting.
Narrower than BOTS-001; team games only. Traced.

### BOTS-004
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: brain.ts:1876 `stale = path===null || !pathValid || now-plannedAt>REPLAN`; :1900 `if (path===null)
plannedAt=now` is a no-op because `path===null` keeps stale true next frame, so an unplannable combat goal
(goalEntityId -1) replans a full reverse scan every frame. No think-stagger (bot-rerelease.ts:158). Perf.

### BOTS-005
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: estimates.ts:71 caps `caches` at 128 entries by COUNT only, each a Map with one entry per reachable node
(up to 100000 per construct.ts:112); navigation.ts:162-166 `forClient` builds a fresh NavigationRuntime per
client, so caches, incoming-edge maps and the 16 MB AAS LRU are per-bot and not shared. Growth scales with
bots × nodes × distinct goals, retained for the map. Leak/unbounded-growth confirmed in source.

### APP-001
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: Reproduced three times here — NET-003, SIM-001 and the QW shutdown each ended the process rc=1 with the
error reaching run()/main.ts:82-93. application.ts:4701 `await this.step(elapsed)` has no try; step's catch
(4685-4689) only rethrows non-fatal errors; no caller recovers. Any per-frame throw ends a dedicated server.

### APP-002
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: mapResourcePath (options.ts) only accepts `[a-zA-Z0-9_/-]` and rejects dots/plus/space/quote (verified
by reading the regex); server-supplied map/sound/image names reach it and throw (remote-application.ts:1167,1233,1239).
q3-client.ts:139 / unified-client.ts:90 mark rejected, call host.disconnected, then rethrow; no caller catches →
client process exit (APP-001) instead of a menu return. Hostile-server client DoS. Traced.

### APP-003
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: Game-driven travel is unguarded — application.ts:3510 `await this.replaceWorld(mapResourcePath(matchMap),
...); return;` and :3560 `await this.replaceWorld(map, carry);` sit in no try, while the console path (3524) and
the Q2 campaign path (3540-3542 via reportCampaignTravelError) are guarded. A bad rotation/changelevel map ends
the server at match end though the prior world was intact. Traced.

### APP-004
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: main.ts:74 print sink calls `process.stdout.write(text)` unguarded; main.ts:48 and the crash path (92)
also write unguarded. Author reproduced the `--list-content | head` / `--help | head` EPIPE crash entries under a
fake HOME, and on a running server piped to a logger the next host.print throws inside its callback → APP-001.
Code confirmed.

### UI-001
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: preprocessor.ts:38 `DEFAULT_DIAGNOSTIC_LIMIT = Number.MAX_SAFE_INTEGER` is the fallback for all seven
limits (:639-645) and no caller (QVM trap_PC_LoadSource, Team Arena HUD, bot library) sets them (grep-confirmed).
A two-line macro cycle hangs the synchronous token loop; a doubling macro exhausts memory. Mod-content DoS.

### UI-002
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: q2-native.ts:58/82/90 and rerelease-layout throw RangeError on out-of-range stat/client/image indices and
unmatched if/endif; layout text is MSG_ReadString from the server (server-messages.ts:279), parsed during frame
prep with no catch → client process exit. Q2's equivalent was ERR_DROP, not fatal. Traced (throws reproduced).

### UI-003
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: runtime.ts:1644-1655: after wrapping once, a further `menu.cursorItem += direction` drives it to -1 and
`menu.itemAt(-1)` throws ("UI menu item slot exceeds the source array", menu.ts). A menu with one focusable item
plus decorations (or all decorations) reaches this on Up. Reach limited to cgame key-catcher states. Code confirmed.
