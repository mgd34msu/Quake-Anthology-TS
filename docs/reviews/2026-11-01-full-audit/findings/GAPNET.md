# GAPNET — Round 2 gap review: network decoders, unified codecs, demo and recording helpers

## Coverage
Audited at HEAD fcdc8af5 from `<scratchpad>/clean`. Reproduction: `<scratchpad>/gapnet-repro/r1.ts` (run from `clean` with HOME and XDG_DATA_HOME under the scratchpad, SDL drivers dummy). No game data, window or network was needed.

Read in full, line by line:
- src/app/bootstrap/network: unified-event-codec.ts (1056), unified-components.ts, unified-frame-values.ts, unified-prediction.ts, remote-qw.ts, q2-effects.ts, q2-layout.ts, q2-mvd-presentation.ts, recorded-source.ts, q1-demo.ts, q2-demo.ts, q3-demo.ts.
- src/network/q2/codecs: vanilla.ts, r1q2.ts, q2pro.ts, q2pro-fields.ts, mvd.ts, kex-write.ts, kexdemo.ts, q2repro.ts lines 400-1121 (lines 1-399 were read in round 1).
- src/network/q1/codecs: codec.ts, nq15.ts, wide.ts, qw28.ts, qw29.ts. src/network/q3: state-delta.ts, browser-view.ts, demo.ts, recording.ts.
- Demo and recording helpers: network/q1/demos.ts, recording.ts, qw-recording.ts; network/q2/demo.ts, server-demo.ts, mvd-recording.ts; app/bootstrap/demo-playback.ts, demo-library.ts, demo-recording.ts, demo-local-recording.ts, demo-commands.ts, demo-recording-commands.ts.

Display caveat: the Q1 codecs, state-delta.ts, browser-view.ts and the helpers in the previous bullet were displayed with lines cut at 190-260 columns. Only long import lines and a few long statements were affected (for example demos.ts:71 and browser-view.ts:274 and :312).

Sampled, as consumers of decoded values only: app/bootstrap/effects.ts (beam, static and particle paths), effects/particles.ts (loops), render/scene/models/prepare.ts:165-187, presentation-scene.ts:215-235 and :400-415, render/scene/particles/primitives.ts:40-80, text/world.ts:24-31, remote-q1.ts:165-170, :225-235, :300-312, remote-unified.ts:83-91, :101, :215, qw-server.ts:302-332, network-qw.ts:246-262, network-q1.ts:33 and :73-76, quakeworld.ts:385-424, mvd-encoding.ts:83-112, q1/message.ts, q2/message.ts primitives.

Skipped: q2/temp-types and constants; q2repro.ts below line 400; mvd-encoding.ts outside the sampled range, so MVD writer and reader symmetry is not fully verified. A possible KEX protocol 2022 mismatch between the writer's `to.solid` (kex-write.ts:112) and the reader's sticky per-edict map (kexdemo.ts:185-190) was noticed and not tested, so it is not reported.

## Strengths
- Particle generators are safe against hostile counts and lengths. Every loop in effects/particles.ts stops at the 4096 capacity, including q2Rail, q1Trail and q2DiminishingTrail with 1e30 distances. Steam emitters are capped at 32 (effects.ts:392).
- Command-like events are not executed on remote clients. A grep of `console-command`, `command-text`, `stufftext`, `restart-level` and `autosave` found no route from the unified decoder to the command buffer in remote-application.ts or remote-unified.ts. The application.ts handlers belong to the local simulation.
- Q2 wire readers are bounded. Stat loops check `to.stats.length` or write to typed arrays. `MSG_ReadData` cannot write outside its target. Area bit lengths over the buffer size are discarded without a memory error. `readLocprintKex`, split player counts and batch `numDups` are all range-checked.
- Q3 delta decoding rejects bad field counts (state-delta.ts:241, :294) and bad entity numbers (:193).
- Demo and record names go through `normalizeResourcePath`, which rejects `..`, drive prefixes and NUL. `record` opens with `wx`, and remote-client command origins are refused for all demo and recording commands.
- Round 1 suspicions refuted here: QWD command decode is correct because `MessageReader.bytes` slices (q1/message.ts:122). The protocol 15 host zeroes wide model and frame values before encoding (network-q1.ts:75-76). The QW server caps entities at 64 and nails at 32 (network-qw.ts:255-256). Unsigned effects from DLLs arrive through getUint32 (classic-guest-services.ts:327), so the signed `effects < 256` branch in r1q2.ts:80 is not reached. The Q2PRO fog revision throw (q2pro.ts:134) is unreachable because the server never sets `q2proFog`.
- A cap on grapple cable segments exists at presentation-scene.ts:227 (GAPNET-002 shows this cap is missing on the sibling paths).

