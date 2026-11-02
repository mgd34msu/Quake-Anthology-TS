# Native interposition investigation — can a native Quake II world honor foreign movement, character, enemies, and time?

**Question.** When the world is run by an original Quake II game DLL
(`gamex86.dll` classic / `game_x64.dll` rerelease) instead of by the
TypeScript Q2 game, can the player's *other* selections — a foreign
movement provider, a foreign character, foreign enemies — still take
effect by interposing at the guest ABI boundary, with the DLL itself
continuing to execute? Or does the system today collapse into one of the
two forbidden outcomes: **silently ignoring the selection** (launch
succeeds, selection does nothing) or **refusing the launch** (selection
rejected up front)?

**Headline answer.** On committed HEAD the answer is launch refusal:
foreign selection on a native world cannot start at all. On the current
uncommitted dirty tree the refusal is lifted and a genuine foreign-movement
seam exists at the `Pmove` boundary — the DLL still runs `ClientThink` and
`RunFrame` around a TypeScript-stepped movement slice whose result is
copied back through the real `pmove_t` struct — but it is measured broken
(the player sticks at a door), covers movement only, and leaves foreign
character and foreign enemies admitted but silently ignored. Under the
brief's own criteria, native + foreign is therefore **not chemically real
as shipped**, **partial as a dirty movement-only experiment**, and
**not real for character, enemies, save/restore, and time**. The rest of
this report proves that sentence slice by slice and states the exact
mechanism that would be required to make it true without either collapse.

Two ground rules govern every claim below.

*Channel symmetry.* Where the brief requires a channel to be symmetric
(guest can read what the host writes and vice versa, actor projection
works in both directions, time is quotable on both sides of a call), this
report states the symmetry as a *requirement*. It claims a current
asymmetry only where code proves a one-directional mechanism (a write with
no read path, a projection with no counterpart file, a clock with no
getter). Symmetry must never itself be cited as evidence of asymmetry.

*No invented baseline.* Several names in the brief — `docs/canon.md`,
`src/engine/`, `Q2NativeSurface`, `CommandBuffers`,
`runFrameGameImports`, `actors.createSpawn`, Forward→Slice / FromT
projections, an audience/IAM catalog — do not exist in this tree, proved
by `ls` and grep in multiple independent passes (directory absence is
proven; the *string* `src/engine` does occur as donor-path text in
`docs/comparison-q3.md:30,42` and a fixture literal in
`tests/policy/type-policy.test.ts:255`, which is not a real directory).
Where the brief assumes them, this report maps the brief row to the
mechanism the code actually demonstrates and flags the contradiction,
rather than grading the code against a type it never had.

## 0. Basis — what was measured on which tree

All findings split across two trees, and confusing them is the single
easiest way to misread this report.

Committed HEAD is `fbabc9a2516a99c188da2b9e9e82662928a89040`
("Shared CTF plays on every world, QuakeWorld included"). The working
tree carries an uncommitted experiment on top of it: 8 modified files
(+239/−25) — `src/app/bootstrap/content.ts`,
`src/app/bootstrap/simulation/{classic,rerelease}-guest-services.ts`,
`src/app/bootstrap/simulation/runtime.ts`,
`src/compat/q2/classic/host.ts`, `src/compat/q2/native-input.ts`,
`src/movement/q1/netquake.ts`,
`tests/compat/q2/rerelease/native.test.ts` — plus one untracked file,
`src/app/bootstrap/simulation/native-commands.ts`. Nothing is staged.

Everything said below about *gate lifts* and *pmove interposition*
describes that dirty experiment unless explicitly marked HEAD. Everything
said about the guest host, dict layouts, domain model, character actors,
and monster admission describes HEAD, because those files are clean
(`git diff --name-only HEAD` is empty for `src/contracts/*`,
`src/content/catalog/*`, `src/core/*`, `src/world/*`,
`src/persistence/recipe.ts`, `players.ts`, `player-userinfo.ts`, and
the TS Q2 player module). Line numbers for `runtime.ts` and the other
dirty files are working-tree numbers; all other line numbers are HEAD
numbers. Where a child verified a HEAD body via `git show HEAD:...`,
that is noted.

Evidence strength also splits. Static claims (gates, layouts, host
wiring, absence proofs) were verified by reading full bodies and by
`git show`/`git diff`, redundantly across children, and the dirty tree
passes `bun run typecheck` (`tsc --noEmit`, exit 0) — it compiles, which
proves nothing about correctness. Dynamic claims rest on one empirical
probe (Section 10) run on the dirty tree, classic DLL only, single run,
plus classic compat tests passing with and without the qfiles corpus
(`QTS_TEST_CORPUS=/home/buzzkill/Projects/qfiles`, actual-DLL tests
pass with corpus; without corpus 10 pass / 8 skip / 0 fail). No child
ran a HEAD launch (that would require stashing the dirty tree), no
child ran a rerelease foreign-movement lane, and no child ran the dual
native-vs-TS trajectory comparison the brief's JSON claim requires.
Those gaps are preserved as gaps in Section 13, not smoothed over.

A provenance note the synthesis must not hide: the workflow host flagged
every prior lane "incomplete or unusable," yet the handoff index shows
every prior result `complete:true` via `submit_result` with dense,
mutually consistent evidence. This report trusts the inspected evidence
bodies (each carries file:line citations checkable in the tree) and
treats the host flags as an uninspectable host-side signal. Where
children disagree in emphasis, the conflict is kept visible (Section 13)
rather than averaged away.

## 1. The native provider / guest ABI host, end to end

This section describes how an original DLL world actually runs today, at
HEAD, before any foreign interposition is considered. The point to hold
in mind throughout: **the original DLL machine code genuinely executes**
— on an emulated CPU, in sparse guest memory — and the host is already,
at HEAD, the engine. Interposition is therefore not "TS instead of DLL";
it is a question of what the host does at specific engine-import and
export-entry boundaries while the DLL's `ClientThink`/`RunFrame` keep
running around them.

### 1.1 DLL selection and loading — emulated CPU, not dlopen

Catalog builtins declare the artifact as inventory metadata:
`src/content/catalog/products.ts:42-55` gives `q2-classic-{baseq2,
xatrix,rogue,ctf,lmctf,mg2,n64}` `requiredPrograms:['gamex86.dll']`
and the rerelease family `['game_x64.dll']`. That declaration does not
by itself force native execution (Section 2.1). When native *is*
selected, the classic lane constructs the guest in
`src/app/bootstrap/simulation/classic-guest-source.ts:22-31`
(`prepareClassicGuest`: requires role `server-game`, API
`q2-classic-game` v3, profile `windows-i386`, PE ABI check, optional
native-compatibility primary validation) and
`ClassicGuestSource.create:53-84` builds a `SparseGuestMemory`
(pointerBytes 4), maps the PE image, allocates a 1 MiB stack and a
16-byte return trampoline, creates an `I386Cpu` (emulated x86 — not an
OS `dlopen`), a `GuestCallRunner` (`src/guest/abi/runner.ts:68`,
default instruction budget 5,000,000, ×10 for `SpawnEntities`/save),
initializes the Windows guest runtime (`DllMain`/TLS), resolves the PE
export `GetGameAPI`, and calls `host.getGameApi(game)` *before* `Init`.
The rerelease lane is the x64 mirror (`q2-rerelease-game` v2023,
`windows-x86-64`, pe32+/microsoft-x64). In both lanes the bytes that
execute for `Init`, `SpawnEntities`, `ClientThink`, and `RunFrame` are
the original DLL's bytes, interpreted by the TS CPU. Any verdict below
about "TS swap" must be read against that fact: swapping one host
function is not swapping the guest.

### 1.2 Memory — the borrow is a live alias

The host–guest memory bridge is `SparseGuestMemory`
(`src/guest/core/memory.ts:75`). Its `borrow(address,len):237-243`
requires contiguous write-permission chunks (else
`GuestMemoryFault` noncontiguous-borrow), marks the mapping exposed,
and returns `new DataView(bytes.buffer, ...)` — a *live zero-copy alias*
of the backing `Uint8Array`. Mutations through the view are instantly
visible to guest CPU reads; there is no revocation (the code comments
that `DataView` cannot revoke access, so owners must retire views
before unmap/protect). Ordinary `write/fill/move:398-438` go through
write-observers and code invalidation; **borrow writes bypass those
observers** (exposed pages fall back to byte comparison in
`retainExecutableRange:355`). Every edict, client, and `pmove_t` access
below goes through a borrow. The consequence for interposition is
double-edged and central to this report: copying a foreign result back
*requires* writing through a borrow into a guest-allocated struct —
there is no other return channel — so a brief purity rule forbidding
host struct writes would forbid the only mechanism that can work
(Section 11).

### 1.3 The classic host — game_import_t as the real "surface"

`ClassicQ2GuestHost` (`src/compat/q2/classic/host.ts:119-132`) requires
pointerBytes 4, allocates the 176-byte `game_import_t`
(`CLASSIC_Q2_IMPORT_BYTES`, `src/compat/q2/classic/layout.ts:14`), and
binds all 44 `CLASSIC_Q2_IMPORTS` entries (`layout.ts:96-136`) as guest
callbacks with ids `${provider}:api3.<name>`. `getGameApi:149-161`
invokes the DLL's `GetGameAPI(imports)` (cdecl, windows-i386,
`layout.ts:6`), validates every export pointer in
`CLASSIC_Q2_EXPORTS` (`layout.ts:137-146`: `Init`@4, `Shutdown`@8,
`SpawnEntities`@12, `WriteGame`@16, `ReadGame`@20, `WriteLevel`@24,
`ReadLevel`@28, `ClientConnect`@32, `ClientBegin`@36,
`ClientUserinfoChanged`@40, `ClientDisconnect`@44, `ClientCommand`@48,
`ClientThink`@52, `RunFrame`@56, `ServerCommand`@60) as non-null and
executable, and constructs `ClassicQ2Edicts`. Every initialized
non-`Shutdown` export call is wrapped (`call:162-172`): cvars refresh,
invoke, then `edicts.reconcile()` (Section 1.5). An `importBoundary`
hook (`host.ts:50,128`) can wrap every import — this, plus the
rerelease `interceptImport`/`importBoundary`
(`src/compat/q2/rerelease/host.ts:71-88`), is the interposition hook
that actually exists. There is no `Q2NativeSurface` type; the
in-memory function-pointer table *is* the surface.

`importCall` dispatch (`host.ts:313-395`) is honest engine semantics:
printf family (`error` throws), `TagMalloc/TagFree/FreeTags`,
`cvar/cvar_set/cvar_forceset`, configstring/resource indexing, sound,
`pointcontents/inPVS/inPHS/SetAreaPortalState/AreasConnected`,
`setmodel` (writes modelindex at edict+40, inline `*N` bounds to
+188/+200, then links), `linkentity/unlinkentity`, `BoxEdicts` (validates
area kind, writes edict pointers to the guest array, returns count),
`trace` (returns a 56-byte aggregate via `traceBytes:396-418`, with a
host-allocated cached 24-byte `csurface_t`), `Pmove`
(`host.ts:385`, Section 1.7), command args, and message writes; anything
else throws Unsupported. `linkEntity:419-450` mirrors original
`SV_LinkEdict`: it packs `s.solid` at +72, writes `absmin`+212 /
`absmax`+224 / `size`+236 (float-rounded), cluster/headnode/area fields,
increments `linkcount`+92, then registers solidity with the shared
scene. These writes are what a real Q2 engine does; they are the
baseline against which "extra" host mutations (Section 1.9) are judged.

### 1.4 The rerelease host — same shape, opposite Pmove direction

The rerelease host (`src/compat/q2/rerelease/host.ts:91`,
`RereleaseQ2GuestHost{module,core,foreignActors}:111-135`) mirrors the
classic host through `RereleaseCoreServices`/spatial services and
`RereleaseSemanticBindings` (`host.ts:40-46,60`: `bind()` returning
body/combat/powerArmorCells/inventory/callbacks, and
`foreignAddress(actor)`). Its struct layouts are computed, not
hardcoded: `src/compat/q2/rerelease/layouts.ts:17-45` (`structure()`)
computes Win-x64 packing and *flattens* nested layouts into dotted
fields, so `fieldOffset(pmoveLayout,'touch.touches[i].ent')` and
`'s.pm_flags'` resolve; `layouts.ts:53-56` defines `pmoveStateLayout`
and the full `pmoveLayout` (state, cmd, snapinitial, touch list of 32
traces, viewangles, mins/maxs, groundentity, groundplane,
watertype/waterlevel, player, trace/clip/pointcontents callbacks,
viewoffset, blend, rdflags, jump/step/impact fields). Private layouts
(`layouts.ts:63-83`) deliberately expose only a source-proven prefix;
the rest is opaque via runtime stride. That prefix-only discipline
recurs everywhere: `src/compat/q2/rerelease/public-state.ts:27-28`
states "API2023 published prefix only; no g_local.h private members,"
and its `body():50-61` hardcodes `ground:null` (line 59) because true
groundentity is guest-private and HEAD cannot report it. The dirty tree
approximates ground as the world actor when `pm_flags & 4`
(`rerelease-guest-services.ts:204-214`, classic equivalent) — an
approximation, not a read of the private field.

The decisive asymmetry between the two editions is `Pmove` direction.
Classic: `Pmove` is an engine *import* (`layout.ts:118`) with no
corresponding export (`layout.ts:137-146`) — classic DLLs call *out*
to the engine to move. Rerelease: `Pmove` is a game *export*
(`src/compat/q2/rerelease/module.ts:169-201`,
`bindInputMovement` resolving the exported `Pmove` entry and wrapping
it with `bindNativeModEntry`, dispatching at line 197 as
`active() ? boundary(movement, run) : run()`). The brief's
single-boundary model is therefore wrong in a way that matters:
replacing classic `Pmove` replaces host code the DLL never owned;
skipping rerelease `Pmove` skips a DLL function. Section 6.2 grades
them differently for exactly this reason.

### 1.5 Edicts, clients, and reconcile — identity without minting

