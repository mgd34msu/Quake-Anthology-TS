# Mod execution contracts

Read-only investigation of `/home/buzzkill/Projects/quake-1-re-ts`, `quake-2-re-ts`, `quake-3-ts`, and `qfiles`. No tests or game binaries were executed. This artifact records planning evidence, not a compatibility certification.

The unified engine should retain distinct family-specific game interfaces and include TypeScript binary execution as a separate compatibility subsystem. Existing code establishes QuakeC/QVM interpretation and typed game ports. The inspected execution paths do not provide a PE/ELF game loader or x86 CPU interpreter.

## Existing contracts

| Family | Verified execution boundary | Obligations |
|---|---|---|
| Q1 | Version-6 `progs.dat`, distinct NetQuake and QuakeWorld profiles, rerelease named builtins in NetQuake | Aliased 32-bit words, dynamic entity fields, entity identity, function references, builtin semantics, physics callbacks, source protocol writes, saves |
| Q2 classic | Static TS `GetGameAPI` modules, API 3 | Imports/exports, module-owned edicts and private state, shared entity/player prefixes, callback identity, message construction, saves |
| Q2 rerelease | Separate TS game API 2023 and cgame API 2022 | Distinct records, floating-point movement state, game/cgame `Pmove`, JSON saves and transitions, client slots, visibility, bots, presentation |
| Q3 | `qagame`, `cgame`, and `ui` QVM interpreter, six hash-recognized retail TS replacements, classic QVM magic `0x12721444` | Role-specific syscalls, record layouts, guest pointer arithmetic, shared entity records, snapshots, prediction, pure filesystem selection, restart and nested calls |

Q1's profile contract explicitly specifies CRCs, layouts, numbered/named builtins, allocation, timing, and spawn filtering. Its loader rejects unknown versions and CRCs. Additional dialects require additional contracts, not relaxed checks. Q1 bytecode can write protocol bytes directly, so execution compatibility does not make those messages meaningful to another game's client.

- [Q1 profile contract](/home/buzzkill/Projects/quake-1-re-ts/src/progs/profiles/profile.ts:37)
- [Q1 loader validation](/home/buzzkill/Projects/quake-1-re-ts/src/progs/pr_edict_core.ts:1135)
- [Q1 profile tests](/home/buzzkill/Projects/quake-1-re-ts/test/progs_profiles.test.ts:238)
- [Q1 message builtins](/home/buzzkill/Projects/quake-1-re-ts/src/progs/pr_cmds.ts:1336)
- [Q1 rerelease builtins](/home/buzzkill/Projects/quake-1-re-ts/src/progs/ext/qex.ts:1)
- [Q1 entity saves](/home/buzzkill/Projects/quake-1-re-ts/src/progs/pr_edict_core.ts:616)

Q2's TS interfaces deliberately reshape native structures. TS arrays replace the native edicts pointer/stride pair. Binary execution must restore guest memory layouts and pointer arithmetic. Static module selection already separates source game families. Rerelease game/cgame exports own movement and prediction; their host cannot substitute unrelated movement and assume agreement.

- [Q2 classic imports and edicts](/home/buzzkill/Projects/quake-2-re-ts/src/game/game.ts:31)
- [Q2 static module selection](/home/buzzkill/Projects/quake-2-re-ts/src/server/bindings/legacy.ts:36)
- [Q2 rerelease exports](/home/buzzkill/Projects/quake-2-re-ts/src/kexapi/game.ts:2042)
- [Q2 rerelease save bridge](/home/buzzkill/Projects/quake-2-re-ts/src/server/bindings/kex.ts:1185)
- [Q2 prediction tests](/home/buzzkill/Projects/quake-2-re-ts/test/cl_pred_kex.test.ts:84)

