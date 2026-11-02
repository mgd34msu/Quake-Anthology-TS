# VERIFY-D — adversarial verification of Critical/High GAP findings (round 2)

Method: opened every cited file at HEAD in <scratchpad>/clean; confirmed each quoted line is as
written; traced reachability from an untrusted source to the throw/sink; tried to find an outer
guard the author missed. A live weaponized flood harness was not run (environment safety stop);
verdicts below are code-traced, with component-level reproduction where noted. `normalizeResourcePath`
and `sourceCommandText` behaviours were run directly (component repros) and are quoted.

### GAPSIM-001
Verdict: confirmed
Corrected severity: Critical (unchanged)
Reason: records.ts:21 throws when `text.length+1 > 512`; host.ts:276 calls it with capacity 512 for
connect userinfo; readQ2Connect (handshake.ts:124) bounds v34 userinfo only by `/["\r\n\0]/`, no length.
admit() wraps it in q2GameCallback, rethrown fatally at network/q2.ts:445 → application.ts:4686. getchallenge
is unauthenticated. Only setUserinfoStorage (classic-guest-world.ts:211) has a 512 guard; the connect path does not.

### GAPQ3-001
Verdict: confirmed
Corrected severity: Critical (unchanged)
Reason: `orders` has length 7 (commands.ts:34), so `gc 0 7` passes `order > orders.length` (7>7 false) and
`orders[7]` is undefined → throw (commands.ts:505). followCycle:388 and sanitize:131 throws are as quoted.
Route command→q3GameCallback→Q3GameCallbackError rethrown at q3.ts:172, no catch. Peer-text reachable.

### GAPQ3-002
Verdict: confirmed
Corrected severity: Critical (unchanged)
Reason: callVote filter rejects only `;` (commands.ts:517); a `\n` in the map parameter survives into
`vote.string` and checkVote feeds it to `appendConsoleCommand(`${vote.string}\n`)` (match.ts:428). Pass
threshold `yes > trunc(numVotingClients/2)` is trivially met on bot/empty servers. Arbitrary console exec.

### GAPAPP-001
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: audio.ts:548 stores `skin.split("/")[0]` as model; bank.ts:44 builds `#players/<model>/<name>`;
normalizeResourcePath (paths.ts:8) throws on `..`/`.`/`//` (verified by running it). play/receive/frame
await without try; runs in the fatal step. Skin from unfiltered userinfo. Confirmed.

### GAPAPP2-001
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: file-syscalls.ts:138 filters only `..`/`::`/`q3key`; `//` and `/./` bypass it and `mounts.open`→
normalizeResourcePath throws (ran `lower_/x//y.skin` → RangeError). FS_FOPENFILE syscall unguarded; q3-client.ts
rethrows frame failures. Player model userinfo is the source.

### GAPAPP2-002
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: textures.ts:177 `reader.read(path)` is outside the try at :180; bank.ts:51 `content.open(path)` precedes
the try at :53. Both throw via normalizeResourcePath on server-supplied sky/pic/music/skin names during frame
prep with no catch. Confirmed.

### GAPCOMPAT-001
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: id1-attacks.ts:85, id1-projectiles.ts:70, id1-environment.ts:48 all throw QcProgramError for a
foreign/borrowed target. Reachable with shipped `--progs ... enemies:selected` when the player hits or a
foreign enemy touches trigger_hurt/push. Thrown out of the QC tick → APP-001 exit.

### GAPCOMPAT-002
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: movement-host.ts:92 resolves `world.actor(goalentity)` before the flags check; world-host.ts:72 throws
on a freed edict. id1 infighting (gibbed monster head freed by SUB_Remove) + a patrolling monster calling
movetogoal throws. runtime.test.ts:660 pins the throw as intended, confirming the divergence.

