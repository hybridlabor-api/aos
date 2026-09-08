# Changelog

## [3.12.1](https://github.com/hybridlabor-api/aos/compare/v3.12.0...v3.12.1) (2026-09-08)


### ⚠ BREAKING CHANGES

* **startcycle:** /startcycle now means the linear pipeline again. The dispatcher graph moved to /startcycle-graph, and /light-graph was renamed to /startcycle-graph-user. Anything invoking /startcycle expecting the graph must switch to /startcycle-graph.
* **skills:** deduplicate skill trees and tag skills by domain

### Features

* add local project harness directly to maintenance menu and support --project-harness CLI flag ([bacc4ee](https://github.com/hybridlabor-api/aos/commit/bacc4eec35441d2026eac0d7bcb08d5d56729b61))
* **branding:** embed authentic BDB vector coin, watermark and seal in certificate template ([1c28dd2](https://github.com/hybridlabor-api/aos/commit/1c28dd29adcaf4a03232aa571709d82bc7450dc0))
* **branding:** redesign certificate to flagship BDB Enterprise SaaS Host A4 layout ([14bec20](https://github.com/hybridlabor-api/aos/commit/14bec20a13bbb7195e3b076eb473a16d7f036019))
* **client:** implement keychain keypair, OIDC token acquisition, 401 refresh (A8b) ([f67593b](https://github.com/hybridlabor-api/aos/commit/f67593b7cfd52f766b2cbe16eba8a4f93d8144e7))
* **graph:** dispatcher-mediated graph layer for /startcycle (Phase 4) ([5ba9622](https://github.com/hybridlabor-api/aos/commit/5ba9622b09ac98ceef88a4676efb29e181ceb9b6))
* **installer:** add --platforms=&lt;n[,n]&gt; for non-interactive target selection ([6425b97](https://github.com/hybridlabor-api/aos/commit/6425b97b44c9a4a99736a640f354456f4254bb2c))
* **installer:** add glitch banner and topology animation effects ([6f11669](https://github.com/hybridlabor-api/aos/commit/6f1166979967b4e42a5a053243d482e8433634ac))
* **installer:** generate Claude Code + OpenCode subagents from AGENTS.md ([73bd07d](https://github.com/hybridlabor-api/aos/commit/73bd07d245417229a908922c39eeb2a76fa66c24))
* **installer:** gold/emerald KEYSTONE banner for the v3.13 latest release ([e314a04](https://github.com/hybridlabor-api/aos/commit/e314a044c8e102f45938d58386152df089b7c421))
* **installer:** manifest store conflict resolution and npm-based memb-mcp ([ec02555](https://github.com/hybridlabor-api/aos/commit/ec025557a61260d87f287d2ec942f45188866da1))
* **installer:** NODEFORGE codename gets its own ASCII art in the banner ([46c6270](https://github.com/hybridlabor-api/aos/commit/46c6270d44f936c963f1ab9a2819d6fab1cb1761))
* **installer:** NODEFORGE release banner with gradient wordmark ([e32510c](https://github.com/hybridlabor-api/aos/commit/e32510c53cf52140eab48ba54ab6cc4eea62b187))
* **safety:** enforce GO gate via PreToolUse hook, trim CLAUDE.md ([ef2a3a2](https://github.com/hybridlabor-api/aos/commit/ef2a3a2c5d28ad35f3ced5e39b87fd0fa04713f0))
* **skills:** add bdbdesignpro motion-engine router skill ([e0eba75](https://github.com/hybridlabor-api/aos/commit/e0eba7559f379cf8615fb08040c889bec91e67be))
* **skills:** add full anatomy + eval triggers to bdb-core domain ([72d0194](https://github.com/hybridlabor-api/aos/commit/72d0194e321401848291fb713662dcdf0478e164))
* **skills:** add full anatomy + eval triggers to design-ui-ux domain ([785176f](https://github.com/hybridlabor-api/aos/commit/785176f09d676bb74d16e1e68b19c991fca7fbae))
* **skills:** add full anatomy + eval triggers to media-eventtech domain ([46a8147](https://github.com/hybridlabor-api/aos/commit/46a814719583ab5b7c0484ff6da80b7e68fdf0d3))
* **skills:** add full anatomy + eval triggers to saas-ops domain ([3d17190](https://github.com/hybridlabor-api/aos/commit/3d17190db6e6a3b2dfeaf0ae73080887ea636a30))
* **skills:** add light-graph -- disposable multi-agent fan-out ([7fe3ecf](https://github.com/hybridlabor-api/aos/commit/7fe3ecf5f2c972229fa7fa03b9814baab76ccc24))
* **skills:** add sync_ecosystem_wiki.py to aggregate all 31 repos into master visualizer ([4a16a46](https://github.com/hybridlabor-api/aos/commit/4a16a46bcc9acdbb7486982c7b0bd058f1acc23e))
* **skills:** import bdb-deploy skill, wire into godmode-shipping ([088aba3](https://github.com/hybridlabor-api/aos/commit/088aba3cbf0bd860788da05b9c9a01c23266710b))
* **skills:** import triage + prototype from mattpocock/skills (MIT) ([a008ef9](https://github.com/hybridlabor-api/aos/commit/a008ef972529af65d1d4bd8467d38eb85addbe0f))
* **skills:** modernize openwiki-skill to langchain-ai/openwiki v0.5.0 with visualizer and remote update script ([3548ece](https://github.com/hybridlabor-api/aos/commit/3548ece1deffaf766d5c43c2e6718d9c22abeb56))
* **skills:** optimize ecosystem wiki topology into hierarchical domain clusters ([066dc14](https://github.com/hybridlabor-api/aos/commit/066dc148fc089170b20a57ee8b19e7446dd86fe8))
* **skills:** propagate saas-ops consolidation (bdbsaas-ops retire, bdbsaashost OIDC, bdbsaastraining station 1b) ([46775fa](https://github.com/hybridlabor-api/aos/commit/46775fa87a466a8717f9aa06f71dc30c89ad3b6f))
* **skills:** set disable-model-invocation on side-effect skills (F-07) ([c8b0a37](https://github.com/hybridlabor-api/aos/commit/c8b0a3714f65f7152e1c808e6593e8023742aeda))
* **startcycle:** declarative node registry, fix parallel state.json race ([fc54714](https://github.com/hybridlabor-api/aos/commit/fc5471404f6ce57746161b53b2957f18b2529fa0))
* **startcycle:** split into three variants, fix review findings ([3a93688](https://github.com/hybridlabor-api/aos/commit/3a9368807a79d7951a9e57f62d0f0dbf695de63a))
* **workflow:** implement the dispatcher as a Claude Code Dynamic Workflow ([92dbe37](https://github.com/hybridlabor-api/aos/commit/92dbe3742bf85435bf5437c890a12291fa1e199a))


### Bug Fixes

* **assets:** actually commit the new header JPEG, add companion-plugins README section ([1918969](https://github.com/hybridlabor-api/aos/commit/1918969a9c64d641e583d6b260c743abda4b6e7b))
* **assets:** correct mislabeled header image extension, document companion plugins ([a626b47](https://github.com/hybridlabor-api/aos/commit/a626b475a9111dc95573deaef300a765e551b672))
* **hooks:** honor stop_hook_active in graph-gate; document go-gate's mode-independence ([6a73807](https://github.com/hybridlabor-api/aos/commit/6a7380761b89603290753f3ad46b718ea538c551))
* **installer:** apply audit remediations F1 and F2 ([f21a58c](https://github.com/hybridlabor-api/aos/commit/f21a58ce53614476ff95eb9e86f3d2a0557ae3da))
* **installer:** buildKnownSourceHashes crashes on a non-directory entry ([29ff82d](https://github.com/hybridlabor-api/aos/commit/29ff82dc08964f6bc9770958d3aaae14f8183b9a))
* **installer:** correct skill sync flattening bug; sync graph docs (Punkt 7) ([98bd148](https://github.com/hybridlabor-api/aos/commit/98bd14886638a34e1db92d02d8d98f81e2d9c994))
* **installer:** dedupe redundant daemon relaunch after individual module installs ([c6471ca](https://github.com/hybridlabor-api/aos/commit/c6471ca8cd159d498c7c9f68bf0363a6a6e46574))
* **installer:** diagnose Windows Synapse daemon failures instead of hiding them ([b8a92a0](https://github.com/hybridlabor-api/aos/commit/b8a92a0c4a5ace6097f86cb8a5a4c9ae9c15764b))
* **installer:** ecosystem status check compared against latest, not beta ([bb4053d](https://github.com/hybridlabor-api/aos/commit/bb4053d4a8b83e8bfb919b1ccfc94a07280f415b))
* **installer:** give Claude Code its own MCP store, not just Claude Desktop ([f283b7c](https://github.com/hybridlabor-api/aos/commit/f283b7c6834c0e82daf5affec663b8c2b1c84b26))
* **installer:** propagate excludeList through copyDirRecursiveSync recursion ([e3bea52](https://github.com/hybridlabor-api/aos/commit/e3bea52fc748a5cd8a74cf981cd908000bc78b87))
* **installer:** reloadDaemons() now verifies daemons instead of assuming success ([fbe190d](https://github.com/hybridlabor-api/aos/commit/fbe190dfd27ae878e87e5d28c29d6fd6c81d012e))
* **installer:** resolve v3.13 bugs (homeDir sync, hook paths, project mode) ([adc7f47](https://github.com/hybridlabor-api/aos/commit/adc7f47b05a62e899e4df174334641ccceb4d516))
* **installer:** verify background daemons before reporting success ([9545855](https://github.com/hybridlabor-api/aos/commit/9545855e75577c303086a7f346f0ff60ac043c5c))
* **package:** ship .claude/, .opencode/, CLAUDE.md in the npm package ([7481540](https://github.com/hybridlabor-api/aos/commit/74815406729611be6643010c5f5095a396dca62e))
* **security:** Phase 0 F1 remediation of the approval gateway (public npm copy) ([50bec35](https://github.com/hybridlabor-api/aos/commit/50bec35b4b437880236b2b571d0b268f97efb245))
* **security:** rev 3 — configurable admin group + typed 401 tool error (copy C) ([9f5340a](https://github.com/hybridlabor-api/aos/commit/9f5340a869c038e94090934b2bd5df6fc158a9b8))
* **setup-saas:** double-escaped newline printed literally in welcome note ([c602902](https://github.com/hybridlabor-api/aos/commit/c6029021e976bc138e6eeced9009d0b81b7a3758))
* **setup-saas:** ROB-1 ignored CA bootstrap result; SEC-4-class MCP config perms ([5c8b634](https://github.com/hybridlabor-api/aos/commit/5c8b63496d9458f05ffe25712cc0e18ebe73eaf6))
* **skills:** agent-pipeline described a pipeline that no longer exists ([5b2444a](https://github.com/hybridlabor-api/aos/commit/5b2444a5d7bdb0b6627838e890c750bc911a30fb))
* **skills:** correct saas-ops placement to canonical global_config/ container ([22a26dc](https://github.com/hybridlabor-api/aos/commit/22a26dc1519941affe1fd0d523a99e38cd53ccf9))
* **skills:** playwright-skill description was body content, not a trigger description ([21274f6](https://github.com/hybridlabor-api/aos/commit/21274f682f2ad2e7c93b5e37bbb9250be6917a93))
* **skills:** relocate bdbdesignpro into global_config/ (wrong bare placement) ([c2eb33c](https://github.com/hybridlabor-api/aos/commit/c2eb33c73abaf8b37f50e37049923d4d12962195))
* **skills:** repair YAML broken by Phase 0's tagging script (self-caused regression) ([faeec0f](https://github.com/hybridlabor-api/aos/commit/faeec0f8a3b608ba7cf4c87f2270d81580d2e2cd))
* **skills:** resolve F3-F5 pipeline command and duplicate skill issues ([acff50f](https://github.com/hybridlabor-api/aos/commit/acff50ff20ccad57114ef3bccc2e50e963048f61))
* **skills:** restore brainstorming skill lost in Phase 0 dedup; fix bdbrainstorm's category ([3f54176](https://github.com/hybridlabor-api/aos/commit/3f54176c62d29055d61bf334acf5740386a693a5))
* **skills:** sync build_profile.py YAML hardening (code-review findings) ([bb8ded8](https://github.com/hybridlabor-api/aos/commit/bb8ded8e2d0a200c31c32df5a0a06e820903e9fe))
* **startcycle:** bootstrap .agents/ contract into target project ([639cb2e](https://github.com/hybridlabor-api/aos/commit/639cb2eac2808d73e86bb2cb3ee4cd7b8e4e4882))
* **startcycle:** resolve skill/workflow naming collision ([2138bd9](https://github.com/hybridlabor-api/aos/commit/2138bd99028f3cef9e677582d8470b887bb1d2a5))
* **startcycle:** route via scriptPath, not name -- by-name lookup fails ([05382aa](https://github.com/hybridlabor-api/aos/commit/05382aa1b1b175f72a6441f5f0c466e5d743e92e))
* v3.13 audit remediations (Blockers 1-3, SEC 1-4) ([51ae49c](https://github.com/hybridlabor-api/aos/commit/51ae49cc8318f380883df79ec94c1515269d4922))
* **workflow:** resolve 8 real findings from adversarial review of startcycle.mjs ([dc9dc0c](https://github.com/hybridlabor-api/aos/commit/dc9dc0c1079680174545a6702ce39d8662a121a7))


### Miscellaneous Chores

* pin next release to 3.12.1 ([f395afc](https://github.com/hybridlabor-api/aos/commit/f395afc45a23e10681bc9fc710e12d8885876a81))


### Code Refactoring

* **skills:** deduplicate skill trees and tag skills by domain ([e4036aa](https://github.com/hybridlabor-api/aos/commit/e4036aa692ed55eca247fc11c16d2dca039dda33))

## [3.13.0-nodefox.2](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.13.0-nodefox.1...v3.13.0-nodefox.2) (2026-09-05)


### Bug Fixes

* **security:** approval-gateway self-approval bypass closed ([50bec35](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/50bec35))
* **security:** dashboard stored-XSS closed, unauthenticated admin-token minting closed, execution-daemon missing timeout fixed, and DNS-route risk classification added ([9f5340a](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/9f5340a))
* **installer:** update safety - quick-updates no longer overwrite user-modified or third-party files (manifest-based ownership tracking) ([ec02555](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/ec02555))
* **installer:** memb-mcp now sourced from the published @hybridlabor-api/memb package instead of a bundled copy ([ec02555](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/ec02555))

## [3.12.0](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.11.0...v3.12.0) (2026-08-27)


### Features

* **security:** sanitize and neutralize bdbsaastraining skill for public NPM ([8e802b5](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/8e802b5bd94d86e50556dd8eede01e26f885bb0a))
* **skills:** integrate bdbsaastraining v2 workload-adaptive bootcamp ([febd25b](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/febd25ba40f99f797ef3c81c1382f1192952a2f1))

## [3.11.0](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.10.0...v3.11.0) (2026-08-27)


### Features

* **installer:** add local dev guard for launchpad and integrate bdbsaas-ops skill ([794a378](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/794a378c6ff4ac7f7d576fd54e8d7fd5b1db1310))

## [3.10.0](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.9.6...v3.10.0) (2026-08-27)


### Features

* **saas:** implement dynamic gateway discovery and add bdbsaastraining workstation setup ([d29d699](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/d29d699e1cf91b87195b91abf2427a41dc813973))
* **skills:** update bdbsaashost with sanitized zero-trust fastmcp and agent-sudo guardrails ([619d5ac](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/619d5acbb72c8e3506709603e65f2d52cabf2324))

## [3.9.6](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.9.5...v3.9.6) (2026-08-22)


### Bug Fixes

* **installer:** memB standalone venv bootstrap + WebUI daemon autostart ([ee17732](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/ee17732abc1c02c959ad3c9676d24c6178879c20))
* **installer:** prompt for Obsidian memB plugin, launchpad and harden gate ADR-014 ([669c5f8](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/669c5f8ede2314e3c62adcc0e6aa77cc315012b8))
* **installer:** trigger 3.9.6 PR ([cc59898](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/cc59898d9f667922bb5d6d302fee7166878d2675))
* **installer:** trigger clean 3.9.6 patch release ([8dfc8c0](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/8dfc8c0645d305441330537b532c2399a0ddbf42))

## [3.9.4](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.9.3...v3.9.4) (2026-08-22)


### Bug Fixes

* **installer:** elevate memB to standalone ecosystem submodule and sync verification ([d4064f7](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/d4064f7d48a979b1344825f927b62437e842959b))

## [3.9.3](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.9.2...v3.9.3) (2026-08-22)


### Bug Fixes

* **installer:** make venv setup idempotent and refine verification candidate paths ([e64b68d](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/e64b68ddf034f078f3d9c17f253e5fadc9059207))

## [3.9.2](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.9.1...v3.9.2) (2026-08-22)


### Bug Fixes

* **installer:** scope promptNewModules inside main async execution block ([c7dcfaa](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/c7dcfaac76e6c958aafc16653c7b10f32386e113))

## [3.9.1](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.9.0...v3.9.1) (2026-08-22)


### Bug Fixes

* **installer:** resolve NPX local version fallback in detectInstallState ([9c899fc](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/9c899fcb850d626a239694053afdb1cde28b665c))

## [3.9.0](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.8.1...v3.9.0) (2026-08-22)


### Features

* **installer:** add 1-click quick update mode, state detection, and daemon reload ([27bdd80](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/27bdd805bd64636c28a918473a3d1ec1ad36e0a9))

## [3.8.1](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/compare/v3.8.0...v3.8.1) (2026-08-22)


### Bug Fixes

* **windows:** fix cross-platform execSync, add blue color, and correct version verification path ([00a1306](https://github.com/hybridlabor-api/bdb-dev-optimized-agent-skills/commit/00a13064b5645f8fcc1a9e564ba34e5407c367cb))

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
