# Changelog

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
