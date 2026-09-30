---
name: read-the-damn-docs
description: >-
  Use when implementing, integrating, upgrading, debugging, or answering
  anything involving third-party APIs, libraries, frameworks, CLIs, cloud
  services, model or provider SDKs, fast-moving product behavior, unfamiliar
  repo docs or specs, errors that may indicate API drift, or high-stakes auth,
  security, billing, data, migration, deployment, compliance, or privacy
  behavior. Forces a docs pass before coding from memory.
category: engineering-method
source: BuilderIO/skills
---

# Read The Damn Docs

Do not guess where authoritative docs can answer the question. The most common
correct move is to search for the current official docs, open the relevant
pages, and read them before writing code. For APIs, versions, provider behavior,
config, limits, lifecycle hooks, or security-sensitive flows, ground the answer
in what the docs actually say.

**Division of labour with `AGENTS.md`.** `AGENTS.md`'s *Zero guesswork* rule
states the obligation and the trigger list. This skill is the **procedure** that
discharges it. If the two ever disagree, the rule in `AGENTS.md` wins and this
file is the thing that should change.

Adapted from [BuilderIO/skills](https://github.com/BuilderIO/skills) (MIT).
Prose only — no upstream scripts, no agent config, no dependency.

---

## 1. Docs-First Triggers

Read docs before proceeding when any of these are true:

- The user asks for "latest", "current", "official", "supported", "best
  practice", "recommended", "today", "now", or "look it up".
- The needed docs are **not** already in the repo or supplied by the user.
  Search for the official docs rather than hoping model memory is current.
- The task adds, upgrades, configures, or imports a package, SDK, framework,
  plugin, CLI, model, cloud resource, or provider integration.
- The API is fast-moving or version-sensitive: AI SDKs, model provider APIs,
  Next.js, React, Tailwind, Vite, Drizzle, Prisma, Stripe, GitHub, Slack,
  Notion, browser APIs, deployment platforms, auth libraries, and similar.
- The implementation depends on auth, OAuth scopes, permissions, secrets,
  webhooks, billing, payments, PII, encryption, data retention, migrations,
  retries, rate limits, quotas, caching, deploys, or compliance.
- An error mentions deprecation, unknown options, missing exports, invalid
  config, unsupported fields, changed defaults, or version mismatch.
- The repo has local docs, ADRs, generated schemas, OpenAPI specs, route or
  action registries, design-system docs, or package-level READMEs that could
  define the contract.
- The choice is expensive to reverse: public wire formats, database schema,
  migration strategy, persistent IDs, event names, customer-visible behavior,
  or external automation contracts.
- You catch yourself about to write "usually", "probably", "I think", "from
  memory", or code copied from model memory for an external API.

---

## 2. What Counts As Docs

Use the most authoritative source available:

- **Local** repo docs, specs, ADRs, schemas, generated types, package READMEs,
  and tests — for project-specific behaviour.
- **Official** product docs, API references, migration guides, changelogs,
  release notes, and SDK source or type definitions — for third-party
  behaviour. Find these with web search when you do not already have the URL.
- **Package registry metadata** for versions. Before adding a dependency, check
  its current version (`npm view <pkg> version`, `pnpm view <pkg> version`, or
  the ecosystem equivalent), then read the docs for *that* major version.
- **Source code or type definitions** when official docs are incomplete. Treat
  this as evidence, not folklore.

Avoid Stack Overflow, old blog posts, random snippets, and memory as the
primary source when official docs exist. Use community sources only to debug
symptoms *after* the authoritative contract is known.

**In this environment:** `firecrawl-search` and `firecrawl-scrape` are the
installed tools for the web pass, and `deja-memory` / `memb_mcp` can surface
prior project knowledge. Neither substitutes for a docs read.

---

## 3. Required Workflow

1. **Identify the exact surface** — package name, installed version, target
   version, provider endpoint, CLI command, config file, local helper, schema,
   or product feature.
2. **Search for the current official docs**, unless the relevant docs are
   already local or the user supplied a URL. Targeted queries work best:
   `<product> <feature> official docs`, `<package> migration guide`,
   `<provider> API reference`.
3. **Open and read the docs closest to that surface.** Prefer local docs first
   for internal code, then official upstream docs. For new packages, verify the
   latest version before writing imports, config, or install commands.
4. **Extract the few facts needed** — option names, imports, lifecycle rules,
   default behaviour, breaking changes, limits, permissions, and examples for
   the current major version.
5. **Implement or answer using those facts.** If the docs conflict with existing
   code, inspect the local code path and call out the discrepancy — do not
   silently pick one.
6. **Verify with the smallest useful check** — typecheck, tests, build, CLI dry
   run, API schema validation, or a local reproduction. This is the same
   "narrowest quiet validation" rule the Shipping gate enforces.
7. **Name what you read** in the final answer, when that evidence affected the
   recommendation or the implementation.

---

## 4. Examples That Must Trigger A Docs Pass

- *"Add Tailwind to this app."* — Check the current Tailwind major and its
  install docs before creating config files or assuming old PostCSS setup.
- *"Stream responses with the AI SDK."* — Verify the current SDK major,
  provider package names, streaming helpers, and runtime examples.
- *"Wire up Stripe webhooks."* — Read current signature verification, event
  retry, endpoint secret, and framework body-parsing docs before coding.
- *"Fix this Next.js caching bug."* — Read the docs for the **installed** major
  and router mode before assuming cache invalidation semantics.
- *"Add Drizzle migrations."* — Read the current kit docs **and** the existing
  repo migration conventions before generating files.
- *"Create a GitHub Action."* — Read Actions syntax and permissions docs,
  especially `pull_request`, `workflow_run`, OIDC, tokens, and artifacts.
- *"Why does this OAuth flow fail?"* — Read the provider's scopes, redirect URI,
  PKCE, token refresh, and app-verification docs before changing code.
- *"Use this repo's plan/comment/action system."* — Read local docs, route and
  action registries, schemas, and tests before inventing endpoints or props.
- *"Upgrade Vite/React."* — Read the migration guide for the **exact** target
  major before editing config or imports.
- *"What model should we use?"* — Read current provider model docs, pricing and
  limits pages, and SDK examples before recommending.

---

## 5. When A Quick Local Read Is Enough

Do not search the web for every tiny edit. A docs pass can be local and brief
when the answer is already in the repo: existing helper usage, nearby tests,
typed interfaces, generated clients, ADRs, or package READMEs.

But if the task depends on an external tool, package, provider, or current
product behaviour, a search is usually the right first step. For trivial
language syntax, typo fixes, formatting, or self-contained code with no
external contract, proceed normally.

---

## 6. If Docs Are Unavailable

If network access, auth, or missing local files prevents reading the docs, say
that plainly **before** relying on memory. Narrow the uncertainty, inspect
source or types if available, and do not present the result as
confirmed-current. A clearly-labelled estimate is useful; an unlabelled one is
a defect.

---

## 7. Verification

- [ ] Every trigger in §1 was checked before writing code, not after.
- [ ] The exact version in play was established (installed vs. target), and the
      docs read match that major.
- [ ] At least one authoritative source backs every external API, option name,
      default, limit, and lifecycle claim in the output.
- [ ] No claim rests on Stack Overflow, a blog post, or model memory as its
      primary source.
- [ ] Conflicts between docs and local code were surfaced, not silently
      resolved.
- [ ] The smallest useful verification check was run and its result reported.
- [ ] The sources consulted are named in the response where they affected the
      recommendation.
- [ ] Any remaining uncertainty is stated explicitly, with what would resolve it.
- [ ] No npm dependency, script, or executable was added by this skill.
