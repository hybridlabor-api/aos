# SkillSpector CI

**What runs:** `.github/workflows/skillspector.yml` installs NVIDIA SkillSpector v2.12.0
(`pip install --no-cache-dir git+https://github.com/NVIDIA/SkillSpector@c7958a32...`, pinned commit) and runs
`skillspector scan <skill-dir> --no-llm --format json` (static only, no API keys, read-only token).

**Triggers:** `pull_request` and `push` to `main` for `skills/**`, the workflow, the baseline and the filter
script. Note: the badge reflects the *workflow run*, and any run that also touches the workflow/baseline/
filter files updates it — a green badge can coexist with findings during the warn period (see below).

**Changed-only scanning:** a PR's diff is taken for **all** files under `skills/**` (not only `SKILL.md`).
Each changed path is mapped to its skill directory: the nearest ancestor containing a `SKILL.md`; if no
ancestor has one, the top-level `skills/<category>/<name>` directory is used. The resolved directories are
de-duplicated and scanned. If a changed file has no resolvable skill directory, the job emits a `::warning::`
instead of silently skipping. A skill whose files were only deleted produces no diff entries and is skipped.
The diff is read with `git -c core.quotepath=off diff -z --name-only --diff-filter=ACMR` (NUL-separated, no
quoting hazards) and processed in a NUL-safe loop. When a resolved directory no longer exists on disk, the
scan step fails with a clear error. Pushes to `main` scan all of `skills/`.

**Warn until 2026-10-21:** findings appear as `::warning::` annotations and in the job summary; the job
passes. From `SKILLSPECTOR_ENFORCE_FROM` (2026-10-21) the job fails on any HIGH or CRITICAL finding
not in the baseline. Scan errors and schema errors (exit code 2) always fail. Severity values are
**uppercase** `LOW` | `MEDIUM` | `HIGH` | `CRITICAL` (verified — the CLI emits uppercase; the filter
upper-cases defensively).

**Badge caveat:** during the warn period a run with un-baselined HIGH/CRITICAL findings still shows
green — the badge only reflects that the workflow completed. The warnings appear in the job summary,
not on the badge. The badge updates only on workflow runs; because both triggers are filtered by
`paths`, the badge does not change when unrelated code changes.

**Baseline:** `.github/skillspector-baseline.json`, a JSON array of known false positives:

    [{"skill": "bdb-aos", "id": "SH-001", "file": "SKILL.md", "reason": "why this is safe"}]

- `skill`: required, directory below `skills/` (nested: `group/name`); empty strings are invalid
- `id`: required — matched only against the report's `issues[].id` (never `category`); an entry for
  one id never suppresses a different finding of the same category
- `file`: optional — when present, the entry suppresses only findings in that file
- `reason`: required, reviewed in the PR
- Entries with undefined (missing/not-string) `skill`/`id` never match; invalid entries abort the
  filter with exit 2 at load time.

**Reports:** scan step writes `reports/<index>.json` plus an `<index>.path` sidecar mapping the index
to the skill directory, so the filter never reconstructs paths from file names (no `__` ↔ `/` guessing,
which breaks on names containing underscores).

**Baseline matching is id-only, per skill, per file (when set)** — see the schema above.

**Fail-closed:** the filter exits with code 2 unless every report JSON has an `issues` array, the
sidecar for each report exists and is non-empty, the number of reports equals the number of scanned
directories listed in `skill-dirs.txt`, and the baseline schema is valid. A missing report for a
scanned dir is a failure. `SKILLSPECTOR_ENFORCE_FROM` is validated as `YYYY-MM-DD` (exit 2 otherwise)
and compared as UTC strings.

**Add a false positive:** run the scan, copy the issue `id` from the summary into the baseline with a reason,
commit in the same PR. Do not use the CLI's own YAML baseline; CI only reads the JSON file.

**Run locally:**

    pip install --no-cache-dir "git+https://github.com/NVIDIA/SkillSpector@c7958a3268d9498644b22edb75d0f051bbc8cbfc"
    skillspector scan skills/<name> --no-llm --format json -o /tmp/r/1.json
    echo "<name>" > /tmp/r/1.path
    node .github/scripts/skillspector-filter.mjs /tmp/r .github/skillspector-baseline.json 2026-10-21

**Transitive dependencies (supply-chain note):** only the top-level SkillSpector commit is pinned.
SkillSpector's transitive `pip` dependencies are **not** pinned in CI — they are resolved at install
time and could change upstream without notice. Installable lock/constraints files suitable for
`pip install -c` were not available in this repo, so no offline constraints approach was added. CI
uses `--no-cache-dir` so every run resolves fresh and any upstream change is visible in the run log
rather than silently cached; treat a suddenly failing or behaviorally different scan as a possible
transitive-dependency change.