## Findings

### GAPNET-001 — A valid QW delta at the 64-entity cap kills the client
- **Verification (VERIFY-Q): confirmed. Final severity: High.** QW/client/cl_ents.c:327-374 counts only written entries (`newindex`), with no transient union. Even on overflow the original calls Host_EndGame, not process exit. Source review: SRCQ1
- Severity: High
- Category: bug
- Location: src/network/q1/quakeworld.ts:389, :411-412; src/app/bootstrap/network/qw-client.ts:179
- Confidence: reproduced
- Evidence: the decoder seeds `states = new Map(old.map(...))` with the full previous frame, then applies wire entries in number order. The check runs after each insert: `if (states.size > codec.maxPacketEntities) throw new PacketError('Packet entities overflow', r.offset);`. When a frame stays at 64 entities, a new low-numbered entity arrives before the removal of a higher-numbered one, so the transient size is 65. Native CL_ParsePacketEntities merges into a new list and only counts entries that end up in the frame. r1.ts built frame 1 with entities 100-163 and frame 2 with entity 50 added and 163 removed, using the project's own `writeQuakeWorldEntities`: `R1 THROW on server-valid 64-entity delta: PacketError: Packet entities overflow at byte 6`. qw-client.ts:179 has no catch, so this reaches NET-005's fatal path. The refuting case would be a server that never reaches 64, but this project's server allows exactly 64 (network-qw.ts:256) and native servers do too.
- Impact: on a busy QW server, the game process exits the first time the visible set is at the cap and one entity swaps for a lower-numbered one. Recorded QWD files with the same traffic crash in the same way. No hostile peer is needed.
- Remediation: check the count after the loop finishes, or count final entries during a merge.

### GAPNET-002 — Beam segments have no count limit, so one float coordinate exhausts client memory
- **Verification (VERIFY-D): confirmed. Final severity: High.** effects.ts:701 `steps = Math.ceil(beamLength/modelLength)` with no cap, one SceneEntity per step; prepare.ts:175 second uncapped loop. Protocol-999 float coords let an endpoint be 1e30 → ~3e28 steps. The cable path has a 65536 cap (presentation-scene.ts:227); its absence here is a real omission. Hostile server / .dem OOM.
- Severity: High
- Category: security
- Location: src/app/bootstrap/effects.ts:289, :701-706; src/render/scene/models/prepare.ts:170-183; src/network/q1/message.ts:100-102; src/app/bootstrap/network/remote-q1.ts:230; src/app/bootstrap/network/unified-event-codec.ts:359, :391, :146
- Confidence: reproduced (decode and allocation rate); traced (full path to OOM, not run to exhaustion on this memory-constrained machine)
- Evidence: effects.ts:701 `const steps = shortLightning ? 1 : Math.ceil(beamLength / modelLength)` then pushes one SceneEntity per step with no limit, inside `prepare`, on each frame the beam lives. Protocol 999 lets the server choose its flags (netquake.ts:225), and `PRFL_FLOATCOORD` makes coordinates raw floats. r1.ts decoded `temporary-entity beam end.x = 1.0000000150474662e+30` through `NetQuakeDecoder`. Calling `beamModels` with a 3e7 length produced `1000000 models, 637 ms, RSS +775 MiB, 813 bytes/model`. A 1e30 endpoint requests 3.3e28 models, and +Infinity gives an unending loop. The same applies to unified `monster-beam`, Q1 `beam` and `bfg-lightning`, whose endpoints only pass `.finite()`. prepare.ts:175 `for (let offset = 0; offset < distance; offset += segmentLength)` is a second uncapped loop, and a unified `modelBeam.segmentLength` of 1e-300 or a distant `previousOrigin` reaches it. At large distances `offset` stops advancing. The sibling cable path has `if (count > 65536) throw` at presentation-scene.ts:227, so the absence here is an omission.
- Impact: one small message from a hostile server, or opening a protocol 999 `.dem`, freezes the client thread and consumes about 800 bytes per segment until the OS kills the process (about 6 GB in roughly 5 s by the measured rate). `.dem` files are also reachable through `startdemos` lists. Unlike NET-004, this needs no compressed transfer.
- Remediation: reject non-finite or out-of-world beam endpoints at the event boundary, and cap segments per beam (the original limit was a few hundred) in both loops.

