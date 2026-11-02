# VERIFY-ZZ — audit lead's ruling

### SRC9-001
Verdict: confirmed
Corrected severity: High
Reason: The crash is reproduced on a dedicated server, and no hostile input is needed. It needs an opt-in QVM mod plus bots, and peers can't add bots; built-in q3-baseq3 and q3-missionpack are unaffected. This report reserves Critical for what a remote peer can do in a realistic configuration, so it is High. VERIFY-Z judged it Critical as a normal-use crash and called that a close call. Anyone running a QVM mod with bots should treat it as a blocker.
