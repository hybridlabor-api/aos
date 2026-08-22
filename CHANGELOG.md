# Changelog

## [3.8.0](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.7.0...v3.8.0) (2026-08-22)


### Features

* **memb:** SQLite WAL mode, FTS5 BM25 hybrid search, 8-tool FastMCP surface, and deduplication ([ebd3b1b](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/ebd3b1b5555db577cda350587bcb49fc801ff7cd))


### Bug Fixes

* **memb:** flat payload content_hash lookup in memb_ingest.py for cross-run deduplication ([2ffd4d1](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/2ffd4d1cb9a4202bf5063d111fd013eb0552350d))
* **memb:** unblock global category search, upgrade to gemini-2.0-flash, and add offline fallback ([6fdec8e](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/6fdec8e9805d3f128a082b108a03b91a54771c39))

## [3.7.0](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.6.1...v3.7.0) (2026-08-22)


### Features

* **installer:** add automated NPM version drift checker and auto-updater for standalone modules ([e55de21](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/e55de2152d431c93c159ea50201e735c9b6731bf))
* **installer:** add SaaS Server Mgmt prompt and update counts ([d08ffeb](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/d08ffebcab3a49f124146cd81233700486e2588d))
* **installer:** integrate bdb-remoteos-mcp and bdbsaashost skill ([86fa32f](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/86fa32ff387f82ec98d7757bc4fa9676990d74ee))

## [3.6.1](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.6.0...v3.6.1) (2026-08-18)

### Features & Bug Fixes

* **installer:** add full 6-module selection flow and post-installation health verification routine
* **installer:** fix Windows PowerShell emoji mojibake by using standard UTF-16 surrogates
* **installer:** implement dynamic filesystem skill counting (154 curated skills)
* **installer:** add template prompt for automated Ecosystem Health Audit cron job scheduler
* **skills:** bundle `bdb-ecosystem-health` and `bdbhtmlmanueldocs` skills in curated payload
* **docs:** synchronize exact skill (154) and MCP server (21) counts across English, German, Portuguese READMEs, and OpenWiki architecture

## [3.6.0](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.5.2...v3.6.0) (2026-08-18)

### Features

* **remote:** integrate BDB OS Remote Tailscale SSE Gateway and Multiplexer support ([a0b63a8](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/a0b63a8))
* **power-ups:** standalone NPX support for Heimdall, BDB Remote, Synapse, and memB via interactive tool installer ([2e5f9ad](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/2e5f9ad))
* **rules:** add Native Cursor rule specifications for BDB Multi-Agent Team and StartCycle orchestration

## [3.5.2](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.5.1...v3.5.2) (2026-08-18)


### Bug Fixes

* adjust installer to symlink new synapse Node wrapper instead of missing Go binaries ([4b99fe4](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/4b99fe41fa60fc38ee717500a0cb2f5a04e16e47))

## [3.5.1](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.5.0...v3.5.1) (2026-08-18)


### Bug Fixes

* **installer:** handle emojis in AGENTS.md when compiling native subagents ([8a7ba66](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/8a7ba66b0583d0856b5f64b7f3c72a3988ebb547))

## [3.5.0](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.4.0...v3.5.0) (2026-08-18)


### Features

* **core:** implement BDB Ecosystem Architecture (Context Boot, OS Skill, Synapse Integration, Agent Compiler) ([0003cc6](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/0003cc66f98f9b9241612ba5092baaa422a45a3d))

## [3.4.0](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.3.0...v3.4.0) (2026-08-18)


### Features

* **installer:** add --mcps to pick an MCP subset in non-interactive runs ([f6661e6](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/f6661e6231b7d82447ed6f7cde69bb41afe89911))


### Bug Fixes

