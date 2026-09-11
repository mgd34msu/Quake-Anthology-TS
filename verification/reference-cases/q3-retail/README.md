# Q3 retail launch observation

The Steam `quake3.exe` executed under the existing Proton Wine 11 runtime, then displayed `Failed to find Steam`. No engine log, map, protocol reply, demo, or game render was captured. [launch-review.json](launch-review.json) pins the inspected private-display image and the recorded cleanup. [latest.json](latest.json) contains the raw process result, requested `q3dm1` workload, input configuration, executable identities, runtime identities, and archive hashes.

The driver command is `bun tools/reference/q3-retail/capture.ts`. It currently attempts one bounded base-game dedicated launch. Each run creates an ignored `.artifacts/q3-retail/capture-*` directory. Bubblewrap exposes the host filesystem read-only and permits writes to the owned artifact root and private temporary directory. The driver uses a fresh Wine prefix, copied retail executable, selected external PK3 symlinks, and private Xvfb. GLX is disabled for this dedicated capture. No Proton launcher, existing Steam profile, or user display is used.

All recorded process IDs were absent after cleanup. The ignored directory retains the prefix and commercial executable copy for inspection. No commercial bytes are committed. Source hashes document the filesystem review and do not assert that the available GPL source produced the Steam binary.

The user redirected work to engine implementation during this attempt. Team Arena, graphical gameplay, demos, timedemos, and further launch variants remain unqualified. This failed launch contributes no parity or performance acceptance.
