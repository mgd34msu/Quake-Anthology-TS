export interface SourcePin {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
  readonly excerpts: readonly { readonly firstLine: number; readonly lastLine: number; readonly purpose: string }[];
}

export const q1SourcePins: readonly SourcePin[] = [
  { id: "quake-sv-phys", path: "quake/WinQuake/sv_phys.c", sha256: "4c65e087e2a86fa6fb1883e0ec050ce0469cb31242f4c2243ac28d974826952e",
    excerpts: [{ firstLine: 126, lastLine: 144, purpose: "SV_RunThink scheduling, callback entry and removal return" }] },
  { id: "quake-remove-builtin", path: "quake/WinQuake/pr_cmds.c", sha256: "24be89ddb3a27ba2bcc90868f6bb884b069490d97d2c84c631844d63bd38b075",
    excerpts: [{ firstLine: 965, lastLine: 971, purpose: "PF_Remove delegates entity removal to ED_Free" }] },
  { id: "quake-free-edict", path: "quake/WinQuake/pr_edict.c", sha256: "90467fdbc99ffb557afae0a828e82c6d2e3d38e7509707fe4a6842578798f28c",
    excerpts: [{ firstLine: 122, lastLine: 139, purpose: "ED_Free marks free, clears entity fields and stores nextthink=-1" }] },
  { id: "quake-pr-exec", path: "quake/WinQuake/pr_exec.c", sha256: "43cc7181ee0a74f43e32045fb77f05767041fa1d94ef69f4cc8532d933340b8b",
    excerpts: [{ firstLine: 410, lastLine: 412, purpose: "OP_ADD_F stores a float after addition" },
      { firstLine: 419, lastLine: 421, purpose: "OP_SUB_F stores a float after subtraction" },
      { firstLine: 428, lastLine: 430, purpose: "OP_MUL_F stores a float after multiplication" },
      { firstLine: 447, lastLine: 457, purpose: "OP_DIV_F and signed int conversions for OP_BITAND and OP_BITOR" }] },
  { id: "quake-eval-type", path: "quake/WinQuake/progs.h", sha256: "2ba22bcae0bf4915970876e902064448c4191653968b3a2a2c5bdfade8005596",
    excerpts: [{ firstLine: 24, lastLine: 33, purpose: "eval_t float storage" }] },
  { id: "quake-prog-fields", path: "quake/WinQuake/progdefs.q1", sha256: "e81793ac2f78dc2a461d5de78c65937060ebb272c876bdf12250aec2b673d30c",
    excerpts: [{ firstLine: 3, lastLine: 11, purpose: "QC globals and time storage" },
      { firstLine: 85, lastLine: 89, purpose: "think callback and nextthink float field" }] },
  { id: "quake-host-clock", path: "quake/WinQuake/host.c", sha256: "5f16220fdd2b34e4d6c1d60a9542a951c9a379b53e030af4a19811533498b5f1",
    excerpts: [{ firstLine: 40, lastLine: 43, purpose: "host_frametime is double" }] },
  { id: "quake-server-clock", path: "quake/WinQuake/server.h", sha256: "a408184fe7a6261953d3b40f53df7020e43702abece1746206d736bc1ca59a5d",
    excerpts: [{ firstLine: 38, lastLine: 44, purpose: "sv.time is double" }] },
  { id: "mg1-hub", path: "quake-rerelease-qc/quakec_mg1/map_specific/hub.qc", sha256: "d105dbb02675b2216ff3bc5d68f04667a73a6832b7ccd13f7f6e58e5640be24a",
    excerpts: [{ firstLine: 21, lastLine: 30, purpose: "hub exit removes itself unless the complete mask is present" }] },
  { id: "mg1-sigils", path: "quake-rerelease-qc/quakec_mg1/items_runes.qc", sha256: "c53b931a1b787cc546f51e15052e0c20aca2991f58e8a5444c724e053ee4d177",
    excerpts: [{ firstLine: 28, lastLine: 37, purpose: "SIGIL_ALL includes five sigils, value 31; sixth sigil is excluded" }] },
  { id: "mg3-counter", path: "quake-rerelease-qc/quakec_mg3/mg3_triggers.qc", sha256: "9be9cf40aabd8fc7e4995462f35b7d647531d0ac765e58022d035951543ebf63",
    excerpts: [{ firstLine: 66, lastLine: 81, purpose: "Count only E1 through E4 and invoke SUB_UseTargets at threshold" },
      { firstLine: 125, lastLine: 134, purpose: "Cooperative inhibition, zero-count default and use callback installation" }] },
  { id: "mg3-defs", path: "quake-rerelease-qc/quakec_mg3/defs.qc", sha256: "6e6571276449d31a1cf62624e3ba9b11b8341034d9d1c8db20843f1d698c4632",
    excerpts: [{ firstLine: 838, lastLine: 842, purpose: "COOP_ONLY and NOT_IN_COOP masks, inhibition macro" },
      { firstLine: 860, lastLine: 864, purpose: "Sigil bit definitions" }] },
  { id: "mg3-subs", path: "quake-rerelease-qc/quakec_mg3/subs.qc", sha256: "9bf015c15ce74eff887e5f2546bc3bc055d9c868589dedbac26aa6f6b1fd854d",
    excerpts: [{ firstLine: 61, lastLine: 69, purpose: "RemovedOutsideCoop" },
      { firstLine: 311, lastLine: 335, purpose: "SUB_UseTargets can defer actual target callbacks; oracle stops at its invocation" }] },
];

export const q1OracleLimits: readonly string[] = [
  "These are evaluations of source-derived equations in strict TypeScript under Bun, not measured native or retail traces.",
  "No original C engine, retail executable, QuakeC compiler, VM or commercial asset is executed by this capture.",
  "Scalar stores assume IEEE-754 binary32 round-to-nearest ties-to-even and signed 32-bit int conversions within range. Native compiler excess precision, undefined conversions, NaN, infinity, overflow, division by zero, vector reductions and FMA are outside this oracle.",
  "SV_RunThink models one invocation on a live entity. Entity identifiers are symbolic and zero is world. Callback effects are prescribed retain, remove or reschedule operations. Remove follows PF_Remove and ED_Free for free and nextthink; other cleared edict fields, arbitrary QuakeC execution and movement are outside scope.",
  "The mg1 oracle stops at remove(self) or trigger_changelevel() invocation. It does not evaluate trigger initialization or complete a retail hub.",
  "The mg3 oracle models trigger_rune_counter spawn filtering followed by one use call. It records SUB_UseTargets invocation with self and activator; target resolution, delay, messages, killtargets and downstream callbacks remain outside scope.",
  "Rerelease mission code is pinned to the locally available source file hashes. Historical retail builds may differ, including the mg1 fifth-sigil definition.",
];