* **installer:** inject the Gemini key and python path literally ([d505b81](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/d505b8177f04048c22f48af4df2ebf66a52178ef))
* **installer:** keep file I/O errors in the install IIFEs from killing the run ([58997c3](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/58997c3a05d2ba1e36b578dfd67c04332f54c55e))
* **installer:** keep MCP config I/O errors from killing the run ([524765d](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/524765de0ce79a13277024f5fed767955be98716))
* **installer:** never overwrite an unreadable mcp_config.json in merge mode ([7eef234](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/7eef234a69b4c1a9b7732203784f10d86942158f))
* **installer:** stop the .env writer from corrupting keys containing $ ([4fb7494](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/4fb74945c9a24f0b35633070a38c18823c8555d9))
* **installer:** stop the merge from dropping user-owned MCP entries ([d5ce9d1](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/d5ce9d11e614d76eb492ae45067dd92bf3e086c0))
* **installer:** sync skills to Claude Code/Codex/Cursor/Roo and fix platform MCP injections ([ece7bf8](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/ece7bf84d0ce1551259f5a5651db56daff073670))
* **installer:** treat the Codex config.toml as TOML, not as broken JSON ([7825b8e](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/7825b8e69915c0455e16e71ebfdfca3c95e29f68))
* **mcps:** pass the collected GitHub token to the github MCP server ([14d8595](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/14d85953e3f45dd941a11139c4cc3c9668b29cb9))
* **mcps:** register the After Effects Go fallback only when go exists ([b21ed10](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/b21ed10b2d63e48fd153820eec04272df17b2663))
* **mcps:** ship after-effects-mcp sources so postinstall build can run ([0899a71](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/0899a714e6574f4459dfcd659a549607e1038f19))
* **memb:** keep default ingestion path behaviour-equal and harden file reads ([7862567](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/78625677979b6f0a606d0f2bb76a7a87fc1306e9))
* **memb:** repair ingestion crash, vault limit, file coverage and spaCy dep ([d8437b5](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/d8437b5d1e45462ea5119f98840cf09f511e8a2a))
* **memb:** tie chunking to --all-markdown, restore the default output ([8f0b5a2](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/8f0b5a24ffcfd47962709c3d5e933e1d290ea457))
* **openwiki:** create ~/Library/LaunchAgents before writing the plist ([36f0cfa](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/36f0cfabf69230abb9eb3898e59fa8fe3090c688))
* **openwiki:** create run_daemon.sh fresh instead of writing over an existing path ([9d4fbbd](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/9d4fbbdac638369a1461074d9af3a69d67b888b6))
* **openwiki:** export the entered API key before verifying it ([9fa6180](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/9fa6180d3dc22a7efd0c28991e8841b6a5e4a70c))
* **openwiki:** keep the API key out of the LaunchAgent plist and systemd unit ([f8f6156](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/f8f615678c246c302dd8bd1ccb858841d5c9cc1e))
* **openwiki:** make xml_escape produce valid XML on bash 5.2 and newer ([b146843](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/b1468438efa87e02b6c9f0b85c2d562ee29160fc))
* **openwiki:** stop reporting a schedule when only the logon fallback ran ([d97da95](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/d97da951e67f00b396b527ed93d42e42a1246c71))
* **openwiki:** stop writing the API key into autostart and check task rights ([3d14ebe](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/3d14ebecbd706e22c007d6910408a4fcf35c1878))
* **token-saver:** install Claude Code plugin to ~/.claude on Windows too ([8b7b71d](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/8b7b71df412032bc8ceb8b953e42017b24d93dd0))
* **token-saver:** look for the legacy Gemini extension in ~/.gemini ([2f23775](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/2f23775d29de45975fb490c579f72b1d60ced7bd))
* Windows paths, memB ingestion, npm packaging and installer robustness ([7bd1fad](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/7bd1fada9a0a48c24ad3f4523b2e228127f4b987))


### Reverts

* **token-saver:** drop the %APPDATA%\claude orphan cleanup ([b4ea65d](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/b4ea65da3188a4d2e7cad009d98f26d8c2f0764c))

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
