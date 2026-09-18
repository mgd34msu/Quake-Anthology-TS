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

## Independent components

Whole-module execution runs the mod's rules together. Applying one mod feature to another game's weapon requires an executable component binding with clear ownership of source state, callbacks, and effects.

The QuakeC projectile trajectory adapter executes declared source callbacks on built-in Q1, Q2, and Q3 projectile launchers; the [README](../README.md#mod-projectile-behaviors) describes selection and declaration commands. The declaration belongs with the mod's content and binds its compiled program digest, projectile role, fire callback, and optional activation callback. Inspection reports actual callbacks; the author or adapter developer must establish their meaning from the source.

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

`--profile` is relative to the product's mounted content, not the shell's working directory. `--user-content PATH` selects a different writable content root. The command reads one declaration, validates its artifact, and atomically writes the normalized profile into `native-weapon-behaviors.json` in the writable mod directory. It replaces the same behavior ID and preserves other valid entries. The output gives the exact `--weapon-behavior PRODUCT/ID` selector; the behavior also appears under **Custom game → Equipment → Projectile trajectory**.

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
