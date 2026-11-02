# PLATFORM — Native platform, audio, input, console, capture, camera, debug, and LLM

## Coverage
Read in full:
- src/platform/** (18 files, 3,342 lines), including sdl.ts (1,080) and audio.ts (292).
- src/audio/** (15 of 16 files, 3,576 lines), including mixer.ts (1,137) and engine.ts (611).
- src/input/** (24 files, 2,317 lines), src/console/** (13 files, 1,091 lines), src/llm/** (11 files, 1,300 lines).
- src/capture/index.ts (87), src/debug/** (111), src/camera/** (243), src/types/png.d.ts (4).

Sampled:
- src/audio/reverb-presets.ts: first 40 of 301 lines (preset data).
- Outside scope, only to trace paths: src/main.ts, src/core/commands/index.ts (530-860), src/core/commands/text.ts (macro expansion), src/settings/config.ts (100-205), src/app/bootstrap/audio.ts, capture.ts, config-scripts.ts, startup-config.ts, application.ts (step and run), startup.ts (step and run), network/qw-client.ts, remote-q1.ts, remote-q3.ts, q2-client-receiver.ts, src/world/actors/registry.ts, tools/build.ts.

Skipped: nothing in scope.

Experiments: throwaway scripts in `<scratchpad>/platform-exp`, run against `<scratchpad>/clean`. No window was opened and no network request left localhost. `SDL_SetHint`, libvorbisfile and libtheoradec were exercised through bun:ffi without creating a window. `git rev-parse` does not work in the clean copy, so I did not confirm its commit hash independently.

## Strengths
- Bun:ffi pointer handling is careful. Buffers passed to native code stay referenced for the duration of the use (`FreeTypeFontLibrary` retains font bytes, `gl-programs.ts` pins shader sources, `theora.ts` keeps packet data alive via the packet). SDL allocations are copied before `SDL_free`. There are no `JSCallback`s in production paths; the only one is in the diagnostic `VirtualSdlController`, and it is closed correctly.
- Audio uses SDL's queue API rather than a callback, so no JS runs on the SDL audio thread. Queued depth is capped at two seconds and the backend probes for exact queued-byte reporting.
- Library loading tries ordered candidates, reports every failure in an `AggregateError`, and treats a missing symbol as a load failure for that candidate.
- Remote stufftext cannot reach the command buffer. QW (qw-client.ts:141), NetQuake (remote-q1.ts:242) and Q2 (q2-client-receiver.ts:105) act only on a small whitelist and print everything else. Q3 systeminfo does not set client cvars (remote-q3.ts:116).
- LLM requests require `invocation.direct` and a local origin. Bindings (`seat.ts:142`), aliases and scripts are rejected, with tests for each. Peer chat and game state never enter the prompt; the prompt is only the user's typed text plus the command catalog, and the catalog excludes cvar values and alias bodies.
- LLM credentials are written atomically at mode 0600 outside the content tree, so guest filesystem access and `condump` containment do not reach them. The OAuth flow uses PKCE and a 256-bit state, listens on loopback only, and runs on its own worker. All fetches use `redirect: "error"`, so bearer tokens do not follow redirects. Error messages are constructed locally, so response bodies and tokens do not reach logs. `grep` finds no use of tokens or keys outside src/llm.
- SSE input is capped at 1 MiB total, and the worst-case parser inputs I tried finished in 88 ms or less. Requests have overall timeouts and cancellation.
- `settingsPath` contains `condump`, `writeconfig`, `screenshot` and `levelshot` inside the writable root, and failures are printed rather than fatal (`capture.ts` `queue`). `openContainedParent` uses descriptor-anchored `O_NOFOLLOW` traversal.

## Findings

### PLATFORM-001 — Audio actor table grows for every spawned body, slows every frame, then crashes at 65,535
- **Verification (VERIFY-B): confirmed-with-changes. Final severity: High.** engine.ts:141-148 and audio.ts:568 as quoted; re-ran throw at generation 65,536. The 50 spawns/s rate is about 4.5x too high: q3dm1 with 4 bots measured 11.2 new actors/s, 75 bodies average, so 30,000 actors at about 45 min and the crash at about 97 min. World replacement resets it (application.ts:2969), so it needs one long world; retail content suffices. Dedicated servers have no audio.
- Severity: High
- Category: leak
- Location: src/audio/engine.ts:140-149, src/app/bootstrap/audio.ts:568, src/world/actors/registry.ts:69-70, src/app/bootstrap/application.ts:4685-4686
- Confidence: reproduced (engine behavior); traced (feed from the frame loop)
- Evidence: `audio.ts:568` runs on every frame: `for (const body of this.snapshot.bodies) this.engine.updateActor(body.actor, body.body.origin);`. `engine.ts:141` does a linear search, `this.actors.findIndex(candidate => candidate.actor.equals(actor) && candidate.owner === owner)`, and a miss pushes a permanent entry. `engine.ts:146-147` then throws: `if (this.actors.length + 1 >= maximum) throw new RangeError("Audio actor capacity exhausted")`. `registry.ts:69` gives each spawn a new generation, so every rocket, nail and gib is a new `ActorId`. The only removal is `resetRound` or a new `ApplicationAudio` per world. No path removes entries when an actor dies. The exception reaches `application.ts:4686`, which rethrows it to `main`.
  Measured with `UnifiedAudio` and fresh generations: 100 `updateActor` calls cost 1.4 ms at 1,000 actors, 6.3 ms at 10,000, 29.8 ms at 30,000 and 61.5 ms at 60,000. It threw `Audio actor capacity exhausted` at generation 65,536.
- Impact: A long single-world session, such as a listen server or a bot deathmatch with no map rotation, loses frame time steadily. With about 100 live bodies, audio bookkeeping alone exceeds a 60 Hz frame budget by about 30,000 accumulated actors. The session then exits with a crash. At 50 spawns per second that point arrives in about 22 minutes.
- Remediation: Replace the array with a map keyed by slot and generation, and retire entries when an actor leaves the snapshot and has no active voices or loops.

### PLATFORM-002 — A corrupt Ogg music page crashes the game during playback
- **Verification (VERIFY-B): confirmed-with-changes. Final severity: Medium.** Re-ran: `corrupt mix THROWS ... -3`; intact and truncated files pass (vorbis.ts:129). No catch at audio.ts:650. Trigger needs a damaged music file, not normal content.
- Severity: High
- Category: robustness
- Location: src/platform/vorbis.ts:129, src/audio/music.ts:65, src/audio/music.ts:88, src/audio/engine.ts:419, src/app/bootstrap/audio.ts:650
- Confidence: reproduced
- Evidence: `vorbis.ts:129` reads `if (count < 0) throw new VorbisError("ov_read", count);`. `OV_HOLE` (-3) is libvorbisfile's recoverable "data interruption" result. The throw travels through `MusicPlayer.nextChunk`, `RawAudioStream.mix`, `UnifiedAudio.mix` and `pump` with no catch, and `SoundBank.openMusic` guards only the open. I corrupted one Ogg page of an ffmpeg-generated file and ran `UnifiedAudio.mix`: `corrupt mix THROWS: VorbisError: ov_read failed with Vorbis error -3`. The intact and truncated files both played to completion.
- Impact: One damaged page in a music file in a pak, pk3 or addon ends the session when playback reaches it. The file passes validation at open. The owned temporary directory is also left behind (see PLATFORM-021).
- Remediation: Retry on `OV_HOLE` in `read()`. Catch other decoder failures in the music path, stop that track and print a warning.

### PLATFORM-003 — A stereo sound effect passes the sound bank and crashes when played
- **Verification (VERIFY-B): confirmed-with-changes. Final severity: Medium.** Guard absent as quoted (bank.ts:33, mixer.ts:202-204). Corpus scan: 141 of 8,530 WAVs are stereo, nearly all music or `tactile/*_vb.wav`. The non-music effects found: `loop_electricity_05.wav`, referenced only from 6 Team Arena ui/*.menu files, and `alliance/quiet.wav`, unreferenced by any scanned bsp, shader, qvm, cfg, menu or arena file. I did not run the menu path or trace haptic files through the mixer. No retail BSP trigger found.
- Severity: High
- Category: robustness
- Location: src/audio/bank.ts:33, src/audio/wav.ts:143, src/audio/streams.ts:95, src/audio/mixer.ts:202-204, src/audio/mixer.ts:409, src/audio/mixer.ts:489, src/app/bootstrap/audio.ts:358
- Confidence: reproduced (mixer throw); traced (bank to frame loop)
- Evidence: `wav.ts:143` accepts one or two channels and `streams.ts:95` returns stereo Ogg as is. `bank.ts:33` catches only decode errors and registers the result with no channel check. `mixer.ts:202-204` then throws: `if (!allowStereo && sound.channels !== 1) throw new RangeError("sound effects must be mono, matching Quake S_LoadSound")`. Both `startQ1Sound` and `startSharedSound` threw this in a direct test. `startQ2Sound` reaches the same check through `admitSourceSound`. `audio.ts:358` calls `engine.play` inside an awaited frame path with no catch. The original engines print a warning and skip such a file, as the mixer comment implies.
- Impact: Custom maps and mods can ship stereo WAV or Ogg effects. The first play of one ends the session instead of being silent. `bank.ts:29-31` already states the intended policy that a bad file should behave like a missing one.
- Remediation: Reject non-mono sound effects in `SoundBank.register` with one warning, returning null as for undecodable files.

### PLATFORM-004 — Ordinary invalid console commands throw through the frame loop and exit the game
- **Verification (VERIFY-B): confirmed-with-changes. Final severity: Medium.** "Ordinary invalid commands" is overstated. Through real `Application.step` with a local-seat context, `bogus`, `map nosuchmap`, `give foo`, `exec nofile`, `fov abc`, and Q1 `impulse foo`/`impulse 999` all survive. Step throws on Q3 `impulse foo` (impulse.ts:37), `+attack 1 abc` (seat.ts:246), `startcamera` and argless `loadcamera` (camera/application.ts:32-35). Used `buffer.append`, not the console UI.
- Severity: High
- Category: robustness
- Location: src/input/seat.ts:123, src/input/seat.ts:246, src/input/impulse.ts:37, src/camera/application.ts:32-35, src/camera/application.ts:51, src/core/commands/index.ts:773-800, src/app/bootstrap/startup.ts:1378, src/app/bootstrap/application.ts:4476, src/app/bootstrap/application.ts:4685-4686
- Confidence: reproduced (dispatch throws); traced (no catch up to main)
- Evidence: `dispatch` uses `try { ... } finally { ... }` with no catch (`core/commands/index.ts:773-800`). `startup.ts:1378` and `application.ts:4476` await the drain without a catch, `application.ts:4686` rethrows non-fatal errors, and `run()` has no catch, so `main` writes a crash log and exits. Against a real `CommandBuffer`:
  - `impulse foo` and `impulse 999` (Q3 dialect): `RangeError: Input impulse must fit a byte`. `impulse.ts:37` returns `Number(text)` for q3 and q2-rerelease, and `seat.ts:123` throws.
  - `+attack 1 abc`: `RangeError: Invalid button command timestamp`.
  - `startcamera`: `Error: No camera loaded`.
  - `loadcamera` with no argument: `Error: Usage: loadcamera <file.camera>`.
  - `savecamera x` with no camera loaded: `Error: No camera loaded`.
- Impact: A typo at the console, or a line in any executed cfg, terminates the session and can lose unsaved progress. Remote stufftext cannot trigger this because of the whitelist. Mod cfgs and local scripts can.
- Remediation: Catch per-command errors at the local-client drain boundary and print them, keeping a separate type for truly fatal engine errors. Change usage errors in the camera commands to prints.

### PLATFORM-005 — Cancelling a request during token refresh discards the rotated token and signs the user out
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** src/llm/settings.ts:367 aborts the shared controller when users reach 0; :351 checkRequestAbort and the signal passed to write at :357 then drop the already rotated token. refreshSubscription's result is persisted nowhere else. Fake-endpoint run not repeated.
- Severity: Medium
- Category: bug
- Location: src/llm/settings.ts:350-351, src/llm/settings.ts:357, src/llm/settings.ts:367, src/llm/settings.ts:134-136
- Confidence: reproduced (with a fake rotating token endpoint)
- Evidence: `settings.ts:367` aborts the shared refresh when the last user leaves: `finally { shared.users--; if (shared.users === 0) shared.controller.abort(); }`. `settings.ts:351` and the signal passed at `settings.ts:357` then drop the result. Observed sequence:
  ```
  token endpoint got R1 valid=true
  request1: LLM request cancelled.
  file refresh after cancel: R1; server now accepts: R2
  token endpoint got R1 valid=false
  request2: Subscription token request failed. Try signing in again.
  ```
- Impact: `llm_cancel`, the 120-second timeout, or game exit during the refresh window can invalidate the stored credential on any provider that rotates refresh tokens. The user must sign in again, and reuse of an old token may trigger provider reuse detection.
- Remediation: Do not tie the token exchange to caller cancellation. Once the request is sent, let it finish on its own timeout and always persist a returned credential.

### PLATFORM-006 — The `llm_exec` validator is a short deny list, so model output can persist scripts, quit, or connect
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** src/console/llm-batch.ts:5 is a ten-name deny list, and :42-51 otherwise accepts any registered name. llm.ts:71-72 executes immediately. commands.ts:42-48 condump writes any name (Q2 forces .txt). startup-config.ts:62 executes autoexec.cfg from the seat scope. remote-application.ts:1462 and demo-commands.ts:46 run cvar text as commands.
- Severity: Medium
- Category: security
- Location: src/console/llm-batch.ts:5, src/console/llm-batch.ts:42-51, src/console/llm.ts:71-72, src/console/commands.ts:42-48, src/app/bootstrap/startup-config.ts:62, src/app/bootstrap/remote-application.ts:1462, src/app/bootstrap/demo-commands.ts:46
- Confidence: reproduced (validation and dump); traced (reload at next startup and deferred cvars)
- Evidence: Any registered name passes unless it is one of `["llm_ask", "llm_exec", "llm_cancel", "exec", "vstr", "alias", "bind", "stuffcmds", "cmd", "wait"]`. `validateLlmBatch` accepted each of these: `quit`, `connect evil.example.org`, `say hello`, `writeconfig config`, `set nextmap "exec evil.cfg"`, and `echo "bind w quit"; condump autoexec.cfg`.
  Executing the last batch with console output wired up produced `[["autoexec.cfg","bind w quit\n\n"]]`. `startup-config.ts:62` executes `autoexec.cfg` from that same seat directory on the next launch, so the batch installs commands the validator exists to forbid. Q2 appends `.txt` to `condump` names (`commands.ts:45`), so this particular route applies to Q1 and Q3. Cvars used as deferred commands bypass validation where they are registered: `remote-application.ts:1462` appends `nextmap` to the command buffer, and `demo-commands.ts:46` does the same for `nextdemo`/`nextserver`. `llm.ts:71-72` prints the batch and runs it immediately, with no confirmation.
- Impact: A hallucinated or manipulated model reply can disconnect the player, connect to another server, quit, overwrite config, or persist bindings across restarts, despite the stated rule of "no scripts, bindings, delays". The current prompt path limits who can steer the model (see PLATFORM-016), so this is not remote compromise.
- Remediation: Use an allow list of settings and safe commands, reject file-writing and connection commands and command-valued cvars, and add a confirmation step for anything else.

### PLATFORM-007 — Legacy credential migration keeps plaintext copies and imports provider settings from the working directory
- Severity: Medium
- Category: security
- Location: src/main.ts:55-62, src/llm/settings.ts:122, src/llm/settings.ts:132
- Confidence: reproduced (mode preservation); traced (rest)
- Evidence: `main.ts:56` selects `dirname(process.execPath)` for compiled builds and `process.cwd()` otherwise. `main.ts:59-60` then runs `copyFileSync(resolve(legacyLlmDirectory, name), resolve(llmDirectory, name), constants.COPYFILE_EXCL)` for `llm.json`, `chatgpt.key`, `other.key` and `other.service` on every launch. A test showed a 0644 source producing a 0644 destination. The source is never removed. `settings.ts:122` reads without checking permissions, and 0600 applies only on a later rewrite (`settings.ts:132`). `mkdirSync` at `main.ts:58` also sets no restrictive directory mode.
- Impact: Keys stay in plaintext beside the executable and can stay world-readable in the settings directory. Separately, on a machine with no existing settings, a game bundle or working directory containing `llm.json` and `other.service` silently selects an attacker's `other-api` base URL. Any key the user later pastes and every prompt then go to that URL.
- Remediation: Migrate only credentials, write them at 0600, delete the originals after success, and require explicit confirmation for any imported base URL. Tighten the mode of existing key files on load.

### PLATFORM-008 — `crash.log` is created with default permissions and records unredacted argv and output
- Severity: Medium
- Category: security
- Location: src/main.ts:13-22, src/console/log.ts:7
- Confidence: traced
- Evidence: `main.ts` calls `appendFileSync(resolve(directory, "crash.log"), ... argv=${JSON.stringify(argv)} ... --- recent output ---\n${tail}\n)` with no mode, in a directory created with no mode. With a typical umask that gives 0644. Nothing redacts `+set rcon_password ...`, `+set password ...`, or `mvd_password`, all of which are settable from the command line, and up to 32 KB of recent output is appended. `ConsoleLog` uses 0600 for the same class of data (`log.ts:7`), though it is unused (PLATFORM-028).
- Impact: Server passwords on the command line become readable by other local accounts, and they travel with any crash log a user attaches to a bug report. PLATFORM-001 through 004 make crash logs a routine event.
- Remediation: Create the file at 0600 and redact values following password-like cvar names in argv and output.

### PLATFORM-009 — A configured LLM provider receives billable requests at launch and game switch without user action
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** src/console/llm.ts:84, input.ts:698 and startup.ts:805 call primeLlmConsoleSession unprompted; session.ts:103-109 sends a real transport request. settings.ts:399 only checks configured provider and model. startup.ts:803 comments show this is deliberate warm-up, but no opt-in exists.
- Severity: Medium
- Category: security
- Location: src/console/llm.ts:84, src/app/bootstrap/input.ts:698, src/app/bootstrap/startup.ts:805, src/llm/session.ts:97-110, src/console/llm-batch.ts:83-85, src/llm/settings.ts:397-401
- Confidence: traced
- Evidence: `llm.ts:84` runs `void primeLlmConsoleSession(commands, requester)` at command registration. The bootstrap repeats this at `input.ts:698` and `startup.ts:805`. `session.ts:103-109` then sends a real request asking for "READY". The primer holds up to 48,000 characters of names plus 16,000 of documentation (`llm-batch.ts:83-84`). `session.ts:97` skips the warm-up only if the primer is byte-identical, so a new alias or cvar triggers another full turn on the next `llm_ask`. The only guard is that a provider and model are configured (`settings.ts:399`).
- Impact: Starting the game contacts a third-party or user-configured service, consumes paid tokens or subscription quota, and discloses the command catalog (including mod and alias names), even for a player who never uses the feature in that session.
- Remediation: Open the session on the first `llm_ask` or `llm_exec`, or make warm-up an explicit opt-in setting.

### PLATFORM-010 — The mixer has no voice limit, so a server's sound stream can stall the client
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** WQ sound.h:130 sets MAX_CHANNELS 128, and SND_PickChannel returns NULL when none can be stolen (snd_dma.c:384-385). Source review: SRCQ1
- Severity: Medium
- Category: performance
- Location: src/audio/mixer.ts:236, src/audio/mixer.ts:448, src/audio/mixer.ts:498, src/audio/mixer.ts:509, src/audio/mixer.ts:829-860, src/app/bootstrap/network/remote-q1.ts:211
- Confidence: reproduced (timing); traced (network path)
- Evidence: When no slot is free, `mixer.ts:509` extends the array: `const free = this.freeChannels.pop(), index = free ?? this.voices.length;`. The Q1 and Q2 originals drop sounds when channels run out; the comment at `mixer.ts:236` confirms this version grows instead. `startQ1Sound` has no per-entity limit, and `mixer.ts:498` adds an O(voices) scan per start. The array never shrinks, so every later block keeps scanning its high-water length. Each `svc_sound` becomes a play (`remote-q1.ts:211`). Measured with a 10-second sound and a 735-frame mix (the budget at 60 Hz is 16.7 ms):

  | Voices | Start all (ms) | One mix (ms) |
  |---|---|---|
  | 96 | 1.1 | 3.2 |
  | 1,000 | 4.0 | 10.0 |
  | 5,000 | 50.3 | 22.7 |
  | 20,000 | 935.7 | 88.6 |

- Impact: A malicious or buggy server sending many long sounds per packet reduces the client to very low frame rates for as long as the voices last. This also affects local content that spawns sounds heavily. The client slows rather than crashes.
- Remediation: Enforce a hard voice cap with source-style channel stealing, and compact the voice array when it drains.

### PLATFORM-011 — High-resolution scroll wheels fire a full key press for each fractional event
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** src/input/router.ts:202 forwards preciseY, and src/input/seat.ts:195 `for (count = 0; count < Math.abs(delta.y); count++)` runs once for any nonzero fraction. sdl.ts:413 decodes integer y, which the router ignores. Actual event sizes vary by device, as the finding says.
- Severity: Medium
- Category: bug
- Location: src/input/router.ts:202, src/input/seat.ts:193-198, src/platform/sdl.ts:413
- Confidence: reproduced (seat behavior); plausible (device event sizes vary by driver)
- Evidence: `router.ts:202` forwards `event.preciseY`, and `sdl.ts:413` also decodes the accumulated integer `y`, which the router ignores. `seat.ts:195` then runs `for (let count = 0; count < Math.abs(event.delta.y); count++)`, so any nonzero fraction gives one full press. Eight events of 0.125, which is one notch on a 120-units-per-notch wheel, produced 8 `weapnext` commands in a test.
- Impact: On hi-res mice and touchpads, one wheel notch cycles through several weapons, which makes default wheel weapon switching unusable.
- Remediation: Accumulate fractional delta per seat and emit one press per whole step, or use SDL's integer `y` for key presses.

### PLATFORM-012 — A failed controller open during hotplug is fatal
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** src/platform/controller.ts:305 calls discover on ADDED, and :270 `required(api.SDL_GameControllerOpen(index), ...)` throws on null with no per-device catch before the open. input.ts:764 and startup.ts:1363 iterate pollEvents with no catch. The failure trigger stays plausible, not observed.
- Severity: Medium
- Category: robustness
- Location: src/platform/controller.ts:270, src/platform/controller.ts:305, src/app/bootstrap/input.ts:764, src/app/bootstrap/startup.ts:1363
- Confidence: traced (propagation); plausible (trigger)
- Evidence: `controller.ts:305` handles the ADDED event by calling `this.discover(timestamp, instance)`. `controller.ts:270` then uses `required(api.SDL_GameControllerOpen(index), "SDL_GameControllerOpen")`, which throws on null. `pollEvents` is called in the frame paths at `input.ts:764` and `startup.ts:1363` without a catch.
- Impact: Plugging in a pad can end the session if the open fails at that moment, for example from a device-permission race with udev, an unplug during open, or a busy HID device.
- Remediation: Catch open failures per device in `discover`, print a warning and continue. Rescan on the next hotplug event.

### PLATFORM-013 — Cancellation does not stop a session warm-up inside a request
- **Verification (VERIFY-J): confirmed. Final severity: Low.** session.ts:56 awaits #primeNow with no signal, and :103-109 calls transport with no signal inside the serial queue. llm.ts:30-31 aborts and prints cancelled while the warm-up continues.
- Severity: Low
- Category: bug
- Location: src/llm/session.ts:56, src/llm/session.ts:103-109, src/console/llm.ts:30
- Confidence: traced
- Evidence: `session.ts:103` calls the transport with `{ prompt, instructions: primer, sessionId }` and no signal. `llm_cancel` prints "LLM request cancelled." at `llm.ts:31`, but the warm-up keeps running and holds the serial `#chain`.
- Impact: Tokens are still spent after cancellation, and later requests from any seat can wait up to the 120-second timeout.
- Remediation: Pass the request's signal into `#primeNow` when it runs inside a user request.

### PLATFORM-014 — A refresh response without a new `refresh_token` is treated as failure
- **Verification (VERIFY-J): confirmed. Final severity: Low.** auth.ts:74 requires nonempty(refresh_token) on all grants, and refreshSubscription (:168) reaches the same parser. `previous` is used for scopes but not for the refresh token.
- Severity: Low
- Category: bug
- Location: src/llm/auth.ts:74, src/llm/auth.ts:168
- Confidence: reproduced
- Evidence: `auth.ts:74` requires `nonempty(item["refresh_token"])` for refreshes too, though `previous` is available. A fake endpoint returning only `access_token` and `expires_in` gave `Subscription token request failed. Try signing in again.`. RFC 6749 section 6 makes a new refresh token optional.
- Impact: If the provider stops rotating on some responses, valid sessions would fail on every refresh. Current provider behavior was not tested.
- Remediation: Fall back to `previous.refreshToken` on the refresh grant.

### PLATFORM-015 — Any request to the OAuth callback with a wrong state aborts sign-in
- **Verification (VERIFY-J): confirmed. Final severity: Low.** auth-worker.ts:26-28 posts state-mismatch for any GET on the callback path, and auth.ts:120 rejects the login. No Host or Origin check exists. Denial only; the state check still blocks the credential.
- Severity: Low
- Category: security
- Location: src/llm/auth-worker.ts:26-28, src/llm/auth.ts:120
- Confidence: traced
- Evidence: `auth-worker.ts:27` posts `state-mismatch` for any GET to `/auth/callback` with a bad state, and `auth.ts:120` rejects the whole login. There is no origin or Host check.
- Impact: Any web page open during sign-in, or any local process, can cancel the login with a request to `http://localhost:1455/auth/callback`. This denies service only. The state and PKCE checks still protect the credential.
- Remediation: Answer the bad request with 400 and keep waiting until the timeout.

### PLATFORM-016 — Mod-controlled names reach the system prompt unescaped, and past turns are replayed as instructions
- **Verification (VERIFY-J): confirmed. Final severity: Low.** llm-batch.ts:82-85 joins names unescaped; commands/index.ts:512-515 checks alias name length only. session.ts:125-128 places prior turns in instructions, labelled as prior context. Alias length under 32 limits payload per name, but many names can be combined.
- Severity: Low
- Category: security
- Location: src/console/llm-batch.ts:82, src/console/llm-batch.ts:85, src/core/commands/index.ts:512-515, src/llm/session.ts:125-128
- Confidence: traced
- Evidence: `llm-batch.ts:82` builds the catalog with `entries.map(entry => `${entry.kind}:${entry.name}`).join(", ")`. Alias names are only limited to under 32 characters, with no character check (`index.ts:515`), and cvar names come from loaded mods. The text "documentation, not instructions" is the only barrier. `session.ts:125-128` also places earlier user and assistant text into `instructions`, the highest-trust field.
- Impact: A mod can place instruction-like text in the prompt and influence `llm_exec` output, which then reaches the commands in PLATFORM-006. I found no remote path, since stufftext is whitelisted. A mod that can do this can usually run its own cfg already, so the added capability is small.
- Remediation: Filter catalog names to a command-name character set, and send past turns as ordinary messages where the transport supports it.

### PLATFORM-017 — A malformed LLM settings file blocks repair through the UI
- **Verification (VERIFY-J): confirmed. Final severity: Low.** settings.ts:150,169,267,282 parse the existing file before writing, and parsePreferences (:66-71) throws on invalid or missing fields, so the replacing write never runs.
- Severity: Low
- Category: robustness
- Location: src/llm/settings.ts:150, src/llm/settings.ts:169, src/llm/settings.ts:267, src/llm/settings.ts:282
- Confidence: traced
- Evidence: Each mutation first parses the existing file, for example `const current = parsePreferences(await this.load("llm.json"));`. `saveApiKey` and `removeCredential` do the same with `parseChatgpt`. A parse failure throws before the write that would replace the file.
- Impact: After a hand edit, or a format change such as a missing `models` entry, selecting a provider or removing a credential keeps failing until the user finds and deletes the file manually.
- Remediation: Let explicit save and remove operations fall back to defaults when the existing file is invalid.

### PLATFORM-018 — An environment-set signal hint makes video and controller startup fail
- **Verification (VERIFY-J): confirmed. Final severity: Low.** sdl.ts:166-167 and controller.ts:93-94 throw on SDL_SetHint returning non-1, which SDL returns when the environment variable overrides at default priority. audio.ts:59-65 requiredHint already reads back the value.
- Severity: Low
- Category: bug
- Location: src/platform/sdl.ts:166-167, src/platform/controller.ts:93-94, src/platform/audio.ts:59-65
- Confidence: reproduced
- Evidence: With `SDL_NO_SIGNAL_HANDLERS=1` in the environment, `SDL_SetHint` returned 0 in a test; without it, 1. `sdl.ts:166` throws in that case: `if (api.SDL_SetHint(...) !== 1) throw new Error("SDL must leave signal handling to the Unix signal owner")`. `controller.ts:93` is identical. `audio.ts:59-65` already handles this by reading the hint back.
- Impact: The desired value is already set, yet the window fails to open and the controller provider fails.
- Remediation: Share `requiredHint` across the three modules.

### PLATFORM-019 — A large stdin burst crashes the dedicated server
- **Verification (VERIFY-J): confirmed. Final severity: Low.** dedicated.ts:30 calls EventRing.admit inside the data handler with a 16384-slot ring (:10), and event-ring.ts:93 throws when full. main.ts:35 handles it as uncaught. `pending` has no bound.
- Severity: Low
- Category: robustness
- Location: src/console/dedicated.ts:10, src/console/dedicated.ts:30, src/main.ts:35
- Confidence: reproduced
- Evidence: `dedicated.ts:30` calls `this.lines.admit(...)` inside a stream `data` handler, and `admit` throws when the 16,384-slot ring is full. Writing 20,000 newlines in one chunk gave `uncaught: Event ring capacity exhausted (16384 undrained records)`. In production that reaches the `uncaughtException` handler at `main.ts:35`, which exits. `pending` also has no length limit for input without a newline.
- Impact: Piping a large script or binary data into a server's stdin stops it. This needs local stdin access.
- Remediation: Use `append`, report dropped lines, and cap `pending`.

### PLATFORM-020 — Audio device removal is not handled
- **Verification (VERIFY-J): confirmed. Final severity: Low.** No handler for 0x1100/0x1101 in src; sdl.ts:419 decodes them as unsupported. engine.ts:547 has no error path. Whether the queue stops draining after removal is still untested and from memory SDL2 may keep consuming, but silence until restart holds in both cases.
- Severity: Low
- Category: robustness
- Location: src/platform/sdl.ts:419, src/audio/engine.ts:547
- Confidence: plausible
- Evidence: `grep` finds no handling of `SDL_AUDIODEVICEREMOVED` (0x1100 range) in src, and it decodes as `unsupported`. If the SDL2 queue stops draining after removal, `engine.ts:547` computes `frames = 0` indefinitely and no error is raised. I did not test a real unplug.
- Impact: Unplugging a selected USB headset may leave silence until `snd_restart` or a relaunch.
- Remediation: Handle the removal event and reopen on the default device.

### PLATFORM-021 — Temporary copies of Ogg files survive abnormal exit
- **Verification (VERIFY-J): confirmed. Final severity: Low.** streams.ts:49-60 writes to mkdtemp and removal occurs only in close (:70-77). /tmp currently holds 22 quake-audio entries.
- Severity: Low
- Category: leak
- Location: src/audio/streams.ts:49-60, src/audio/streams.ts:70-77
- Confidence: reproduced
- Evidence: `fromBytes` writes each archive Ogg to `mkdtempSync(join(tmpdir(), "quake-audio-"))`, and removal happens only in `close()`. This machine's `/tmp` holds `quake-audio-*` directories dated 2026-10-23 and 2026-10-25, plus one from my PLATFORM-002 test.
- Impact: Each crash can leave a full copy of the current music track in `/tmp`. On tmpfs that consumes RAM until reboot. The crashes above make this routine.
- Remediation: On POSIX, unlink the file immediately after `ov_fopen` succeeds.

### PLATFORM-022 — The mix path allocates per block and per sample on the game thread
- **Verification (VERIFY-J): confirmed. Final severity: Low.** mixer.ts:818, :826, :828 allocate per pump and block, :1003 builds a gain object per looped sample, :949 copies and filters voices. engine.ts:401-421 and streams.ts:177 allocate output arrays.
- Severity: Low
- Category: performance
- Location: src/audio/mixer.ts:818, src/audio/mixer.ts:826, src/audio/mixer.ts:828, src/audio/mixer.ts:1003, src/audio/engine.ts:401-406, src/audio/engine.ts:421, src/audio/streams.ts:177
- Confidence: traced
- Evidence: Each `pump` allocates new output and paint arrays and a `Set`. `mixer.ts:1003` builds `{ left: loop.leftVolume, right: loop.rightVolume }` for every looped sample unless the JIT removes it. `issueScheduledSounds` also copies and filters all voices per paint block (`mixer.ts:949`). A mix with 96 voices took 3.2 ms on first run (not a warmed benchmark).
- Impact: Steady GC pressure while audio runs. This is a contributor to frame jitter rather than a defect by itself.
- Remediation: Reuse scratch buffers across mixes and pass gains as numbers.

### PLATFORM-023 — Each screenshot rescans all earlier names with two syscalls per candidate
- **Verification (VERIFY-J): confirmed. Final severity: Low.** capture/index.ts:64-72 starts at index 0 with mkdir and open per candidate on every unnamed capture. bootstrap/capture.ts:92-93 sends cl_avidemo frames through screenshot with no name.
- Severity: Low
- Category: performance
- Location: src/capture/index.ts:64-72
- Confidence: traced
- Evidence: The loop runs `await mkdir(dirname(candidate), { recursive: true })` and then `open(candidate, "wx")` from `shot0000` for every capture. `cl_avidemo` uses this path for each frame through `capture.ts` `captureFrame`.
- Impact: Recording time per frame grows linearly with the number of existing files, so an avidemo session costs quadratic filesystem work. Output stops at `shot9999`.
- Remediation: Create the directory once and remember the last used index.

### PLATFORM-024 — The console rebuilds and sorts the whole catalog each frame while a completion is selected
- **Verification (VERIFY-J): confirmed. Final severity: Low.** session.ts:40-43 getter calls queryConsoleEntries, and discovery.ts:21-31 builds and sorts the full catalog. presentation.ts:511 reads it in the console draw path. It applies only while the console is drawn with a selected completion.
- Severity: Low
- Category: performance
- Location: src/console/session.ts:40-43, src/console/discovery.ts:21-31, src/app/bootstrap/presentation.ts:511
- Confidence: traced
- Evidence: `selectedCompletionEntry` calls `queryConsoleEntries(...).find(...)`. That builds a map of all commands, aliases and cvars and sorts it, and it runs in the per-frame draw options at `presentation.ts:511`. I did not time it.
- Impact: Extra frame time and garbage while a tab completion remains highlighted.
- Remediation: Cache the selected entry when the completion changes.

### PLATFORM-025 — Each mouse-motion event repeats native size queries and capture checks
- **Verification (VERIFY-J): confirmed. Final severity: Low.** router.ts:198 calls pointerPosition per motion event regardless of relative mode; router.ts:175 reads two sizes, each allocating Int32Arrays and calling FFI (sdl.ts:638-644, 792-805). :205 updateCapture reaches sdl.ts:772 this.relativeMouse, another FFI call. sdl.ts:816 peeks one event per call.
- Severity: Low
- Category: performance
- Location: src/input/router.ts:173-177, src/input/router.ts:198, src/input/router.ts:205, src/platform/sdl.ts:638-644, src/platform/sdl.ts:792-805
- Confidence: traced
- Evidence: Each motion event calls `pointerPosition`, which calls `logicalSize` and `drawableSize`. Each of those allocates two `Int32Array`s and makes an FFI call, even in relative mode where the position is unused. `updateCapture` then adds another FFI call per event through `relativeMouse`. Events are also fetched with one `SDL_PeepEvents` call each (`sdl.ts:816`).
- Impact: Input cost scales with mouse polling rate. An 8 kHz mouse produces over 100 of these per frame at 60 Hz. I did not measure the total.
- Remediation: Cache window sizes until a resize event and update capture once per pump.

### PLATFORM-026 — Codex access relies on another client's identity and a private endpoint
- **Verification (VERIFY-J): confirmed. Final severity: Info.** auth.ts:5,140, codex.ts:30-35 and models.ts:131-132 hold the fixed client ID, originator pi, private endpoint and pinned client_version. Terms not assessed.
- Severity: Info
- Category: maintainability
- Location: src/llm/auth.ts:5, src/llm/auth.ts:140, src/llm/codex.ts:30-35, src/llm/models.ts:131-132
- Confidence: traced
- Evidence: The sign-in uses a fixed `CLIENT_ID`, `originator: "pi"` and `"User-Agent": `pi (...)``, calls `chatgpt.com/backend-api/codex/responses`, and pins `client_version=0.162.1`. The code comment says the backend hides newer models from older clients.
- Impact: The feature can break without notice, and using this identity may conflict with the provider's terms. I did not assess the terms; this needs a project decision.
- Remediation: Make the dependency explicit in the docs, and confirm whether a registered client is available.

### PLATFORM-027 — Three native parsers handle downloadable content in process
- **Verification (VERIFY-J): confirmed. Final severity: Info.** freetype.ts:112, theora.ts:50,77 and vorbis.ts:82 pass content to system libraries in process. No version check found at those sites.
- Severity: Info
- Category: security
- Location: src/platform/freetype.ts:112, src/platform/theora.ts:50, src/platform/theora.ts:77, src/platform/vorbis.ts:82
- Confidence: traced
- Evidence: Font, Ogv and Ogg bytes from mounted content are handed to system FreeType, libtheora and libvorbisfile in the game process. Bindings check results and bound copies, but parser memory safety depends on the installed library versions, which are not checked.
- Impact: A parser vulnerability in an outdated system library would run inside the game when it loads third-party content. I found no specific flaw.
- Remediation: Document minimum library versions and consider checking them at load.

### PLATFORM-028 — Unused and untested code remains in audio and console modules
- **Verification (VERIFY-J): confirmed. Final severity: Low.** Word grep matches the finding for all listed symbols; bindSoundMemory appears only in tests/audio/playback.test.ts, and only writeLinearBlastStereo16 is imported from source-paint.ts (mixer.ts:17). adpcm, wavelet and source-paint total 641 lines.
- Severity: Low
- Category: dead-code
- Location: src/console/log.ts:4, src/audio/adpcm.ts, src/audio/wavelet.ts, src/audio/source-paint.ts:5-212, src/audio/mixer.ts:308, src/audio/mixer.ts:717, src/audio/mixer.ts:796
- Confidence: traced
- Evidence: `grep` across src and tests:
  - No importers outside their own file, and no tests: `ConsoleLog`, `SourceCompressedPainter`, `encodeAdpcmSound`, `adpcmMemoryNeeded`, `resampleSoundRaw`, `transferPaintBuffer`, `byteSwapRawSamples`.
  - `SourceWaveletCodec` is used only by that dead painter, with no tests.
  - `queueRawBytes`, `queueMusic` and `getRawSamplePointer` have no callers.
  - `bindSoundMemory` is called only from one test, so the `soundMemory` branches throughout the mixer never run in production.
  - From `source-paint.ts`, production uses only `writeLinearBlastStereo16`.
- Impact: About 640 lines across adpcm, wavelet and source-paint, plus mixer branches, add reading and review cost with no effect. The mixer's dual code paths make its behavior harder to reason about.
- Remediation: Delete the unused modules and branches, or wire them in with tests if they are planned.

### PLATFORM-029 — Tests miss the highest-risk failure paths in this scope
- **Verification (VERIFY-J): confirmed. Final severity: Low.** tests/console/llm.test.ts has 0 condump/writeconfig hits, no test mentions OV_HOLE, and round-reset.test.ts:24 uses maxActors 3 for reset behaviour. condump is exercised elsewhere (tests/capture/application.test.ts:89) but not as an LLM rejection.
- Severity: Low
- Category: test-gap
- Location: tests/console/llm.test.ts, tests/audio/round-reset.test.ts:24
- Confidence: traced
- Evidence: `tests/console/llm.test.ts` has 0 occurrences of `condump` or `writeconfig`, and its rejection cases cover only the listed indirect commands. `round-reset.test.ts:24` exercises `maxActors: 3` for reset behavior, not growth from generation churn over time. I did not find tests for `OV_HOLE`, a fatal command error reaching the main loop, or refresh cancellation after the server rotates a token. This list comes from targeted searches, not a full read of the test tree.
- Impact: PLATFORM-001 through 006 could regress, or remain, without any test failing.
- Remediation: Add regression tests alongside the fixes for those findings.
