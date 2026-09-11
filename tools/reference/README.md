# Reference captures

Run the read-only inventory with:

```sh
bun tools/reference/environment.ts
```

It writes `verification/reference-environment.json`. The record uses the source census's repository registry, currently thirteen original and donor trees, and pins every Git-visible changed or untracked source file, the Bun executable and capture code, tool availability, hardware observations, and candidate native binaries. Raw command outputs remain in the record. Source and retail directories are read-only inputs.

`environment.ts` exports `identifyFile` and `observeCommand` for the family capture drivers. File identities use SHA-256. The command helper records both streams, nonzero exits and timeouts; importing it does not run the inventory. Its subprocess environment inherits the caller's environment and explicitly forces `LC_ALL=C`. The record stores that explicit override rather than publishing the caller's full environment. A gameplay driver must separately pin the variables that affect its workload and isolate writable profiles, network endpoints and displays.

The inventory found native `q2repro` and `q2reproded` builds under the adjacent original-source tree, with both classic and rerelease game modules. Their executable hashes identify the observed binaries. A current Git revision does not prove which revision or compiler settings produced an existing ignored build. The `q2-native` capture lane records actual execution and qualifies that provenance separately.

The default discovery roots also include the installed `Quake`, `Quake 2` and `Quake 3 Arena` titles under `~/.local/share/Steam/steamapps/common/`. Classic WinQuake, GLQuake, QuakeWorld, Quake II and Quake III executables are PE32 i386; both rereleases supply PE32+ x86-64 executables. Quake's original `quake.exe` is DOS. The installed title paths identify candidate family/edition associations; hashes identify the local bytes without claiming vendor integrity. The Steam Q3 directory's `quake3-ts` remains a TypeScript donor.

Wine was absent from PATH, but the installed `Proton - Experimental/files/bin/wine --version` succeeds and reports Wine 11.0. The inventory hashes that runtime's launch files and version metadata. Direct Wine with a fresh isolated prefix supplies a classic-reference launch candidate; each actual game launch has its own capture. The installed Proton script performs installation fixups and may create its default prefix, so the inventory does not execute it in place. No existing Steam compatdata or account/profile configuration is used.

Only the three named Steam title directories and selected runtime metadata/files are inspected. Before reading corpus or Steam file bytes, discovery restricts candidates to executable/library suffixes and known donor executable names. It excludes keys, account manifests, configs and asset files even when Steam marks every file executable. Unrelated Steam games are excluded. No original Linux Q1 or Q3 engine was found within this recorded scope; that does not prove global absence.

Source-derived cases live in family directories under `tools/reference` and `verification/reference-cases`. They evaluate original C/C++/QuakeC semantics and retain source identities and assertions. They are distinct from original executable traces. In particular, source evaluations alone do not prove host compiler rounding, complete game execution, image parity, protocol peer compatibility or campaign completion.

`verification/reference-targets.json` records required measurements and their current acceptance state. It adopts no FPS, latency or image-error number. Hardware discovery, donor agreement and a source-derived arithmetic result cannot supply those measurements. Real workload captures must record raw samples, camera paths, clocks, dimensions, cvars, content precedence, actual driver details and controlled conditions before a target can be justified.

Check the shared helpers with:

```sh
bun test tools/reference/environment.test.ts
```

The tests use actual temporary files and Bun processes to check SHA-256 identity, symlink resolution, stream/exit capture and termination of a timed-out process. They also check the file-selection rule that excludes account/profile data and prevents a neighboring title from matching a selected installation path.