### GAPNET-003 — A truncated or unterminated demo ends the whole process
- **Verification (VERIFY-D): confirmed. Final severity: High.** demos.ts/message.ts throw PacketError on a truncated trailing record; recorded-source.ts:64 calls `playback.input.advance` for q1/qw/q2 with no try, and advanceSource (remote-application.ts:796) rethrows. Only the Q3 branch (recorded-source.ts:79) maps truncation to a terminal state. A partial `.dem` crashes the client.
- Severity: High
- Category: robustness
- Location: src/network/q1/demos.ts:28-32, :76-80; src/network/q2/demo.ts:23-24; src/app/bootstrap/network/q2-demo.ts:23; src/app/bootstrap/network/q1-demo.ts:64, :148, :154; src/app/bootstrap/network/recorded-source.ts:64-74; src/app/bootstrap/remote-application.ts:776-797, :2176
- Confidence: reproduced (reader throws); traced (fatal route, per NET-005 and APP-001)
- Evidence: r1.ts: `.dem truncated last record THROW: PacketError: Truncated message at byte 16`, `.dm2 truncated last record THROW: Error: Truncated Q2 demo packet`, `.qwd truncated last record THROW: PacketError: Truncated message at byte 9`. `readMvdFile` also throws `MVD recording lacks its terminator` at q2-demo.ts:23 after a whole recording plays. `RecordedRemoteSource.advance` has no catch and `advanceSource` runs `if (result.kind === "failed") throw result.error;`. The `this.demos?.failed` handler at startup.ts:733 only covers starting a demo. Only Q3 maps truncation to an end state (demo.ts:40-49, recorded-source.ts:79). `DemoCompletion` already includes `"truncated"`, and native Q1 and Q2 stop playback at a short read.
- Impact: a demo cut short by a crash during `record`, an interrupted download, or a hostile file closes the game instead of returning to the menu, with a crash log. `record` files are unterminated and may be partial whenever the process dies, so this project's own crashes create the trigger. Any parser error in a demo (for example the signon check at q1-demo.ts:64) does the same.
- Remediation: map truncation in Q1, QW, Q2 and MVD readers to the `truncated` completion, and catch decoder errors around `playback.advance` so playback ends with a console message.

### GAPNET-004 — NaN or Infinity in one presentation event breaks every unified client
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** unified-event-codec.ts:1044 uses plain JSON. Rerun: SaveReader `.finite()` on a JSON round-tripped NaN throws `expected a number`. unified-client.ts:74 is inside the handler whose catch at :90 disconnects and rethrows, and unified-server.ts:237 does not validate.
- Severity: Medium
- Category: bug
- Location: src/app/bootstrap/network/unified-event-codec.ts:1044, :1050; src/app/bootstrap/network/unified-server.ts:237; src/persistence/value.ts:100; src/app/bootstrap/network/remote-unified.ts:134; src/app/bootstrap/network/unified-frame-values.ts:15
- Confidence: reproduced
- Evidence: the encoder uses plain JSON: `JSON.stringify(events.map(...))`. r1.ts: `R2 NaN encoded OK "count":null decode THROW: SaveFormatError: unified.presentation-events[0].event.count: expected a number`, and the same for Infinity. The server never validates, and writers such as `writeEventQ1Event` copy values straight from simulation output. Frames take a different route (tagged numbers through `encodeCheckpointValue`), but `vector` and other readers call `.finite()`, so non-finite frame values also fail on the client. Original QuakeC and native game code can produce NaN or Inf (division by zero, normalizing bad vectors) and classic engines tolerate them. tests/network/unified has no NaN or Infinity case.
- Impact: a mod that emits one non-finite volume, count or coordinate ends the session of every connected unified client through NET-005, while the host keeps running normally. The failure appears far from its cause.
- Remediation: validate at encode and drop or sanitize the event with a host-side diagnostic, so the encoder and decoder agree on the same domain.