### GAPCOMPAT-003
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: client-state-record.ts:75 throws at `entities.length > 256`; readPacketEntities (server-message.ts:111)
caps only individual numbers (<1023), no snapshot count limit, and validateEntities is encode-only. A hostile
server's 257-entity snapshot throws in CG_GETSNAPSHOT. Source truncates instead.

### GAPCORE-001
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: browser-view.ts:200-201 concatenates all status rules then setInfoValue with maximumLength 1024;
info.ts:17 throws "oversize infostring" at >=1024. decodeQ3ServerStatus stores rules unbounded. Runs inside the
UI ping trap with no catch → client exit when the server list is open.

### GAPCORE-002
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: cvars/index.ts:738 writes `${name} "${archiveValue}"` with no escaping; archiveValue (725) and
sourceCommandText (text.ts:6) pass `"`/CR/LF through (ran it: `30"\nexec evil.cfg\n//` survives verbatim),
so an archived value injects extra script lines executed at next launch. Escaping flaw confirmed; the remote
trigger depends on GAPAPP-002's forced cvar write (plausible), but QVM trap_Cvar_Set reaches the same writer.

### GAPMAT-001
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: state-delta.ts:185-186 stores any float32 bits; the native TS Q3 renderer consumes them directly —
light-sampler/q3-lighting throw on non-finite origins, primitives.ts:27/53/59 throw on NaN or >int32 rail length
and segments>1e6. q3-client.ts rethrows frame errors → exit. Reachable without a QVM cgame via the TS scene path.

### GAPNET-001
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: quakeworld.ts:389 seeds `states` with the full prior frame; the overflow check at :411 runs inside the
loop, so adding a low-numbered entity before removing a high one transiently hits 65 > 64 cap → PacketError.
qw-client.ts:179 has no catch. The project's own server permits exactly 64, so server-valid traffic crashes.

### GAPNET-002
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: effects.ts:701 `steps = Math.ceil(beamLength/modelLength)` with no cap, one SceneEntity per step;
prepare.ts:175 second uncapped loop. Protocol-999 float coords let an endpoint be 1e30 → ~3e28 steps. The cable
path has a 65536 cap (presentation-scene.ts:227); its absence here is a real omission. Hostile server / .dem OOM.

### GAPNET-003
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: demos.ts/message.ts throw PacketError on a truncated trailing record; recorded-source.ts:64 calls
`playback.input.advance` for q1/qw/q2 with no try, and advanceSource (remote-application.ts:796) rethrows.
Only the Q3 branch (recorded-source.ts:79) maps truncation to a terminal state. A partial `.dem` crashes the client.

### GAPQ12-001
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: remote.ts:291 builds `players/<model>/tris.md2` from a peer's configstring with no existence check or
fallback; presentation-scene.ts:196 calls assets.model unguarded; assets.ts:325 throws "Model is absent".
Any custom player model the client lacks (downloads off) crashes it; source falls back to male.

### GAPQ12-002
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: weapons/player.ts:263 throws when `inventory.consume` fails. Phalanx consumes on a later frame; Tesla
reserves nothing; `drop` (commands.ts:53-58) empties the stack between check and consume (canDrop true for Tesla).
Component repro reproduced both PHALANX and TESLA throws via the same consume call. Reaches run loop → server exit.

### GAPQ12-003
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: give.ts:12 throws on missing argument; runtime.ts:7693 gates only deathmatch, so a coop peer reaches
giveQ1; unified-server rethrows UnifiedHostFailure fatally while the NetQuake route (q1.ts:154) merely drops the
peer. Any coop peer sending `give` with no args exits a unified Q1 host.

### GAPQ12B-001
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: rogue-runes.ts:31 afterQuad gates on `attacker !== null` (an id, not liveness); damage→state→resolveOwned
returns null for a released owner → throw (runes.ts:42/70). disconnect releases the actor synchronously
(composition runtime.ts:217) and projectiles keep the id. A rocket/grenade outliving its owner's leave crashes the host.

