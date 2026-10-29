# How a release is cut

Process as of 5.3.0, verified from CI config, scripts and git history. Repo:
`hybridlabor-api/aos`, public on GitHub by design.

## release-please does the versioning

- `.github/workflows/release-please.yml` runs
  `googleapis/release-please-action` (pinned to the v4 sha) on `main` with
  `release-please-config.json` and `.release-please-manifest.json`.
- Version bumps come from Conventional Commits only, with `"versioning":
  "always-bump-patch"`: `feat:` and `fix:` both cut a patch release (5.4.x);
  a minor or major release needs an explicit `Release-As: x.y.z` footer; `chore:`/`docs:`/`refactor:` are
  invisible to the bump math (docs: no changelog line either). This is why
  subject prefixes matter — an unprefixed subject is invisible to the bot
  (AGENTS.md "Release automation").
- The config mirrors every shipped version file — the plugin manifests,
  marketplace entries — via JSONPath `extra-files`
  (release-please-config.json), so plugin versions never drift from the npm
  version.
- `package.json` is never bumped by hand; the manifest in
  `.release-please-manifest.json` tracks the last released version
  (currently `5.3.0`).
- The release PR merge (title "chore(main): release X.Y.Z", e.g. #168 for
  5.3.0) is what creates the tag.

## CI jobs

`.github/workflows/ci.yml` has three jobs:

1. `test` (Syntax & Validation): `node --check installer.js`, the skill
   validator self-test, profile validator, and `jq empty` on every JSON file.
2. `full-test`: the whole `npm test` suite in a container sandbox
   (`AOS_TEST_SANDBOX=container`) on Node 24.
3. `windows` (Windows hooks): `node --test tests/windows-hooks.test.js
   tests/antigravity-hooks.test.js` on `windows-latest` — runs only on
   `v*` tags and manual dispatch (S8-8, 3fab97c7).

Skill metadata is additionally checked by the separate `skillspector`
workflow.

Release-please PRs and release commits skip jobs 1-2 explicitly
(the `if:` guards), so a release merge never waits on itself.

## Publish, and the beta channel

After a release is created the workflow checks out full history with tags —
required because prepack rebuilds `shipped-hashes.json` from every `v*` tag
(S8-3; the workflow comment at release-please.yml:28-30; a shallow clone
ships an empty list and a *publish* is refused for that,
scripts/build-shipped-hashes.mjs:35-40) — then publishes (release-please.yml:
39-47; S8-2/S8-3 in 82a209a1):

- a plain version goes out with `npm publish --access public` (dist-tag
  `latest`);
- any version with a prerelease suffix (`*-`) goes to a dist-tag derived from
  the suffix word — `beta` for `5.0.0-beta.N` — never `latest`. A prerelease
  therefore only reaches installs that name that exact version or dist-tag;
  nothing auto-installs it.
- the beta line itself was configured in release-please during the beta
  phase (`prerelease: true`, `prerelease-type: beta`, S8-1 40da5ae1; visible
  at tag `v5.0.0-beta.1`), and 5.0.0 graduation was one explicit commit
  (`chore(release): graduate from beta to stable 5.0.0` with `Release-As:
  5.0.0`, 3b309af) that dropped the prerelease setting so the next release
  published to `latest`.- npm pack emits a tarball of file entries only — no directory entries
  (verified with npm 11 on the dev machine: `tar -tf` lists only
  `package/<files>`); the installer's extraction strips the `package/`
  prefix with `--strip-components=1` (lib/tar-extract-args.js).
- `shipped-hashes.json` is regenerated at pack time by the `prepack` script
  (package.json:32 `node scripts/build-shipped-hashes.mjs`): it hashes every
  payload file of every released tag via `git ls-tree`/`git cat-file`, so the
  file inside the tarball is a reliable ownership oracle for the installer's
  conflict logic (installer.js:1017-1034). Its generation can never embed its
  own hash (the hashed blob list is built before the file is written), and
  the installer always overwrites it (installer.js:1018-1022, d1ffd60).
- `.env` files are excluded from the payload (`"files"` plus S8-6 e4d9ffb8,
  eb030baf: drop only local secret env files, keep `.env.example`).

## The bundle branch

Since 5.2.0, features ride `main` through long-lived bundle branches instead
of one-PR-per-fix bursts: `release/5.2-bundle` (PR #164, gate v2, ECC
reviewer parity, lane-b ergonomics, Windows fixes — 18 merges inside the
branch) and `release/5.2.2-bundle` (PR #167: installer idempotent updates,
gateway settings, Windows module locks, router R1) both merge to `main` and
release-please cuts the release from the result. Integration branches feed
the bundle (`integ/open-points` -> 5.3.0 via PR #169).

## The test matrix before tagging

Verified release ritual, from the recorded runs and repo evidence:

- **macOS, first and second run.** `tests/installer-e2e.sh` — real network,
  throwaway `$HOME`, run before a release and outside `npm test` on purpose
  (tests/installer-e2e.sh:1-9). It installs fresh, then re-runs the
  installer and asserts the second run both refreshes AOS-owned files
  (stale hook, workflows, stale skill) and leaves user files and foreign
  hooks intact. The 46-row acceptance matrix (docs/
  aos-4.16-to-5.1-agent-notes.md:35) runs against the packed tarball; the
  5.0.0 graduation recorded `macOS 46/46`.
- **Windows, interactive.** The acceptance run happens on a separate
  Windows test machine with computer-use supervision and an explicit human
  GO on that machine (docs/aos-4.16-to-5.1-agent-notes.md:36). The
  graduation commit recorded Windows green for 5.0.0 (3b309af).
- **Forced lock-path test.** The Windows module-lock path is exercised
  deterministically: tests/rename-retry.test.js forces persistent EPERM and
  asserts the clear locked-module message; tests/
  stop-module-processes.test.js drives both stop passes against fake
  process tables.
- **Container suite.** `npm test` under `AOS_TEST_SANDBOX=container`; the
  5.0.0 graduation recorded Docker FULL 248/248.

## Rollback

The repo does not encode a post-publish rollback command. What it does give:
beta separation keeps a bad prerelease completely off `latest`; the module
update path never removes the previous versioned tree until the swap has
succeeded and restores it on failure (installer.js:2795-2860 comment),
re-`installing the previous version` is just naming that version; and the
AOS store has explicit `aos store rollback <name>` with validated backups
(bin/aos-store.mjs:140, lib/store-shared.mjs `rollbackInstall`, WP4/WP5 1f16fdd).
For npm itself, recovery means publishing a fix release — one more reason
`feat:` discipline matters.
