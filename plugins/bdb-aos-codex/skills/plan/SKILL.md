---
name: plan
description: "Plan end to end: draft, render in Plan Builder, annotate, await approval, then hand off. Generated from plugin-commands.json; invoke as $bdb-aos:plan."
---

Run the full planning pipeline. Never ask which mode: BDB Plan Builder (`--mode bdb-plan-builder`) is the default; `standard` is only the fallback when the builder is not installed (`aos-plan-canvas modes`). 1) draft the plan with `concise-planning`; 2) run `aos-plan-canvas templates`, pick the template whose useWhen matches the topic, then `aos-plan-canvas new <template-id> <plan-dir>` and fill in the plan (edit plan.mdx in place on a revision; `new` refuses a non-empty target); 3) open and listen in one call: `aos-plan-canvas open <plan-dir>/plan.mdx --mode bdb-plan-builder --await` (or `open` then `await` immediately) — never end the turn without a listener; collect annotations and wait for the human's verdict; 4) only after an `approve` verdict continue with `writing-plans` or `$bdb-aos:graph`. Topic: whatever the user wrote after the skill name
