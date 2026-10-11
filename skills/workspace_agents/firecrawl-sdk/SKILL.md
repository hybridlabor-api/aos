---
name: firecrawl-sdk
description: "Integrate Firecrawl into product code: SDK setup and FIRECRAWL_API_KEY onboarding, /scrape, /search and /interact endpoints. Use when an application (not the agent itself) calls Firecrawl."
category: library
---

# Firecrawl SDK

Use this skill when Firecrawl must live inside product code: the application
itself calls the Firecrawl SDK or REST API at runtime, driven by a
`FIRECRAWL_API_KEY` from its environment. This is the app-integration path,
not the agent's own live web work — for ad-hoc scraping, crawling, searching
or interacting done by the agent during a task, use the `firecrawl` CLI skill
instead.

Typical product cases: knowledge ingestion from known URLs, enrichment from
company or docs pages, answer generation with cited sources, extraction behind
login-gated or JavaScript-heavy pages. The guides cover the three endpoints in
build order: `/scrape` for one known page, `/search` when only a query is
known, `/interact` when the page must be acted on before it can be read.
Start with the cheapest endpoint that fits and escalate only when the data is
not reachable yet: scrape → search for discovery → interact for pages that
must be manipulated.

## Guides

Open these in order of need, not all at once:

- `overview.md` — start here: scope of the SDK integration path and how it differs from the CLI skills. Read it first in every new integration.
- `onboarding.md` — install, browser auth, and wiring `FIRECRAWL_API_KEY` into the project's `.env`. Open it when the app has no Firecrawl access yet, or when the human still needs to sign up or authorize in the browser.
- `scrape.md` — content from one known URL: formats (default `markdown`), `onlyMainContent` for article-like pages, rendering options, and when to escalate to `/interact`. The default extraction primitive.
- `search.md` — the feature starts from a query, not a URL: turning a search into a shortlist of pages for later extraction. Keep search and extraction conceptually separate unless scraping results is clearly required.
- `interact.md` — pages that need clicks, typing, forms, pagination or navigation before content is readable. Keep it scoped to the smallest browser workflow that unlocks the data.

## Endpoint order at a glance

- Have a URL, need page content → `/scrape` (`scrape.md`).
- Have only a query, need to discover sources → `/search` (`search.md`), then scrape the shortlist.
- Content locked behind clicks, forms or login → `/interact` (`interact.md`), scoped to the smallest workflow that unlocks the data.
- First Firecrawl contact in this app at all → `onboarding.md` before any of the above.

## References

- `references/project-setup.md` — wiring Firecrawl into the project structure and environment.
- `references/auth-flow.md` — the browser sign-in / authorization flow when the human must approve access.
- `references/sdk-installation.md` — installing the chosen SDK or preparing the REST path.
