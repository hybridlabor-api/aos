# Changelog

## [3.3.0](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.2.0...v3.3.0) (2026-08-17)


### Features

* **installer:** add lightweight bdb-synapse integration ([d29380e](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/d29380edd44172a654999d0095f779c19f3c652c))
* **pipeline:** establish first-class /startcycle skill and cross-harness synchronization ([0a879ba](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/0a879ba360fa45531e502314221a3d62b209a907))


### Bug Fixes

* **installer:** harden synapse setup — broken symlink, Windows .exe, isAutoYes behavior ([58ed77c](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/58ed77c335faf46a35bdb9cddf4da9a2e6ab8100))

## [3.2.0](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.1.6...v3.2.0) (2026-08-13)


### Features

* **creator-extension:** transition to MCP-First architecture and modularize bdbmediastorm ([e545a11](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/e545a1192ceee6802cba40a367a8cfae5eb58c11))
* **design:** consolidate 5 design skills into authoritative godmode-ui-ux ([98c4e3f](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/98c4e3f1b17bfdee8258b3a4c9016372681e58a7))
* **harness:** add native .agents structure, sync roo modes, and update package files ([32d97d8](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/32d97d8a0dbc487ef8d87f5bcfea22c69a3a8426))
* **pipeline:** close OpenWiki-memB-Shipping loop and sanitize absolute paths across skills ([85bd732](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/85bd732fd0dbb38de56fc616a35f7ea0b9b24e7f))


### Bug Fixes

* **ci:** remove unnecessary npm install step before publish ([df6e806](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/df6e80695cebf388888dd82fd2a0b4ba2b413df5))
* **golem-rhino:** change FastMCP description argument to instructions ([dfdb933](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/dfdb933974723893e97d9d7ad11496f456cb68cd))
* **harness:** remove unneeded firecrawl skills from .agents/skills ([a8f5d30](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/a8f5d30fbaeb2e8ac35da1b00d7aa5e6c8bb23a1))
* **installer:** address sandbox test findings for robust installs ([9ef75d8](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/9ef75d8b449c55761114aa0df5b5b07199bf118e))
* **installer:** split media-eventtech custom mode into dedicated eventtech, media, and 3d godmodes to align with recent Creator Extension refactoring ([7978642](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/7978642125b9445353d1d82fbc93b361356d11a5))
* **mcps:** pin mcp&lt;2.0.0 and add PEP 723 metadata to fix runtime imports for davinci, grandma3, resolume, and rhino ([814029b](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/814029bce24be8a51ce07121b91ed10d2f7a9259))

## [3.1.6](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.1.5...v3.1.6) (2026-08-13)


### Bug Fixes

* **openwiki:** restore verified Google default model gemma-4-26b-a4b-it ([18a911c](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/18a911c205dd3f246c6763f61bdd232c8ef20c26))
* **openwiki:** use valid default Gemini model with automatic model discovery ([dc42a79](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/dc42a79792d81916cfda8d683c634d5bf4dd71b9))

## [3.1.5](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.1.4...v3.1.5) (2026-08-13)


### Bug Fixes

* **installer:** cross-platform hardening - JSON path escaping, npm diagnostics, OpenWiki TLS verify, Linux daemon detection ([42048ef](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/42048eff46a9e9d85f2dcce2fcb2e7c8ab1e11aa))

## [3.1.4](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.1.3...v3.1.4) (2026-08-13)


### Bug Fixes

* **installer:** robust JSON config parsing and correct daemon task error handling ([6693af2](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/6693af2d93a2119210b5842a7a97d24b615bae56))

## [3.1.3](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.1.2...v3.1.3) (2026-08-13)


### Bug Fixes

* **installer:** prevent memB pip install hang on Windows ([a750a9f](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/a750a9f7154aa148fc9b9ceb58745b6c099d2532))

## [3.1.2](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.1.1...v3.1.2) (2026-08-12)


### Bug Fixes

* **installer:** Windows compatibility - UTF-8, npm retries, scheduler fallback, OpenCode support ([e2c7e96](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/e2c7e96fac803cd913d7db639e4092d1388c85de))

## [3.1.1](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.1.0...v3.1.1) (2026-08-12)


### Bug Fixes

* prevent installer hang by using async daemon startup ([6b36a46](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/6b36a465f7bdc4033feee38b0161f5dc3b74f67c))

## [3.1.0](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.0.7...v3.1.0) (2026-08-12)


### Features

* expand OpenWiki LLM provider wizard with additional models ([4830a30](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/4830a307c85539c2b4749c29365522dbc76362e6))


### Bug Fixes

* **ci:** use npm install for release publish without lockfile ([3cb9905](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/3cb99056bfa68f93bfa7b87704ae5218d85cbe67))

## [3.0.7](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.0.6...v3.0.7) (2026-08-12)


### Bug Fixes

* **ci:** repair release-please workflow for v3.0.6 release automation ([f7fc4dd](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/f7fc4dd93df731b7d3e6740125aaf463a69eea19))

## [3.0.6](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.0.5...v3.0.6) (2026-08-12)


### Bug Fixes

* **installer:** inject gemini api key for memb and make davinci-resolve-mcp setup unattended ([f57e306](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/f57e306dbcad41706c952868154f8902210efed4))
* **mcp:** add setuptools_scm version spoofing for rhino fallback server ([bc95559](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/bc95559071db3ad2371e9525dd33bc89a0ebf380))
* **mcp:** replace invalid 'uv run -r' with '--with-requirements' and fix setuptools_scm version lookup for davinci fallback ([fe7e20a](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/fe7e20a1859b04a03e263545997cce47da1d3e45))
* **mcp:** resolve port conflicts, missing uv PATH, missing anyio, and open_design daemon URL ([3f4f832](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/3f4f8325bf91e562afa64524b51fd86637108930))