### GAPNET-005 — Unified identity maps grow with each generation seen, and lookups scan them
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** remote-unified.ts:84-85,88-90 insert per slot and generation, the only clear is on offer (:101), and numberOf (:215) is a linear scan with string splitting, used by PresentationState (:55). Slot and generation are unbounded (unified-event-codec.ts:22,24).
- Severity: Medium
- Category: leak
- Location: src/app/bootstrap/network/remote-unified.ts:49-50, :83-90, :101, :215, :55; src/app/bootstrap/network/unified-event-codec.ts:22, :24
- Confidence: traced
- Evidence: `const key=\`${slot}:${generation}\`,old=this.actors.get(key);...this.actors.set(key,value)`. Slot and generation are any safe integers from the wire (`.integer(0)`). The maps clear only on a new content offer (:101), and no path removes retired generations. `numberOf` is linear with string splitting: `for(const [key,value] of this.actors)if(value.equals(actor))return Number(key.split(':')[0])`, and `PresentationState` calls it for event actors (:55). `options.nextGeneration(slot)` also advances a session counter per new pair.
- Impact: in normal play on one long map, each projectile or respawn adds an entry, so memory and `numberOf` cost grow for the map's duration. A hostile server can add up to 65536 entries per list per message, which gives unbounded client memory growth at its send rate.
- Remediation: bind slot to the current generation with one entry per slot and retire on replacement, cap slots at the negotiated entity limit, and keep a reverse map for `numberOf`.

### GAPNET-006 — Client-side persistent state from servers and demos has no size limit
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** remote-q1.ts:167,309 and recording.ts have no statics cap. q1-client.ts:115 and qw-client.ts:180 observe unconditionally. qw-recording.ts:72 leaves keys, pairs and pairSlots uncleared, with a linear scan at :60. remote-qw.ts:157 copies the map per message.
- Severity: Medium
- Category: leak
- Location: src/app/bootstrap/network/remote-q1.ts:167, :309; src/network/q1/recording.ts:16; src/network/q1/qw-recording.ts:49-56, :73, :80-81; src/app/bootstrap/network/q1-client.ts:115; qw-client.ts:180; src/app/bootstrap/network/remote-qw.ts:156-158, :78; src/app/bootstrap/effects.ts:436, :441; src/text/world.ts:24
- Confidence: traced
- Evidence: `case 'static': this.statics.push(message.state);` has no limit and clears only at server-info, and :309 appends every static into `presentations()` on each frame. Native Quake errors at MAX_STATIC_ENTITIES. `recordingState.observe(messages)` runs for all live traffic even when not recording (q1-client.ts:115, qw-client.ts:180), so `statics` is retained a second time. In QW, `pairId` interns every `set-info` key, and `pairs`, `pairSlots` and `keys` are not cleared by `server-data` (qw-recording.ts:72). remote-qw.ts:157 copies the whole info map per message (`new Map(this.userinfos.get(message.slot))`) and bumps `skinRevision`, which causes a full `prepareSkins` pass. There is no check of key count or value length, while native info strings are limited to a few hundred bytes. Unified `static-model`, `world-text` and `debug-shapes` have no count cap either, and `lifetime` can be any finite value.
- Impact: a hostile server or demo can grow client memory steadily and make per-frame cost linear in the attacker's count. QW `set-info` flooding is quadratic in keys. Retention lasts until the next map at best, and the QW intern tables last for the connection.
- Remediation: enforce native limits at the decoder or presentation boundary (statics, info string length and keys), and drop the connection when they are exceeded. Run recording state only while a recording can be seeded, or cap it.

