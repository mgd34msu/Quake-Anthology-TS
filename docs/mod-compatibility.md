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

The native component adapter executes declared original API3/API2023 callbacks with private linked records and original module save routines. Original Xatrix and Q2Eaks health pickups have composed on a Q3 actor in a Q1 world and resumed after saving. Native callbacks can also emit authored sound and text or replace borrowed actors' model groups. Optional source-actor declarations connect the original allocator, release routine, per-entity update, clock and use callbacks to shared ownership and collision. Original delayed actions and moving actors continue after saving without running a second whole game world. Looping sounds retain component ownership through saves and unified network events; disabling one component preserves the others' sounds. Native owned-actor combat and inventory, custom client effects and complete host-service coverage remain under development. A declaration describes an established source interface; it cannot infer a subsystem's behavior or make an unsupported engine service work. Whole-module execution and the narrower projectile adapters below remain separate compatibility paths.

Shared equipment on a native primary game needs that module's original combat interface. Currently verified destinations are the admitted Xatrix API3 DLL, retail Q2 rerelease API2023 DLL, and LRCTF/Threewave QVMs. The shared attack enters the original damage routine, preserving source armor and reaction logic. Unknown private layouts remain unsupported; the public game ABI alone does not describe them.

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

## Maps and source rules

`--map-game` selects geometry independently from the game module. Shared collision queries adapt geometry to the module's source interface. The game module still interprets authored entities, objectives, scripts, and progression. Unknown entity classes retain their authored keys and reach the selected module; the host does not infer a replacement from a map or mod name.

Local foreign-map support does not make an original network client understand another engine's BSP format. Native-wire admission preserves that distinction.
