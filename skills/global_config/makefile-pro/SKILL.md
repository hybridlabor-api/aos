---
name: makefile-pro
description: "Generate, scaffold, validate and lint Makefiles and .mk files: .PHONY targets, build automation, common mistakes. Use for any Makefile work."
category: engineering-method
---

# Makefile Pro

One entry point for Makefile work, covering two phases: generating a new
production-ready Makefile and validating or linting an existing one. Covers
C/C++, Python, Go, Java and generic projects, GNU Coding Standards targets,
security hardening and CI integration.

Generation is requirements-first (language, structure, targets, install
layout) with validation as a mandatory final step; validation is a
local-first, deterministic pipeline whose exit codes decide whether fixes are
optional, recommended, or required. Pick the section below by the request:
"create/generate/write a Makefile" → Generate; "validate/lint/check/review a
Makefile" → Validate.

## Generate

- Use when a Makefile is created from scratch or manual build steps are converted to targets; do not use it for validating existing files or running builds.
- Gather requirements first: language (C/C++, Python, Go, Java), project structure (single/multi-directory), build artifacts, install layout (default `PREFIX=/usr/local`), and which standard targets (all, install, clean, test, dist, help) are needed.
- Ask the user only when information is missing or ambiguous (language, structure, registry, single vs. multiple binaries, cross-compilation); otherwise proceed with standard defaults.
- Perform a documentation lookup for unfamiliar territory: Docker/container targets, CI platform integration (GitHub Actions, GitLab CI, Jenkins), cross-compilation, package managers (Conan, vcpkg, Homebrew), multi-binary projects, or version embedding via ldflags.
- Built-in quality bar: GNU Coding Standards compliance, security hardening, dependency tracking, and automatic validation as the final step of every generation.
- Always run validation on the generated file before handing it back (see Validate).
- Full guide: generator/GUIDE.md
- Helper scripts live in generator/scripts/.

## Validate

- Use when checking an existing Makefile or `.mk` file: quality, linting, hardening, security or troubleshooting before CI.
- Default entrypoint, run for every check:

```bash
bash scripts/validate_makefile.sh <makefile-path>
```

- Layers run in order: dependency preflight (`python3`, `pip3`, `make`), GNU make syntax check (`make -n --dry-run`), `mbake validate`, `mbake format --check`, custom security/best-practice/optimization checks, plus optional `checkmake` and `unmake` when installed.
- Exit codes: `0` = passed, `1` = passed with warnings (fix recommended, merge-policy dependent), `2` = failed — errors must be fixed and the run repeated.
- Record the command, exit code, and error/warning/info counts from every run; open reference docs only for the finding types actually reported.
- Fix, rerun, and stop when no new errors appear; document any warnings accepted intentionally and always report the latest exit code.
- Full guide: validator/GUIDE.md

