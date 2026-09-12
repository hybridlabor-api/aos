# AOS — Codex CLI & ChatGPT Codex

**Read [AGENTS.md](AGENTS.md) first.** It holds every rule that applies to all
harnesses: the non-negotiables, the release gate, Conventional Commits, the
skill contract and category routing, the pipeline variants, and the delegation
policy. Nothing from it is repeated here.

This file covers only installation and what Codex agents get.

## Installation

Via the Codex CLI marketplace:

```bash
codex plugin marketplace add hybridlabor-api/bdb-dev-optimized-agent-skills
codex plugin add bdb-dev-optimized-agent-skills
```

Or universally, across every AI environment detected on the machine:

```bash
npx @hybridlabor-api/aos@latest -y
```

Skills install to `~/.codex/skills/` alongside the other harness directories.

## The release gate is honoured, not enforced, here

`.claude/hooks/go-gate.mjs` is a Claude Code hook and does not run under Codex.
`git push`, `npm publish`, `npm version` and recursive `rm` are still gated
behind a literal **GO** from the user — nothing mechanically stops you, which
makes the rule more important, not less. The full gate, including the three
clarifications that have caused real incidents, is in AGENTS.md.

## What ships

- **memB Engine** — offline-first, zero-compute long-term memory vault.
- **OpenWiki** — autonomous project documentation and release-note builder.
- **Heimdall TokenSaver** — context-window compression.
- **CAD & Hardware Studio** — Text-to-CAD (STEP, STL, 3MF), URDF/SRDF robotics, DXF, G-code slicing.
- **Video & Media Production** — OpenMontage, Palmier Pro, local ComfyUI rendering pipelines.
- **Build pipelines** — `/startcycle`, `/startcycle-graph`, `/startcycle-graph-user`. Agent personas are portable; the dispatcher script is Claude-Code-specific, so on Codex the invoker drives each step itself, exactly as `/startcycle` describes.
