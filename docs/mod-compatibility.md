# Mod compatibility

Keep each mod in its own directory under the installed or writable content root. See the [README's recommended layout](../README.md). Discovery makes a package selectable; its executable interface, required assets, and authored gameplay still determine whether it can run.

## Early Quake III server modules

The `q3-1.16n-base` profile supports the base server interface in the original 1.16n and 1.17 SDKs. These modules use different player, entity, command, event, and configuration records from later releases. The profile translates their public records while preserving private guest memory.

Place `qvm-compatibility.json` beside the selected mod's packages in the writable overlay. This example applies to the original InstaGib Plus package retained from PlanetQuake:

```json
{
  "version": 1,
  "modules": [{
    "role": "qagame",
    "artifactPath": "vm/qagame.qvm",
    "artifactDigest": "sha256:5aca191fa970a82829a7e29c8b128594dcebb39e4fe439a852bffa0988b3dcfa",
    "profile": "q3-1.16n-base"
  }]
}
```

The digest identifies the QVM's uncompressed bytes, not its containing PK3. Use a declaration only when the module's SDK interface is established. A digest mismatch fails loading; changing the declaration cannot reinterpret an existing saved game's memory under another profile. Modules without a declaration use `q3-modern`.

This profile supports the legacy server's public game services, callable bot services, and SDK memory/math intrinsics. It translates the SDK's action bits, user commands, chat arguments, and navigation results while retaining the module's own AI. The original InstaGib module initialized its bot library, admitted two bots, and advanced eight seconds of AI and command execution. Its itemless test arena produced no movement; this result does not establish bot navigation or combat.

Legacy client/UI syscall and record adapters are implemented from the retained SDK headers. An actual matching early client/UI package remains unwitnessed, and private configuration or powerup meanings still require an explicit declaration. Unsupported operations report an error, including deprecated model-load and test-print ordinals without a callable donor interface. The original InstaGib module also ran with the inherited modern client on Q2 geometry, including local firing and saved continuation. These results do not qualify every early mod.

## Quake III mod inventories

Native Q3 weapon selection preserves the module's weapon numbers. Modules with changed item tables can supply `qvm-items.json` beside their packages. Its `artifactDigest` must match the uncompressed qagame bytes, and its table layout describes the original initialized data. Names, weapon numbers, and ammo associations are then read from that table. The original cgame retains its own HUD and gameplay rules.

Threewave 1.7's verified layout is built in. This equivalent declaration shows the format; its offsets apply only to these exact bytes:

```json
{
  "version": 1,
  "artifactDigest": "sha256:9751bad99a2d138f96a9b0436d2ea2d965b86214175dc33e4cea95e059419337",
  "items": {
    "address": 5356, "count": 49, "stride": 52,
    "fields": { "className": 0, "pickupName": 28, "type": 36, "tag": 40 },
    "weaponType": 1, "ammoType": 2
  }
}
```

The current interface covers a static QVM item table and the standard public weapon/ammo records. Mods that replace those records or generate their catalogs dynamically need an additional source interface. Q3 sound effects also follow the original client's WAV policy: cue/sampler loop metadata does not control Q3 channel playback.

## Independent components

**Custom game → Mods** lists installed independent components with individual enable/disable controls. Multiple components can be selected; their source game does not restrict the destination world. The list reports missing dependencies, declared conflicts, and unavailable components. From the command line, repeat `--mod PRODUCT/COMPONENT_ID` for each selection.

A package declares its independent components in `gameplay-mods.json` beside its game data:

```text
q1/rerelease/mymod/
  progs.dat
  gameplay-mods.json
  profiles/
    feature.json
```

The selection document has this shape:

```json
{
  "version": 1,
  "components": [
    {
      "id": "feature",
      "title": "Authored feature name",
      "purpose": "addition",
      "callbacks": "profiles/feature.json",
      "requires": [],
      "conflicts": []
    }
  ]
}
```

`requires` and `conflicts` contain complete `PRODUCT/COMPONENT_ID` selections. A `game-type` component stays out of this list. Callback declarations identify the exact compiled program digest, original functions, source fields, and shared operations they consume. Changing the program or declaration invalidates a saved component identity. Each selection owns separate guest state, registrations, and checkpoints, including two components that use the same program.

The current QuakeC adapter executes declared original callbacks for damage, inventory changes, and actor think, touch, use, pain, and death. It connects source field access to canonical actors and reuses destination collision, spatial, and presentation services. See the [QuakeC callback contract](../src/contracts/mod-callbacks.ts). An actual Copper callback has passed the package selection, Q2 launch, two-component composition, and public save/load path. That establishes the declared callback behavior, not all of Copper's gameplay as independent components.

The QVM adapter uses the same shared operations with explicit source record layouts, original instruction entries, and typed arguments. See the [QVM callback contract](../src/contracts/qvm-mod-callbacks.ts). Original QuakeC and QVM callbacks have run together through public Q2 launch, disk save/load, and map travel. QuakeC source helpers also use the source scheduler and shared physics; an original Copper bubble spawned, moved, rendered, and resumed after saving. Declared QVM allocation, linking, scheduled updates and removal retain their source-owned actors across full saves.

QVM components can declare their original damage entry and actor callback fields. Shared attacks then execute the original damage, use, touch, pain and death functions. Callback pointers are read when the guest calls them, including pointers changed during that same execution. Original shootable buttons and breakable brushes have run in Q1 geometry, retained their source behavior after saving, and released their collision on disable. Area-portal contributions belong to each component, so disabling one preserves other components and the primary game's portal state.

Production QVM modules run in TypeScript with the compiled Quake III VM's call/return and bitwise-complement behavior. Return addresses remain separate from writable guest memory. This allows the original Threewave 1.7 module to initialize without a game-specific exception; its bounded client, hook and save/load workflow has passed. It does not establish full Threewave match compatibility.

Full saves retain guest world state and its actor identities. Map travel retains the enabled selections and restarts world-scoped guests; it does not copy references to the previous map's actors. Only an adapter with explicitly independent session state may retain that state across maps.

The native component adapter executes declared original API3/API2023 callbacks with private linked records and original module save routines. Original Xatrix and Q2Eaks health pickups have composed on a Q3 actor in a Q1 world and resumed after saving. Native callbacks can also emit authored sound and text or replace borrowed actors' model groups. Optional source-actor declarations connect the original allocator, release routine, per-entity update, clock and use callbacks to shared ownership and collision. Original delayed actions and moving actors continue after saving without running a second whole game world. Looping sounds retain component ownership through saves and unified network events; disabling one component preserves the others' sounds. Declared native owned actors receive shared attacks through original damage routines, retaining composed callbacks and deferred attack provenance through saves. Declared native client inventory fields and lifecycle calls are connected; borrowed armor projection, custom client effects and complete host-service coverage remain under development. Declared mutable inventory capacities are supported as described below. A declaration describes an established source interface; it cannot infer a subsystem's behavior or make an unsupported engine service work. Whole-module execution and the narrower projectile adapters below remain separate compatibility paths.

Shared equipment on a native primary game needs that module's original combat interface. Currently verified destinations are the admitted Xatrix API3 DLL, retail Q2 rerelease API2023 DLL, and LRCTF/Threewave QVMs. The shared attack enters the original damage routine, preserving source armor and reaction logic. Unknown private layouts remain unsupported; the public game ABI alone does not describe them.

### Component files and server information

QVM components use the existing QVM file service with separate output directories at `<user-content-root>/.mods/<encoded-product>/<encoded-component>/`. Source read, write, append, seek, list and saved handle operations retain their original behavior. Each component sees its output before its installed resources and scripts; it borrows verified package handles without owning them. The location remains stable across maps and executable updates.

Server-info and configstring imports share the primary QVM implementation, including source flags, buffer rules and legacy ABI index translation. Original LR initialization opened its log, wrote its own server-info values, and resumed logging after saving.

A QVM component can declare `spawnEntities` as source entity text, like a native component. Missing or null text supplies an empty stream. Only the component's declared original calls consume it; enabling the component does not pass the destination BSP entity lump or start another game world. The token import uses the primary engine parser and buffer rules. Saves retain the exact stream and parser position. An original LR parser/spawn witness creates one declared button in a Q1 world, saves, then resumes at a second declared button without recreating the first. Full match initialization remains separate.

QVM client callbacks can opt into a `clients` declaration with reserved source rows, client-only `records`, a public `playerStateRecord`, and explicit `admit`, `userinfo`, and `disconnect` calls. A `{"kind":"client","input":"self"}` argument supplies the component's source client number. Ordinary actors use separate rows. Each row resolves a live destination client identity; restoring saved rows does not replay admission callbacks or reuse a disconnected client's identity. This does not invoke a second game's client-connect, client-begin, or whole-game frame.

Client imports read the destination's userinfo and accepted input. Source userinfo writes update storage without recursively invoking gameplay callbacks. Usercmd conversion retains the accepted input time and uses the component's own weapon and angle state; it requires real input. Targeted commands and deferred disconnects retain the actual recipient. Component configstrings remain private, including source player rows; they feed component asset lookup and saves, and do not overwrite the primary game's wire tables. Local component player events can use a declared original cgame, as described below. Full component network snapshots are not yet transported.

QuakeC components can declare `clients: { maximum, admit, userinfo, disconnect, frame? }`, using named original calls with `self` and `time` inputs. Optional `frame` calls also accept `elapsed` and run once per component frame for each admitted client. Declared paired `think`/`nextthink` fields run due original functions before those calls. Retained controls remain source state; this does not replay a command or its consumed impulse. Source edicts 1 through `maximum` are reserved independently of destination client IDs; ordinary actors begin after them. A string field such as `netname` can declare `binding: "userinfo", key: "name"`. Client reads and writes use that raw userinfo key while other actors retain private source fields. Saves retain admitted state and private memory without replaying admission; disconnect and slot reuse retire the old mapping.

The decoded program ABI selects NetQuake or QuakeWorld client builtin semantics. QuakeWorld `infokey` reads the mapped client and `sprint` keeps its level argument. Original Copper and QuakeWorld callbacks have exercised these paths against Q2 geometry. QuakeWorld components now reuse the primary codec and destination PVS/PHS recipient rules for authored sound, temporary effects and multicast. Signon state and pending actor identities survive saves; late admission receives the component signon once. Muzzle flashes retain their original origin/angle semantics through the unified event codec. Messages queued for a disconnected actor are discarded rather than redirected to a reused slot. Source protocol/session-owner messages and private client metadata still require explicit destination bindings; unsupported services report that boundary.

Native API3/API2023 components can declare `clients: { maximum, records, admit, userinfo, disconnect, command }`. Public game API calls use `entry: { kind: "game-export", name }`; PE exports and private source entries retain their separate declarations. Each source edict supplies its own client pointer. The adapter does not assume private client memory is a contiguous array. Typed client and userinfo arguments preserve the source ABI; original userinfo corrections update shared storage without recursively calling the source callback.

A rejected original admission queues the destination disconnect. Its source row remains reserved until that disconnect, so collision pointers and ground references remain valid, while further gameplay callbacks for that client are suppressed. Saving while a rejection is pending is rejected. Restored admitted clients keep their private state without replaying admission. Disabling a component releases its projections without invoking an authored player-disconnect callback on the primary game. Original Xatrix and Q2Eaks checks cover mutable userinfo, client commands and inventory, save/restore, rejection, pointer identity and slot reuse.

Shared client services distinguish the latest accepted command from an actual input application. `subscribeApplication` reports ordered before/after events for command and movement-slice scopes, effective source commands, absolute aim, source elapsed time, client generation, and nested invocation identity. Completion distinguishes success, actor removal and failure. Saves retain the invocation ordinal; restoring a save emits no input event. The five shared movement profiles publish their actual source subdivisions.

Source commit `0808144` connects original native API3/API2023 `ClientThink` and movement execution to this service. Observers see actual command duration and source aim; body changes reach the working source movement state before copyback. Removed clients keep their source allocation until the outer operation finishes, then disconnect once. Ordinary callback failures remain failures; shutdown does not call into an already discarded module. Original Xatrix and retail rerelease checks cover nested public input, body writes, removal, subsequent frames, save continuation and failed-callback teardown. Internal authored native bot callers remain unqualified. This source change is installed.

The QVM interpreter supports scoped cancellation of one source call while preserving real errors and unrelated execution. Source commit `06ba62f` connects artifact-pinned LRCTF and Threewave input boundaries. It reports actual `Pmove`/`PmoveSingle` execution, including commands retained for later `G_RunClient`, with exact source timing and aim. Body changes preserve source ground state. Removed clients run their original disconnect before the matching input call unwinds; the next client and later frame phases continue. Source slots remain reserved until the outer operation completes. Internal `ClientSpawn` settling executes unchanged without publishing application events. Original two-client checks include offhand grenades, saved continuation, nested input, source faults and slot reuse. Other module profiles remain unfinished. These source changes are installed.

Source commit `23b3a90` adds optional `clients.input` bindings for all three component families. Each binding declares a `client-command` or `movement-slice` scope, a `before` or `after` phase, and original calls. Callbacks receive applied commands, elapsed source time and absolute aim. Optional QC/native input fields stage declared source storage; QVM `GET_USERCMD` exposes the active application. Ground queries report the live working movement state. Nested contexts restore only transient input, preserving authored timers and consumed fields. Failed or removed applications skip terminal source calls and release their contexts in reverse order. A save never replays an input application. These additions are installed.

Before-input bindings may declare `outputs`. The common application folds source changes in component order, preserves received commands and exposes the effective command to the selected system. Output capabilities expire with their callback. Q1/QW, both Q2 editions and Q3 carry effective commands into their actual movement applications; selected weapon preparation runs after command callbacks. Source-relative aim uses the live delta angles. Movement-slice output applies to that slice.

QC outputs name a declared input field or an original named handler. QVM outputs name exact record fields, an original handler with its actor pointer and optional scalar return, or command storage captured within an original function. Native handler outputs declare their actual argument ABI and current client actor. A handler that actually runs may consume its control even when original code refuses the action without clearing its input. Nested applications keep their own changes; a suspended command retains only its own source writes. Callbacks cannot manufacture a received command or reuse a disconnected player.

Original full Hipnotic `PlayerPreThink` exercises grounded jumps, held landing, release/repress, airborne/water refusal and a branch that never calls `PlayerJump`. Original Threewave `PM_CheckJump` checks success and refusals through a Q2 command. Original LRCTF/Threewave and both native primary clients check actual command writeback and source-relative aim. Native components may declare original per-client frame calls on their existing source clock and source-reviewed exclusions within a containing original function. Original Xatrix and rerelease `ClientThink`/`ClientBeginServerFrame` checks execute the held-fire dispatcher and retain source ammo and timing; they do not substitute a leaf firing callback.

QVM borrowed-client event publication retains the original event numbers, player state, module identity and ordering, including saved cursors and nested stores. It does not yet attach a component cgame consumer; original mod-specific audio/effects remain unfinished. These bounded checks do not qualify arbitrary source loops, native internal bot callers, every weapon, or complete player composition. Retained non-NetQuake Q1 pre-frame work without a newly received command still follows its existing source path.

QuakeC component `PF_aim` now uses the same source aiming algorithm as the primary game, with ordered projected actors, declared `team` and `takedamage` fields, destination collision and canonical QuakeWorld `noaim`. Source declarations must distinguish `DAMAGE_AIM` from ordinary damage eligibility. QuakeWorld defaults to `sv_aim 2`; NetQuake retains `0.93`, and explicit overrides remain intact. Original QuakeWorld shotgun firing, ammo use, obstruction and saved next-shot continuation were checked in Q2 geometry. This does not establish full arsenal compatibility. Q1 addon vector punch and weapon recoil now share the existing source-owned player field, or a saved fallback when no Q1 field exists. Source decay runs once. Native Q2 kick and Q3 cameras retain their own behavior while presenting the Q1 punch. Old saves without the new marker import previously selected Q1 weapon recoil once. Addon view-roll writes now update the selected source view owner separately, preserving input and punch. Original QC uses its named `v_angle`; admitted native modules use their artifact-proven private field, and QVM uses its current client player state. Unknown native private layouts reject the write.

Native `inventory-capacity` fields declare an item and scalar width alongside count storage. Actual authored count/capacity changes commit once per item, preserving count policy and other entry properties. Nested callbacks drain already captured source changes before refreshing their private view. Admission and restore require a destination owner that stores and consumes mutable capacity; unsupported owners fail before original source mutation. Shared inventory storage qualifies; original QC hardcoded limits do not. Original API3/API2023 bandolier and pack checks cover paired writes, source save/restore, nested pickups, fixed-owner rejection and unchanged foreign armor. These are provider/source checks, not a complete Application save qualification.

Regular armor and effective powered protection are independent records. Partial regular-points, regular-equipment and powered mutations preserve the other layer; whole-state writes remain for deliberate restore/reset. Native declarations preserve separately held power items and activation masks during a regular change. Independent enum selectors retain selected armor at zero points; a positive selector sharing the points field naturally becomes unselected at zero. Planned writes validate the resulting representation before storing bytes. Unsupported family or activation changes reject before mutation.

`QTSAVE3` stores the independent layers and accepts old version-2 saves. Only a restored original source binding can normalize its exact old synthetic power-only placeholder; real depleted regular equipment remains intact. A versioned `world:primary-protection` provider record preserves current hidden engine-owned armor while components replace it. Original source owners retain their own checkpoints without a duplicate host snapshot. Unified peers negotiate `qts:snapshot-v4` for source-owned armor, raw component player events, and ownerless Q2 trail effects. The frame decoder still reads captured version-2/3 frames; native game protocols are unchanged.

QuakeC, QVM and native callback declarations may contain a `protection` list. Each entry names one `channel` (`regular` or `powered`), its source storage, selection, original absorption routine and source flag mapping. Native legacy `poweredProtection` declarations normalize to this list without altering original declaration bytes or digests; declaring both forms is an error. Regular source armor projects points and item identity with `kind: source`, without pretending that the original formula is a fixed coefficient. Each hit runs the original code against current source state. Native canonical inventory aliases remain authoritative; private source storage stays in the module's save.

Each channel has one component owner. `claim` refuses an existing owner. `replace-primary` names the permitted primary provider; `replace-current-primary` explicitly permits replacing the destination primary, so one unchanged declaration can work across games. Neither replacement admission overrides another component. One component may provide both channels, or separate components may provide one each. Reservations precede initialization and bindings follow original client admission. Removal releases both channels and reveals current primary armor. Whole-armor writes validate every affected owner before storing; ordered source observers preserve nested hits and atomic stores that affect both channels.

Shared Q1/Q2/Q3 combat applies powered protection before regular armor. Qualified original QuakeC, LRCTF/Threewave QVM, Xatrix and retail rerelease damage routines expose these stages too. Their remaining damage, momentum and reaction code executes in the original frame. QuakeC and rerelease inline regions require declared boundaries and proven continuation state; they are not implemented by executing and undoing an entire damage call. Fractional donor savings are truncated separately at original QVM/native integer interfaces, without changing the donor's original debit. Source actor retirement cancels only its owning damage frame.

Original Copper, Threewave and Xatrix donor checks exercise live rule changes and private storage. Primary-source checks cover original QuakeC, QVM and both native interfaces. These bounded checks do not establish every donor/primary combination. Standalone inline native donor declarations remain unfinished. QuakeC region donors require admitted input/output state; arbitrary bytecode regions are rejected. A regular-protection scale must reach a declared original argument/global when required: an unrepresentable scale rejects before invoking a donor leaf. Original Threewave `CheckArmor` has no such scalar interface. Rogue super-lava's original temporary armor scale is identified from its declared caller site.

Source restoration and component activation precede validation of composite armor and canonical inventory. Original activation policy, including inactive or depleted equipment, remains authoritative. A generic foreign pickup cannot invent a source armor tier, formula or capacity: it must use an admitted original operation. Full original movement/weapon loops, foreign pickup operations and remaining host services are separate unfinished work. Unsupported source stages and artifact layouts reject admission.

Native owned armor declarations retain their scalar storage and ordered selectors. Legacy `q2` declarations supply fixed metadata; `source` declarations leave savings to original code. Qualified primary native projections now read live original armor metadata. Updating one tier preserves other held items, and unrepresentable selections reject before mutation. Full health/damage ownership remains with owned native actors; borrowed protection owns only its declared channel.

Client declarations must supply the initialization expected by their original callbacks, including private fields such as the player classname pointer. Existing artifact-pinned address fields can reference original literals. An API2023 foreign-attacker probe confirmed that missing classname initialization faults in original damage reaction code; providing its declared original pointer preserves damage and pain execution.

The component frame join uses source entry time (destination frame-exit time minus elapsed). It runs after destination movement, with client source slots before dynamic source actors. This does not establish complete original `SV_Physics_Client` ordering or live destination weapon/body animation.

### Original pickup operations

QuakeC, QVM and native API3/API2023 components can declare `pickups` that call original eligibility and grant functions. Each rule names an `id`, exact `offered` item IDs, a `resource`, and an `operation`. A protection resource names its `regular` or `powered` channel; an inventory resource names an already admitted canonical item. Armor rules follow the current protection reservation. Inventory rules delegate pickup behavior while the selected inventory provider keeps ownership of storage, capacity and consumers. This does not admit arbitrary new foreign inventory items.

`boolean-grant` uses the original grant's nonzero return as acceptance. `gate-then-grant` first runs an original boolean `gate`, then a `grant` whose `grantAccepts` is `nonzero` or `always`. The distinction matters: original Q3 grants can return respawn intervals instead of acceptance. Rules must name the actual donor item or helper; the engine does not infer an armor tier or quantity from another game's item name.

Calls receive `self` (recipient), `other` (pickup), `item`, `time`, `pickup-count`, `pickup-has-count` and `pickup-dropped`. A source default has count/has-count zero; an authored override preserves its signed value with has-count one. Runtime adapters validate the source ABI. QVM and native rules can additionally declare bounded `context` fields on the foreign pickup projection, with exact record, offset and lowered value. Native image addresses rebind through the current module and pointer width. Those fields remain scoped across the original gate and grant and are restored afterward. Retained temporary pointers and donor map-lifecycle callbacks require additional support.

The ported Q1, Q2 and Q3 map callbacks retain their touch eligibility, feedback, targets, coop retention and respawn rules. One scope covers the whole attempt, preventing recursive targets from awarding the same pickup twice. A source refusal never falls back to a second grant. Disabled bindings and retired actors cancel the old continuation. Source armor with no matching rule refuses the pickup; hidden primary armor is left intact. Inventory delegation applies only to its exact offered IDs. Other inventory grants remain with their primary owner.

Original tier/count stores are observed before nested callbacks can reenter combat. Existing source checkpoints retain the resulting state, and restoration rebuilds current bindings. Original Copper and Threewave checks cover armor refusal, tier changes and restoration; Threewave also exercises original ammo limits that vary by game mode. Original native ammo checks cover both classic and rerelease ABIs; classic armor checks cover tier upgrades, refusal and save restoration. Rerelease regular-armor grants remain unverified. A public Q1 Application check touches authored armor and shell pickups, saves, loads and continues with the current original Threewave owner.

Original-primary VM grant sites and map-coupled objectives such as Q3 team items remain separate work. A configured replacement for an unsupported objective rejects before invoking donor code. QuakeC nonarmor helpers and additional source item layouts require their own qualification; the interface does not establish compatibility with arbitrary mod artifacts. This pickup change is installed in `9ddbb8d`.

### Component console commands

`modcmd PRODUCT/COMPONENT_ID <command>` selects one enabled component explicitly. Component-generated commands enter the same Application command program with their source dialect and instance identity. Cvars and script files resolve within that component; aliases and deferred commands retain the same owner. Disabling an instance cancels its pending commands, waits and script reads while preserving the other components and the primary world. Prepared worlds stage engine actions until publication.

QVM components use their original `GAME_CONSOLE_COMMAND` entry and command imports. Native API3/API2023 components use the public `ServerCommand` entry through `sv`, with source argv restored after nested calls. QuakeC `localcmd` retains component ownership instead of becoming unowned presentation text. Classic QuakeC has no general console export, so its declaration can supply named original functions:

```json
"commands": [{
  "name": "source_skill",
  "function": "skill_set",
  "arguments": [{ "kind": "argument", "index": 1, "type": "string" }],
  "globals": []
}]
```

This example binds Copper's original function. Argument index zero is the command name; missing arguments yield an empty string or zero. Argument types are `string` or `float`. `arguments-text` passes the source argument text and `argument-count` passes the number of tokens, including the command name. Constants use the existing `float`, `string` and `vector` values. The same values can populate declared source globals, which are restored after the call. Names and source signatures are validated against the exact program.

Ordinary user input continues to address the primary world. An explicit component command must not silently fall through to another game's private command handler when names collide. Engine operations such as map changes remain shared Application operations. A declaration does not add engine imports or custom console ABIs that the adapter does not support.

### Q3 body replacements

Both Q3 presentation implementations share the supplemental model renderer. A body override replaces an actor's original body models while original sounds, lighting and nested effects continue. Original snapshots and collision remain unchanged. The last enabled component supplying an override owns that actor's model group; disabling it restores the preceding group.

Compiled cgames need exact body-rendering declarations because the public `refEntity_t` has no actor identity. Verified Threewave and LRCTF declarations are built in. Other cgames can supply `cgame-presentation.json` with `version: 1`, `artifactPath`, `artifactDigest`, and a `bodySubmissions` array. Each entry declares a function instruction `entry`, its `actorArgument`, the actor's `entityNumberOffset`, and `reference: { "kind": "locals" }` or `{ "kind": "argument", "index": N }`. An optional `when: { "argument": N, "equals": V }` limits the declaration to a source call condition. Entries must match the actual module and cover its relevant body-rendering paths. See the [typed declaration](../src/compat/qvm/cgame-body.ts).

The bridge executes each original function and suppresses only body references in its declared storage. It does not guess ownership from model filenames. Unknown cgames without a matching declaration reject body replacements explicitly. Current original-bytecode checks cover general entities, missiles and movers; replacement-player attachments and every custom effect path remain unqualified.

### QuakeC projectile components

Select a declared component under **Custom game → Mods**, or pass `--mod PRODUCT/ID`. The earlier `--weapon-behavior PRODUCT/ID` selector remains supported. The component changes trajectory on a matching projectile launcher; it does not replace the launcher itself.

For a package without declarations, inspect the mounted program and bind callbacks established from its source:

```sh
./quake-typescript weapon-behavior inspect q1-classic-homefix --content /path/to/qfiles
./quake-typescript weapon-behavior declare q1-classic-homefix --content /path/to/qfiles \
  --id homefix:rocket --role rocket --fire CheckHomingRocket --activate ActivateHoming \
  --title "Homefix homing rockets"
```

These are Homefix's actual callback names. Inspection does not infer a function's purpose from its name. The command writes `weapon-behaviors.json` atomically into the writable mod directory and leaves the executable unchanged. `--artifact` selects another mounted program; `--user-content` changes the tool's writable root. Authors can ship the declaration with their package. A rebuilt executable needs a declaration with its new digest.

### Native projectile components

The native declaration binder supports Q2 API2023 Windows x64 trajectory components with the fixed capabilities described below. Its built-in declaration supports `game_x64.dll` from [Q2Eaks v0.21](https://github.com/ceeeKay/Q2Eaks/releases/tag/v0.21), with SHA-256 `b60b79f7fb6f115218681a9cbab8765267e34f72466975526df05ad288925dde`. Place the author's package in `q2/rerelease/q2eaks/` under either content root and retain the Q2 rerelease base assets. The selectable behavior is **Faster rockets**, ID `native:rocket-trajectory`. Built-in and external declarations use the same validation and execution path.

This profile executes the DLL's authored weapon policy and projectile callbacks in a private component. Selection enables its private `g_faster_rockets` setting. The component retains source initialization, inventory context, cvars, and saved state; the selected launcher retains primary ammo, damage, impact, and presentation. A public Q3 launcher workflow on Q2 geometry completed launch, save, load, and resumed projectile motion with this profile.

Native entrypoints and private layouts require an executable profile matched to the exact artifact. A rebuilt DLL or another release requires a newly verified declaration; renaming it or writing QuakeC metadata cannot make it compatible. This is separate from ordinary whole-module execution. This native result does not establish arbitrary-mod or multiplayer compatibility.

#### Native declarations

Keep the DLL, companion assets, and author-provided profile together under the selected mod's directory. For example, the writable content root can contain:

```text
q2/rerelease/mymod/
  game_x64.dll
  profiles/rocket.json             # one complete author-provided declaration
  native-weapon-behaviors.json     # installed selection document
```

Inspect the mounted image and install the supplied declaration from the source checkout:

```sh
bun run start weapon-behavior inspect q2-rerelease-mymod --content /path/to/qfiles
bun run start weapon-behavior declare-native q2-rerelease-mymod \
  --profile profiles/rocket.json --content /path/to/qfiles
```

`--profile` is relative to the product's mounted content, not the shell's working directory. `--user-content PATH` selects a different writable content root. The command reads one declaration, validates its artifact, and atomically writes the normalized profile into `native-weapon-behaviors.json` in the writable mod directory. It replaces the same behavior ID and preserves other valid entries. The output gives the exact `--weapon-behavior PRODUCT/ID` selector; the behavior also appears under **Custom game → Mods** in the current source.

Native `inspect` reports the artifact digest, ABI, PE entry-point RVA, section RVAs, sizes and permissions, and complete declared profiles. Image sections identify address ranges only. Inspection does not discover private weapon entrypoints, infer field layouts, or establish callback semantics. The author or adapter developer must establish those facts from the exact build's source and matching binary evidence.

The complete [version 1 declaration type](../src/contracts/native-weapon-behavior.ts) fixes `kind` to `q2-api2023-trajectory`, `abi` to `windows-x86-64`, and `aspect` to `trajectory`. It records:

- The mounted `artifactPath`, exact `sha256:` digest, behavior ID, title, and projectile role.
- Entity, client, and equipped-weapon record sizes and byte offsets, executable entry RVAs, and callback registration layouts. Public entity-prefix fields must match API2023.
- Source time and next-think state in signed 64-bit milliseconds, entity-to-void callbacks, and the pointer-returning allocation entry. These are fixed conventions, not arbitrary native signatures.
- Source initialization classes, equipment and ammunition commands, initial private cvars, and temporary provisioning cvar overrides. Required effects outside the component's supported ownership still fail explicitly.

Validation rejects unknown fields, overlapping or misaligned layouts, artifact mismatches, and incompatible image ranges. Those checks do not prove guessed offsets or gameplay semantics correct. A declaration must describe the author's executable behavior; it does not replace that behavior with host-side trajectory code.

The selection document has the form `{"version":1,"profiles":[...]}`, where each array entry is a complete declaration. A mounted document replaces the built-in fallback, including an empty `profiles` array. With no document, the exact Q2Eaks artifact retains its built-in choice. Authors can distribute this document directly instead of using the installation command.

Saved selections retain the normalized full declaration as part of their identity, alongside the module digest and native private state. Changing offsets, callbacks, provisioning, or other declaration fields cannot silently reinterpret an existing save, even when the behavior ID and DLL remain unchanged. This interface does not support every private ABI, weapon subsystem, or multi-projectile launch policy.

### QVM projectile components

The QVM adapter uses the same trajectory interface as QuakeC and native components. A verified profile binds the exact compiled module, callback entries, argument conventions and private layout. Its private VM retains initialization, cvars, client admission, source target/team state and activation. Save/load retains that state and the primary projectile attachment; primary collision, damage and presentation still belong to the selected launcher. Invalid or mismatched profiles fail admission.

The `homing-source-built` package uses [Anup Shinde's authored Q3 homing source](https://www.anupshinde.com/modifying-quake3/), built unchanged over the original Q3 support source. Its QVM digest is `2605056ff2f7dc5c3b157d31841ca2a5ed2db2fe97a681ae73b8c8bdfe15ccef`. The original download, author README and build provenance are retained with the package. It is a source-built artifact, not an author's distributed binary.

The public workflow selected a Q2 rocket launcher on Q2 geometry, admitted two actual local players, observed authored steering, saved and loaded, then matched ten subsequent 50 ms trajectory samples through projectile retirement. The offline coop launch used this Q3 component's FFA-derived relationship; it does not establish cooperative team fidelity. The adapter does not automatically extract arbitrary mod subsystems or multi-projectile firing modes.

### Original QVM component sounds and effects

A QVM callback declaration can include `presentation` with `version: 1` and `runtime: "qvm-player-events"`. Both `gameplay` and `cgame` identify the original program path, digest and ABI. The cgame must be present in the same component's mounts. Preparation rejects a mismatched program or storage layout before executing it. The enclosing declaration digest pins this presentation contract in saves.

`storage` declares original gameState, player-state, snapshot, centity, time, frame-time and view-origin locations. `initialize` runs original context and media registration; `refresh` runs original configuration updates after a source revision changes. `project` and `event` execute the original player-state projection and event handler. `frame` advances original transient pools and mark submissions once per application frame. Function addresses and offsets must come from that exact executable; there is no host table translating mod event numbers into stock effects.

Each local viewing seat owns a separate cgame instance. The event target keeps its source client number while the snapshot contains the viewing player's original state. Its header is explicitly `synthetic-player-event`, with no entity list or area mask; it is not a full source network snapshot. The application supplies its actual camera origin and elapsed source time. Event geometry survives into the next frame, and the source's own frame routines control transient expiry.

Captured geometry, lights and source media join the destination view. Sounds and loops have a component owner as well as an actor and seat, so retiring one component cannot stop another's channels. Save/load rebuilds cosmetic client state from the restored source and event cursor. World replacement, removed viewers and source-generation changes retire old clients and resources.

This support covers local declared player events. Full component snapshots, entity-event dispatch, HUD or camera ownership, background music, shader remapping and cinematics still need shared ownership and transport. These unscoped client operations reject explicitly. They are not silently accepted or redirected to the primary game. Original Threewave source code has bounded sound/media and transient-rendering evidence; this does not establish arbitrary cgame compatibility.

## Maps and source rules

`--map-game` selects geometry independently from the game module. Shared collision queries adapt geometry to the module's source interface. The game module still interprets authored entities, objectives, scripts, and progression. Unknown entity classes retain their authored keys and reach the selected module; the host does not infer a replacement from a map or mod name.

Local foreign-map support does not make an original network client understand another engine's BSP format. Native-wire admission preserves that distinction.