`ClassicQ2Edicts` (`src/compat/q2/classic/records.ts:60-155`,
`layout.ts:8-14,36-69`) reads the edict array base (exports+64), stride
(exports+68, ≥260, %4==0), counts (≤65536), and requires API version 3.
`at(slot)` borrows the *full private stride* (e.g. 896 bytes for Xatrix),
not just the 260-byte public prefix (`CLASSIC_Q2_EDICT_BYTES=260`;
`PLAYER_STATE=184`, `CLIENT_PREFIX=188`, `PMOVE=240`, `EXPORT=80`,
`USERCMD=16`). Public edict offsets include origin+4, angles+16,
modelindex+40, frame+56, skinnum+60, solid+72, client*+84, inuse+88,
svflags+184, mins+188, maxs+200, absmin+212, absmax+224, clipmask+252,
owner*+256; bytes 260..stride are DLL-private (health+480,
velocity+376, flags+264, pain/die entries in the qualified profile).
`clientPrefix(slot)` borrows 188 bytes at `*(edict+84)`: `pm_type`@0,
pmove origin int16[3]@4, velocity int16[3]@10, `pm_flags`@16,
`pm_time`@17, gravity@18, delta_angles@20, viewangles@28,
viewoffset@40, gun fields, stats int16[32]@120, ping@184.

After every guest call, `reconcile:142-151` scans every slot: `inuse`
clear and not retained releases the actor; otherwise it allocates at
source and binds the record to a canonical actor. Canonical identity
itself lives host-side and is never minted by a projection:
`src/contracts/identity.ts:11-20` (`ActorIdentity{session,slot,
generation}` with token equality), `createIdentityOwner:73-94` as sole
mint, and `src/world/actors/registry.ts:59-119`
(`allocate`/`allocateAtSource`/`atSource`/`sourceOf`/`release`, with
exactly one source binding per actor — `Slot.source` is scalar). Guest
hosts call `allocateAtSource(module.id, guestSlot)` (rerelease
`host.ts:168`, classic `records.ts:124`). This is the identity
machinery Section 6.4 stress-tests: projections are maps keyed by the
canonical id, so reprojection does not drift the id — but the scalar
source slot means an actor born in DLL A cannot be source-born in
DLL B; B gets a projection entry only, and provider-checked paths
reject it. Finite guest slots (`src/world/actors/source-slots.ts:
47-96`, with cooldown reuse and fatal exhaustion) bound simultaneous
projections. Both facts are code-proven one-directional limits, not
inferences from a symmetry requirement.

### 1.6 Guest services, lifecycle, and the frame loop

Host services facing the DLL are `ClassicGuestServices`
(`src/app/bootstrap/simulation/classic-guest-services.ts:57`) and
`RereleaseGuestServices`
(`src/app/bootstrap/simulation/rerelease-guest-services.ts:34-46`,
whose comment states the contract exactly: "Public API2023 imports
borrow shared engine while source RunFrame owns gameplay"). The classic
constructor builds `ClassicQ2EngineServices`
(`src/compat/q2/classic/host.ts:27-48`: `engine` as
`Pick<Q2FoundationHost,...>`, cvars, `bindEntity`, print/configstring/
resource/sound, areas, `worldLink`, `boxEdicts` via scene query,
messages/commands, and `pmove`). `bindHost:133-139` creates the combat
and inventory bindings (Section 1.8). `body(record):207-220` reads
origin/angles/bounds from the edict borrow (velocity from in-slice
input motion, else the client prefix int16 values ×0.125), and at HEAD
always reports `ground:null`. `bindEntity:221-237` binds a body whose
`write` either writes through in-slice motion or — for a velocity
change outside a slice — requires a source-semantic velocity writer,
throwing "API3 velocity writes require source semantic binding"
otherwise; it always stores angles+16 and bounds+188/200, stores
origin+4 only when no motion is active, then binds qualified combat
and admits the entity. `linkBody:238-247` registers collision contents
and restores link state. Presentation helpers read the same borrows:
`playerState:328-335`, `playerView:152-161`, `playerGrounded:150`
(`pm_flags & 4`), `entityState:322-327`, `publishEntities:349-359`,
and `modelAppearance:336-348` (Section 6.1). The rerelease services
mirror this (`bindEntity:215-228` with callbacks all `null`;
`playerGrounded/playerView:118-133`; `appearance/publishEntities:
256-273`), including the null-callbacks fact that becomes decisive for
enemies (Section 6.4): guest thinks/touches never enter the shared
`ActorCallbackTable` (`src/world/actors/callbacks.ts:13-60`).

World lifecycle is `ClassicGuestWorld`
(`src/app/bootstrap/simulation/classic-guest-world.ts:24`):
`create:56-69` (guest creation with `GetGameAPI` inside, then
`bindHost`), `init:85-87` (`Init` + reconcile), `spawn:94-101`
(`SpawnEntities` at `host.ts:183-193` with ×10 instruction budget,
then two `RunFrame`s), `connect/begin:190-204`
(`ClientConnect` with a 516-byte mutable userinfo buffer, retain,
`ClientBegin`), `think:230-232`
(`services.withPlayerMovement(movement, host.clientThink(slot, cmd))`
with a 16-byte usercmd: msec@0, buttons@1, angle shorts@2/4/6,
forward@8, side@10, up@12, impulse@14, light@15), `frame(ms):233-238`
(requires `ms===100` exactly, then `RunFrame` + publish), travel/
revisit (`126-157`: rebind edicts, re-spawn, `ReadLevel` path with 100
`RunFrame`s), and close (`Shutdown` + detach + unmap all). The
rerelease world is parallel, with `frame()` requiring exactly the
configured frame milliseconds (validated divisor of 1000,
`rerelease-guest-services.ts:70`; compat default 25 ms,
`src/compat/q2/rerelease/module.ts:82`) and userinfo buffers of 2048
bytes (`rerelease-guest-world.ts:156-192`).

The runtime frame loop that drives all this is `nativeQ2Frames` in
`src/app/bootstrap/simulation/runtime.ts:6408-6453` (via
`stepNativeQ2:6383` / `stepNativeQ2Async:6391`; `q2-native`
short-circuits `step()` at `:4494` and never touches `playerStates`).
Phase 1, per input-batch command and *before* any `RunFrame`: compute
equipment/grapple/pose/speed, gate the attack bit if the primary is
not selected, and call `source.game.think(slot, localCommand,
movement)` — i.e. DLL `ClientThink`. The local-command conversion
(`classic-guest-player.ts:40-46`) subtracts `delta_angles`
(`angleShorts = (angles − delta) & 65535`) because the DLL re-adds
them, and throws unless the command kind is `q2-classic`. Phase 2:
accumulate host milliseconds and, while a full guest frame is due,
**advance the host clock first** (`clock.advance(0.1s)`), then call
`source.game.frame(100)` (`RunFrame`), yielding 100 ms. Two orderings
to remember for Section 6.3: `ClientThink` runs at pre-advance host
time, and the host clock advances *before* `RunFrame` — while guest
`level.time` advances *inside* the DLL, unreadable by the host.

Monster and item spawning fall out of this lifecycle without host
help: `SpawnEntities` runs the DLL's own spawn functions over the map
entity string inside the guest, self-allocating edicts that the host
then observes via reconcile/`allocateAtSource`. The host does not
spawn monsters into a native world; it discovers them. That sentence
is the whole enemies problem in miniature (Sections 5.4, 8).

### 1.7 Physics and Pmove at HEAD

At HEAD, classic `gi.Pmove` is TypeScript and always was: the DLL
never contained it. `runClassicGuestPmove`
(`src/compat/q2/classic/pmove.ts:16-130`) borrows the 240-byte
`pmove_t` (state: `pm_type`@0, origin int16[3]@4, velocity int16[3]@10,
`pm_flags`@16, `pm_time`@17, gravity@18, delta_angles@20; cmd:
msec@28, buttons@29, angles@30, forward@36, side@38, up@40,
impulse@42, light@43; snapinitial@44, numtouch@48, touchents@52..179,
viewangles@180, viewheight@192, mins@196, maxs@208,
groundentity*@220, watertype@224, waterlevel@228, trace*@232,
pointcontents*@236), requires the trace/contents callbacks non-null,
applies equipment pre-mutations (gravity ×scale, prediction-suppressed
flag bit 64, velocity override), then runs TS `pmoveClassic`
(`pmove.ts:121`, from `src/movement/q2/classic.ts`) with the selected
numeric profile and `sv_airaccelerate`. Crucially, the guest's own
trace/pointcontents callbacks are invoked *synchronously mid-move*:
`commit()` first writes the full state back to the struct
(`pmove.ts:60-67`), `host.invoke` re-enters the DLL trace function on
the guest stack, then `reload()` (`:68-79`) re-reads the struct
because the callback may have mutated it. Equipment pose forces
`PM_FREEZE` with zero velocity and restores type/viewheight/bounds/
ducked afterward. Quantization is intrinsic: origin and velocity are
stored as int16 eighths (value×8 truncated, read ×0.125 — a 1/8-unit
quantum), angles as int16 (65536/360°), `pm_time` as uint8 8 ms units.

Rerelease at HEAD is the mirror image: `NativeInputBinding`
(`src/compat/q2/native-input.ts:79-118`) wraps the DLL `ClientThink`
export via `bindNativeModEntry`, and the module wraps the DLL `Pmove`
export (`module.ts:169-201`). At HEAD the movement boundary, when
consulted at all, always executes `run()` — the original DLL `Pmove`
— with at most equipment patching around it (Section 5). HEAD
`movement()` even early-outs with
`if(!applications.active) return runBody` when no mod-client
application is active, so the projection is never built. In other
words: HEAD foreign movement is not "ignored at the Pmove seam"; it is
*unreachable* — the gates of Section 2 refuse the launch, and the seam
itself has no path that steps a foreign provider.

### 1.8 Combat and inventory compliance, including black-box mode

Deep guest-state sharing (health, armor, damage, inventory) is
*profile-gated by DLL digest*, and the unqualified case is a deliberate
black box. `classicCombatProfile(digest)`
(`src/compat/q2/classic/combat-profile.ts:94-98`) returns a profile
only for two Xatrix digests (`sha256:8187df3f...`,
`sha256:0b0d119e...`); everything else returns `null`.
`ClassicCombatBindings.create`
(`src/compat/q2/classic/combat-binding.ts:41-51`) returns `null` on a
null profile — no combat binding at all, so the shared
`GameplayAuthority` (`src/world/gameplay/authority.ts:53-81`) holds no
state for that actor and the DLL keeps health/armor/damage fully
private in edict/client bytes the host never decodes. Digest mismatch
throws. `ClassicSourceInventory.create`
(`src/compat/q2/classic/inventory.ts:19-50`) behaves identically
(null without profile; else item-table parsing with inventory
read/write at `client+inventory+index*4`). `hasSourceInventory` is
simply `#inventory!==null` (`classic-guest-services.ts:171`).

When qualified, the binding is rich but narrow: it requires stride
exactly 896 (`combat-binding.ts:75-113`), reads/writes health and
armor at profile offsets, derives team from userinfo skin + dmflags,
and implements `sourceDamage` by *invoking the guest's own `T_Damage`
entry RVA* with lowered arguments (`:212-277`) — foreign attackers are
projected by spawning a real temporary guest edict via the guest's
`G_Spawn` entry (writing origin/angles/bounds/velocity), freed via
`G_FreeEdict` afterward, with write-observers capturing what the DLL
did to health/velocity/inventory. Damage/armor entry hooks
(`:140-195`) interpose only during a composed combat operation. The
rerelease side has the qualified counterpart
(`RereleaseCombatBindings`) plus `RereleaseForeignActors`
(`src/compat/q2/rerelease/foreign-actors.ts:33-34`, Section 6.4),
which exists only when `foreignDamage+nativeEntries` are supplied
(`src/compat/q2/rerelease/host.ts:125-126`); otherwise the default
`foreignAddress` *throws* "requires a semantic projection extension"
(`rerelease-guest-services.ts:82`), and classic `pointer()` throws
"Foreign actor requires an explicit native semantic edict adapter"
(`records.ts:106-111`). The compliance rule of the whole system is
therefore: **public ABI fields are shared unconditionally; private
fields are shared only under a digest-qualified profile; otherwise
the guest is authoritative and opaque.** Any interposition design
that needs private fields on an unqualified DLL fails by construction
— a constraint the dirty experiment collides with head-on (mirrored
combat, Section 6.2).

### 1.9 Frame state shape — in memory vs on disk

One running native frame, in memory, is `SparseGuestMemory` mappings
(PE image sections including globals and the item table, 1 MiB stack,
176-byte imports, `TagMalloc` allocations, the edict array at
exports+64 sized count×stride, per-client allocations, plus transient
16-byte usercmd / 516-byte userinfo / string allocations freed per
call). The 240-byte `pmove_t` lives *inside* the guest (on its stack
or in globals during `ClientThink → P_ClientThink`); only its address
crosses to `gi.Pmove`. Host-side mirroring is deliberately thin:
`SharedBodyTable` (`src/world/actors/body.ts:53`, `bind:79` external
vs `create:93` local) holds read/write closures over the borrows, the
registry holds slot↔actor maps, and the scene holds collision. The
per-command sequence is: `ClientThink` fills `pmove_t` from the client
prefix (already int16 eighths), calls `gi.Pmove` (HEAD classic:
`pmoveClassic` with the commit/invoke-trace/reload loop; dirty
foreign: `MovementPlayer.move`, Section 6.2), the struct is written
back, the DLL copies state to edict+4/+188/200, processes touchents,
links, thinks weapons; the host reconciles; later `RunFrame` advances
monsters/physics through the same import table; reconcile again;
`publishEntities` snapshots from borrows.

On disk the two editions diverge completely, and no child covered both
until the critic pass assembled them — a concrete coverage gap this
report preserves. Classic on-disk state is *opaque DLL files*:
`classic-guest-world.ts:277-278` (`writeOriginal() → host.save
('WriteGame'/'WriteLevel')`, `host.ts:302-305`), restored via
`ReadGame + SpawnEntities + 2×RunFrame + ReadLevel:281-290` with
`.sv2` metadata noted at `:271`; the emitted bytes are guest-binary
output with no TS layout in the repo, so an exact classic on-disk
frame layout cannot be stated from TS bodies. Rerelease on-disk state
is *DLL JSON inside a TS envelope*:
`native-q2-rerelease-save.ts:20-28` (`Q2RereleaseNativeSave{module,
map,api2023,abi,server{configstrings,portals,cvars},game/level,
visitedLevels}`), where `readRereleaseSourceSave:46-58` holds
unterminated DLL JSON bytes (`WriteGameJson`,
`src/compat/q2/rerelease/host.ts:288`) plus deferred damage and
foreign projections `[{slot,actor}]`, encoded as a
`ProviderCheckpoint` schema `q2:rerelease-native-original` v1
(`:94-98`) inside the generic `SaveImage`
(`src/contracts/session.ts:126-144`, `schemaVersion:3` with the full
`ExecutableRecipe` embedded verbatim, re-read strictly by
`src/persistence/recipe.ts:219-228`). Critically,
`runtime.ts:7205` (`checkpointFromSource`) records `guests=[]` for
`q2-native` (only `quakec`/`q3-qvm` guests are checkpointed there),
and **no checkpoint path has been identified for the dirty
`nativeMovementPlayers`/`nativeExactMotions`/`nativeMirroredCombat`
maps**. Combined with the `mode==='live'` guard below, a restored
foreign-movement frame is, on current code, a frame in which the
foreign player object does not exist.

Host mutations of guest memory beyond honest import semantics deserve
an explicit list, because interposition lives exactly here. Honest
writes (what a real engine does): `linkentity` abs/cluster/linkcount,
`setmodel` inline bounds, `BoxEdicts` result array, trace aggregate,
`TagMalloc`/cvar/configstring allocations, `pmove_t` commit. Beyond
that, HEAD already writes: (1) any shared-engine body write stores
edict origin/angles/bounds outside any DLL call via the `bindEntity`
closure; (2) `writeTravelLevel` (`host.ts:235-271`) zeroes client
`inuse` around `WriteLevel` and restores it; (3) `entityStates`
(`classic-guest-world.ts:254`) repairs `s.number`; (4) `setClientPing`
(`records.ts:156-161`); (5) `setPlayerViewRoll`
(`classic-guest-services.ts:162-170`) writes a *private* client field
and therefore requires a qualified profile, throwing on black-box
guests; (6) qualified combat/inventory writes (health/armor/inventory
cells, temporary `G_Spawn` attacker edicts, entry-hook execution
replacement); (7) `NativeInputBinding.apply`
(`native-input.ts:172/178` HEAD numbering) rewrites guest usercmd
bytes and temporarily overwrites `ps.pm_type`; (8) equipment edits to
the `pmove_t` before `pmoveClassic`; (9) `cvars.refresh()` before
every `host.call` writes host-owned cvar structs. The dirty experiment
adds: (10) `projection.write`/`writeOutputs` overwriting the entire
pmove result without running engine pmove, exact-motion re-seeding
through (1), and grapple velocity injection. All borrow writes bypass
`SparseGuestMemory` write-observers. The lesson is not that the host
is "cheating" — items (1)–(9) are load-bearing HEAD behavior — but
that *purity* ("no host writes except through the ABI") is already
false at HEAD, so it cannot be the criterion that disqualifies (10).
The criterion must be causal correctness: does the guest subsequently
consume the written state as intended? Section 5 applies that test.

## 2. Selection and gating — where foreign choices are recorded, refused, or dropped

### 2.1 selectedQ2GameLibrary, applicationPreset, and the missing dll-selection module

There is no dll-selection module. DLL selection is one function,
`selectedQ2GameLibrary` (`src/app/bootstrap/content.ts:158-164`,
identical HEAD and dirty), plus catalog mod expectations
(`src/content/catalog/index.ts:247-257`). It returns an explicit
`--q2-game` value verbatim; otherwise it consults
`sourceProgramProduct` (`src/app/bootstrap/source-program.ts:6-18`,
which walks map-only mods up their base-product chain) and returns
`game_x64.dll` (rerelease) or `gamex86.dll` (classic) *only if* the
family is `q2`, the product is *not* a builtin, and
`requiredPrograms` includes the library. Builtin exclusion is the
point: official Q2 defaults to TypeScript, proved by
`tests/app/q2-native-selection.test.ts:27-28` asserting
`execution[0].kind==='typescript'` without `--q2-game`. Automatic
native forcing applies only to discovered non-builtin mods whose
inspected programs include the edition's Windows DLL
(`catalog/index.ts:247-254`); non-Windows `.so/.dll` addons are marked
unresolved with an explicit reason (`:257`). `--q2-game` parsing
(`src/app/bootstrap/options.ts:33,87,203-207`) requires only a `.dll`
suffix; edition/API/ABI are later derived from the *selected product's
edition*, not from the filename (`content.ts:257,269-274`:
rerelease ⇒ `q2-rerelease-game` v2023 + windows-x86-64, else
`q2-classic-game` v3 + windows-i386; the TypeScript fallback carries
the *identical* API identity differing only in `kind`/artifact/
profile, `content.ts:117-124`). CLI defaults are `product=
q2-classic-baseq2, movement=q1, character=q3` (`options.ts:150-152`),
so a bare `--q2-game x` without `--movement q2 --character q2` trips
Gate 1 at HEAD — the defaults themselves are foreign.

Foreign selection *is* faithfully recorded when admitted:
`content.ts:254-256` (and `startup-selection.ts:839`) build
`recipe.movement = ${options.movement}:movement`,
`recipe.character.definition`, and
`recipe.character.appearance = ${options.character}:model/${model}`
(`src/contracts/content.ts:183,302-326`, `ExecutableRecipe
{schemaVersion:3,...}` as the launch source of truth). Every loss
described later happens *downstream* of the recipe, which is what
makes it a silent-ignore problem rather than a selection-encoding
problem: the system remembers the choice and then doesn't use it.

### 2.2 The two gates — defense in depth, then lifted

Gate 1, `applicationPreset` (HEAD, via `git show HEAD:content.ts`):
with a selected Q2 game library, throw
"--q2-game requires Quake II source, movement and character with
native offline/server operation" unless family is `q2`,
`movement==='q2'`, `character==='q2'`, no `--progs`, no `--bot-skill`,
and network ∈ {offline, native-server, q2-server}. Gate 2, the
`loadApplicationContent` loop over `recipe.execution` (HEAD,
`content.ts:~472-478`): a native server-game module requires family
`q2`, edition↔API match, `execution.length===1`,
owner == map-entities provider/content,
`movement.provider==='q2:movement'`,
`character.definition.provider==='q2:character'`, and
`enemies.kind==='map-defined'`, else throw "Native Quake II requires
edition-matching actors, movement, character and arsenal" (the word
"arsenal" has no corresponding weapons check — a message/code mismatch
worth noting). Gate 2 is the backstop for recipes not built by
`applicationPreset` (restored recipes, `content.ts:448`;
`StartupSelectionModel.resolve()` custom choices,
`startup-selection.ts:846-852`; saves). Since
`selectedApplicationPreset:266` hardcodes
`enemies:{kind:'map-defined'}`, the Gate-2 enemies clause is dead code
for preset-built recipes and bites only custom/restored ones — a layer
distinction Section 6.4 needs. Two bypasses exist at HEAD:
`presentationSource?.kind==='unified'` skips the loop per module
(`content.ts:454`, recorded/playback), and
`applicationConfigurationPreset:230-236` bypasses Gate 1 (config-only;
actual load still hits Gate 2).

