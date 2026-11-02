# VERIFY-S — the audit lead's rulings where the source review (VERIFY-Q) carried a different severity without new evidence about reach or cost

### CONTENT1-003
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: VERIFY-C's ruling stands. The source review made no claim about severity: horde has no original counterpart.

### GAPQ12B-003
Verdict: confirmed
Corrected severity: Low
Reason: VERIFY-G's measured cost stands, about 0.5 ms per tick for 8 players. The source review only noted it is port-specific.

### CONTENT2-002
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: VERIFY-C's measured 0.6 s window stands. The source review confirmed the difference from m_hover.c but did not re-measure reach.

### CONTENT2-003
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: VERIFY-C's narrow-trigger finding stands. The source review confirmed the mechanism at g_weapon.c:47 but did not re-test how often monsters stay frozen.

### GAPQ3-005
Verdict: confirmed
Corrected severity: High
Reason: VERIFY-G's ruling stands. The source review found the missing wrap is inherited from id's cgame, but here it becomes a fatal bounds error that peers can trigger, where the original read out of range without exiting.

### GAPQ3-010
Verdict: refuted
Corrected severity: Info
Reason: VERIFY-G refuted the trigger. The source review states it did not re-test this and it has no source claim.

### BOTS-006
Verdict: confirmed
Corrected severity: Low
Reason: VERIFY-G's cost ruling stands. The source review made no statement about it.

### BOTS-013
Verdict: confirmed
Corrected severity: Low
Reason: VERIFY-G's cost ruling stands. The source review made no statement about it.