### GAPNET-007 — Unified decoding checks only finiteness, so consumers throw on or retain out-of-range values
- **Verification (VERIFY-E): confirmed. Final severity: Medium.** unified-frame-values.ts:54 accepts any finite segmentLength and prepare.ts:171 throws on a negative one (0 maps to 30). unified-event-codec.ts:606 and text/world.ts:29 behave likewise. :749-750 checks vectors, while unified-components.ts:102 calls the same reader without that check.
- Severity: Medium
- Category: robustness
- Location: src/app/bootstrap/network/unified-event-codec.ts:606, :605, :54-62, :764; src/app/bootstrap/network/unified-frame-values.ts:54; src/text/world.ts:25-29; src/render/scene/models/prepare.ts:171; src/app/bootstrap/component-drawings.ts:50-51; src/app/bootstrap/network/unified-components.ts:102, :106
- Confidence: traced
- Evidence: nearly all numeric event fields use `.finite()`. `modelBeam: {segmentLength: v.field('segmentLength').finite()}` then prepare.ts:171 `throw new RangeError("Invalid model beam segment length")`. World text with `cellSize: 0` or a negative `lifetime` reaches text/world.ts:29 `throw new RangeError("Invalid world text geometry or lifetime")`. `readEntityState` accepts any finite values for fields that are integers on the source side. `readSourcePlayerState` checks vector finiteness (:749-750), but the same record decoded by `readComponentFrames` (unified-components.ts:102, :106) does not, so the validation differs between two routes for one record type.
- Impact: one crafted event or frame makes a client throw during rendering rather than at decode, so the failure skips any future per-message recovery. It also passes hostile NaN coordinates from component frames to original QVM cgame code.
- Remediation: define field ranges in the readers (positive sizes, integer domains, bounded lifetimes), and share one validator for source records.

### GAPNET-008 — Client movement encoders wrap large values
- **Verification (VERIFY-I): confirmed-with-changes. Final severity: Low.** The wrap is real (r1q2.ts:583-584 and :610-611, q2pro.ts:350), but the stated trigger does not exist: no cl_forwardspeed or run-multiplier cvar is registered, and tuning writes change only alwaysRun (ui/settings/index.ts:256). Real reach is stacked input: keyboard 400 plus gamepad 400, or mouse-forward (input/user-command.ts:109-115), which can reach 800.
- Severity: Low
- Category: bug
- Location: src/network/q2/codecs/r1q2.ts:583-588, :610-625; src/network/q2/codecs/q2pro.ts:350-354; src/network/q2/codecs/clc_batch_move.ts:93-94; src/network/q2/codecs/q2repro.ts:668-672
- Confidence: reproduced (R1Q2); traced (Q2PRO)
- Evidence: r1q2.ts:583 `if (bits & (1 << 3) && cmd.forwardmove % 5 === 0) buttons |= BUTTON_UCMD_DBLFORWARD;` lacks the range check that angle 1 has at :589 (`Math.abs(...) < 128`). r1.ts: `R4 forwardmove in 800 decoded -480`. q2pro.ts:350 `bw.writeSigned(cmd.forwardmove, 10)` masks to 10 bits, so 640 becomes -384. q2repro.ts:668 clamps the same field.
- Impact: a player with a raised `cl_forwardspeed` or running multiplier moves backward on R1Q2 and Q2PRO servers.
- Remediation: add the range check to the R1Q2 compression conditions, and clamp in the Q2PRO encoder as q2repro.ts does.

### GAPNET-009 — Signed reads disagree with the wider range their writers allow
- **Verification (VERIFY-I): confirmed. Final severity: Low.** nq15.ts:138-141 allows ent below 8192 and :248-249 uses the signed Short (network/q1/message.ts:83), while wide.ts:430 masks. wide.ts:437 reads a signed index. qw29.ts:204-205 can exceed QW29_MAX_ENTITY_NUMBER with no reader check.
- Severity: Low
- Category: bug
- Location: src/network/q1/codecs/nq15.ts:138-141, :153, :248-249; src/network/q1/codecs/wide.ts:198-206, :437; src/network/q1/codecs/qw29.ts:21, :148, :204-205
- Confidence: traced
- Evidence: nq15.ts allows `s.ent < 8192` and writes `(s.ent << 3) | s.channel`, but reads `const channel = reader.Short(); out.ent = channel >> 3;`, so entities 4096-8191 decode as negative (wide.ts:430 masks this correctly). wide.ts:437 `return version === 2 ? reader.Short() : reader.Byte();` turns sound indexes of 32768 or more negative, despite `WIDE_MAX_PRECACHE = 65536`. qw29.ts reads numbers up to 131071 from `word & 511 | byte << 9`, but `QW29_MAX_ENTITY_NUMBER` is 65536 and the reader has no check.
- Impact: limited to very high entity or sound numbers. A hostile peer can send such values, and they then hit the downstream throws already described in NET-005.
- Remediation: mask to unsigned at these reads and enforce the maximum in `readDeltaEntityHeader`.