The dirty diff deletes exactly the foreign-selection clauses and
nothing else (verified: two hunks, 9 lines). Gate 1 dirty
(`content.ts:214-217`) keeps `family!=='q2'`, `--progs`, `--bot-skill`,
and the network set, message "...requires a Quake II source...".
Gate 2 dirty (`content.ts:472-477`) keeps family, edition-match,
single execution, owner==entities, message "...edition-matching
source actors". Intent, reconstructed and classified: the retained
clauses are **honest capability limits** (edition↔ABI pairing, sole
server-game execution for those entities, Q2 entity/BSP ABI, native
host joined only to local/native-wire server paths, single
server-game slot vs `--progs`, Q3 bot admission not joined to guest
clients). The deleted HEAD clauses were **silent-fallback preventers**:
at HEAD nothing consumed foreign movement/character/enemies for a
native guest, so refusing was the honest alternative to ignoring.
Deleting them without complete consumption converts refusal into
silent-ignore — which is precisely what happened for character and
enemies (Section 5). No clause in HEAD is cleanly "pure refusal";
the closest are the preset-dead enemies conjunct and the blanket
`--bot-skill` ban.

The startup menu never offered a native-foreign combination honestly
either: `src/app/bootstrap/startup-selection.ts` (read in full,
HEAD==dirty) has zero `q2GameLibrary`/DLL awareness;
`rows():658-716` marks choices unavailable only for
not-installed/unresolved (`:85-88`), with no rule disabling foreign
movement/character/enemies for a Q2 product; `get options:758-772`
retains any CLI `q2GameLibrary` through `...initial`; `resolve():821`
calls `applicationPreset`, so at HEAD a menu launch combining initial
`--q2-game` with foreign picks throws at resolve-time, not pick-time,
and without `--q2-game` builtins never go native from the menu at all.
Official-campaign presets (`resolvePreset:380-430`) force same-family
movement/character as campaign affordance and don't even strip
`q2GameLibrary` (`:414-415`) — unrelated to DLL execution. Further
constraints surviving in both trees: weapon behaviors + non-TS
server-game throw (`content.ts:329-330`), runtime exact
API/ABI-vs-prepared-guest check (`runtime.ts:560-564`), and
`original-save.ts:22,59` stripping `q2GameLibrary` when deriving save
identity. No gate constrains mode/rules/skill/seats/map geometry for
native beyond owner==entities.

### 2.3 The createPlayer giant defaults object — what it is and why native never benefits

`createPlayer(actor, client, origin, angles, arsenal,
characterDefinition?, characterAppearance?)`
(`runtime.ts:3429-3516`, HEAD) is the one place a `MovementPlayer` is
born, and it explains half the character story by itself. It builds a
`netQuake` binding only for quakec/Q1 sources (`:3433-3453`, undefined
for `q2-native`) and passes `MovementPlayer` a ~58-line host literal:
client outputs (`:3455`), input applications (`:3456`), mixed-QC
`sourceClient` (`:3458-3473`, Section 4.1), QW binding (`:3474-3483`),
actors/bodies/combat/scene and rerelease movement (`:3483`),
`q2MovementConfig:3484`, a `gibbed` probe reading `q2Characters`
(`:3485`), speed multiplier (`:3486-3491`), fixed pose, weapon/
animation/touch hooks (`:3492-3493`), punch/world/trigger/brush/jump
(`:3494-3497`), and Q3 hooks (`:3498-3511`) — then origin, angles,
arsenal, and the character references (`:3512`). Its role is total:
*every* host capability a movement provider might need flows through
this object, and `MovementPlayer` (`players.ts:117-630`,
`move():473 → moveCommand():519`) can do nothing the object doesn't
offer. Two character-relevant facts follow. First, the object contains
**no character-actor binding** — it only *reads* `q2Characters` if
someone else attached one. Second, `MovementPlayer` defaults
(`players.ts:221-261`) *do* capture the recipe:
`characterDefinition/appearance` default to
`recipe.character.definition/appearance` (`:223-224`), deriving family
(`:227`), standing bounds (`:228`), view height (q3 26 else 22,
`:230`), and per-family animation state (`:235-238`). On TS/QC/Q3
admission those defaults are then overwritten from live state
(`runtime.ts:3766-3767` QC, `:3815-3817` TS, `:3561-3563,3579` Q3).
On native admission at HEAD, `createPlayer` is **never called at all**:
`admitPlayer:3754-3756` short-circuits `q2-native` to
`admitQ2NativePlayer(client, userinfo ?? \name\Player N\skin\
male/grunt\fov\90)` (hardcoded skin, recipe never consulted), which
connects/begins the DLL client (`runtime.ts:6132-6136`) and registers
it (`registerQ2NativeClient`, HEAD: clients map + inventory binding
only — verified no `nativeMovementPlayers`/`foreignNativeMovement`
symbols at HEAD). No `MovementPlayer`, no `playerStates` entry, no
`attachQ1Character`/`attachQ2Character`/`Q3CharacterActor`. The dirty
experiment calls `createPlayer` only when `mode==='live'` and
`foreignNativeMovement()` holds (`runtime.ts:6143-6148` dirty), with a
fabricated Q2 `ArsenalState` and *no explicit character arguments* —
so the `players.ts:223-224` defaults do capture the foreign recipe
into the object (the critic-verified refinement over a looser
"character lost at creation" reading) — but the object is stored in
`nativeMovementPlayers` (`runtime.ts:343-354` dirty fields,
deliberately kept out of `playerStates`), no `attach*` follows, and
neither `presentations()` nor `characterViews()` ever reads it
(Section 6.1). A giant defaults object that faithfully carries the
foreign character into a sequestered, presentation-invisible player
is worse than no object at all: it makes the ignore look implemented.