### GAPQ12B-002
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: ctf/teams.ts:31 calls `services.disconnect(actor)` with no return, then uses `state.owner(actor)` which
throws post-release; rogue-teams.ts:64 disconnects then `setColor`→clients.require throws ("Q1 source client is
not admitted", clients.ts:34, record deleted by onRelease:31). Five `color` commands drop every player via the host.

### GAPQ3-003
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: server-commands.ts:242 throws RangeError at count>8 (source limit is 32); the repo's own server sends up to
32 (team.ts:438/447) and consumers clamp to 8. A 9th team member crashes every TS cgame client on that team; the
queue poisons `pending` (server-commands.ts:159-164) so recovery is impossible.

### GAPQ3-004
Verdict: confirmed-with-changes
Corrected severity: High (functional break confirmed; process-exit fatality not proven)
Reason: filterPacket with empty ip gives initializedMask 0, so `(filter.mask & ~0)!==0` throws for any real
filter (server-commands.ts:170); client-admission.ts:273 calls it for bots. Bots cannot connect on any server
with addip/g_banIPs — a real wrong-core-behavior break (confirmed). The "exits the process" claim is the author's
own untraced expectation; console addbot is caught and printed. High stands on the functional break, not a crash.

### GAPSIM-002
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: rebindWorld (classic-guest-services.ts:126) clears configstrings/messages/buffer/resource names but neither
`#monsterProxies` nor `#pendingProxies`; the retained proxies are iterated next bind (383-385), and `engine.actors.isLive`
is false for the prior level's foreign identities → `freeProxyEdict` on a stale slot now reused by new-map edicts. Silent corruption.

### GAPSIM-003
Verdict: confirmed
Corrected severity: High (unchanged)
Reason: network-q3.ts:178 `areas = [...new Set(leaves.map(leaf => scene.leafArea(leaf)))]` keeps solid-leaf -1 and
takes areas[0]/areas[1], dropping a third real area; the areasConnected adapter (:180) returns false for negatives.
The two sibling implementations skip -1 (q3-client/visibility.ts:29, guest-records.ts:164), matching SV_LinkEntity.
Reproduced over baseq3: a door's real area is dropped, culling it from one side when closed.

### GAPSIM-004
Verdict: confirmed-with-changes
Corrected severity: Medium (was High)
Reason: Code is as quoted — refreshTargets (qvm-weapon-behavior.ts:218) and grapple synchronize (qvm-grapple-source.ts:265)
call `options.targets()` once then `mirror()` per target, and mirror re-runs the full `targets()` scan (weapon:181,
grapple:219), so each is O(A²) per step. But targets() (runtime.ts:3102) and these components run only for selected
QVM weapon/grapple behaviors; no retail content drives the A≈352 case (that needs the cross-engine Q1/Q2 config). On
native Q3 actor counts the cost is measurable, not "major perf loss." Real defect, limited reach → Medium.

---

### NET-002 (VERIFY-A retry, QW sequence 0x7fffffff)
Verdict: confirmed (traced) — VERIFY-A's inconclusive resolved
Corrected severity: Critical (VERIFY-A had downgraded to High)
Reason: channels.ts:118-120 advances the SERVER's outgoing to a peer-supplied `sequence & 0x7fffffff`;
advanceOutgoingSequence (reliability.ts:35) permits exactly 0x7fffffff. The first server transmit then does
`outgoing++` → 0x80000000 (reliability.ts:57); every later transmit hits `if (this.outgoing > 0x7fffffff) throw`
(reliability.ts:46). The missed guard VERIFY-A sought: in publish() that throw is caught (qw-server.ts:330) and
routed to disconnectClient, whose own farewell `transmit` at qw-server.ts:190 is UNGUARDED and re-throws on the
exhausted channel → escapes publish() → run loop → process exit. An admitted peer (QW admission is unauthenticated,
NET-007) needs one crafted packet plus one normal server frame. Reply-gating does not save it because the
disconnect-path transmit is unconditional. Not run live (harness blocked); trace is end-to-end.
