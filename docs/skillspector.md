# SkillSpector CI

**What runs:** `.github/workflows/skillspector.yml` installs NVIDIA SkillSpector v2.12.0
(`pip install git+https://github.com/NVIDIA/SkillSpector@c7958a32...`, pinned commit) and runs
`skillspector scan <skill-dir> --no-llm --format json` (static only, no API keys, read-only token).

**Triggers:** `pull_request` and `push` to `main` for `skills/**`, the workflow, the baseline and the filter
script. PRs scan only skill directories whose `SKILL.md` changed; pushes to `main` scan all of `skills/`.

**Warn until 2026-10-21:** findings appear as `::warning::` annotations and in the job summary; the job
passes. From `SKILLSPECTOR_ENFORCE_FROM` (2026-10-21) the job fails on any HIGH or CRITICAL finding
not in the baseline. Scan errors (exit code 2) always fail.

**Baseline:** `.github/skillspector-baseline.json`, a JSON array of known false positives:

    [{"skill": "bdb-aos", "rule": "<issue id or category>", "reason": "why this is safe"}]

- `skill`: directory below `skills/` (nested: `group/name`)
- `rule`: matches the report's `issues[].id` or `issues[].category` exactly
- `reason`: required, reviewed in the PR

**Add a false positive:** run the scan, copy the issue `id` from the summary into the baseline with a reason,
commit in the same PR. Do not use the CLI's own YAML baseline; CI only reads the JSON file.

**Run locally:**

    pip install "git+https://github.com/NVIDIA/SkillSpector@c7958a3268d9498644b22edb75d0f051bbc8cbfc"
    skillspector scan skills/<name> --no-llm --format json -o /tmp/r/<name>.json
    node .github/scripts/skillspector-filter.mjs /tmp/r .github/skillspector-baseline.json 2026-10-21

Report field names (`issues[].id/category/severity/location`) are taken from the NVIDIA README; the exact
severity casing is unverified (the filter upper-cases it).
