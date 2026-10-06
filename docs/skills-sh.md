# skills.sh listing

`skills.sh` is the public catalog of installable skills. It is populated
anonymously by the `skills` CLI: every install made through
`npx skills add <owner/repo> --skill <name> -y` is reported by the CLI and
grouped on the site. `skills.sh.json` in this repo is a display-only grouping
and does not drive what the script emits.

## What scripts/list-skill-installs.mjs prints

The script scans `skills/**/SKILL.md`, reads the frontmatter `name` and
`category` (a small frontmatter reader; folded `>`-style descriptions are
skipped), and prints one command line per skill, exactly once:

```
npx skills add hybridlabor-api/aos --skill <name> -y
```

The slug comes from `--repo` (default `hybridlabor-api/aos`) and both it and
every skill name are validated; anything invalid is skipped and reported to
stderr, never placed in a command line.

Ordering is by tier:

1. pipelines: `startcycle`, `startcycle-graph`, `startcycle-graph-user`
2. category `bdb-core`
3. names starting with `bdb-` or `aos-`
4. playbooks: names starting with `pb-`
5. everything else (alphabetical)

Options: `--json` (array of `{tier, name, category, command}`), `--tier <n>`
(one tier only), `--out <file>` (write the lines to a file; refuses to
overwrite an existing file), `--count` (per-tier numbers). The script never
runs any process — it only prints. Exit 0 on success, 2 on usage errors.

## Who runs the installs

Nobody in the pipeline runs the install commands. Adding a skill to skills.sh
is a one-time manual step: a human copies the printed lines and runs them in a
scratch directory. Until then a skill is not listed there, regardless of its
presence in this repo.
