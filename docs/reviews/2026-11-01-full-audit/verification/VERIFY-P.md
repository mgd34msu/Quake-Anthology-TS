# VERIFY-P — severity decisions from the independent re-measurement (RETIME), applied by the audit lead

### GUEST-005
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: RETIME-002 measured retail DLLs in the real Application. The synthetic 7x ratio holds at 7.9x, but floating point takes 18.2% of the classic whole step and 7.8% of the rerelease step, and an FP instruction costs 2.3x a non-FP one in real code. A real cost, but not the main limit; GUEST-004 is.

### GUEST-004
Verdict: confirmed-with-changes
Corrected severity: High
Reason: RETIME-001 confirms this on retail data: 0.72 MIPS at about 83K instructions per frame, so the interpreter needs about 110 ms for a 100 ms server frame with a classic DLL on base2.

### RENDER-007
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: RETIME-008 and VERIFY-F confirm the trigger on real Q1 maps (e1m1 has 1,278 children on leaf 0), but the cost is at most about 0.1 ms per query.

### RENDER-008
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: RETIME-009 measured 0.6-2.4 ms for typical real views rather than 16-25 ms, with only extreme views reaching a full frame. GL upload cost remains unmeasured, so severity stays Medium.

### UI-005
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: RETIME-010 found no pool growth with retail Team Arena strings. The defect needs other strings.

### RENDER-001
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: RETIME-007 confirmed the growth rate at about 740 MB per minute, up to about 1.7 GB, but with random backLerp that was not observed in a live client. VERIFY-B measured real play: 47 keys in 3,600 Q1 frames, with growth only for a Q1 character on a Q2-clock map at about 17 MB/s. Real-play evidence decides, so severity stays Medium, and the peak on that path is higher than VERIFY-B's 150 MB-per-pair estimate suggested.
