# Harbor Notes showcase

One invented product (Harbor Notes, a team notes app) planned in every plan variant, so the variants can be compared side by side. All content is invented.

| Variant | Folder | Open |
|---|---|---|
| Standard plan-canvas (plain Markdown) | `standard/plan.md` | `aos-plan-canvas open examples/showcase/standard/plan.md` |
| BDB Plan Builder plan with storyboard, build map and Archify | `builder/` | `aos-plan-canvas open examples/showcase/builder --mode bdb-plan-builder` |
| BDB Plan Builder visual recap | `recap/` | `aos-plan-canvas open examples/showcase/recap --mode bdb-plan-builder` |

Run the commands from `skills/global_config/plan-canvas/scripts/lib/plan-builder` (the workspace root must contain the folder).

## Agent trail

```bash
aos-plan-canvas trail examples/showcase/builder --out production_artifacts/00_execution_plan.md
aos-trail . --plan production_artifacts/00_execution_plan.md --no-open
```

## Architecture diagram

`architecture.json` is the Archify source of `builder/00_architecture.html`. Regenerate with:

```bash
aos-archify validate architecture examples/showcase/architecture.json --quality showcase --json
aos-archify deliver architecture examples/showcase/architecture.json examples/showcase/builder/00_architecture.html --quality showcase --json
```

`plan.builder.html` files are generated and gitignored.