The official Q2 rerelease documentation describes new interfaces and layouts, 40 Hz simulation, exported prediction movement, and original expansion-map spawnflag conflicts. Its combined DLL is not automatic compatibility with every original expansion map. [Official source and API documentation](https://github.com/id-Software/quake2-rerelease-dll).

Q3's adapter borrows shared entities through guest pointers and strides while copying player snapshots. Tests cover relocation, pointer arithmetic, snapshot copying, and isolated ping writes. Retail replacements use hashes; the code distinguishes 2000 Team Arena artifacts from its 1.32b source baseline.

- [Q3 module acquisition](/home/buzzkill/Projects/quake-3-ts/src/engine/client-modules.ts:45)
- [Q3 shared data](/home/buzzkill/Projects/quake-3-ts/src/vm/game-data.ts:20)
- [Q3 data tests](/home/buzzkill/Projects/quake-3-ts/tests/qvm-game-data.test.ts:5)
- [Q3 QVM parser](/home/buzzkill/Projects/quake-3-ts/src/assets/qvm.ts:172)
- [Q3 game calls](/home/buzzkill/Projects/quake-3-ts/src/engine/qvm-game.ts:21)
- [Q3 upstream game interface](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/g_public.h)
- [Q2 upstream classic interface](https://github.com/id-Software/Quake-2/blob/master/game/game.h)

## Native artifact evidence

| Supplied artifact | Static observation |
|---|---|
| Q2 CTF, Rogue, Xatrix, LMCTF `gamex86.dll` and LMCTF `gamex86_ppro.dll` | PE32 i386, `GetGameAPI` export. LMCTF imports 63 KERNEL32 functions for memory, TLS, file I/O, library lookup, locale, exceptions, and other runtime services. |
| Q2 rerelease `baseq2/game_x64.dll` | PE32+ x86-64, `GetGameAPI` and `GetCGameAPI`; TLS, relocation, and unwind directories; 140 imported symbols across MSVC C++, CRT, and KERNEL32 libraries. |
| Quake Live `baseq3/bin.pk3` | Three i386 PE DLLs and i386/x86-64 ELF qagame shared objects. Both ELF modules depend on libstdc++, libm, libgcc_s, and libc. Quake Live remains separately identified product scope. |

Static disassembly of LMCTF includes x87 arithmetic, control-word operations, and extended-precision loads/stores. Rerelease uses scalar SSE extensively. Disassembly is not proof that every decoded instruction is reachable or that the full required instruction set has been established.

## TypeScript-only binary execution work

1. Guest address space, checked memory access, stable pointers, allocation, and callback addresses.
2. PE32/PE32+ section mapping, relocations, imports/exports, initialization, and TLS. ELF32/ELF64 dynamic symbols, versioned imports, relocations, initialization, and TLS.
3. TypeScript i386/x86-64 instruction execution, flags, indirect calls, x87 precision/control behavior, and required SSE semantics.
4. Calling conventions for the relevant Windows and System V ABIs, including callbacks and aggregate layouts.
5. TypeScript implementations of reached OS/C/C++ runtime imports, including initialization, allocation, strings, files, time, callbacks, and exceptions where exercised.
6. Guest-memory Q2 import/export structures and Q3 native entry interfaces, with independently verified layout offsets for each ABI.

PE identifies a required machine architecture independently of the file's import/export tables. Loading bytes does not execute them. [Microsoft PE specification](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format). Windows x64 additionally requires register passing, shadow space, alignment, and unwind rules. [Microsoft calling convention](https://learn.microsoft.com/en-us/cpp/build/x64-calling-convention?view=msvc-170).

Keep source ports and binary interpretation as distinct execution choices behind family-specific host contracts. Existing ports provide useful references and fast execution, but do not establish unrecognized binary-only mod support. A future TS instruction translator can accelerate the same guest model; loader, ABI, runtime, and semantic requirements remain.

## Typed host design and semantic issue

Use a discriminated union of QuakeC, Q2 classic, Q2 rerelease, and Q3 role contracts. Brand guest addresses, entity handles, client slots, resource indexes, and time units. Each execution owner retains private memory. Typed family adapters expose collision, entity linking, assets, presentation, filesystem, and session services. Save envelopes and network sessions identify their module and compatibility profile.

**Issue: binary execution cannot independently enforce gameplay overrides hidden in guest code.** Cross-game combinations require ownership rules for movement, damage, inventory, triggers, spawning, progression, and prediction. Q2/Q3 modules can implement these privately. Generic TS binary execution must therefore be accompanied by semantic adapters or explicit TS ports for requested overrides that cannot be expressed at the host interface. These combinations remain completion obligations; a working CPU emulator does not close them.

## Feasibility and acceptance gates

Use supplied bytes and require sequential evidence:

1. Correct metadata, relocation, import resolution, initialization, and module entry entirely through TS execution.
2. API version, guest structure access, and bidirectional engine callbacks.
3. Real map spawning, client connection, movement, firing, damage, linking, and frame advancement.
4. Game/level save round trips, callback restoration, and level transitions.
5. Rerelease game/cgame prediction agreement and a complete multiplayer exchange.
6. Measured simulation performance on a named Linux machine at required game cadence.
7. Instruction/import coverage and a precise first unsupported operation for incomplete fixtures.

Each supported module/profile needs an artifact identity, required builtin/syscall/import manifest, representative singleplayer and multiplayer scenarios, save/network evidence, and cross-game semantic checks. Unknown QuakeC dialects, extended QVM formats/syscalls, further ABIs, and mod-private protocols are uncovered compatibility work. Passing one DLL or the stock TS ports does not close those categories.

## Reproduce the static inspection

These commands only read supplied artifacts. `objdump` and `readelf` inspect files; they do not load or execute game modules.

```bash
rg --files /home/buzzkill/Projects/qfiles -g '*.dll' -g '*.so' -g '*.pk3'
file /home/buzzkill/Projects/qfiles/q2/lmctf/gamex86.dll
file /home/buzzkill/Projects/qfiles/q2/rerelease/baseq2/game_x64.dll
objdump -p /home/buzzkill/Projects/qfiles/q2/lmctf/gamex86.dll
objdump -p /home/buzzkill/Projects/qfiles/q2/rerelease/baseq2/game_x64.dll
objdump -d /home/buzzkill/Projects/qfiles/q2/lmctf/gamex86.dll
objdump -d /home/buzzkill/Projects/qfiles/q2/rerelease/baseq2/game_x64.dll
```

The following reproduces all discovered Q2 game-DLL formats/imports/exports and Quake Live archive formats/dependencies without extracting retail files to disk. Linux anonymous memory files are closed after inspection.

```bash
python3 - <<'PY'
from pathlib import Path
import os
import re
import subprocess
import zipfile

for path in sorted(Path('/home/buzzkill/Projects/qfiles/q2').rglob('game*.dll')):
    print('\nFILE', path)
    print(subprocess.check_output(['file', str(path)], text=True).strip())
    output = subprocess.check_output(['objdump', '-p', str(path)], text=True)
    imports = {}
    current = None
    for line in output.splitlines():
        if 'DLL Name:' in line:
            current = line.split('DLL Name:', 1)[1].strip()
            imports[current] = []
        match = re.match(r'\s+[0-9a-f]+\s+<none>\s+[0-9a-f]+\s+(\S+)', line)
        if match and current:
            imports[current].append(match[1])
        if re.search(r'\bGetC?GameAPI\b', line):
            print('EXPORT', line.strip())
        if any(name in line for name in ['Thread Storage Directory', 'Exception Directory', 'Base Relocation Directory']):
            print(line.strip())
    for library, symbols in imports.items():
        print('IMPORTS', library, len(symbols), ', '.join(symbols))
    print('TOTAL IMPORTS', sum(map(len, imports.values())))

archive = zipfile.ZipFile('/home/buzzkill/Projects/qfiles/quakelive/baseq3/bin.pk3')
print('\nQL ARCHIVE', archive.namelist())
for name in archive.namelist():
    data = archive.read(name)
    print(name, len(data), subprocess.check_output(['file', '-'], input=data).decode().strip())
    if not name.endswith('.so'):
        continue
    descriptor = os.memfd_create('quake-module-static-inspection')
    try:
        os.write(descriptor, data)
        source = f'/proc/self/fd/{descriptor}'
        dynamic = subprocess.check_output(['readelf', '-d', source], pass_fds=(descriptor,), text=True)
        print('\n'.join(line.strip() for line in dynamic.splitlines() if 'NEEDED' in line))
        symbols = subprocess.check_output(['readelf', '--dyn-syms', '--wide', source], pass_fds=(descriptor,), text=True)
        print(symbols)
    finally:
        os.close(descriptor)
PY
```

Import-table parsing above matches the installed GNU objdump format observed during inspection. Full `objdump -p` output remains the authority if a different tool version changes the presentation.
