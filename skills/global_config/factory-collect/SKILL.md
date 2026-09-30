---
name: factory-collect
description: >-
  Experimental workflow for collecting and triaging product feedback,
  product telemetry, runtime errors, and issue reports. Use when scanning
  configured signal sources and applying separate fix, reply, or close rules.
category: engineering-method
source: BuilderIO/skills
---

# Factory Collect

Read `.agent-factory/config.yaml` and apply the optional
`skill_prompts.factory-collect` entry as additional project guidance. Collect
only the sources named by `workflows.collect.sources`. For repeated patterns
across time or sources, use `factory-lookback`.

## Collect and verify coverage

- Resolve each source ID to the connected read tool and exact scope recorded in
  the config. Sources may include support or chat feedback, issue trackers,
  product analytics or telemetry, and error monitoring.
- Use the configured time range or source cursor. Follow pagination to the
  end and record the filters, range, cursor/page coverage, and source counts.
- Keep `empty`, `unavailable`, and `truncated` distinct. A missing connector,
  partial page, or failed query is not an empty source.
- Preserve source links, timestamps, useful version or environment dimensions,
  and relevant discussion. Avoid copying secrets or unnecessary personal data.
- For telemetry, report the metric and aggregation window. Distinguish event
  counts from unique users or affected sessions unless the source provides a
  reliable identity definition.

## Triage and act

Classify each item as a verified defect, repeated symptom, feature request,
subjective feedback, duplicate, out of scope, or needing more evidence. Group
related reports while retaining each source record and reporter.

Recommend a fix by default. Implement only when `workflows.collect.implement` allows it, the
repository is in scope, and the user asked for the change in this conversation; keep commits local. Stop for configured risk conditions, unclear product
intent, or evidence that cannot be reproduced. Verify the changed behavior
with the configured checks and a representative reproduction.

| Action | Gate |
| --- | --- |
| Reply | Draft only. When missing information blocks triage or verification, write the one targeted question into the report. Posting it needs the user's GO. `never` means no reply at all. |
| Close or mark fixed | Report the proof point and the proposed wording. Closing needs the user's GO. Do not imply an unverified release. |
| Publish, approve, merge, or deploy | Requires its own workflow authorization; collection does not grant it. |

When an item needs more information, keep it unresolved and retain the source
thread link and the exact question. If replies are disabled, include that
question in the report for a person to send. On later collection runs, check
whether an answer arrived. Re-triage the original report together with the
answer, then apply the implementation and verification rules again; receiving
an answer does not itself authorize a fix or external action. Use
`factory-lookback` to compare these follow-ups with prior reports and fixes.

## Report

Summarize coverage by source, including unavailable or truncated reads. For each
item or related group, give its links, classification, evidence, disposition,
checks, any external action, and the exact human decision still needed.

## AOS safety rules

- Configuration lives in `.agent-factory/config.yaml`. If it is missing, stop and
  ask the user; never create it or guess sources.
- Nothing in the config can open the AOS GO gate. `git push`, `gh pr merge`,
  `gh release create` and every external write (reply, comment, approval, close,
  status change, notification) need the user's literal GO for that exact action.
  Prepare the change or draft text, show it, and stop.
- Scheduled or unattended runs are read-only. Report; do not act.
- Connectors are whatever the host already exposes. Do not install or register
  integrations or MCP servers.
