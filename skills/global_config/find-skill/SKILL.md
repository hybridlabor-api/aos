---
name: find-skill
description: >-
  Find which skill in the AOS library fits a task, by searching it. Use when you need a skill by name or topic and do not know which one covers it.
category: bdb-core
---

# `find-skill`: find the right skill

You do not need every skill loaded. Search the library, pick the best match, read only that skill.

## Search

```bash
aos store search <words>
```

- Every word must match the skill name, description or category, in any order. `-` and `_` count as spaces, so `find-skill` and `find skill` are the same query.
- Results are ranked: exact name, then a word in the name, then a word in the description, then the category. Ties are sorted by name. The first row is the best match.
- The search covers all shipped AOS skills plus the ECC and Scenario stores. Narrow it with `--source=aos|ecc|scenario|all` and `--type=skills|agents`.
- Use two or three concrete words (`pcb`, `plan canvas`, `react review`). A long sentence works only if almost all its words occur in one skill.

## Use the match

1. Take the top row. Output columns: kind, name, pack/group, source, description.
2. Open `SKILL.md` of that skill. For an installed skill it is in your harness skills directory.
3. If the skill is not installed (lean skill library: only router skills are installed), run `aos store install <name>` (add `--dry-run` first to see the plan; `--harness=claude` limits it to one harness), then read `~/.aos/library/skills/<name>/SKILL.md` right away. The current session can use the skill without a restart.
4. If two rows look alike, or nothing fits, do not guess: use `ask-tim`, which maps the main flows and explains which of several overlapping skills to pick.