`MovementPlayer`'s own contract matters for movement verdicts:
`moveCommand:519` hard-throws without combat state (`:532`, "Player
has no combat state" — the reason dirty mirrored combat exists),
dispatches the provider by profile (`player-movement.ts:87-101`:
q1-netquake/qw/q2-classic/q2-rerelease/q3), hard-throws on
command/profile dialect mismatch (`:595`), and treats the body table
as truth — `readState():311 → readMovementState():316` re-derives
state from `SharedBodyTable` every call (classic re-quantized via
`eighths()=trunc(v*8):105-107,334`), `commit():340` writes
origin/velocity/angles/bounds/ground back. Host lifecycle hooks are
`PlayerMovementHost:41-76` (`sourceClient.before/afterMovement`,
netQuake/quakeWorld hooks, `jump()`, `touchTriggers()`,
`fixedPose()`, `speedMultiplier()`). The NetQuake stuck rescue it can
invoke — `checkStuck` (`src/movement/q1/netquake.ts:106-117`: try old
origin, then integer offsets z 0..17, x/y −1..1, else restore stuck
origin) over `positionFree` (`src/movement/q1/common.ts:107-110`,
zero-length trace) — becomes part of the quantum-divergence story in
Section 6.2. Command translation into this machinery is
`selectedQ3Command` (`q3-commands.ts:51-65`, axes ×320/127 q1,
×200/127 q2) on Q3 worlds; the dirty native analogue is
`selectedNativeCommand` (`native-commands.ts:17-44` untracked, from
Q2 200-scale: q1 ×320/200, q3 `trunc(clamp(v*127/200))`, angle words
`trunc(a*65536/360)&65535`, jump/crouch synthesized; rerelease keeps
only attack(1)/jump(8)/crouch(16), dropping all other button bits,
classic impulse except to q1/q2-classic targets, and light level).

Who steps players, by source kind (HEAD `runtime.ts`): `q2-native`
via `stepNativeQ2` only; `q3-qvm` throws in sync step; q1/quakec-
netquake two-phase (`prepareNetQuake` ~:4629 + `physicsNetQuake`
:4758); TS q1/q2/qw via `player.move` (~:4715); TS q3 via
`source.game.playerThink` (~:4702) + `syncQ3Player`. Timing that
binds them: `src/contracts/time.ts:6-7` (classic
`frameMilliseconds:100` literal; rerelease variable +
`preparation:'before-frame'`), `src/content/catalog/timing.ts:3-9`
(native rerelease 25 ms, classic 100 ms, `binary32/each-operation`
numeric for all native families), `providerTiming()`
(`players.ts:85-89`, throws if missing) and `movementProfile():91-103`
(clock kind → gravity 800/maxSpeed 320 q1, airAccel 0.7 qw vs 10
netquake, q2 snapInitial, q3 fixed ms). Facades enforce cadence by
throw (classic `frame()` unless 100 ms; rerelease unless exactly the
configured milliseconds). Section 6.3 shows why cadence-by-throw is
not time quotability.

## 3. The two named tests — exactly what they prove and cannot prove

`tests/app/q2-native-selection.test.ts:1-32` (read in full; run on the
dirty tree: 1 pass, 5 expects, 21.64 ms) builds a *synthetic*
`InstalledCatalog` with `options():19-23` hardcoding
`--movement q2 --character q2`, and asserts only
`applicationPreset` execution identity: TypeScript default (`:27-28`),
native classic i386 for `gamex86.dll` (`:29`), native rerelease x64
for `game_x64.dll` (`:30`), auto-native for a synthetic native-test
product (`:31`). It loads no corpus, opens no `Application`, executes
no DLL byte, and contains no foreign movement/character case — indeed
its hardcoded pure-Q2 options mean it passes identically on HEAD and
dirty trees and proves nothing about the lifted gates. What it proves
is real but narrow: edition-follows-library selection and the
TS-default for builtins.

`tests/first-playable/application/q2-native-original.test.ts:1-51`
(read in full) is `test.skipIf(QUAKE_Q2_NATIVE_APP!=='1'):12` —
skipped in normal runs. When enabled it hard-links corpus
`q2/xatrix/gamex86.dll`+`pak0.pak` (`:16-17`), launches
`--map xswamp --movement q2 --character q2 --renderer gl` (`:18-20`)
through `Application.open` (`:26-29`), and asserts: `q2Native()` /
seated (`:30-33`), artifact path (`:38`), instruction budget
5,000,000 (`:39`), `spawnInstructions > 5_000_000n` (`:40`),
`give health 137` ⇒ `playerUi.health===137` (`:41-45`), a
320×240×4 capture (`:46-47`), and loading/frame servicing (`:35-36`).
That proves — for *one pure-Q2 Xatrix DLL on xswamp* — that original
bytes execute, spawn, and process a DLL client command. It cannot
prove anything about baseq2 `gamex86.dll`, `base1`, foreign movement,
foreign character, trajectory, or model, none of which it selects or
asserts.

The surrounding native tests do not close the gap (bodies inspected):
`tests/compat/q2/rerelease/native.test.ts` (713 lines, real corpus
`game_x64.dll`, `skipIf(!available)`) covers host-level DLL binding,
ABI messages, external-velocity-enters-`Pmove` (`:240-317`), and full
`PreInit..ClientThink/RunFrame` (`:319-713`) — real DLL execution with
*no* `Application` and *no* foreign provider; its only dirty change is
a one-line signature arity update (`:306`). Classic compat tests
(`tests/compat/q2/classic/{host,world,services}.test.ts`) prove CTF/
Xatrix attach/spawn/frame/save, `Pmove` reentry, external velocity,
and travel — pure-Q2 host level throughout.
`tests/app/q2-native-save.test.ts:6-23` is a synthetic codec roundtrip;
`tests/app/native-q2-map.test.ts:5-16` is entity-string projection;
`tests/first-playable/application/frame-time-native-*.test.ts` are Q3
despite their names; `startup-native.test.ts` is TS/QC startup. Grep
for `trajector` in `tests/` finds only TS prediction replay
(`tests/first-playable/prediction/selected.test.ts:64`, which
explicitly asserts authority unchanged) and weapon/monster fixtures;
`selected.test.ts:23-135` runs TS worlds × q1/q2/q3 movement with
`execution=typescript` in every cell. **No committed or dirty test
asserts foreign movement or character on a native Q2 Application
lane, and no test compares a native-DLL trajectory against a
TS-composed trajectory under identical foreign selections.** The
brief's JSON trajectory claim is therefore, today, untested in the
literal sense (Section 11 states the test that would satisfy it).

## 4. Domain model — the brief's table vs the code's sources of truth

The brief assumes a canonical surface vocabulary. The code has a
different, quite precise vocabulary. Mapping brief rows to
code-demonstrated truth (all HEAD; dirty experiment explicitly
excluded from this baseline by the domain child, correctly):

- **`docs/canon.md` → absent.** Real canon: `src/contracts/*.ts`
  bodies plus `docs/contracts.md` / `docs/foundation.md` (both exist).
  `src/engine/` → absent as a directory (see ground rules). Hence
  `src/engine/{surfaces,game-imports,q1,q2,harness,network-stdlib}`
  cannot exist.
- **`Q2NativeSurface`, Forward→Slice, FromT, `runFrameGameImports`,
  `actors.createSpawn`, bus events → absent** (grep hits are only
  false positives: `arenaInfosFromText`, `Kfont_FromTTF`,
  `getTypeFromTypeNode`). Real equivalents: the `game_import_t`
  callback table (`classic/host.ts:123-131`, per-import
  `importCall`/`importBoundary`), `RereleaseCoreImports`/
  `RereleaseGuestModule` (`rerelease/host.ts:115-116`), the TS-side
  `Q2FoundationHost` (`src/content/q2/foundation/host.ts:97-120`:
  actors/bodies/callbacks/combat/inventory/now/frameSeconds/gravity/
  random/schedule/trace/... with `Q2GameOptions:20-34`), its factory
  `q2ActorHost` (`runtime.ts:2119-2153`, `authority='primary-world'`
  at call sites `:2664,2673,3124` — working-tree numbers in a dirty
  file, HEAD pattern), and spawning as
  `SessionActorRegistry.allocate/allocateAtSource`
  (`registry.ts:59,78`) + `registerEntity`
  (`foundation/host.ts:102`). No spawn bus.
- **Audience / IAM catalog → absent as a catalog.** Real `audience` is
  a per-event union: `EventAudience` (`src/contracts/session.ts:
  41-44`, world|seat|client) on `SimulationEvent:52-57` and
  `AudioAudience` (`src/app/bootstrap/audio.ts:60,284,345-359`).
  No `projectFrom`, no IAM type, no generic `traverse` API.
- **`CommandBuffers` → absent.** Commands are transient per-tick
  values: dialect `UserCommand`s (`src/contracts/protocol.ts:30-80`:
  q1-netquake/qw/q2-classic/q2-rerelease/q3 — note rerelease has no
  upMove/impulse, buttons encode jump/crouch), built by
  `InputCommandBuilder` (`src/input/user-command.ts:67-167`, throws on
  frame/dialect mismatch, `Math.fround` only for q3), wrapped as
  `ActorCommand`/`InputBatch` (`src/contracts/session.ts:19-39`), with
  `MovementCommand=UserCommand` (`src/contracts/movement.ts:16`,
  "selected wire codec does not choose movement"). Network storage is
  an `EventRing<ActorCommand>(16384)`
  (`network/unified-server.ts:63`), not a source of truth.
- **Catalog / recipe → exists in substance.** `ProviderReference
  {provider,content}` (`src/contracts/content.ts:157-160`),
  `MapSelection`/`CharacterSelection`/`EnemySelection` (`:171-198`),
  `ExecutionModule` (`:252-259`, typescript|quakec|qvm|native),
  `LaunchChoice` (`:262-278`), `ExecutableRecipe` (`:302-326`) as THE
  launch SoT; `LaunchPreset`/`selectLaunch`/`validateLaunchRoles`/
  `resolveLaunch` (`src/content/catalog/launch.ts:13-16,37-47,101-118,
  154-221` — only `match` is family-bound; other roles "deliberately
  cross families" `:98-100`; `selectLaunch` "cannot replace campaign
  gamecode, movement, character or assets" `:36`). Per-actor override:
  `ActorConfiguration` (`session.ts:15-17`). Map/movement/character/
  enemies/weapons/combat are recipe ProviderReference roles — **not
  cvars and not a surface** (contradiction flagged).
- **Actors/bodies/combat → registry/table/authority.**
  `SessionActorRegistry` (`registry.ts:35`), `SharedBodyTable`
  (`body.ts:53`; SoT is local copy *or* live external binding to edict
  bytes — not a command buffer), `CombatStateBinding`/`GameplayHooks`/
  `GameplayAuthority` (`authority.ts:53-81`).
- **Cvars naming map/movement/model → contradicted.** Dialects:
  `CommandDialect` (`src/contracts/common.ts:5`) with per-dialect
  `CvarPolicy:24-28`; registry `src/core/cvars/index.ts:154` (Q3 vs Q2
  flag bits `:13-22`, `numbers()` with `Math.fround:320-323`,
  `register():391`, dialect-branched `set():448`); archives
  `src/app/bootstrap/cvar-archives.ts:6-28` (owner-partitioned JSON,
  version+dialect validated). **No cvar names the recipe map or
  movement provider.** `mapname` is a Q3 read-only serverinfo mirror;
  model/skin live only as userinfo mirrors
  (`player-userinfo.ts:28,67`, Section 6.1). Cvars are dialect
  mirrors/archives; the recipe is the SoT. Command-dialect SoT
  likewise: the dialect literal travels in cvar archives and save
  state (`src/core/cvars/index.ts:183,226-229`), but the command
  *dialect* that chooses a codec is the recipe/world dialect, and
  movement explicitly does not follow the wire codec
  (`movement.ts:15-16`).
- **Save schema → codec, not independent SoT.** `SaveImage
  {schemaVersion:3, recipe, frame, clocks, random, actors, bodies,
  combat, inventories, configurations, thinks,
  providers:ProviderCheckpoint[], guests}` (`session.ts:119-144`),
  strictly re-read (`persistence/recipe.ts:219-228`, execution
  validation `:85-143`), `SavedGame` union with no silent fallback
  (`src/persistence/saved-game.ts:7-18`).
- **Determinism infrastructure → exists, with an external residue.**
  `ArithmeticProfile`/`NumericProfile`/`NumericOperations`
  (`src/contracts/numeric.ts:2-32`); implementation
  `src/core/numeric.ts:101-143` (`binary32 → Math.fround` per op;
  `donor-binary64 →` identity round, float32 store, "reproduce donor
  TS ports, not native x87" `:72`; `sse` restricted; `x87` always
  `RangeError` "requires an x87 arithmetic backend" `:128`).
  Per-provider `ProviderTiming{provider,clock,numeric}`
  (`content.ts:287-291`) rides in the recipe. `Math.fround` occurs
  6,913 times in 342 files. What the repo *cannot* prove is
  cross-engine bit-identity (Bun/JavaScriptCore correct rounding for
  all inputs incl. subnormals/NaN payloads; the repo notes only that
  "Bun canonicalizes NaN at the JS number boundary,"
  `src/core/numeric.ts:264-266`, plus local roundtrip tests
  `tests/foundation/primitives.test.ts:35-38`). Any brief claim
  stronger than "code requests per-operation binary32 rounding via
  `Math.fround`" is external to this repo and marked unresolved here.

**Verdict on this section:** `canon.md`/`src-engine`/surface absence is
solidly proven; the brief's monomorphized-surface/bus vocabulary is
invented; the real system — recipe + registry/body/authority +
`game_import_t` + dialect cvars-as-mirrors + `SaveImage` codec — is
coherent without it. The brief's domain/Slice text itself is not a
repo file (grep `Slice 2|Slice 3` in `*.md` = 0), so rows beyond the
enumerated names cannot be mapped; Sections 6–9 judge against the
task-stated invariants (DLL keeps executing, interpose at ABI, no
silent-ignore / no launch-refusal), not against unseen brief text.

## 5. Is the described system already made, in part or in whole?

Mostly no for native worlds — but the *patterns* it needs are made,
working, and committed elsewhere, and the dirty experiment is best
understood as porting two of them to a harder boundary. Inventory of
real seams at HEAD, each with its boundary and its limit:

**Arsenal interposition on native (qualified floor).**
`builtinNativePrimary(digest,edition)`
(`src/compat/q2/native-primary.ts:28-35`) is non-null only if *all*
digest-bound profiles exist; `NativePrimaryWeapons`
(`src/compat/q2/native-primary-weapons.ts:53-105`) "borrows real
primary client fields" via profile RVA/offset reads/writes and a
`NativeWeaponDispatcher` intercepting the guest's internal weapon
dispatcher and inline delay/damage regions, with field save/restore
around host invocations (`:198-207`). At HEAD, selecting an arsenal
with `profile===null` throws "Native primary weapon source is
unqualified" inside `bindNativeInput`; `originalCommand` suppresses
the attack bit unless the native weapon continuation owns it.
Boundary: guest-internal dispatcher + `ClientThink` command. Guest
remains authoritative for fire/animation/damage, executed in-DLL.
Generalization to movement/character/enemies requires equivalent
per-artifact RVA profiles — impossible by construction for black-box
DLLs, which is why the dirty movement design instead uses the
*published* `Pmove` boundary.

**Black-box arsenal floor (commit `6e1ca419` lineage).** Refusal
gates for unqualified QVM/native arsenal were removed; Q3 QVM filters
the usercmd (`Q3ServerState.filterUserCommand`), the runtime
suppresses `buttons &~1` only when no primary weapons exist, a
foreign arsenal is selected, and the primary slot is unselected;
subscriptions happen only when a qualified primary exists
(`runtime.ts:789-790,809,825-837` — else the shared selected arsenal
runs standalone and "the guest game continues untouched"), proved by
`tests/first-playable/application/q3-blackbox-arsenal.test.ts`.
Pattern: suppress *one* guest behavior at the usercmd seam, TS owns
the foreign subsystem beside the guest. It generalizes to movement
only weakly — movement has no suppressible button; the whole `Pmove`
*result* must be replaced inside `ClientThink`, and the black-box
floor gives no guest-state access beyond public `playerState` (dirty
mirrored combat is exactly that ceiling).

**Foreign weapons on QC via derived stages (commit `4fe0929b`
lineage).** `qcDerivedWeaponStage()`
(`src/content/q1/quakec/weapon-stage.ts:92-106`) is never null: it
derives `W_WeaponFrame` dispatch, animation continuations, and repeat
gates by *structural introspection* of the QC program (shape
predicates `:22-29,51-85`), with exact verification for two pinned
retail digests (`:109-205`); `QcWeaponStageBinding:278-310` skips
guest dispatcher execution when unselected and forces release globals
when selected. Boundary: QC VM function/region interception with full
program visibility. This *cannot* generalize to PE DLLs, which expose
no function/statement table to derive from.

**`NativeInputBinding` + `ModClientApplications` (the plumbing the
dirty experiment extends).** At HEAD,
`src/compat/q2/native-input.ts:79-193` wraps the DLL `ClientThink`
entry; `command():122-146` resolves identity or passes through to the
original; `apply():147-193` begins a mod-client application scope
(`src/world/session/mod-client-applications.ts:13-110`: ordered
journal, outputs limited to view-angles in the same dialect, scalar
fields, impulse), writes the effective command back into guest
usercmd memory, temporarily projects `pm_type` (restored in
`finally`), runs the *original* guest code, and finishes. HEAD
`movement()` returns the guest body unless applications are active,
in which case it offers a `NativeInputMotion` projection (origin/
velocity read/write, grounded, view) while still running the guest
mover. Plumbing generalizes; movement *replacement* at HEAD does not
exist here (`run` always executes, no output-field copy-back).

**Equipment / grapple motion projection.** `EquipmentMovement
{speedMultiplier?,pose?,velocity?,gravityScale,predictionSuppressed}`
(`src/contracts/movement.ts:18-25`) "contributes at original Pmove
boundary": rerelease preparation writes velocity/gravity/flag bits
pre-callback (`src/compat/q2/rerelease/equipment-movement.ts:15-20`),
`withRereleaseEquipmentMovement:23-59` keeps "original Pmove still
owns angles, collision, contacts, source state," patches speed via a
qualified-profile XMM-register observer (verifying the `Pmove` RVA
matches), freezes pose via `PM_FREEZE`, and post-writes viewheight/
bounds/ducked. Classic routes equipment into `runClassicGuestPmove`.
Grapple velocity is injected via `nativeEquipmentVelocity`
(`runtime.ts:767-770`, `beginNativeEquipmentFrame:2215-2247`) and
`projection.write` before `withInputMovement(run)`, so in-slice body
reads see it while the guest integrates. This proves pre/post struct
patching on real DLLs — dirty `writeOutputs` is its extension from
patch-*around* to replace-*wholly* — but velocity injection cannot
confer foreign air-acceleration/friction/hull semantics.

**QC mixed movement (closest working template).**
`PlayerMovementHost.sourceClient{projectState,beforeMovement,
afterMovement}` (`players.ts:45-49`), wired only for
`source.kind===quakec && mixedQc` (`runtime.ts:3458-3473`):
QC `PlayerPreThink` runs (detecting/consuming a source jump via
flags/velocity delta, `quakec-source.ts:1023-1064`), the TS
`MovementPlayer` integrates with the *selected* provider, then
PostThink writes back `FL_ONGROUND(512)`, groundentity, waterlevel,
and dialect-translated watertype into QC entity fields before
`PlayerPostThink`. QC stays authoritative for weapons/thinks/damage.
Conceptually this *is* the dirty native design — but native DLLs have
no separate Pre/PostThink exports; the only interposition point is
*inside* `ClientThink` at its `Pmove` call, and copy-back targets a
transient `pmove_t`, trusting uninspectable DLL post-`Pmove` code to
propagate it. That trust is unverified for black-box DLLs.

**Q3 `moveQ3Client` (the design the dirty code mirrors).**
`runtime.ts:3604-3670` (callback wired at `:2989`): read Q3 movement
state/environment, clamp elapsed 0..200 from
`commandTime`, convert via `selectedQ3Command`, `player.move`, then
copy back `commandTime`/viewangles/viewheight, age `pmTime` and clear
`TIME_*` flags for foreign providers (`:3646-3655`), write
`groundEntityNum` (1022 world / slot / 1023), write state, legs/torso
animation, republish events, and return `{contacts,bounds,waterlevel,
watertype,xyspeed}`. Boundary: an explicit typed host callback inside
a TS-implemented Q3 game — no binary interception, no struct guessing.
Dirty native code copies its shape
(`selectedNativeCommand ≈ selectedQ3Command`,
`write+writeOutputs ≈` state copy-back + result record) but with raw
offsets and gaps: no `pm_time`/`delta_angles`/`groundplane`/
`step_clip`/`impact_delta`/`screen_blend` handling, fabricated touch
planes, zeroed viewoffset (Section 6.2). Neither template interposes
monster movement: Q3/QC monsters run guest thinks against shared
bodies, and native monster think/touch/pain/die are private edict
function pointers with no `Pmove`-like public per-monster export —
enemies would need import-level or qualified-profile mechanisms, not
the `Pmove` seam.

**The current pmove bridge, if present.** At HEAD: classic TS
`pmoveClassic` as engine import (always guest movement), rerelease
wrap that always runs the guest mover. In the dirty tree: a foreign
`MovementPlayer` stepped at the `gi.Pmove` / `Pmove`-export boundary
with full-struct copy-back (detailed in Section 6.2). That bridge is
*the* novelty under investigation — modeled on `moveQ3Client` + QC
mixed movement, built on `NativeInputBinding` plumbing, constrained
by black-box ceilings, and present in no commit.

**Invented baseline, for contrast:** `Q2NativeSurface`,
`CommandBuffers`, `src/engine/*`, `canon.md`, Forward→Slice/FromT,
audience/IAM catalogs, `runFrameGameImports`, `actors.createSpawn`
(Section 4). Nothing to extend; any plan naming them must first be
translated into the seams above.

## 6. Slice verdicts

### 6.1 Character — ignored at three independent stages; why tris.md2

*Requirement as a requirement.* Character identity on a native world
must be a **continuous identity stream**, not a one-shot field write:
each frame the presented body (model, skin/colors, frame/animation,
life state) must be the *selected* character driven by live body
state, for as long as the actor lives, dies, and respawns — while the
DLL's own identity bookkeeping (name, scoreboard, `CS_PLAYERSKINS`)
remains valid. A single userinfo write at connect cannot satisfy
this: userinfo can only choose among Q2 player models the DLL
understands, and cannot express Q1 MDL frames + shirt/pants palette
translation or Q3 segmented MD3 (legs/torso/head, tags,
animation.cfg) at all.

*What the code does.* Foreign character is ignored at **all three**
stages, in both lanes where it can be observed:

1. *Selection → userinfo (seat-cvar family guard).* Graphical seats
   admit with `${cvars.infoString(UserInfo)}\\ip\\localhost`
   (`application.ts:1921-1922`); `createClientCvars`
   (`application.ts:2221`) registers userinfo with
   `model = options.character==='q2' ? options.characterModel :
   'male'` — foreign character forces `male`; native defaults floor
   `skin='male/grunt'` (`application.ts:2223-2228`;
   `src/core/cvars/index.ts:391-401` register-doesn't-replace makes it
   a floor nothing raises). `applyCharacterAppearance`
   (`player-userinfo.ts:50-71`) returns early on empty skin (`:62-63`)
   and writes Q2 `skin` only if dialect is q2* **and** character is
   q2 (`:64-65`), Q3 model keys only if q3+q3 (`:66-68`), QW skin only
   if q1 (`:69-70`). On a native Q2 world the seat dialect is q2-*
   while the character is q1/q3, so every branch misses and the DLL
   receives `skin=male/grunt`. Per-dialect keys for reference:
   NetQuake `_cl_name`/`_cl_color` only (`player-userinfo.ts:16-19`,
   no model/skin — single `progs/player.mdl` + palette); QuakeWorld
   `name/topcolor/bottomcolor/team/skin` (`:21-24`); Q2 single
   `skin='model/skinname'` + gender/hand/fov (`:26-29`); Q3
   `model/headmodel/team_model/team_headmodel` each `'model/skin'`
   (`q3-client/userinfo.ts:16-33`). The reverse-direction precedent
   exists and is explicit: `applyQ3ProxyModel`
   (`q3-client/userinfo.ts:4-14`) forces `sarge/default` for foreign
   characters on Q3 *because* "foreign bodies render through unified
   presentation instead." The Q2-native equivalent (proxy + override)
   does not exist.
2. *Player creation.* HEAD: no `MovementPlayer`, no character actor
   (Section 2.3). Dirty: a sequestered movement-only player holding
   inert provider references, still no `attach*`. The reusable halves
   all exist for TS worlds — `attachQ1Character:3909-3920` (source
   resolution `:3886-3907`, pain/die wiring),
   `attachQ2Character:3922-3951` (host + `model=players/<appearance>/
   tris.md2`, skin 0 — note even here skin is hardcoded),
   `Q3CharacterActor` construction (`:3568-3579` spawn, `:3789-3799`
   admit, `:7582-7589` restore; `content/q3/foundation/character.ts:
   101-180` legs/torso only), `Q1CharacterActor`
   (`content/q1/base/player.ts:80-128`) — with call sites covering TS
   admit (`:3809-3810`), Q3-world foreign spawn (`:3584-3589`), and
   restore (`:7571,7575`), but *no* native call site. QC worlds attach
   no character actor on admit either (`:3758-3772`); QVM worlds throw
   on admit (`:3775`) and present guest bodies — honest analogues
   showing native is not uniquely negligent, just unfinished.
3. *Presentation.* `presentations():6637-6648 →
   primaryPresentations():6652-6767` (HEAD) for `q2-native`
   (`:6655-6679`) iterates *guest edicts*, emitting
   `modelAppearance(state.number)` path/skin/frame from the DLL's
   entity state. The TS loop `for player of playerStates.values()`
   (`:6714`) never fires for native clients (HEAD: none; dirty: wrong
   map), and `characterViews():6769-6782` likewise iterates only
   `playerStates`. Guest appearance itself:
   `modelAppearance` (`classic-guest-services.ts:336-348`,
   `rerelease-guest-services.ts:252-263`) maps modelindex 255 through
   `CS_PLAYERSKINS` (classic 1312+, rerelease 11582+;
   `network/q2-layout.ts:21-22`) defaulting to `player\male/grunt`,
   returning `players/<model>/tris.md2` + `<skin>.pcx` + attached
   weapon by `(skin>>>8)&255`. Host plumbing to the DLL is faithful:
   `ClientConnect`/`ClientUserinfoChanged` forward the (already
   male) userinfo (`classic-guest-world.ts:190-210`,
   `rerelease-guest-world.ts:156-192`, `runtime.ts:5886,5935-5937`,
   seat re-pump `application.ts:4564-4581`; the fov-only rewrite at
   `runtime.ts:5722-5730` proves re-pumping works); the DLL writes
   `CS_PLAYERSKINS` (binary body uninspected — inferred from host
   parsing and the TS analogue `content/q2/base/player/index.ts:
   167-180,255`). On TS worlds foreign bodies *do* show correctly
   because presentation reads `MovementPlayer.characterAppearance`/
   character actors (`runtime.ts:6714-6735` path/frame/colors;
   `characterViews` for Q3, with powerups/team hardcoded) — that
   decoupling from userinfo is exactly what native lacks. One
   absoluteness caveat, kept honest: downstream
   `detachedModels`/`sourceModels` consumers were not fully traced by
   every child, so "100% guest-driven" is proven for the
   `primaryPresentations` path measured in Section 11, with that
   residual named in Section 13.

*Why the probe always saw `players/male/tris.md2`.* Pure HEAD:
foreign launch refused, so any successful launch has character q2 +
default model male (`options.ts:224`) ⇒ male/grunt by construction —
correct, not a bug. Gate-lifted dirty lane: recipe foreign (1) →
seat forces male, appearance writes nothing (2) → DLL gets
male/grunt (3) → DLL sets modelindex 255 + `CS_PLAYERSKINS` (4) →
presentation renders `players/male/tris.md2` with DLL Q2 frames (5)
→ dirty player's foreign fields never read, no actor steps its
animation (character tick loops `runtime.ts:4876-4881` cover
`q2Characters`/`q1Characters`+`playerStates` only) (6). Fixing only
userinfo would yield `players/<foreign>/tris.md2` — a nonexistent
asset with MD2 frames — still wrong for Q1/Q3 bodies. Continuous
validation therefore does not exist; what exists is a one-shot,
family-guarded field that is empty for foreign selections, plus two
downstream stages that never look. **Verdict: character NOT REAL in
both trees (HEAD by refusal, dirty by triple silent-ignore).**

### 6.2 Movement — a real seam, measured broken; trajectory translation quantified

The dirty bridge, precisely (all uncommitted). Fields:
`nativeMovementPlayers`, `nativeMirroredCombat`, `nativeSliceTouches`,
`nativeExactMotions` (`runtime.ts:343-354`). Foreignness test:
`foreignNativeMovement():6181-6186` compares
`providerTiming(recipe.movement.provider).clock.kind` against the
edition clock kind (`q2-classic`/`q2-rerelease`) — provider *identity
and content are ignored*, so a different same-clock provider is by
construction not foreign and its selection is silently dropped (guest
mover runs). Creation: live-mode native connect only (`:6143-6148`).
Seam: `NativeInputBinding.movement()` dirty (`native-input.ts:202-288`)
removes the `!applications.active` early-out, always builds a
projection when a `ClientThink` scope exists (scope pushed in
`command():122-145` before `original()`; classic `bindInputMovement`
has no extra predicate, rerelease does), and offers
`NativeInputMotion{read,grounded,view,write,writeOutputs}` with
`NativeInputMotionOutputs:26-39`. Stepping lives in
`bindNativeInput` movement closure (`runtime.ts:6306-6376`):
equipment velocity first; if no native movement player,
`withInputMovement(run)` (guest mover — the fallback that makes
restore/same-clock cases silent-ignore); else
`withInputMovement(projection, () => {...})` which (a) syncs combat
(below), (b) on classic re-seeds exact motion if the struct body is
within 0.12501 on all six origin/velocity components of the retained
exact body, else discards exact (teleport/knockback wins,
`:6325-6334`; supported by `motionBodies` cache in
`classic-guest-services.ts:70-80,207-209,228` so in-slice reads stay
exact despite 1/8 quantization), (c) translates the command via
`selectedNativeCommand` + `relativeMovementCommand` with fabricated
`serverTime = trunc(timeSeconds*1000) + cmd.milliseconds` (`:6337`),
(d) calls `player.move(input, {phase:'client-command', elapsed:
cmd.milliseconds})` (`:6344-6348`) capturing touches via `touch():4201`,
(e) retains the exact post-move body on classic (`:6349-6352`),
(f) `projection.write(body)` + `writeOutputs(...)` (`:6357-6370`:
ground slot world-0 / actor source slot / silently world if unmapped
`:6359-6360`, ducked from bounds height, water level/type via
`nativeWaterContents:6210` dialect map, viewHeight,
`bounds=player.bounds`, touches = slice touches ∪
`scene.queryActors(absBounds±1,'solid')` mapped to source slots,
silently dropping unmapped actors), and (g) **returns without calling
`run()`** (`:6374` `{kind:'void'}`). `jump():4236` no-ops for these
players; `weaponStep` early-returns for `q2-native`; `QTS_NATIVE_MOVE_DEBUG`
console logs remain in `runtime.ts:6345,6353,6368,6373,6432,6448`,
both guest services, `host.ts:426`, and `netquake.ts:71` (the only
dirty change to `netquake.ts` is that log).

`writeOutputs` (`native-input.ts:239-283`) writes, classic:
`pm_flags`@16 preserving bits &~5 | ducked 1 | grounded 4,
watertype@224, waterlevel@228, viewheight f32@192, mins@196/maxs@208,
groundentity* @220 via `edicts.at(groundSlot)`, numtouch@48 +
touchents@52+i*4 (cap 32) — mirroring `pmove.ts` `commit()`.
Rerelease (via `fieldOffset`): `pm_flags` u16 &~5, water/viewheight
(i8)/bounds, groundentity*, `touch.num` + `touches[i].ent` — with
**viewoffset zeroed (`:267-268`) and every touch plane normal
fabricated as (0,0,1) (`:276-277`)**. Never written in either edition:
`pm_time`, `delta_angles`, gravity, snapinitial, groundplane,
screen_blend, rdflags, jump_sound, step_clip, impact_delta,
viewangles, full `trace_t` touch fields. The ±1-inflated AABB touch
union over-approximates a real `Pmove` touch list (nearby solids the
sweep never contacted, potentially double-firing DLL touch/trigger
logic), while slice touches can under-approximate brush models the
union then guesses back. Whether classic DLL `ClientThink` copies
mins/maxs/groundentity/touches back into edict/private state and
fires touches from the synthesized list cannot be confirmed from TS
bodies; the author's own debug logs chasing bounds pre/post-think
suggest copy-back was still being hunted. Mirrored combat
(`syncNativeMovementCombat:6192-6207`): qualified bindings pass
through untouched; black-box guests get a shared-combat mirror built
each slice from `nativePlayerUi` (health, armor, invulnerable iff
powerup is `q2:item_invulnerability`, mass 200, `canTakeDamage:true`)
purely so `moveCommand` doesn't throw — the guest stays damage
authority, so **foreign-provider fall/environment damage is silently
annulled** (overwritten from HUD next slice, never written back)
unless the DLL independently derives it from projected velocity
(unverified). Dirty body-ground hacks complete the picture: both
guest services report ground as the world actor iff `pm_flags & 4`,
collapsing all non-world ground (movers, actors) to world-or-null.

Numeric regimes deserve one sentence because they meet inside the
struct: the foreign provider computes in the *selected movement's*
numeric profile (`players.ts:240`), while guest struct stores use the
*guest/source* numeric passed at `bindInput` (`runtime.ts:6293`) —
two rounding regimes, one `pmove_t`.

*Trajectory translation, quantified.* Translation is lossy and
intent-level: axis rescaling with clamp+truncation, aim re-quantized
to 16-bit words, dropped button/impulse/light bits (Section 2.3);
there is no inverse and no trajectory comparator in the tree. The only
measurements are the Section 11 probe (dirty, classic `base1`,
`gamex86.dll`, 50 ms host steps, held forward): pure-Q2 displacement
703.9, peak speed ≈380, endpoint (−427.9, 111.9, −23.9); Q1-movement
displacement 114.6, peak ≈343, frozen from t40 (2 s) to t159 (8 s) at
(235.9, −281.4, 24.0); Q3-move+char displacement 117.2, peak ≈638,
frozen at (236.9, −276.8, 24.0). Read correctly, that proves three
things at once: the foreign provider *steps* (displacements and
provider-characteristic peak speeds differ from baseline and from each
other — not silent-ignore as in the prior session), the DLL *executes*
throughout (identical `spawnInstructions=10631594`, `give health`
reaching 137 in every lane), and locomotion *breaks at the door*
(~x236, z never drops, Q2 endpoint never reached). Code-only verdicts
of "partially met / genuine causal seam" that omit the freeze are
incomplete; the critic is right that synthesis must carry it. Cause
is undiagnosed (door touch/trigger vs hull/quantization vs the
exact-contact cycle below); `QTS_NATIVE_MOVE_DEBUG` was not run.

Quantum divergence, bounded honestly: classic trunc-toward-zero
eighths give <0.125/axis sign-dependent error per store. With exact
retention, steady locomotion re-seeds exactly *only while* guest
displacement stays within one quantum — but (a) genuine slow guest
motion ≤1 quantum/slice (pusher/conveyor/platform carry <1.25 u/s per
100 ms frame) is indistinguishable from quantization and is *erased*
every slice, so guest-visible vs TS-exact trajectories can diverge
without bound while the DLL edict (written from the quantized struct)
stays quantized; (b) exact-contact resting (TS epsilon off a plane,
truncation embedding the hull up to 0.125 in) plus any >quantum guest
motion discarding exact can start the next step embedded, invoking
`checkStuck` rescue to old-origin/integer offsets and re-quantizing —
a stable jitter/stuck cycle with no escape counter, still speculation
as the door-freeze cause; (c) rerelease (float32 struct, no seeding)
resets divergence per slice to float32 rounding, except a
q2-classic-*profile* foreign provider re-quantizes on every
`readState`/`commit` even on rerelease guests. **Verdict: movement
PARTIAL in the dirty tree (real causal seam at the engine-import
boundary on classic; per-function skip of a DLL export on rerelease),
measured broken end-to-end, NOT REAL at HEAD.** Classic satisfies
"DLL keeps executing" structurally — only the engine import slice is
replaced; rerelease satisfies it for `ClientThink`/`RunFrame` but not
for `Pmove` itself. Silent-ignore survives inside the experiment for
`mode!=='live'` clients, same-clock providers, and the
`player==undefined` fallback.

### 6.3 Time — cadence enforced, value unquotable; drift unmeasured

*Requirement as a requirement.* For interposed stepping to be
meaningful, `level.time`/`frametime` must be quotable — readable to a
stated precision — immediately before and after every guest call
(`ClientThink`, `RunFrame`, entry hooks), so a foreign provider can be
stepped in quoted quanta of *guest* time and host time can be checked
against it.

*What the code does.* Host and guest run **independent clocks**
synchronized only by frame *count*. Host: `SourceClock`
(`src/world/session/clocks.ts:24,35-44`) float64 plain addition, no
`fround`; `runtime.ts:263,975` (`seconds()`, `timeSeconds`) likewise.
Guest: `level.time` is **never written or read by the host** —
`classic-guest-world.ts:22` comments "API 3 owns time"; `frame():236`
passes no time argument; rerelease `runFrame(mainLoop:boolean)`
likewise (`rerelease-guest-world.ts:101-102` frame counter is
host-side only). The sole guest time-adjacent read is `levelFrame`
RVA under qualified profiles
(`src/compat/q2/classic/combat-profile.ts:30,88`). Guest time lives in
guest `.data` as float32 accumulated by the DLL (0.1f / 0.025f per
`RunFrame`); host time accumulates float64 0.1 / 25 ms; the two drift
monotonically with **no reconciliation anywhere** (`fround` sites on
the Q2-native frame path: none — contrast `quakec-source.ts:1136`,
`q3/runtime.ts:492`). Clock profiles differ irreconcilably without
explicit conversion (`src/contracts/time.ts:3-8`; `sameTimeUnit`
throws, `clocks.ts:14`; `providerFrame` `provider-frames.ts:8` only
shifts interval start-vs-end, it does not slice). The dirty bridge
compounds it: Q3-dialect `serverTime` is fabricated from *host* time
(`runtime.ts:6337`), and the `FrameContext` handed to the provider
mixes time-kind seconds with elapsed-kind milliseconds on classic
(`:6344`), fed as **one** `player.move()` call with no sub-slicing to
the foreign fixed/max quantum (`players.ts:519` single step) — a
100 ms classic slice arrives whole at QW (max 50 ms) or fixed-step Q3
providers, making trajectories batching-dependent. Even the probe's
50 ms host steps are not guest-frame quoted (classic facade throws
unless 100 ms), so probe samples are host-step samples. `frameSeconds()`
for TS actor hosts is correctly quantized host-side
(`runtime.ts:2934`) — host-side only.

`Math.fround` determinism, repo-verifiable part only: the code
requests per-operation binary32 rounding through
`NumericOperations` where the profile says so, and local roundtrip
tests pass. Bit-identity across Bun versions/CPUs/engines (and
whether the DLL's own x87/SSE float32 accumulation matches any TS
regime) is **not verifiable from this repo** and is not claimed here.
Any invariant requiring `host timeSeconds == guest level.time` (even
to float32) is false after enough frames and unobservable when it
breaks. **Verdict: time NOT REAL for exactness — cadence REAL by
throw, quotability ABSENT, drift REAL-by-construction and UNMEASURED
by anyone.**

### 6.4 Enemies / actors — canonical identity symmetric, guest projection bounded and edition-split

*Requirements as requirements.* (i) The same canonical actor,
projected through any sequence of guest windows (A→B→C, native→TS),
must remain the same actor with no identity drift, for an unbounded
number of reprojections. (ii) Enemy *markings* — monster-ness, enemy
relation, team — must mean the same thing on both sides of every
projection, or targeting/damage decisions diverge silently.

*What the code does.* Requirement (i) holds **canonically** and fails
**guest-visibly**, for code-proven reasons (Section 1.5): projections
never mint ids (maps keyed by canonical id + `resolveOwned` first —
`foreign-actors.ts:218-219`, `borrowed-actors.ts` by-actor map), so
reprojection is drift-free in `SessionActorRegistry`. But the scalar
`Slot.source` forbids second source-birth; provider-checked paths
reject projection-only actors (`foreign damageNative:290-291`
requires `sourceOf.provider===module.id`; classic `pointer():108-109`
throws; dirty touch mapping silently drops slotless actors); guest
slots are finite (`G_Spawn` null throws `foreign-actors.ts:226`; QC
"No free QC row" `borrowed-actors.ts:58`; `SourceActorSlots` fatal),
so *unbounded simultaneous* windows exhaust by construction; and
guest pointer identity churns across free/respawn
(`foreign-actors lookup:211-212`, save/rebind `:386-394`,
`registry rebindRestoredSource:170-189`) even though canonical
identity doesn't. Unbounded *sequential* reprojection: yes.
Unbounded *simultaneous* guest-visible presence: no — a real,
one-directional capacity limit, stated as such.

Guest projection of a foreign actor exists **only on rerelease, only
as a damage stub**: `RereleaseForeignActors.address():216-234` spawns
a fresh guest slot per canonical actor (generation-checked
`lookup():197-215`); `#sync():236-260` writes *only* public fields —
body vectors, health/mass/takedamage, `movetype=0 MOVETYPE_NONE`
("shared owner alone advances"), `svflags=1 SVF_NOCLIENT`,
`client=null`, `classname='foreign_actor'`, solid/abs/linked — no
think/touch/use/pain/die pointers, no monsterinfo/enemy/model/frame.
It exists only when qualified (Section 1.8). **Classic has no
equivalent file at all** (directory listing + empty grep verified;
`records.ts:106-111` throws instead) — the classic conclusion rests
on that throw + listing rather than a full classic damage audit,
which is decisive for projection existence but named as a residual
for damage nuance. The QC analogue is read-only
(`QcBorrowedActors` `src/compat/qc/borrowed-actors.ts:15-16,45-133`:
projects body/health, *throws* on any guest write except two fields).

Admission and dispatch complete the failure. Selected monsters are
never prepared on native worlds: `runtime.ts:838`
(`if source.kind!=='q3-qvm' && source.kind!=='q2-native' {
prepareSelectedMonsters() ... }`) — on `q2-native` a
`recipe.enemies=replace` selection (`src/contracts/content.ts:193-196`)
is skipped with no error *there*; HEAD refused it upstream at Gate 2,
the dirty tree admits and ignores it. Inside
`prepareSelectedMonsters` (`runtime.ts:1119-1124`,
`monster-runtime.ts:51-60`) TS-world replacement itself is strict
(ordinary classnames only, spawnflags preserved). On TS worlds
selected monsters run as **subworlds**: `monsterSourceFor:1043-1098`
builds a separate `Q1EntityServices`/`Q2EntityServices` per provider,
`attachMonster:1104-1116` spawns there, while authored linkage
(target/killtarget/counters/dormant activation) stays with the *map
program* (`monster-runtime.ts:176-249`); stepping is one
registry/body-table with per-source execution dispatch
(`actor-execution.ts:18-38,106-216`), plus `runQvmSelectedActors:
4386-4417` and `SessionMods.advance` (`mods.ts:214`) after the
primary frame. On native worlds none of that runs for monsters:
guest services bind `callbacks:{think:null,touch:null,use:null,
pain:null,die:null}` (`rerelease-guest-services.ts:215-228`; classic
binds bodies+combat only), `nativeQ2Frames` does `think`+`frame` then
arsenal/mod stepping with **no `executeActor` pass**, so DLL thinks
run only inside `RunFrame` and a TS monster attached to a stub would
never step. Markings diverge exactly as feared: the stub's
`svflags=1` is not `SVF_MONSTER(4)` (cf. `serverFlags&4` checks
`runtime.ts:2027,2132`), its classname is `foreign_actor`, combat
projection syncs health/armor but never team/enemy
(`foreign-actors.ts:248-249`), while canonical team/CTF
(`runtime.ts:5472,5810-5821`), DLL team/friendly-fire semantics, and
dirty mirrored combat (`team:null`) each own a different truth.
**Verdict: enemies NOT REAL (HEAD refused, dirty silently ignored;
rerelease damage-stub PARTIAL for damageability only, classic ABSENT);
actor identity canonically SOUND, guest-visibly BOUNDED; enemy/team
markings NOT symmetric by code proof.**

### 6.5 Consilience — do permuted selections describe the same world?

*Requirement.* Permuting independent selection axes (movement ×
character × enemies × arsenal) over the same map/DLL should compose:
each axis contributes its own effect, the world remains one world,
and no axis secretly vetoes or impersonates another.

*Finding.* Today the axes do not compose on native worlds; they form
a ladder of vetoes. At HEAD any foreign axis vetoes the launch
(Gates 1–2), while `weaponBehaviors` + non-TS execution vetoes
separately (`content.ts:329-330`) and unqualified arsenal vetoes in
`bindNativeInput`. In the dirty tree the launch veto lifts but
composition still fails observably: movement permutes (brokenly),
character permutation is a no-op (q1-character trajectory
bit-identical to pure-Q2 at sampled points, model unchanged —
Section 11), enemies permutation is a no-op (never prepared), and
axes interact through hidden couplings — movement foreignness is
decided by *clock kind*, so permuting to a same-clock provider
silently un-permutes movement; character visibility depends on
`playerStates` membership, which depends on the movement experiment's
sequestration; mirrored combat (needed only because movement requires
combat) annuls movement-caused damage, coupling movement to combat
authority. The recipe layer *does* compose (`launch.ts:98-100`
cross-family roles, `ActorConfiguration` per-actor picks) — consilience
fails at consumption, not at description. **Verdict: consilience NOT
REAL on native worlds; REAL at the recipe layer, which is precisely
what makes the downstream ignores "lies" rather than limitations
(Section 10).**

## 7. Do decisions made under the described system survive in the final system? — the four questions

**Q1. Time quotability — would verbatim-stepping decisions survive?
No, not unchanged.** The described (dirty) system steps the foreign
provider once per guest slice with `elapsed = cmd.milliseconds`
(`runtime.ts:6344`) and a host-fabricated `serverTime` (`:6337`);
clock quanta differ by profile (`src/contracts/time.ts:3-8`) and
`providerFrame` (`provider-frames.ts:8`) does not slice. A final
system *must* quote the guest interval as k foreign quanta + carried
remainder per actor (Section 12), which changes sub-step counts and
therefore trajectories for any provider with a fixed/max quantum
smaller than 100 ms. Tuning, AI thresholds, or tests calibrated on
verbatim-millisecond stepping must be re-qualified; only decisions
stated in terms of guest-frame outcomes (alive/dead, touched trigger)
survive untouched.

**Q2. Trajectory translation — bit-exact or intent-level?
Intent-level only.** Translation (`native-commands.ts:8,19-42`)
clamps/truncates axes, re-quantizes aim, drops bits, defaults the Q3
weapon; there is no inverse and no comparator. The strongest
defensible equivalence is: same translated intent sequence + same
initial `BodyState` ⇒ per-guest-frame origins within
`max(classic 0.125 quantum, foreign epsilon)`. Gross locomotion
decisions (route, jump/no-jump, door reached) can transfer under that
definition once the door freeze is fixed; sub-quantum decisions
(strafe-jump thresholds, ramp slides, exact landing velocities) will
not transfer bit-exactly and must not be promised to.

**Q3. Quantum divergence — ≤1 quantum or ≤1 guest frame?
≤1 quantum only absent external displacement; the ≤1-frame claim is
false as a guarantee.** Steady state is bounded by the 0.125 classic
quantum *with* exact retention, but one classic guest frame is
100 ms (≈32 units at 320 ups) / rerelease 25 ms; after any guest
displacement >1 quantum the exact cache is discarded and divergence
for that frame can be a full frame of travel plus a wrong
ground/touch set (Section 6.2). Decisions assuming "at most a frame
behind" survive; decisions assuming "at most a quantum wrong,
always" do not.

**Q4. Actor symmetry — do bot/monster decisions reading shared state
survive? Partially — vocabulary yes, behavior no without
re-qualification.** The shared vocabulary (`ActorId`, `BodyState`,
combat fields) is stable and canonical identity is sound. But
behavior differs today by edition (rerelease damage-stub vs classic
absent), by binding (qualified real combat vs black-box mirror with
`team:null`, `canTakeDamage:true`), and by marking (`SVF_MONSTER`
absent on stubs, enemy/team never synced). Any bot, monster-AI, or
rules decision that reads combat/bodies/team/enemy on a native world
observes different facts per edition/profile and must be
re-qualified against a symmetric final binding before it can be
trusted to mean the same thing.

Overall: **the described system's decisions do not continue to work
unchanged in a correct final system.** What survives is the
*architecture* (recipe roles, canonical identity, `Pmove`-boundary
interposition, qualified-profile discipline). What must be
re-qualified is every numeric/behavioral calibration that touched
verbatim time, sub-quantum trajectory, or asymmetric actor state.

## 8. Subworld portability, the killshot, and selection-layer failure

TS selected monsters already live as subworlds (Section 6.4): separate
entity services per provider, one registry/body-table, authored
linkage retained by the map program. That model is portable *between
TS/QC/QVM worlds* because in each case the "map program" is host-
visible TS (`authoredTargets`, `mission.killed`, `useTargets` in
`monster-runtime.ts:176-249`) and stepping is host-dispatched
(`actor-execution.ts`). Portability to a native world fails at exactly
the joint: the map program becomes DLL `SpawnEntities` executing
inside an opaque guest window.

**Killshot (the brief's internal contradiction, instantiated).**
Launch (dirty tree) rerelease `base1` with
`enemies=replace: monster_tank → Q1 monster_shambler`. The
selection-layer rule *outside* the guest (the launch recipe) demands
shambler behavior with authored obligations preserved. The subworld
model demands shambler behavior live in its own `Q1EntityServices`
attached to the *map program's* actor. On a native world the map
program is the DLL: it self-allocates the edict
(`host.ts:168 allocateAtSource`) and — marked **speculation** where
it exceeds the public prefix, inferred from
`public-state.ts:27` prefix-only design + null callbacks — stores
spawnflags/target/targetname/monsterinfo{enemy,nextthink} and
`level.total_monsters` in private guest memory the host cannot read
or write. Now either (i) let the DLL tank live: `RunFrame` steps its
private think, the shambler never runs (and today
`prepareSelectedMonsters` is skipped, `runtime.ts:838`, so this is
exactly silent-ignore — the tank stays); or (ii) suppress it and
project a canonical shambler + `foreign_actor` stub: the stub is
`svflags=1` not monster, wrong classname, `MOVETYPE_NONE`, no
use/think pointers, so DLL trigger/targetname activation, kill
counters, and enemy acquisition cannot see it as the authored
monster, while the TS shambler's enemy state lives where the DLL
cannot read — and the native loop never steps it anyway. The actor
must simultaneously be *inside* the guest window (authored linkage,
counters, targeting — selected from outside) and *outside* it
(selected subworld stepping the native loop doesn't perform). No
allocation order satisfies both without either TS-writing DLL private
state (forbidden for black-box guests, unavailable without profiles)
or the DLL executing foreign think code (no such export). The team
variant has the same shape (mirror `team:null` vs canonical CTF team
vs DLL friendly-fire). This is not an implementation bug; it is a
contradiction between "selection lives outside the guest" and
"obligations live inside the guest's private state," and any honest
final system must resolve it by *narrowing what enemy replacement
promises on native worlds* (Section 12), not by pretending the stub
is the monster.

**Selection-layer failure, stated plainly.** The recipe/selection
layer is the *only* layer that currently tells the truth about
foreign choices — and it has no way to know its truth is dropped.
There is no consumption audit: nothing verifies that
`recipe.movement.provider`, `recipe.character`, or `recipe.enemies`
was consumed by the world that claimed to honor it (no post-admission
assertion, no "selected but unstepped" diagnostic). Gates were the
audit, crudely, by refusing what couldn't be consumed. Lifting them
without adding consumption *or* an audit is the selection-layer
failure: the system now *records* choices it doesn't *keep*.

## 9. What the brief forces, slice by slice

- **Character:** a continuous per-frame identity stream (presentation
  interposition + stepped character actor + valid Q2 proxy userinfo),
  never a connect-time skin string. Forced because Q1/Q3 bodies are
  inexpressible in Q2 userinfo and death/gib/respawn are streams.
- **Movement:** interposition *inside* `ClientThink` at the `Pmove`
  call (the only seam; no Pre/PostThink exports exist), with full
  `pmove_t` copy-back the DLL subsequently consumes — including the
  fields the dirty code omits or fabricates — and honest handling of
  the classic-vs-rerelease direction difference. Forced because
  velocity injection cannot confer foreign physics and suppressing a
  button cannot replace integration.
- **Time:** quotable guest time (readable before/after each guest
  call to stated precision) plus a per-actor quoting slicer (k quanta
  + remainder). Forced because frame-count sync with float64-vs-
  float32 drift makes "same trajectory" undefined.
- **Enemies:** either true guest-visible monster projection
  (think/touch/use, monster marking, counters, linkage — requiring
  qualified profiles or import-level mechanisms) *or* an explicit,
  recipe-visible narrowing of the promise. Forced by the killshot:
  the damage stub cannot be silently upgraded in prose.
- **Enemy markings:** monster/enemy/team must be projected with the
  actor or explicitly declared unprojected; health-only sync is a
  marking lie waiting for a targeting bug.
- **Consilience:** consumption must be auditable per axis — each
  recipe role either observably consumed or the launch/save must say
  so in-band. Forced because permutation without audit is how
  silent-ignore hides.

## 10. Why this rigor makes operational sense for *this* engine

This engine's superpower — one recipe permuting map, movement,
character, weapons, enemies, and execution across Q1/QW/Q2/Q3,
TS/QC/QVM/DLL — is also its optimality crisis: **every boundary is
stringly/offset-bound** (provider-id strings, userinfo key dialects,
struct offsets, digest-bound RVAs, classname sets), and every such
boundary fails *silently* by default. A family guard that doesn't
match writes nothing (`player-userinfo.ts:64-70`). A clock-kind
comparison that matches steps nothing foreign
(`runtime.ts:6181-6186`). A `mode` that isn't `'live'` creates
nothing (`:6143`). A slot lookup that misses drops the touch
(`flatMap []`). A profile that is null binds nothing
(`combat-binding.ts:41-51`). None of these throw; the game launches,
the DLL executes (10.6M spawn instructions!), health cheats work —
and the player's actual selections do nothing. In a single-game
engine that class of bug is a glitch; in a permuting anthology
engine it is the *dominant* failure mode, because the number of
boundaries grows with the product of the axes while testing grows
linearly at best. The brief's rigor — no silent-ignore, no
launch-refusal as a shortcut, trajectory-level proof, quotable time,
symmetric markings — is therefore not purism. It is the cheapest
known countermeasure: force each permutation to either causally
demonstrate its effect through the real seam or fail loudly at the
layer that promised it. Silent lies are the one bug class this
architecture cannot afford, because its entire value proposition is
"your selections compose." The current state — HEAD refusing honestly,
dirty tree composing movement brokenly while ignoring character/
enemies sweetly — shows both failure modes the rigor exists to
exclude, in one tree, at one time. That is the strongest possible
argument for keeping it.

## 11. Probe state — launched yes, ignored yes (per lane, with numbers)

Probe: `/tmp/probe-native-lanes-empirical.ts` (left for re-run; pattern
after pre-existing `/tmp/probe-native-move.ts:1-34`), run
`SDL_AUDIODRIVER=dummy bun run` from the qfiles corpus on the dirty
tree, exit 0, no lane errored. Each lane: `Application.open
--game q2-classic-baseq2 --map base1 --q2-game gamex86.dll
--renderer cpu --hidden 320x240`, 20× `step(50)` settle,
`give health 137`, held forward (key 119), 160× `step(50)`;
`peakSpeed = hypot(dx,dy)/0.05` from `playerView().origin` (noisy
estimator — compare lanes relatively; single run; cpu renderer).

- **pure-q2** (movement q2, character q2): disp **703.9**, peak
  **380**, (128,−320,24.1) → (−427.9,111.9,−23.9), model
  `players/male/tris.md2`, health 137, spawnInstr **10631594**.
- **q1-movement** (q1/q2): disp **114.6**, peak **343**, frozen
  (235.9,−281.4,24.0) t40→t159, model male/tris.md2, health 137,
  spawnInstr 10631594.
- **q1-character** (q2/q1): disp **703.9**, peak **380**, trace
  **identical to pure-q2 at every sampled t**, model male/tris.md2,
  health 137, spawnInstr 10631594.
- **q3-movechar** (q3/q3): disp **117.2**, peak **638**, frozen
  (236.9,−276.8,24.0), model male/tris.md2, health 137, spawnInstr
  10631594. (`healthAfterGive` read 100 after one step, 137 by end —
  DLL `ClientCommand` took effect during stepping.)

Conclusions per lane (dirty tree only): **launches — yes, all four**
(foreign no longer refused). **DLL executing — yes, all four**
(`q2Native()` non-null, artifact `gamex86.dll`, >10.6M guest
instructions — the same metric `q2-native-original.test.ts:40`
asserts >5M — plus the health cheat landing). **Movement taken
effect — yes but broken** (foreign lanes differ from baseline and
each other, then freeze ~x236 for 6 seconds). **Character taken
effect — no** (model/family `q2` in every lane; q1-character
indistinguishable from control). Caveats preserved: rerelease lane
never probed; stuck cause undiagnosed (debug logs not run);
`characterViews()` not probed and the probe's `presentations().find`
lacks the `!viewWeapon` filter, so a view-only effect cannot be
excluded; HEAD baseline never launched (refusal is diff-proven);
no repeat run, so determinism is unmeasured.

Damage silent-ignore does in the *final* system, if shipped as-is:
saves embed the lying recipe verbatim (`SaveImage.recipe`), so a
restored game re-promises foreign character/enemies and re-drops them
(and movement too, via `mode!=='live'`); network/unified consumers
reading `presentations()` replicate male bodies to every seat;
bots/rules reading mirrored combat learn `team:null` and annulled
fall damage as facts; test suites passing on launch+health (the two
named tests' exact assertions) certify the lie. Silent-ignore doesn't
stay local — it is *persisted, replicated, and certified*. That is
why "launches yes" without "ignored no" is a negative result, not a
partial success.

## 12. The required mechanism — refusing both collapses

Neither "refuse foreign on native" (HEAD) nor "admit and hope"
(dirty) satisfies the requirement as written. The exact sequence
below does, placed in the layers that already own each concern
(selection in content/catalog, lifecycle in runtime, dialect
projection in compat, catalog never steps):

1. **Content/catalog layer** (`src/content/catalog/launch.ts`,
   `content.ts:applicationPreset/loadApplicationContent`): resolve
   the recipe only. Remove the movement/character/enemies *refusals*,
   keep edition/source/single-execution checks, and add a
   **consumption contract**: each native recipe records, per axis,
   `honored-by: pmove-interposition | presentation-interposition |
   guest-native | explicitly-narrowed(reason)`. Narrowing (enemies on
   black-box guests, Section 8) is expressed *in the recipe*, never
   discovered later by absence.
2. **Runtime lifecycle** (`runtime.ts:registerQ2NativeClient` for
   *live, restore, and travel* alike; checkpoint/restore in
   `save.ts`/`runtime.ts:7205`): own the `MovementPlayer` +
   character actor for every native client whose recipe selects them,
   with `recipe.character` definition/appearance, persisted in the
   checkpoint (exact motions/mirror either checkpointed or provably
   re-derivable — "re-derive on restore" must be tested, not hoped).
   No `mode==='live'`-only creation; foreignness by *provider
   identity*, not clock-kind equality. Missing player at step time
   throws (fail loudly), never falls through to `run()` silently
   when the recipe promised foreign movement.
3. **Character identity stream** (`runtime.ts:admitQ2NativePlayer/
   updatePlayerUserinfo`, guest-services appearance,
   `primaryPresentations`/`characterViews`): pump a valid Q2 proxy
   skin through `ClientConnect`/`ClientUserinfoChanged` for DLL
   identity/scoreboard (the `applyQ3ProxyModel` pattern in reverse);
   attach and step the matching `Q1/Q2/Q3CharacterActor` from guest
   body/combat state each frame; in `primaryPresentations`, replace
   the guest client edict's body entry (slots in `source.clients`)
   with the selected character's presentation (q1/q2 path/frame/
   colors as `:6731-6735`, q3 via `characterViews` as `:6778-6780`),
   suppressing the duplicate `tris.md2` body, keeping held/view
   weapon logic (`:6670-6678`) consistent with the *selected
   arsenal*, and mapping guest death/gib/bodyque onto character
   lifecycle every frame (death-state source for black-box guests is
   an explicit design input: qualified flag, HUD health edge, or
   declared narrowing — pick one, don't guess).
4. **ABI seam, selection-free** (`native-input.ts:NativeInputBinding`,
   classic `pmove.ts` / rerelease `module.ts`): always project the
   `pmove_t` and forward the native command; the *runtime* chooses
   foreign-step XOR guest-`run()`. Complete the copy-back:
   origin/velocity, groundentity (no `??0` world lie — unmapped
   ground is null + diagnostic), touches from the actual sweep (no
   ±1 union, no fabricated (0,0,1) planes — carry real trace planes
   or omit with a stated rule the DLL tolerates, verified per
   edition), mins/maxs, water, viewheight *and* viewoffset (no
   zeroing), `pm_flags`, plus an explicit disposition for every
   remaining field (`pm_time`, `delta_angles`, groundplane,
   step_clip, impact_delta, screen_blend, rdflags: preserve guest
   value, derive, or zero — decided and tested per field, classic
   and rerelease separately, because the seams face opposite ways).
   Reuse existing pumps: `withInputMovement`, equipment pre/post
   patching, `commit/reload` trace reentry, `ModClientApplications`
   scoping — extend, don't parallel-build.
5. **Time quoting slicer** (`provider-frames.ts` + per-actor
   remainder accumulator in runtime): quote each guest slice as
   k×foreign-quantum + carried remainder; single time kind in
   `FrameContext`; `serverTime` derived from quoted guest frames,
   not host float64. Where guest `level.time` remains unreadable
   (black-box), state quotability as *frame-count + cadence*
   explicitly and bound drift in the test tolerance — never claim
   value equality that cannot be read.
6. **Combat honesty** (runtime mirror / qualified bindings): keep
   qualified bindings authoritative-shared; for black-box mirrors,
   either write foreign-caused damage back through a public channel
   the DLL consumes or declare in the consumption contract that
   movement-caused damage is guest-derived-only. Annulment by
   overwrite is forbidden silently.
7. **Enemies** (new `src/compat/q2/classic/foreign-actors.ts`
   mirroring rerelease *only as a first step*, plus runtime monster
   admission on native): port the projection, then confront the
   killshot head-on — monster marking, think/touch/use dispatch
   ownership, counters/linkage — via qualified profiles where
   available and recipe-visible narrowing where not. Stepping foreign
   monsters on native worlds (`executeActor` pass or equivalent) is
   part of the mechanism, not a follow-up.
8. **Cleanup:** remove all `QTS_NATIVE_MOVE_DEBUG` logging; commit
   `native-commands.ts` as a real module with dialect tests.

**Validation plan.** (a) *Committed dual-run trajectory test* (the
JSON-claim shape, literal): same map/seed/command script, two
`Application` launches through `loadApplicationContent+
createSimulation` (corpus qfiles, `SDL_AUDIODRIVER=dummy`) — (A)
native DLL (classic *and* rerelease variants) + foreign
movement+character, (B) TypeScript world + *identical* foreign
providers — driving identical `ActorCommand`s through
`simulation.step`, recording per-guest-frame `bodies.read`
(origin/velocity/ground/bounds), asserting (i) DLL causally executed
in A (instructions + DLL-owned state change beyond the moved slice),
(ii) trajectories agree within `max(0.125, epsilon)` per frame,
(iii) both differ from a native-movement control, (iv) presented
model in A is the selected foreign character with no duplicate
`tris.md2` body, (v) save→restore mid-run preserves all of the above.
(b) *Unit seams:* `presentations()` path assertion in the style of
`tests/first-playable/simulation/cross-family-q3.test.ts:47-48,76-78`
+ `characterViews()` presence + `playerColors`; command-translation
round-trip intent tests; quoting-slicer remainder tests; classic
quantum re-seed adversarial tests (slow pusher, exact-contact rest,
teleport). (c) *Human eyeball checks:* third-person/state-dump
verification — second-seat/bot facing the player (Q2 has no general
third-person camera; Q3 view third-person
`content/q3/presentation/view.ts:23-25,79` covers Q3 seats only),
corpse-at-respawn, intermission podium, plus
`Application.captureNextFrame():4707-4709` PNGs and a configstring/
presentation state dump diffed between lanes. (d) *Staircase:* pure
native control → foreign movement only → + foreign character → +
save/restore → + rerelease → + enemies (or narrowed contract) →
+ network seats; each stair must pass (a)–(c) before the next is
claimed.

**Gate-removal criteria.** A gate clause may be removed only when:
the consumption it guarded is implemented *and* covered by a stair
(a)–(c) test that fails without the consumption; restore/travel
paths are covered, not just live; both editions are covered or the
clause is narrowed per-edition in the recipe; and no silent fallback
remains on the guarded path (missing consumption throws). Until
then the HEAD refusals — for all their bluntness — are more honest
than the dirty admissions, and restoring them per-axis (character,
enemies) while movement matures behind its own tests is a legitimate
intermediate state. Honest refusal per-axis beats dishonest
composition overall.

## 13. Final verdict — chemically real, partial, or not real?

Definitions (brief criteria): **CHEMICALLY REAL** = original DLL
bytes execute *and* foreign selection causally alters behavior
through the ABI seam with copy-back the guest subsequently consumes,
proven by a dual-run test. **PARTIAL** = seam + causal path exist for
a subset (one axis / one edition / uncommitted / unproven end-to-end).
**NOT REAL** = selection refused, ignored, or TS-swapped wholesale.

Per lane:

| Lane | HEAD `fbabc9a2` | Dirty tree |
|---|---|---|
| Movement, classic | NOT REAL (refused) | **PARTIAL** — real seam at engine import, DLL runs around it, measured broken at door (~x236), no trajectory test |
| Movement, rerelease | NOT REAL (refused) | **PARTIAL (code-only)** — seam skips a DLL export; never probed; fabricated touch planes, zeroed viewoffset |
| Character (both editions) | NOT REAL (refused; male correct-by-construction) | **NOT REAL** — triple silent-ignore, `players/male/tris.md2` always |
| Enemies (both editions) | NOT REAL (refused for custom recipes) | **NOT REAL** — never prepared; rerelease damage-stub PARTIAL for damageability only; classic absent |
| Time quotability | NOT REAL (unquotable, drift) | NOT REAL (unchanged; bridge fabricates host time) |
| Actor identity (canonical) | REAL (drift-free ids) | REAL (unchanged) — guest-visible presence BOUNDED in both |
| Consilience / audit | NOT REAL (veto ladder) | NOT REAL (admit-without-audit) |
| Save / restore of foreign selection | N/A (refused) | NOT REAL (`mode!=='live'` + no checkpoint path) |

**Overall: native + foreign as a shipped claim is NOT REAL. As a
dirty-tree movement-only classic experiment it is PARTIAL — a genuine
causal seam that typechecks and visibly steps — and it is not yet
chemically real on any lane**, because chemical reality requires the
dual-run trajectory proof (absent), working locomotion (measured
frozen), character causation (absent), and restore survival
(absent). The DLL-execution half of the claim, by contrast, is fully
real and was never in doubt: original bytes spawn, think, and answer
cheats in every lane measured.

What remains, in dependency order: diagnose and fix the door freeze
(with `QTS_NATIVE_MOVE_DEBUG` evidence, then remove the logs);
complete `pmove_t` copy-back per edition with per-field dispositions;
provider-identity foreignness + loud failure instead of silent
fallthrough; runtime lifecycle + checkpointing for restore/travel;
the character identity stream (proxy + actor + presentation
replacement); the time quoting slicer with honest black-box bounds;
combat-damage honesty; classic foreign-actor port + an explicit
enemies contract (full projection where qualified, recipe-visible
narrowing where not — resolving the killshot by narrowing the
promise, not by inflating the stub); the committed dual-run
trajectory test + staircase (Section 12); and only then gate removal
per the criteria above. Until the staircase's first steps pass,
per-axis honest refusal (character, enemies) should be restored —
it is the only current behavior that doesn't lie.

### Honest conflicts and unresolved evidence

Kept visible rather than resolved by fiat: (1) Code-only "PARTIAL /
partially met" movement verdicts vs the probe's measured freeze —
this report sides with the measurement for end-to-end claims and
with the code reading for seam existence; both are true at different
altitudes. (2) "Character lost at creation" (loose) vs "captured by
defaults into an invisible player" (verified `players.ts:223-224`) —
the latter is used. (3) Flat "`src/engine` zero hits" vs donor-path/
fixture string occurrences — directory/type absence proven, string
absence false. (4) Gate-2 enemies clause "dead for presets" vs
runtime `prepareSelectedMonsters` skip — different layers, both true;
conflating them understates the dirty-tree ignore. (5) The host's
"incomplete or unusable" flags on all prior lanes vs their complete,
dense submitted bodies — uninspectable; evidence bodies trusted.

Unresolved (named gaps, not conclusions): rerelease foreign
trajectories never run; door-freeze cause undiagnosed; DLL-side
`ClientUserinfoChanged` body, `CS_PLAYERSKINS` live value, and
post-`Pmove` copy-back consumption unobserved (binary + no live
dump); `characterViews()` on native lanes unprobed;
`detachedModels`/`sourceModels` downstream not fully traced; classic
on-disk `WriteGame`/`WriteLevel` byte format not in repo TS; dirty
movement-player persistence on restore has no identified path;
per-artifact qualified-vs-mirrored combat for the specific corpus
DLLs untraced; guest frametime sourcing inside the rerelease DLL
untraced beyond host cadence enforcement; `Math.fround`
cross-engine determinism external to the repo; private layouts of
unqualified classic DLLs unqualified by design; brief Slice text
absent from the repo, so unseen rows are unmapped. No claim in this
report rests on closing any of these silently.

*Basis reminder.* HEAD `fbabc9a2` vs dirty tree (8 files +239/−25 +
untracked `native-commands.ts`) as in Section 0. All interposition
claims are dirty-tree claims. No source files were edited by the
investigation lanes; this report is the only artifact written.

















