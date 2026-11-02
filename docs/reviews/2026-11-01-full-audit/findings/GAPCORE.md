# GAPCORE — Round 2 gap read: session, gameplay, Q3 collision internals, cvars, media and render leftovers
## Coverage
Read in full, line by line:
- world/session/**: session 479, mods 421, clocks 105, resources 40, mod-files 31, mod-match 57, mod-clients 70, mod-client-input 72, mod-client-input-values 24, mod-client-command 54, mod-client-presentation 36, mod-presentations 45, mod-objectives 108, mod-client-applications 120, mod-client-outputs 124, mod-commands 140, index 5.
- world/gameplay/**: authority 820, policies 306, inventory 350, pickups 229, original-pickups 157, weapon-behaviors 102, armor 73, transitions 44, q1-aim 37, q1-client-visibility 67, damage-modifier 11, mod-composition 82, index 11. Combat and armor formulas were compared with g_combat.c and combat.qc from memory; no copy is on this machine.
- world/actors: callbacks 109, source-slots 103, body 217.
- world/collision/q3: patch 512, map-resource 566, polylib 267, map-loader 72, allocation 18, counters 17, settings 26, checksum 25, topology lines 60-281.
- core: cvars/index lines 234-821 (with CORE's 1-234 this is the whole file), cvars/numbers 46, cvars/info 63, omnitimer 49, binary/index 154.
- persistence/q3 46; media/roq-playback 244; media/presentation 167; render/scene/particles/q3-system 458.
- contracts/identity 99.
Sampled:
- core/common-parse: first 200 non-blank lines of 662, plus a throw and loop scan of the rest.
- render/scene/patch lines 1-229 of 312.
- media/playback: line scan only.
- Callers opened only to trace: network/q3/{admission, browser-view, discovery}, compat/qvm/client-browser-syscalls, app/bootstrap/{server-browser, q3-client, configuration, network/q3, network/remote-q3}, runtime.ts ranges.
Skipped, not read (say so in the report):
- src/contracts/** other than identity (4330 lines; CORE ran an export survey only).
- materials/{material-finish 508, q3-lighting 262, compile 87, source-state 172, color, dlight, fog, sky, material-iterator, legacy-fog, turbulence, q2-lighting, q2-lightgrid, geometry, cinematic}.
- render/scene/{patch-lod 186, particles/legacy 140, particles/primitives 144, models/shadedots 215}; render/cpu/{fog 102, lines 139, source 84}; render/gl/{fog-shader 110, shadow-shader 93}. No file matched render/scene/light-sampler* or render/scene/lighting*, so the names in the brief did not resolve there and those were not read.
- text/{localization 431, q3-font-registry 291, layout 136, draw2d 108, and small files}.
- formats/images/{jpeg-encoder 342, png-encoder 45}; media/{roq-presentation, material, transitions, types, audio, still}; the persistence and settings schema readers FORMATS listed.
- core/{random/q2-rerelease, cvars/mirror, q3-cd-key, q3-product-policy, md4}; world/collision/{media}; geometry/q1-solid.
Experiments: gapcore/{admit,arch,q3cm}.ts, run against the clean HEAD checkout and maps extracted from q3a/baseq3/pak0.pk3.

## Strengths
- Session ownership is careful. `validateOwnershipChange` checks every incumbent before `replaceWorld` mutates anything, `closeAll` keeps closing after a failure and aggregates errors, and prepared clients and seats remove themselves when closed.
- GameplayAuthority enforces strong invariants: observed stores must match committed source state, policies cannot swap provenance, and cursors always close in `finally`. Actor release clears bindings, armor cells and protection.
- Q1, Q2 and Q3 damage ordering, armor arithmetic, knockback and bit flags matched the id code in every branch I compared, including Rogue's doubled power armor cost and rerelease minimums. `q1-aim.ts` and `q1-client-visibility.ts` match PF_aim and PF_checkclient.
- `tessellatePatch`, `generatePatchCollide` and the facet and bevel logic follow tr_curve.c and cm_patch.c closely, with the source's caps enforced.
- The production Q3 map path validates BSP cycles and references (formats/q3-map/decode.ts:191-214) before collision sees the data.
- The Q3 server's packet loop catches peer-triggered errors (app/bootstrap/network/q3.ts:172), so the admission throw described under GAPCORE-001 does not reach the server.

## Findings
### GAPCORE-001 — One Q3 server status reply over 1024 bytes exits any client whose server browser pings it
- **Verification (VERIFY-D): confirmed. Final severity: High.** browser-view.ts:200-201 concatenates all status rules then setInfoValue with maximumLength 1024; info.ts:17 throws "oversize infostring" at >=1024. decodeQ3ServerStatus stores rules unbounded. Runs inside the UI ping trap with no catch → client exit when the server list is open.
- Severity: High
- Category: robustness
- Location: src/network/q3/browser-view.ts:198-204; src/core/cvars/info.ts:17; src/core/cvars/info.ts:61; src/network/q3/discovery.ts:49-53; src/compat/qvm/client-browser-syscalls.ts:43
- Confidence: reproduced (the throw); traced (datagram to run loop)
- Evidence: `let text = ""; for (const [key, value] of result.status.rules) text += ...; slot.info = setInfoValue(text, "nettype", "1", { dialect: "q3", maximumLength: 1024, ...` and `if (info.length >= options.maximumLength) throw new RangeError("Info_SetValueForKey: oversize infostring");`. `decodeQ3ServerStatus` stores every rule with no size limit, and the poll in server-browser.ts:408-409 bounds only player counts, name and map. Running setInfoValue with a 1100-byte string gives `RangeError: Info_SetValueForKey: oversize infostring`. The call runs inside UI trap 48 (`browser.getPing`), which has no catch, and VM-004 and APP-001 establish that this ends the process. info.ts:61 throws the same way when the pair exactly fills the buffer.
- Impact: The UI polls LAN_GetPing while the player has the server list open. Any server in that list, including one supplied by a hostile master, can end the client by answering `getinfo` with long rules. The player only has to open the browser. GAPAPP-007 covers the same unbounded rules breaking cache saves; this is a separate, fatal path.
- Remediation: Truncate or reject the rebuilt info string in `pingTime`, and bound rule text at poll admission. Make setInfoValue print and return for oversize input, as the id code's non-fatal paths do, or catch at each untrusted caller.

### GAPCORE-002 — Archived cvar values are written unescaped into a script that runs at next launch, so a forced server write can persist console commands
- **Verification (VERIFY-D): confirmed. Final severity: High.** cvars/index.ts:738 writes `${name} "${archiveValue}"` with no escaping; archiveValue (725) and sourceCommandText (text.ts:6) pass `"`/CR/LF through (ran it: `30"\nexec evil.cfg\n//` survives verbatim), so an archived value injects extra script lines executed at next launch. Escaping flaw confirmed; the remote trigger depends on GAPAPP-002's forced cvar write (plausible), but QVM trap_Cvar_Set reaches the same writer.
- Severity: High
- Category: security
- Location: src/core/cvars/index.ts:738 (`archiveCommands`); src/core/cvars/index.ts:448 (`set`); src/core/commands/text.ts:6-12; src/app/bootstrap/remote-application.ts:928; src/app/bootstrap/configuration.ts:246-247; src/app/bootstrap/q3-client.ts:267
- Confidence: reproduced (output text); traced (reload as script); plausible (that the registry GAPAPP-002 writes is the one saved at remote-application.ts:928, because of `staged(owner.cvars)` at line 1330)
- Evidence: `commands.push(`${prefix}${state.name} "${this.archiveValue(state)}"`);` applies no escaping, and `set` and `sourceCommandText` reject neither `"` nor newlines. Reproduced: after `c.set("cl_maxpackets", '30"\nexec evil.cfg\n//', true)`, `archiveCommands()` returns `seta cl_maxpackets "30"\nexec evil.cfg\n//"`, which is a separate `exec` line. `configuration.ts:247` then runs the file with `currentCommands().insert(args.clientSource.archive, ...)`.
- Impact: GAPAPP-002 gives a Q3 server forced writes to client cvars, and it did not trace persistence. A value that breaks the quoting on any cvar with the archive flag would become arbitrary console commands on the player's next launch, outliving the session. QVM `trap_Cvar_Set` and any other writer reach the same format. The registry identity on the remote path still needs a runtime check.
- Remediation: Reject or escape `"`, CR and LF when writing archive lines, and treat archive files as `seta` data rather than an executable script.

### GAPCORE-003 — Cinematics copy the whole frame on every tick, even when it has not changed
- **Verification (VERIFY-I): confirmed. Final severity: Low.** playback.ts:145 slices on every currentFrame read and :157 reads it on every tick. presentation.ts:143 ticks per prepare, and roq-playback.ts:68-70 and :241 copy per decoded frame. The 177 MB/s arithmetic is correct.
- Severity: Low
- Category: performance
- Location: src/media/playback.ts:145; src/media/playback.ts:157; src/media/roq-playback.ts:68-70; src/media/roq-playback.ts:241; src/media/presentation.ts:72; src/media/presentation.ts:143
- Confidence: traced
- Evidence: `return { status: this.state, frame: this.currentFrame, changed };`, where the `currentFrame` getter copies the picture's rgba. `FullscreenCinematic.prepare` calls `tick()` each display frame. Each decoded RoQ frame adds `copyFrame(dirty)`, and `CinematicImage.prepare` adds `frame.rgba.slice()`.
- Impact: Garbage scales with width x height x 4 x display rate rather than the 30 fps movie rate. A 640x480 movie at 144 Hz churns about 177 MB/s before decode copies (calculated, not measured). Playback is short, so this adds GC pressure and hitches rather than a lasting leak.
- Remediation: Return a shared read-only frame from `tick` and copy only for checkpoints.

### GAPCORE-004 — A complete second Q3 collision loader has no production caller and lacks the checks the live path has
- **Verification (VERIFY-I): confirmed. Final severity: Low.** createSourceQ3Collision and CollisionMapLoader appear only in q3/ and its barrel in src; the only other user is tests/world/collision/retail.test.ts. The live path uses decodedCollisionMap (map-resource.ts:521). The cycle check exists at formats/q3-map/decode.ts:208 and not in CollisionMapResource.load. collisionChecksum has no importer outside the barrel. Load cost was not re-measured.
- Severity: Low
- Category: dead-code
- Location: src/world/collision/q3/map-resource.ts:137-514; src/world/collision/q3/map-loader.ts:32; src/world/collision/q3/index.ts:70-75; src/world/collision/q3/patch.ts:139-237; src/world/collision/q3/allocation.ts; src/world/collision/q3/checksum.ts
- Confidence: traced; load cost reproduced
- Evidence: Grep across src finds `createSourceQ3Collision` and `CollisionMapLoader` only in q3/ and its barrel. Production uses `createQ3Collision` (world/collision/index.ts:65), which goes through `decodedCollisionMap`. The comment "Retains raw source clip-map records when a guest exposes their addresses" describes nothing that runs. `CollisionMapResource.load` also skips the node cycle and reference checks in decode.ts, and it trusts per-model brush and surface counts (map-resource.ts:378-388). Loading q3dm6.bsp through it took 162 ms and added 32.1 MB of heap and 694,325 objects, because each field is a closure over a WeakMap and DataView lookup.
- Impact: About 800 lines to maintain, and a false impression of how Q3 collision works. Wiring it up later would bring in an unvalidated parser that can hang on hostile maps, plus the memory cost above.
- Remediation: Delete it, or move it under tests if it exists as a reference fixture.

### GAPCORE-005 — Lifecycle APIs and helpers in the session and gameplay layers are never used
- **Verification (VERIFY-I): confirmed. Final severity: Low.** No caller uses providers.register, clock, random or checkpoint. No src caller uses SessionMods setEnabled or restore (mods.ts:223, :228). The listed q3 session and kfont exports have no outside importer. q3-system.ts:439 falls through with no creator of ParticleType.Flat.
- Severity: Low
- Category: dead-code
- Location: src/world/session/session.ts:20 and src/world/session/clocks.ts:55-96; src/world/session/mods.ts:223-228; src/world/session/mods.ts:272-301; src/world/actors/source-slots.ts:38-44; src/persistence/q3.ts:29-46; src/render/scene/particles/q3-system.ts:439-442; src/text/kfont.ts
- Confidence: traced
- Evidence:
  - `WorldLifetime.providers` (ProviderRuntimeState) has no caller of `register`, `clock`, `random` or `checkpoint` anywhere in src.
  - runtime.ts is the only user of the SessionMods instance. It calls `advance`, `appearanceOverrides`, `checkpoint`, `checkpointForTravel`, `clientPresentationSources`, `close`, `enabled`, `owns`, `presentations` and `presentationSources`, never `setEnabled` or `restore`. That leaves `restore`'s rollback logic and `apply`'s retained-mod branch unreachable in production.
  - `q3EntityLifetime`, `readQ3Sessions` and `writeQ3Sessions`, and several kfont exports (`Kfont_FromTTF`, `TtfKfont_Lookup`, `kfontHasGlyph`) have no importer outside their own file and barrels.
  - `case ParticleType.Flat:` assigns `vertices` with no `break` and falls into the Animated case, which replaces them. No method in the class creates a Flat particle, so this cannot trigger today.
- Impact: The rollback path looks like tested recovery but never runs in the game. Readers and later callers will trust code that has no production exercise.
- Remediation: Remove what is unused. Add the missing `break` if Flat stays.

## Supplements
- Supplements CORE-008: for point traces, `tracePatch` runs `patch.planes.map(...)` and allocates one relationship object per plane, up to 2048, for each patch reached (world/collision/q3/patch.ts:463-468). Box traces allocate a new plane per facet border through `expanded` (patch.ts:435-445, 500-504).
- Supplements GAPAPP-002: the persistence path it left open is traced in GAPCORE-002.

## Candidates checked and dropped
- Q3 server crash through `connect` userinfo that exactly fills 1024 bytes: the throw is real (admission.ts:175 reaches info.ts:61), but app/bootstrap/network/q3.ts:172 catches it and prints. My script stopped at Huffman decoding of the uncompressed test packet, so the throw was not driven through `connect`; the outcome rests on reading the catch.
- Missing G_Spawn force pass in `allocate`: `q3EntityLifetime` is unused, and QVMs run their own G_Spawn.
- "Q2 victim armor requires a profile" throw (armor.ts:15) on mixed-game armor: `victimArmorContext` always supplies `q2` (runtime.ts:3828).
- "Missing combat policy" for delayed projectiles: every provenance site uses the world's single `recipe.combat.provider`, and SessionMods does not disable mods mid-world.
- ActorId identity comparisons (`===`, Map keys) in mod-client-outputs, mod-match and mod-client-applications: ids are not interned, but these values appear to come from the registry's single live object. I did not check every source binding, so this is not proven.
- `normalize3` on degenerate patch rows: it returns the zero vector rather than throwing.
- Cvar read cost: `variableValue` 93 ns and `get` 146 ns (measured). I did not count reads per frame, so I am not reporting it.
