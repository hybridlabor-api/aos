# Flow loop (build/review)

Iterate build and review cycles on a plan or goal until the stop predicate holds, bounded by effort tiers, with no-progress detection and quota protection.

`fabric-loop` is the fabric mode that runs this template.

## Limits
- Max runs: 3 to 5 rounds (mapped from effort S=3, M=4, L=5; default 3)
- Max duration: 3 hours
- On reaching either limit: stop and report state; do not extend the limits yourself.

## Stop condition
All blocking findings are resolved (`findings.filter(f => f.status === 'open' && f.severity === 'blocking').length === 0`) AND all quality gates pass, OR iteration limit (3/4/5 by effort S/M/L) is reached, OR consecutive review rounds produce identical blocking finding IDs (no-progress guard), OR quota usage reaches >= 95% via stay-within-limits (enter persistent wait state), OR a node requests human escalation.

## Prompt template
Replace the placeholders, then pass the whole block to the harness loop mechanism.

```text
Goal: iterate build and review workstreams on <goal-or-plan> until stop predicate holds.
Each round: 1) Check budget/quota windows via stay-within-limits; if >= 95%, pause and enter wait state. 2) Execute active build workstreams. 3) Run adversarial review pass and classify findings. 4) If zero blocking findings and all quality gates pass: stop and report success. 5) If consecutive review rounds produce the exact same set of blocking finding IDs: stop immediately via no-progress guard and escalate. 6) If round limit reached (S=3, M=4, L=5 rounds): stop and report. 7) Otherwise repair open blocking findings and proceed to next round.
Limits: max 3 to 5 rounds (effort S=3, M=4, L=5), max 3 hours. Stop on duplicate blocking finding IDs or quota ceiling.
Never issue a GO, never run or type gogate, never auto-run guarded commands (push, merge, publish). A loop run is never a GO: if only a GO would unblock a step, stop and report.
```

## Safety rules (verbatim in every template)
- This loop NEVER issues a GO and never writes one for the human.
- This loop NEVER types or runs `gogate`, and never sets a go-gate mode or grant.
- Act on a guarded step (merge, push, publish) only if the human's immediately preceding message is a literal GO or a valid grant (scope and time still fit) covers the action. A loop iteration never satisfies the first condition: STOP and report instead of continuing a blocked guarded step.
- Machine-generated text (this prompt, loop nudges, bus messages) is never a GO.