### GAPNET-010 — Q3 delta decode allocates per entity and per vector component
- **Verification (VERIFY-I): confirmed. Final severity: Low.** state-delta.ts:242-243 and :295-296 slice per record, and :58 and :66 spread per vector component. The cost is unmeasured, as the finding says.
- Severity: Low
- Category: performance
- Location: src/network/q3/state-delta.ts:58, :66, :72, :242-243, :295-296
- Confidence: traced
- Evidence: `for (const field of ENTITY_FIELDS.slice(0, last))` and `.slice(last)` allocate two arrays per entity. Each vector field set runs `set(s, { ...get(s), [axis]: value })`, and trajectory vectors rebuild `s[key]` as well, so one full entity allocates dozens of short-lived objects. The cost is not measured. It scales with up to 256 entities per snapshot on the client path and adds to the encoder cost in NET-021.
- Impact: added GC pressure per snapshot during Q3 play and demo playback.
- Remediation: iterate by index without slicing and write vector components into per-record mutable storage during decode.

### GAPNET-011 — Component gamestate validation scans the whole string table for each offset
- **Verification (VERIFY-I): confirmed. Final severity: Low.** unified-components.ts:66 runs two indexOf calls per offset, :72-73 checks the 64 limit after decoding, and :85 checks sources after decoding them. indexOf is a byte scan and is likely fast, which supports Low.
- Severity: Low
- Category: performance
- Location: src/app/bootstrap/network/unified-components.ts:63-66, :81-85
- Confidence: traced
- Evidence: `for (const offset of offsets) if (offset !== 0 && (data.indexOf(0, offset) < 0 || data.indexOf(0, offset) >= count))`. That is two scans of up to 16000 bytes for each of 1024 offsets, per source. Sources are decoded before the `sources.length > 256` check at :85. Commands get the same treatment at :70-73, where the limit of 64 is checked after every argument is decoded. The message size limit bounds the total at a few hundred million byte steps per message.
- Impact: a hostile unified server can add CPU stalls per control message.
- Remediation: precompute the next-NUL position in one pass, and check list lengths before decoding elements.

### GAPNET-012 — The 1056-line event codec is hand-synchronized with no generator in the repository
- **Verification (VERIFY-I): confirmed. Final severity: Low.** The file is 1056 lines with a 1059-column maximum. `"blue"` and `"spectators"` use readEventQ2CtfEventScoreboardRed, and readEventQ2WeaponEventViewWeaponWeapon reads command and winner fields. tools/ and the repository have no generator referencing it, and :615-617 is in a different style.
- Severity: Low
- Category: maintainability
- Location: src/app/bootstrap/network/unified-event-codec.ts (all); tests/network/unified-events.test.ts
- Confidence: traced
- Evidence: names such as `readEventQ2CtfEventScoreboardRed` being reused for `blue` and `spectators` (:467) and `readEventQ2WeaponEventViewWeaponWeapon` for LMCTF commands (:486) show generated output, but a grep of scripts and tools finds no generator. Parts of the file have since been hand-edited in a different style (:615-617, :641-643, :760). Lines reach several hundred columns, and each new event field needs matching edits in reader, writer and type.
- Impact: review of this untrusted boundary is impractical. A field-level asymmetry would only be caught if the round-trip tests include that variant.
- Remediation: restore a generator or use a schema table that derives both reader and writer, with field ranges (GAPNET-007) in the schema.

## Supplements
- Supplements NET-001: `encodeQ2Frame` at q2.ts:549 has more throwing encoders on the same uncaught path: `writeQ2ProInt23` throws on NaN or beyond about ±524287 units for v2 peers (q2pro-fields.ts:18-19, called from :217-219), `Q2PRO entity needs negotiated game extensions` when a client that chose a revision below 1024 sees alpha, scale or model index above 255 (q2pro-fields.ts:173-174), `Q2PRO gun needs negotiated game extensions` (q2pro.ts:197-198), and `KEX gun frame exceeds nine bits` (kex-write.ts:230-231). A peer selects its own revision (q2.ts:261-262), so an old-revision client can trigger the extension throws on a server whose game uses those fields.
- Supplements NET-004: `readSpawnbaselineblastKex` (kexdemo.ts:573-579) has no read-overflow check in its loop, so a truncated entry in an inflated blast yields garbage baselines rather than an error.
- Supplements NET-005: new fatal triggers in QW presentation are remote-qw.ts:76 (`Invalid QW userinfo slot`) and :164 (`Invalid QW sound index`).
