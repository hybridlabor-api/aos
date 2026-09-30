# Changelog

## [4.5.0](https://github.com/hybridlabor-api/aos/compare/aos-v4.12.1...aos-v4.5.0) (2026-09-30)


### ⚠ BREAKING CHANGES

* **startcycle:** /startcycle now means the linear pipeline again. The dispatcher graph moved to /startcycle-graph, and /light-graph was renamed to /startcycle-graph-user. Anything invoking /startcycle expecting the graph must switch to /startcycle-graph.
* **skills:** deduplicate skill trees and tag skills by domain

### Features

* add engineering-hardware category and godmode-hardware-pcb ([f86484c](https://github.com/hybridlabor-api/aos/commit/f86484c54c705f00ae34f0d55c0b6feecfeb11aa))
* add live-preview-canvas skill (built via antigravity, not yet in the repo) ([672b719](https://github.com/hybridlabor-api/aos/commit/672b7196c481d2a5afbde3f56cf584d6b5672018))
* add local project harness directly to maintenance menu and support --project-harness CLI flag ([c5be80a](https://github.com/hybridlabor-api/aos/commit/c5be80a3c78c11ea6a4050b3c4d321ebb91ab5c1))
* add memB LLM proxy and Auto-Capture system (Phase A & C) ([2d29a0b](https://github.com/hybridlabor-api/aos/commit/2d29a0b75c0e1b320e39e9e86a337172722cfe93))
* **agents,skills:** port 6 subagents and Plan Canvas from affaan-m/ECC ([8e72489](https://github.com/hybridlabor-api/aos/commit/8e724899a3d17fc414d795d0735e2aa5f8f72732))
* AOS 4.7.0 - Live Pipeline Map, deja-vu Memory, memB Second Brain & Security Engine ([#55](https://github.com/hybridlabor-api/aos/issues/55)) ([a943785](https://github.com/hybridlabor-api/aos/commit/a9437859520e6626f05933d8adb627f2c045582d))
* **aos:** CI/CD skills, AOS CLI harness, plugin manifest & installer fixes ([#63](https://github.com/hybridlabor-api/aos/issues/63)) ([08ad51d](https://github.com/hybridlabor-api/aos/commit/08ad51d89109980c3cf98210997cbb68c93856ea))
* **arch:** Phase 0 and 2 optimizations ([#64](https://github.com/hybridlabor-api/aos/issues/64)) ([d19ca2a](https://github.com/hybridlabor-api/aos/commit/d19ca2ada80b67c14932a538d7ca1dff51f44e71))
* **ask-tim:** lead with a flow map, keep the catalogue beneath it ([4969c85](https://github.com/hybridlabor-api/aos/commit/4969c85378caf11e33788238bd95d11292fbbc42))
* auto-copy Godmode/Harness directories to local workspace ([05181e2](https://github.com/hybridlabor-api/aos/commit/05181e21ecdf67b4ab31b1149121963ab9874fe3))
* **branding:** embed authentic BDB vector coin, watermark and seal in certificate template ([af634a9](https://github.com/hybridlabor-api/aos/commit/af634a93ebfcfe397e6d9f70ee6266689116cccd))
* **branding:** redesign certificate to flagship BDB Enterprise SaaS Host A4 layout ([24433f8](https://github.com/hybridlabor-api/aos/commit/24433f84db46a8a13fee275904b2c69d785863c4))
* **ci:** validate the skill contract on every push ([0191f2c](https://github.com/hybridlabor-api/aos/commit/0191f2ce8c8685b06fa001344572fc70b9185a81))
* **cli:** AOS CLI and CICD Skills Import ([#66](https://github.com/hybridlabor-api/aos/issues/66)) ([9cbc7ae](https://github.com/hybridlabor-api/aos/commit/9cbc7ae47c9fd04caf2f22b19b764da631877e54))
* **client:** implement keychain keypair, OIDC token acquisition, 401 refresh (A8b) ([d427715](https://github.com/hybridlabor-api/aos/commit/d42771580503e1edb3327c4930262d77db6749d0))
* **core:** implement BDB Ecosystem Architecture (Context Boot, OS Skill, Synapse Integration, Agent Compiler) ([70bcfce](https://github.com/hybridlabor-api/aos/commit/70bcfcefede244079d3a741dc7241314394edbcc))
* **creator-extension:** transition to MCP-First architecture and modularize bdbmediastorm ([6d0607d](https://github.com/hybridlabor-api/aos/commit/6d0607d2caa9a4f025b2cda218c45f1a95d5ed37))
* **dashboard:** add aos-dashboard, a live view of every BDB service ([a6dac4f](https://github.com/hybridlabor-api/aos/commit/a6dac4fce8a5879c8a6bc3d1db1f86728ab8d392))
* **design:** consolidate 5 design skills into authoritative godmode-ui-ux ([63a11f3](https://github.com/hybridlabor-api/aos/commit/63a11f3b40a9baa870643ae5dfa0f85afc6b674f))
* expand OpenWiki LLM provider wizard with additional models ([3307cb2](https://github.com/hybridlabor-api/aos/commit/3307cb2c3faca7f4128627f1384919ff97217b32))
* **graph:** dispatcher-mediated graph layer for /startcycle (Phase 4) ([8eb6090](https://github.com/hybridlabor-api/aos/commit/8eb60904401ff17d3eafb897805d815aba10e019))
* **harness:** add native .agents structure, sync roo modes, and update package files ([d3da154](https://github.com/hybridlabor-api/aos/commit/d3da15497fe331d933a0e811aa7004595ab5094e))
* **harness:** scaffold universal agent harness directories for v3.0.0 ([b03e3c4](https://github.com/hybridlabor-api/aos/commit/b03e3c4b2a9fc661dca2234345e293cb8795280e))
* **heimdall:** implement universal harness auto-injection for all major IDEs and CLIs ([1046ddd](https://github.com/hybridlabor-api/aos/commit/1046dddb45075b80448fd2fdb2377b9ed2ebd315))
* **installer:** add --mcps to pick an MCP subset in non-interactive runs ([a0e1ad3](https://github.com/hybridlabor-api/aos/commit/a0e1ad34718d6df7d365996642a656c532e4e37c))
* **installer:** add --platforms=&lt;n[,n]&gt; for non-interactive target selection ([a2f6e60](https://github.com/hybridlabor-api/aos/commit/a2f6e60e13e68baebb7b5b0a67bbfd4f01d8e714))
* **installer:** add 1-click quick update mode, state detection, and daemon reload ([0806970](https://github.com/hybridlabor-api/aos/commit/08069706a7b36ef511c35037f28ccb38fb7e148a))
* **installer:** add automated NPM version drift checker and auto-updater for standalone modules ([4a7f67b](https://github.com/hybridlabor-api/aos/commit/4a7f67b47edcd2c6d71408cd5623652f26397dc7))
* **installer:** add automatic git clone fallback for creator extension and os agent workspace ([59f4f03](https://github.com/hybridlabor-api/aos/commit/59f4f037cda4a41a3a1f5ee556d77329b148ed5c))
* **installer:** add glitch banner and topology animation effects ([e94f7eb](https://github.com/hybridlabor-api/aos/commit/e94f7eb9c3cbb814b99e6614d065c9b5d7e09edd))
* **installer:** add lightweight bdb-synapse integration ([c2b6a0e](https://github.com/hybridlabor-api/aos/commit/c2b6a0e74c6c725492cc4bb3576b549fef677447))
* **installer:** add local dev guard for launchpad and integrate bdbsaas-ops skill ([e1fe309](https://github.com/hybridlabor-api/aos/commit/e1fe309a58f06f5d9e7efacb76424032c8592b9a))
* **installer:** add modular prompt to configure BDB Creator Extension ([43cd9d1](https://github.com/hybridlabor-api/aos/commit/43cd9d1eb911cff7133b26ed3c2d0f39065ce79b))
* **installer:** add SaaS Server Mgmt prompt and update counts ([a95965b](https://github.com/hybridlabor-api/aos/commit/a95965b9c995a1001dc632be0064bb9912121f4c))
* **installer:** add setup-saas workstation bootstrapper with @clack/prompts and bdbsaastraining skill ([fb44a7a](https://github.com/hybridlabor-api/aos/commit/fb44a7a293715c31e11277aa13c48e77646dd4d2))
* **installer:** auto-detect existing .env credentials and prompt to reuse on updates ([39bc6c0](https://github.com/hybridlabor-api/aos/commit/39bc6c0d0c217c18af874c2688c83a8eee7e5fb5))
* **installer:** auto-skip credential wizard when existing API keys are detected ([0083e30](https://github.com/hybridlabor-api/aos/commit/0083e30a2bf630f4c60d1e56a1519b288a706746))
* **installer:** automatically inject GEMINI.md global rules to all IDE harnesses ([aae6fc2](https://github.com/hybridlabor-api/aos/commit/aae6fc29e796f43ff74a3c0b68ba95f26216d569))
* **installer:** clarify option 0 to dynamically show detected agent environments ([b8c2d84](https://github.com/hybridlabor-api/aos/commit/b8c2d84e89e5329b78ec3aa193af4e2ea2f94520))
* **installer:** enable cross-platform AO and native Windows Synapse support ([bd5699f](https://github.com/hybridlabor-api/aos/commit/bd5699fa451363b3e9741e8ad4336be8a50e9e69))
* **installer:** generate Claude Code + OpenCode subagents from AGENTS.md ([a558c31](https://github.com/hybridlabor-api/aos/commit/a558c3112fbaa5f01d98521b90a18cc6ff8b24fb))
* **installer:** gold/emerald KEYSTONE banner for the v3.13 latest release ([1bddeb7](https://github.com/hybridlabor-api/aos/commit/1bddeb7a05438b6dbdc01e365a174fb11a7d0c3c))
* **installer:** implement interactive arrow key navigation for all menu prompts ([95a11b6](https://github.com/hybridlabor-api/aos/commit/95a11b64b4783af4adc4fd9262bc6e4c1ac88036))
* **installer:** implement interactive arrow key navigation for all single-select prompts ([d00b0a2](https://github.com/hybridlabor-api/aos/commit/d00b0a2b12a9e62097f0eb421bd6be1db222e158))
* **installer:** integrate bdb-remoteos-mcp and bdbsaashost skill ([b432f0e](https://github.com/hybridlabor-api/aos/commit/b432f0e6a8bc17758dc31b9fbf8c06c849df8c71))
* **installer:** manifest store conflict resolution and npm-based memb-mcp ([2a12de8](https://github.com/hybridlabor-api/aos/commit/2a12de82d36c1cacff2c6a9848b59ce995a8850a))
* **installer:** NODEFORGE codename gets its own ASCII art in the banner ([427c6c1](https://github.com/hybridlabor-api/aos/commit/427c6c159695c5c9c720dca1f7ef5959c1d6b147))
* **installer:** NODEFORGE release banner with gradient wordmark ([6865eed](https://github.com/hybridlabor-api/aos/commit/6865eedaf30862fd54a80e33fa7616eeab98cf03))
* **installer:** overhaul promptMode for Universal Agent Harness sync across all platforms ([14b9d71](https://github.com/hybridlabor-api/aos/commit/14b9d7107fcd88e579f507cc66840c220c151a60))
* **installer:** pre-select already installed MCPs in the menu ([545192d](https://github.com/hybridlabor-api/aos/commit/545192d7358991b34a66060da8634fe91e69affa))
* **installer:** provision ao background LaunchAgent, binary in PATH, and desktop app bundle ([750cc6e](https://github.com/hybridlabor-api/aos/commit/750cc6eb485845145c9634f87be3b4f236830389))
* **installer:** retain Universal Agent Harness branding in option 0 label alongside detected environments ([4add511](https://github.com/hybridlabor-api/aos/commit/4add511b19000c1d6d1bc11dd51fc017f90b2010))
* **installer:** switch ecosystem download from git clone to public npm package ([381ec85](https://github.com/hybridlabor-api/aos/commit/381ec8589b71038dd42bd380f3ffd20f49810cd3))
* **launchpad:** add a favicon and an OpenWiki Visualizer card + autostart daemon ([0cdd6c1](https://github.com/hybridlabor-api/aos/commit/0cdd6c1f6f57519c0469b1a7a4d07978380d24b6))
* **launchpad:** replace emoji branding with real BDB SVG marks ([fb9f8e8](https://github.com/hybridlabor-api/aos/commit/fb9f8e84697f95b356472cf5363e7258e4e473da))
* **mcp:** add open-design mcp server integration to installer ([b6305ff](https://github.com/hybridlabor-api/aos/commit/b6305ffc5890670a4c504f536adcecd77e650bf3))
* **memb:** add memB auto-injection daemon for cursor, claude, and copilot ([ac26211](https://github.com/hybridlabor-api/aos/commit/ac2621136f8c8ee290dd99ff7e7a795fe6c45231))
* **memb:** SQLite WAL mode, FTS5 BM25 hybrid search, 8-tool FastMCP surface, and deduplication ([3c8bb10](https://github.com/hybridlabor-api/aos/commit/3c8bb10f0463e3f02cab7c58cbd89f3f305b9fd1))
* **opencode:** harness plugin with graph loop-keeper and installer payload ([#68](https://github.com/hybridlabor-api/aos/issues/68)) ([837e5fb](https://github.com/hybridlabor-api/aos/commit/837e5fb32fa85e5b082cb0f92ce30f52517f158e))
* **opencode:** wire /startcycle-graph workflow context into bdb-aos plugin ([a9d8b66](https://github.com/hybridlabor-api/aos/commit/a9d8b662a2b1b5c02e482bc369fc749a19257c8f))
* **openwiki:** add 60s auto-refresh to code health dashboard HTML ([c70efda](https://github.com/hybridlabor-api/aos/commit/c70efda52ea957c292031d62a8de54cc5a1a9189))
* **openwiki:** full Repowise-grade RepoGraph dashboard with SVG scatter, dependency network & memB decisions ([f3a1067](https://github.com/hybridlabor-api/aos/commit/f3a106759521dfb6d4c2dce39bf7c698c67033a7))
* **pipeline:** close OpenWiki-memB-Shipping loop and sanitize absolute paths across skills ([6775c22](https://github.com/hybridlabor-api/aos/commit/6775c22045ee62d728f49433038915355da8091d))
* **pipeline:** establish first-class /startcycle skill and cross-harness synchronization ([f7782e4](https://github.com/hybridlabor-api/aos/commit/f7782e43810a0784e4fd7a26a41e606c04027953))
* register a real autostart entry for the launchpad dashboard itself ([ef4a53c](https://github.com/hybridlabor-api/aos/commit/ef4a53cf5e19741fcd3e441981fa82bc02a7f2b5))
* release v3.6.1 - module selection, post-install verification, emoji mojibake fix, dynamic skill counts & health scheduler template ([f1da594](https://github.com/hybridlabor-api/aos/commit/f1da5946ac37cbc5d8d837b28ede1a9e49002387))
* replace manual mcp selection with interactive up/down arrow menu\nfix: execSync reference error in creator extension setup ([0b99f25](https://github.com/hybridlabor-api/aos/commit/0b99f2571e81efb22e0fc97ed223a78c8452b838))
* **saas:** implement dynamic gateway discovery and add bdbsaastraining workstation setup ([f79fcdf](https://github.com/hybridlabor-api/aos/commit/f79fcdfba375db40e90b877072af9495003e56f7))
* **safety:** enforce GO gate via PreToolUse hook, trim CLAUDE.md ([17e7f4d](https://github.com/hybridlabor-api/aos/commit/17e7f4d9be92f99a87b5f3a7942775308561ed88))
* **security:** sanitize and neutralize bdbsaastraining skill for public NPM ([caa2b69](https://github.com/hybridlabor-api/aos/commit/caa2b69f50ca23c58091933b728913004f50f2a7))
* **skills:** add 3 godmode meta-skills (ui-ux, engineering, shipping) ([2782cb9](https://github.com/hybridlabor-api/aos/commit/2782cb9ee54a4dbb7025d0b8408248a5eeb32bbe))
* **skills:** add antigravity-docs-design skill and HTML template for neutral developer documentation ([bc58b70](https://github.com/hybridlabor-api/aos/commit/bc58b70da889d237028474f83efdbdaf54582a38))
* **skills:** add aos-setup and aos-project-init ([9fe0768](https://github.com/hybridlabor-api/aos/commit/9fe0768fdbf634493ca8c8d03e8318416da20b84))
* **skills:** add bdbdesignpro motion-engine router skill ([f3f5ed2](https://github.com/hybridlabor-api/aos/commit/f3f5ed2efa470f91114fa2fcdd425c0d3dd7de7c))
* **skills:** add bdreadme formatting skill ([14bc3de](https://github.com/hybridlabor-api/aos/commit/14bc3de665876e7bac98683afa8d763588ae99a2))
* **skills:** add creator-godmode to govern Creator Extension MCPs and fix markdown table layout ([ae0ab0f](https://github.com/hybridlabor-api/aos/commit/ae0ab0fd23b21543bff64184fecfd2b9bff27edf))
* **skills:** add full anatomy + eval triggers to bdb-core domain ([ebd5ea3](https://github.com/hybridlabor-api/aos/commit/ebd5ea3892e7690800e6af2c4440b2884bfcebda))
* **skills:** add full anatomy + eval triggers to design-ui-ux domain ([2c5bbb5](https://github.com/hybridlabor-api/aos/commit/2c5bbb5d38be21ff38aae7c811e6c33b53cfedbe))
* **skills:** add full anatomy + eval triggers to media-eventtech domain ([bc00d24](https://github.com/hybridlabor-api/aos/commit/bc00d248213509bb570a56434e3d8275b178edbf))
* **skills:** add full anatomy + eval triggers to saas-ops domain ([aca8497](https://github.com/hybridlabor-api/aos/commit/aca849758907e071a8c7d21a7ca10fc1202a485a))
* **skills:** add light-graph -- disposable multi-agent fan-out ([98b02f9](https://github.com/hybridlabor-api/aos/commit/98b02f98efb879c476ae8fa37623cb509e525155))
* **skills:** add sync_ecosystem_wiki.py to aggregate all 31 repos into master visualizer ([73c06c0](https://github.com/hybridlabor-api/aos/commit/73c06c05bf695db143df35c601b355fd6061d60c))
* **skills:** add teamwork-preview prompt crafting and delegation skill ([11fe6f5](https://github.com/hybridlabor-api/aos/commit/11fe6f5cbeeea636dda6cfebc391d8ad625a194e))
* **skills:** add universal ao-orchestrator skill across all harnesses ([4d92e1a](https://github.com/hybridlabor-api/aos/commit/4d92e1a128899b2b9b484cf45093f2ede11bdb35))
* **skills:** enforce Creator Extension and MediaStorm governance within all Godmode skills ([8e291de](https://github.com/hybridlabor-api/aos/commit/8e291dea73aa42c6aa0f618aae2ebfe22d0be719))
* **skills:** import bdb-deploy skill, wire into godmode-shipping ([b9a2a82](https://github.com/hybridlabor-api/aos/commit/b9a2a8200b8010b1589ad27a9fe8d951aa3be5c9))
* **skills:** import triage + prototype from mattpocock/skills (MIT) ([16e5efa](https://github.com/hybridlabor-api/aos/commit/16e5efaf079589216995c87032dcea2b4067c820))
* **skills:** integrate 3 core godmodes into brainstorm and mediastorm workflows ([181bd9b](https://github.com/hybridlabor-api/aos/commit/181bd9bb7669d57e854de6dfa797a52c9934ec5b))
* **skills:** integrate bdbsaastraining v2 workload-adaptive bootcamp ([3296752](https://github.com/hybridlabor-api/aos/commit/32967521553119722be4d9c9e7aaa116661d9410))
* **skills:** make Plan Canvas mandatory in bdbrainstorm and bdbmediastorm ([0168e4e](https://github.com/hybridlabor-api/aos/commit/0168e4e585320967aeb49604d325042611b6e360))
* **skills:** merge bdreadme rules into github-repo skill and remove bdreadme ([3ab0ce7](https://github.com/hybridlabor-api/aos/commit/3ab0ce77a9481a9d2f39d618e949c8126bb78317))
* **skills:** modernize openwiki-skill to langchain-ai/openwiki v0.5.0 with visualizer and remote update script ([4cd208b](https://github.com/hybridlabor-api/aos/commit/4cd208b9a7168fab9c7c38295b715baea7c8c2e5))
* **skills:** optimize ecosystem wiki topology into hierarchical domain clusters ([83aa30e](https://github.com/hybridlabor-api/aos/commit/83aa30e5180942a976ee7d46fe4c84211bec617c))
* **skills:** port the grilling family from mattpocock/skills (MIT) ([152225b](https://github.com/hybridlabor-api/aos/commit/152225bf6d69c9f47f4d52b937f480e9ac97271e))
* **skills:** propagate saas-ops consolidation (bdbsaas-ops retire, bdbsaashost OIDC, bdbsaastraining station 1b) ([acd6f4f](https://github.com/hybridlabor-api/aos/commit/acd6f4fbca0d6d72b0eb60228734d9425b50058a))
* **skills:** rename skill to bdbhtmlmanueldocs and add GitHub Pages live hosting trick ([015d2c6](https://github.com/hybridlabor-api/aos/commit/015d2c679d4f00144a87e81906ccbe1e98d10c5b))
* **skills:** set disable-model-invocation on side-effect skills (F-07) ([5d75ebb](https://github.com/hybridlabor-api/aos/commit/5d75ebb20de74405e4c4f63e73d55b30a951943e))
* **skills:** ship bdbresilience and register it on shipping+engineering ([68993cb](https://github.com/hybridlabor-api/aos/commit/68993cb4d201130e05c5f14363f8535381cde87e))
* **skills:** update bdbsaashost with sanitized zero-trust fastmcp and agent-sudo guardrails ([0fff3d8](https://github.com/hybridlabor-api/aos/commit/0fff3d869708fc214793e3a45ecfda372068f6df))
* **startcycle:** add --skill=&lt;name&gt; mandatory skill injection ([4c376d5](https://github.com/hybridlabor-api/aos/commit/4c376d50a9397f14773fd315367089e0d1c54ae5))
* **startcycle:** declarative node registry, fix parallel state.json race ([7ed7e51](https://github.com/hybridlabor-api/aos/commit/7ed7e5150c33485d5fd5e9a7c6032d326870e79b))
* **startcycle:** split into three variants, fix review findings ([87f962a](https://github.com/hybridlabor-api/aos/commit/87f962a7180daefc3ab05b4a5641ceb179d62eab))
* **store:** /aos-store web UI with complete multi-file installs ([#70](https://github.com/hybridlabor-api/aos/issues/70)) ([ff5e8ec](https://github.com/hybridlabor-api/aos/commit/ff5e8ecf7029a50c4728592d25366b4bfc9b11ca))
* **subagents:** multi-harness subagent architecture across claude, antigravity, opencode, and codex ([258a3a3](https://github.com/hybridlabor-api/aos/commit/258a3a3a458213292c472ede2253e0ee602a2aca))
* **teamwork-preview:** executable workflow, and deliver dispatchers globally ([4360e84](https://github.com/hybridlabor-api/aos/commit/4360e844e8ff626d957345acc297f7d04b9ddb1c))
* wire bdb-hardware-pcb as an optional AOS module ([b87a520](https://github.com/hybridlabor-api/aos/commit/b87a520182e12fe4e0fe7663c504f9992cd53142))
* **workflow:** implement the dispatcher as a Claude Code Dynamic Workflow ([c22ddce](https://github.com/hybridlabor-api/aos/commit/c22ddce301785ed09ec17135f1b22831b0bbab44))


### Bug Fixes

* **--skill:** look in every harness's skills dir, not just ~/.claude ([506fa88](https://github.com/hybridlabor-api/aos/commit/506fa88f03c19b1eabf342df6a7f668faa79bb04))
* address the independent review's confirmed findings ([ab92b05](https://github.com/hybridlabor-api/aos/commit/ab92b0543cf44f7bd72e4ced30e378e2fb367778))
* adjust installer to symlink new synapse Node wrapper instead of missing Go binaries ([544bece](https://github.com/hybridlabor-api/aos/commit/544bece4691f0904c7de8555be57b84ba0fb87d0))
* Allow installing single-file MCP servers like Resolume and grandMA3 ([a51fc67](https://github.com/hybridlabor-api/aos/commit/a51fc67d33b02c2541850ee56873223db1349bdd))
* AOS 4.7.1 - System Doctor, AO Beta, Store Offline Index, Native Plans & Archify Contracts ([#57](https://github.com/hybridlabor-api/aos/issues/57)) ([1e032ef](https://github.com/hybridlabor-api/aos/commit/1e032efa82845e8a969c112c9d589e1c0b2131cf))
* **assets:** actually commit the new header JPEG, add companion-plugins README section ([b548c7e](https://github.com/hybridlabor-api/aos/commit/b548c7e8e227b187003fa08540fffca78ec9ce28))
* **assets:** correct mislabeled header image extension, document companion plugins ([1d02a89](https://github.com/hybridlabor-api/aos/commit/1d02a8984905f98c4353089ddba743da49c08fe0))
* **canvas:** Opencode integration and default canvas for plans ([#67](https://github.com/hybridlabor-api/aos/issues/67)) ([db17242](https://github.com/hybridlabor-api/aos/commit/db17242f4e1bfca4f9bf60eadd9bf3ba8f9427bf))
* **ci:** remove unnecessary npm install step before publish ([7937568](https://github.com/hybridlabor-api/aos/commit/7937568a3c97baf489d872042fc7314d89f9fb16))
* **ci:** repair release-please workflow for v3.0.6 release automation ([6f13166](https://github.com/hybridlabor-api/aos/commit/6f13166ff0d2f6c2bf50c381362fe7ab333291be))
* **ci:** use npm install for release publish without lockfile ([47683d2](https://github.com/hybridlabor-api/aos/commit/47683d2d138be454acc1853ddaf56c63e43d514e))
* **cli:** cross-platform launcher binaries and windows path handling ([#53](https://github.com/hybridlabor-api/aos/issues/53)) ([acb8f72](https://github.com/hybridlabor-api/aos/commit/acb8f72b9fb8c831afd853baf897cae6173648ca))
* Codex/ChatGPT-Desktop detection, self-perpetuating harness folders, isAutoYes credential reset ([89817d3](https://github.com/hybridlabor-api/aos/commit/89817d3e44615bd16a496f7aa286c0eb7459ac6d))
* **dashboard:** report AO's running version, not an archived package's ([37473c6](https://github.com/hybridlabor-api/aos/commit/37473c60bafe6059a8c47b3c5d7689925011bbb1))
* **delegation:** agy is slow, not broken -- correct the timeout guidance ([f88b318](https://github.com/hybridlabor-api/aos/commit/f88b318568c5ebc9c52cfcf909af58447ed85b6c))
* **docs:** repair broken details tags in github markdown ([0bad32b](https://github.com/hybridlabor-api/aos/commit/0bad32b86c85954ec7905293f6ef5833f792561a))
* **golem-rhino:** change FastMCP description argument to instructions ([89c508c](https://github.com/hybridlabor-api/aos/commit/89c508c98a2e3307595228db1d9bb5a674ebe2bd))
* guard against a too-old Node.js before requiring anything ([57eb314](https://github.com/hybridlabor-api/aos/commit/57eb314e9158cd08d347fbe8601dab623aef1c7b))
* **harness:** remove unneeded firecrawl skills from .agents/skills ([865e4e7](https://github.com/hybridlabor-api/aos/commit/865e4e70009f6bda75c05252dd885f4dc418b8df))
* **hooks:** harden GO-gate cross-harness enforcement and populate antigravity-cli hooks ([200db0f](https://github.com/hybridlabor-api/aos/commit/200db0ff5b3e40fac99e7e2e6316360357f51cf0))
* **hooks:** honor stop_hook_active in graph-gate; document go-gate's mode-independence ([e402e4d](https://github.com/hybridlabor-api/aos/commit/e402e4d346dba25c511b9ede36f3913ab535f0ce))
* install openwiki CLI on demand and persist visualizer wiki path ([9782861](https://github.com/hybridlabor-api/aos/commit/9782861d9eb2d4764f9d8714ee1be4483a7836c4))
* **installer:** add an uninstall, in two stages ([e79bd2c](https://github.com/hybridlabor-api/aos/commit/e79bd2c89d5e7c5a7a3a2759d7154a8741ebdd61))
* **installer:** address sandbox test findings for robust installs ([80fd483](https://github.com/hybridlabor-api/aos/commit/80fd4837eba175802464ca5ea632ff17e52d1808))
* **installer:** apply audit remediations F1 and F2 ([208eb43](https://github.com/hybridlabor-api/aos/commit/208eb435f5562692ab4c97f01cbcd0131efe3d21))
* **installer:** buildKnownSourceHashes crashes on a non-directory entry ([cd6b944](https://github.com/hybridlabor-api/aos/commit/cd6b944067bffc653afe6031fe8e396f60cb68b4))
* **installer:** close the audit findings — nine defects in one family ([514d36f](https://github.com/hybridlabor-api/aos/commit/514d36f4ae42981b2f2208ca84afe39e39e01dbd))
* **installer:** correct skill sync flattening bug; sync graph docs (Punkt 7) ([cfbfc3b](https://github.com/hybridlabor-api/aos/commit/cfbfc3b17bb0f3f33cb0f4fdf7df8117b3830d5b))
* **installer:** cross-harness hooks, windows openwiki daemon and dashboard opener ([ab08b9b](https://github.com/hybridlabor-api/aos/commit/ab08b9b0e2a0f53058dc5f60aab240db6af2ac2b))
* **installer:** cross-platform hardening - JSON path escaping, npm diagnostics, OpenWiki TLS verify, Linux daemon detection ([d24572d](https://github.com/hybridlabor-api/aos/commit/d24572daf0fef7ad635c2d53e9a3da49f77307fe))
* **installer:** dedupe redundant daemon relaunch after individual module installs ([3c11b43](https://github.com/hybridlabor-api/aos/commit/3c11b43a9fe6f447322a4488b7de7b7742125dc7))
* **installer:** deploy bdb extensions to neutral .agents folder instead of .gemini ([4dc321a](https://github.com/hybridlabor-api/aos/commit/4dc321a1af2bec2961600742cc2bfea2fded15b3))
* **installer:** detect harnesses by the software, not by its folders ([835fa6c](https://github.com/hybridlabor-api/aos/commit/835fa6c1c956dfae46e699a03fafcac412b96f2a))
* **installer:** diagnose Windows Synapse daemon failures instead of hiding them ([5edccc9](https://github.com/hybridlabor-api/aos/commit/5edccc9d28a79c96ddc7f990a16a102f743425c1))
* **installer:** do not register an MCP whose build produced nothing ([6232ac1](https://github.com/hybridlabor-api/aos/commit/6232ac10a0f6e464fb66af2d2966a14389aab4be))
* **installer:** ecosystem status check compared against latest, not beta ([04785ef](https://github.com/hybridlabor-api/aos/commit/04785ef621fe392c3aeae19fcf5dacb09381d382))
* **installer:** elevate memB to standalone ecosystem submodule and sync verification ([de96dc8](https://github.com/hybridlabor-api/aos/commit/de96dc818af0006e6c7023aeead3494e0be8aa06))
* **installer:** enable AO, but only where its binary can run ([c6e6726](https://github.com/hybridlabor-api/aos/commit/c6e6726f4df6eb8d8a760bd03378e89aef040988))
* **installer:** give Claude Code its own MCP store, not just Claude Desktop ([69c255d](https://github.com/hybridlabor-api/aos/commit/69c255d69e0e637506f2624a6f9db96387104d84))
* **installer:** handle emojis in AGENTS.md when compiling native subagents ([6921b77](https://github.com/hybridlabor-api/aos/commit/6921b77bed3dd55a7d56b77a0b9d8e2d0d0d84a0))
* **installer:** handle windows EPERM during module swap and bootstrap pip in venv ([a772825](https://github.com/hybridlabor-api/aos/commit/a7728250319f9c657f5f947cf352d1acedef733d))
* **installer:** harden synapse setup — broken symlink, Windows .exe, isAutoYes behavior ([6843e09](https://github.com/hybridlabor-api/aos/commit/6843e092498f9d1b82caecaa870908bcbfc9fed3))
* **installer:** inject gemini api key for memb and make davinci-resolve-mcp setup unattended ([fee9582](https://github.com/hybridlabor-api/aos/commit/fee9582f640102769cd3a2f4f22e2f367aa5e99c))
* **installer:** inject the Gemini key and python path literally ([7869d57](https://github.com/hybridlabor-api/aos/commit/7869d57262d2f51f91df4477cf626ae4b97b1d36))
* **installer:** keep file I/O errors in the install IIFEs from killing the run ([6285b83](https://github.com/hybridlabor-api/aos/commit/6285b8395980b8cf15de5399381b2c28a3b3159e))
* **installer:** keep MCP config I/O errors from killing the run ([f8d89b5](https://github.com/hybridlabor-api/aos/commit/f8d89b571203fae3933a10b220fc2ace1400e06b))
* **installer:** let AO install its own service instead of writing a broken one ([8e527c5](https://github.com/hybridlabor-api/aos/commit/8e527c53b2643cf0db83987c63dd4f55c452b732))
* **installer:** make venv setup idempotent and refine verification candidate paths ([c56b4e0](https://github.com/hybridlabor-api/aos/commit/c56b4e021378c0c4458c8a1bfe627cbc3d823f22))
* **installer:** match the MCP guides by their new directory names ([5d4075b](https://github.com/hybridlabor-api/aos/commit/5d4075b7be78f58e9b0b106b73dce27a0c6dff2d))
* **installer:** memB standalone venv bootstrap + WebUI daemon autostart ([8bb2d53](https://github.com/hybridlabor-api/aos/commit/8bb2d53528efcb4f2a76769f8a6e81ed0d301ae0))
* **installer:** never overwrite an unreadable mcp_config.json in merge mode ([a62bcfb](https://github.com/hybridlabor-api/aos/commit/a62bcfb7b5c5f74a20c7c7e9413a48d574f1cb5c))
* **installer:** point AO at bdb-agent-orchestrator, never at the archived one ([59f0030](https://github.com/hybridlabor-api/aos/commit/59f00306b8bbfae824966e931f0d24038c78fe0c))
* **installer:** prevent memB pip install hang on Windows ([cdec6bf](https://github.com/hybridlabor-api/aos/commit/cdec6bfa6436b32d4b1c8732252f7bcdd9a67351))
* **installer:** prompt for Obsidian memB plugin, launchpad and harden gate ADR-014 ([7259191](https://github.com/hybridlabor-api/aos/commit/7259191a18a554d65aec7642c69ff35ffff547d7))
* **installer:** propagate excludeList through copyDirRecursiveSync recursion ([4f6f584](https://github.com/hybridlabor-api/aos/commit/4f6f5849373b2aabb74664f28cf0b04a4e668b0e))
* **installer:** refresh hooks on Quick Update, not only a fresh install ([738d365](https://github.com/hybridlabor-api/aos/commit/738d365b7b7ac3a2f5363e656f34f7c10de599be))
* **installer:** reloadDaemons() now verifies daemons instead of assuming success ([5ed5c11](https://github.com/hybridlabor-api/aos/commit/5ed5c1189f70a355cf7a5633a08072b30d570bf5))
* **installer:** resolve NPX local version fallback in detectInstallState ([605b8b2](https://github.com/hybridlabor-api/aos/commit/605b8b2952eda44f078d8b8bcd0908879b6091a5))
* **installer:** resolve TypeError log.ok and pass visualizer wiki path on windows ([39f9fe1](https://github.com/hybridlabor-api/aos/commit/39f9fe16fc874e779f2fa3349b101ea65a3da85c))
* **installer:** resolve v3.13 bugs (homeDir sync, hook paths, project mode) ([012518b](https://github.com/hybridlabor-api/aos/commit/012518b4091eabbb1369782f210d709968db54c2))
* **installer:** resolve Windows-specific EPERM, AO timeout and DEP0190 on Node 24 ([35b54da](https://github.com/hybridlabor-api/aos/commit/35b54da7c40e0d26b467aa4cbf0ee8e4e8432c08))
* **installer:** robust JSON config parsing and correct daemon task error handling ([3f1e572](https://github.com/hybridlabor-api/aos/commit/3f1e572af189b4bb19b229e023b72c2d1c6e8782))
* **installer:** scope promptNewModules inside main async execution block ([02c9611](https://github.com/hybridlabor-api/aos/commit/02c9611fab2da597c946886cc607053246ce8cb1))
* **installer:** ship and wire the memB ambient memory hook ([9f7ec6b](https://github.com/hybridlabor-api/aos/commit/9f7ec6b6aba33a408a9351680e85049b10544f5d))
* **installer:** split media-eventtech custom mode into dedicated eventtech, media, and 3d godmodes to align with recent Creator Extension refactoring ([21c1861](https://github.com/hybridlabor-api/aos/commit/21c1861b24082de5b7a24eb54679266528748b9d))
* **installer:** split rename swap into two phases to avoid ENOENT on retry ([5aa76cf](https://github.com/hybridlabor-api/aos/commit/5aa76cf6f196025bdd0e1626b4240dc771e47ae1))
* **installer:** stop freezing skills installed before manifest tracking ([5bf0d70](https://github.com/hybridlabor-api/aos/commit/5bf0d705830a63e34a62efab95ed970b34a36eb5))
* **installer:** stop the .env writer from corrupting keys containing $ ([97f4652](https://github.com/hybridlabor-api/aos/commit/97f4652864d86af54922c12aa4e1f2f18603e00e))
* **installer:** stop the dry-run banner claiming more than it does ([c4f421d](https://github.com/hybridlabor-api/aos/commit/c4f421d73fb9ff3945d8f365f422a0d0cbc3a9be))
* **installer:** stop the merge from dropping user-owned MCP entries ([5916a2b](https://github.com/hybridlabor-api/aos/commit/5916a2b46de1615450e67960f13a4b9e47997d83))
* **installer:** sync skills to Claude Code/Codex/Cursor/Roo and fix platform MCP injections ([7a51717](https://github.com/hybridlabor-api/aos/commit/7a517173edb5cfced1fbd4647cafd25e53a7e2bb))
* **installer:** treat the Codex config.toml as TOML, not as broken JSON ([586869b](https://github.com/hybridlabor-api/aos/commit/586869b2718fbf87357f57c1daee0445b07e741d))
* **installer:** trigger 3.9.6 PR ([46b8cc7](https://github.com/hybridlabor-api/aos/commit/46b8cc7ee154b50e45e1982d34fb8fcbd9dd8425))
* **installer:** trigger clean 3.9.6 patch release ([062e26a](https://github.com/hybridlabor-api/aos/commit/062e26a5b8d1b4b0be86f4180f3bcd4a8eed7af9))
* **installer:** unfreeze interactive mcp menu by resuming stdin ([047ea44](https://github.com/hybridlabor-api/aos/commit/047ea444dc4daf0ff722348e454f19bbc619c160))
* **installer:** unify UI interactions across all menus, implement isolated keypress events to prevent TTY crashes ([b7a864a](https://github.com/hybridlabor-api/aos/commit/b7a864a8bc124b1198d1806399414e38f0eb7632))
* **installer:** verify background daemons before reporting success ([ff79c34](https://github.com/hybridlabor-api/aos/commit/ff79c3408ce6737709631aec45c4e848cc7721ee))
* **installer:** Windows compatibility - UTF-8, npm retries, scheduler fallback, OpenCode support ([c22424e](https://github.com/hybridlabor-api/aos/commit/c22424ec92786d046c99d0c8ee92af6beb9e268e))
* iterative visual render loop for hardware-pcb godmode skill ([f2411c6](https://github.com/hybridlabor-api/aos/commit/f2411c6bd0fe7cee53f5eaf6700bb766d757380c))
* kinetic-intro banner hardcoded v4.0.0, stale skill/MCP counts in all 3 READMEs, Node floor aligned to 20+ ([55adcdd](https://github.com/hybridlabor-api/aos/commit/55adcdd4f95d02dc738ebea5aa4b70566bc6777c))
* launchpad dashboard never opened on Quick Update, and its dev-workflow guard used a path from before the workspace reorg ([32d5f12](https://github.com/hybridlabor-api/aos/commit/32d5f129bf068cfeeb8830bf294809ac08a86a5f))
* **launchpad:** plain white wordmark instead of a gradient ([2b53b8e](https://github.com/hybridlabor-api/aos/commit/2b53b8e2be63b992cf87f283c07b6c9d605deeec))
* **mcp:** add setuptools_scm version spoofing for rhino fallback server ([386ad66](https://github.com/hybridlabor-api/aos/commit/386ad66aeedf50bf82640dcaa58ff7c8cacd8c2b))
* **mcp:** replace invalid 'uv run -r' with '--with-requirements' and fix setuptools_scm version lookup for davinci fallback ([7501ae2](https://github.com/hybridlabor-api/aos/commit/7501ae28ea389d6ed0b07eddc676e817db6c2690))
* **mcp:** resolve 404 for open_design_mcp package name and add GEMINI_API_KEY fallback for memB ([6c30916](https://github.com/hybridlabor-api/aos/commit/6c309169cec5f72dd586185746ed4d864f6e8557))
* **mcp:** resolve port conflicts, missing uv PATH, missing anyio, and open_design daemon URL ([f95e5eb](https://github.com/hybridlabor-api/aos/commit/f95e5eb24a52d2f0d9acf7bc33f638c6ca597b32))
* **mcps:** pass the collected GitHub token to the github MCP server ([c4fc27f](https://github.com/hybridlabor-api/aos/commit/c4fc27f571342e4f1dec633e824e56c159a19e6c))
* **mcps:** pin mcp&lt;2.0.0 and add PEP 723 metadata to fix runtime imports for davinci, grandma3, resolume, and rhino ([1ae74e8](https://github.com/hybridlabor-api/aos/commit/1ae74e8501e9a5850e4d6e35066369ecaa12325c))
* **mcps:** register the After Effects Go fallback only when go exists ([3e453aa](https://github.com/hybridlabor-api/aos/commit/3e453aaa2dd7851144ddcfa127bc3978296f43fc))
* **mcps:** ship after-effects-mcp sources so postinstall build can run ([d2999df](https://github.com/hybridlabor-api/aos/commit/d2999df48c719cb8af15b37241a9811142b5df2e))
* **memb:** flat payload content_hash lookup in memb_ingest.py for cross-run deduplication ([64e6651](https://github.com/hybridlabor-api/aos/commit/64e66518c4578e8539a8027dbd4d0a85b5810c30))
* **memb:** keep default ingestion path behaviour-equal and harden file reads ([cf50d89](https://github.com/hybridlabor-api/aos/commit/cf50d89f61416b8850089110ba6e0f593322d68a))
* **memb:** repair ingestion crash, vault limit, file coverage and spaCy dep ([67975b2](https://github.com/hybridlabor-api/aos/commit/67975b2d5d9ed57bf3d8b396da947d46aee6f387))
* **memb:** tie chunking to --all-markdown, restore the default output ([c18821c](https://github.com/hybridlabor-api/aos/commit/c18821cb16d67312dbe56ead21560b46e5a3013d))
* **memb:** unblock global category search, upgrade to gemini-2.0-flash, and add offline fallback ([aabce28](https://github.com/hybridlabor-api/aos/commit/aabce28d93ba5a7e9675c84788078f76882ea6c7))
* **opencode:** add native plugin hooks, slim mcp profile, and skills wiring ([f015175](https://github.com/hybridlabor-api/aos/commit/f015175374ab0c9e6272a47793370ef6ce194abe))
* **openwiki:** create ~/Library/LaunchAgents before writing the plist ([0c875db](https://github.com/hybridlabor-api/aos/commit/0c875dbeeb90b2f5e05f2697f0d25af7991d253c))
* **openwiki:** create run_daemon.sh fresh instead of writing over an existing path ([dcdd1b9](https://github.com/hybridlabor-api/aos/commit/dcdd1b9505d7bc7ea25b645453f0ceee29909082))
* **openwiki:** daemon could never load its SDK -- venv + pinned interpreter ([962abcd](https://github.com/hybridlabor-api/aos/commit/962abcd787b38568494191b61973cd0ce088f246))
* **openwiki:** daemon launcher dropped every provider but Gemini ([fb9f8e8](https://github.com/hybridlabor-api/aos/commit/fb9f8e84697f95b356472cf5363e7258e4e473da))
* **openwiki:** export the entered API key before verifying it ([775ccf0](https://github.com/hybridlabor-api/aos/commit/775ccf0a98397bd619c56af04128d621225dd9cb))
* **openwiki:** guard OPENWIKI_MODEL/BASE_URL against set -u under non-default providers ([0cdd6c1](https://github.com/hybridlabor-api/aos/commit/0cdd6c1f6f57519c0469b1a7a4d07978380d24b6))
* **openwiki:** keep the API key out of the LaunchAgent plist and systemd unit ([73d3008](https://github.com/hybridlabor-api/aos/commit/73d3008fa5210dbaa47b78a1b33c315713ac94fc))
* **openwiki:** make xml_escape produce valid XML on bash 5.2 and newer ([cbbe78c](https://github.com/hybridlabor-api/aos/commit/cbbe78c10f31aa332bd066ab7112b0aa9fc4e7ec))
* **openwiki:** restore verified Google default model gemma-4-26b-a4b-it ([7a315c3](https://github.com/hybridlabor-api/aos/commit/7a315c3c45df6c0188c2ac03677a00959b194101))
* **openwiki:** stop reporting a schedule when only the logon fallback ran ([bd6dfe6](https://github.com/hybridlabor-api/aos/commit/bd6dfe642b50d61cb67f031cbb853de47b98e0e7))
* **openwiki:** stop writing the API key into autostart and check task rights ([7584eb6](https://github.com/hybridlabor-api/aos/commit/7584eb6c441776af36ad930808e879e830fad601))
* **openwiki:** use valid default Gemini model with automatic model discovery ([4541a2c](https://github.com/hybridlabor-api/aos/commit/4541a2c29d4b8db5e5174a000808097650cfeba9))
* **package:** ship .claude/, .opencode/, CLAUDE.md in the npm package ([a8c69c8](https://github.com/hybridlabor-api/aos/commit/a8c69c8135fa46f69a87f453791f2c2ea8a935a3))
* **plugin:** declare Apache-2.0 and drop the hooks claim from plugin manifests ([#75](https://github.com/hybridlabor-api/aos/issues/75)) ([214bf5d](https://github.com/hybridlabor-api/aos/commit/214bf5da3f5c8882c901e3a2638ba32f08447565))
* prevent installer hang by using async daemon startup ([41ffbbc](https://github.com/hybridlabor-api/aos/commit/41ffbbcc8df3877d5ca602eed37e0e2867348537))
* prune retired skills from disk on update, not just from the package ([7f02005](https://github.com/hybridlabor-api/aos/commit/7f020055e8106692aedbb41e6157e77333250508))
* **release:** let release-please bump plugin.json and marketplace.json versions ([#77](https://github.com/hybridlabor-api/aos/issues/77)) ([16fe711](https://github.com/hybridlabor-api/aos/commit/16fe7118c51c0cab6da97eafec36cee1beebb68a))
* **release:** read release settings from release-please-config.json only ([#78](https://github.com/hybridlabor-api/aos/issues/78)) ([75dd7ec](https://github.com/hybridlabor-api/aos/commit/75dd7ecd5020034c67cae33ca9de550688d6208a))
* **release:** resync release-please manifest to actual shipped version ([f90ab3c](https://github.com/hybridlabor-api/aos/commit/f90ab3c57c1f5168158fd6a31c48703d61375500))
* remove BDB-internal skills, moved to private aos-internal repo ([87cefee](https://github.com/hybridlabor-api/aos/commit/87cefee61c089ccb1df63fa43360699475917a2e))
* resolve adversarial review findings F-01 to F-04 and harden path lookups ([#59](https://github.com/hybridlabor-api/aos/issues/59)) ([13cd1f6](https://github.com/hybridlabor-api/aos/commit/13cd1f6c8e0d4df815c29119293d56bb46e5f473))
* retire dead global_legacy dirs on update, detect version downgrades ([3768698](https://github.com/hybridlabor-api/aos/commit/3768698d8384316a22f1cf6ca411602af00327e3))
* **security:** Phase 0 F1 remediation of the approval gateway (public npm copy) ([cd11838](https://github.com/hybridlabor-api/aos/commit/cd118384e322ba2898770299227528e382598307))
* **security:** rev 3 — configurable admin group + typed 401 tool error (copy C) ([819918b](https://github.com/hybridlabor-api/aos/commit/819918b3b6691093435dee7cd7b707e7c0f30a95))
* **setup-saas:** double-escaped newline printed literally in welcome note ([cba5634](https://github.com/hybridlabor-api/aos/commit/cba56341c45cf876f7dfa97e0ec5b7f08ab41b43))
* **setup-saas:** ROB-1 ignored CA bootstrap result; SEC-4-class MCP config perms ([395c077](https://github.com/hybridlabor-api/aos/commit/395c077805fdc81ed958b206190364c8eaff51b6))
* **skills:** agent-pipeline described a pipeline that no longer exists ([48e1990](https://github.com/hybridlabor-api/aos/commit/48e199088af91f55460b20143313ad29d4ac845c))
* **skills:** correct saas-ops placement to canonical global_config/ container ([8daf6a5](https://github.com/hybridlabor-api/aos/commit/8daf6a5d04feea699f17d68a3cf2d8f77a433734))
* **skills:** correct the doctors' install-layout and status assumptions ([478bfc7](https://github.com/hybridlabor-api/aos/commit/478bfc7cf60cc6b474261f9f89c3996781c29361))
* **skills:** describe bdb-memb-mcp by the tools it actually exposes ([32f0c7d](https://github.com/hybridlabor-api/aos/commit/32f0c7dc4dcdd4d438997a4d6fac5e84e5db014c))
* **skills:** make the setup skills configure, not just diagnose ([9ff238a](https://github.com/hybridlabor-api/aos/commit/9ff238a3c7ec464cda8406a94383e1f17f4bacc9))
* **skills:** make the twelve MCP guides discoverable by any harness ([75929c4](https://github.com/hybridlabor-api/aos/commit/75929c43644bc23be192a00de815506d74111339))
* **skills:** move root SKILL.md into skills/bdb-aos so skills CLI discovers all skills ([#72](https://github.com/hybridlabor-api/aos/issues/72)) ([033e810](https://github.com/hybridlabor-api/aos/commit/033e8107cf72416eb2bfcdc0232a8efb2d6497b9))
* **skills:** playwright-skill description was body content, not a trigger description ([31d5093](https://github.com/hybridlabor-api/aos/commit/31d5093bc969aa708e5a6c675493155b067937a8))
* **skills:** relocate bdbdesignpro into global_config/ (wrong bare placement) ([9deb518](https://github.com/hybridlabor-api/aos/commit/9deb518971261c999de40eea25be21f5f61a33ce))
* **skills:** remove hardcoded BDB DEV strings from github-repo layout rules to make them universal ([40d51a2](https://github.com/hybridlabor-api/aos/commit/40d51a2e4f486214b3411cc1c836a17040b3487a))
* **skills:** remove pointers that resolve to nothing ([e168019](https://github.com/hybridlabor-api/aos/commit/e1680198b58a26010ae612504e85db784e2d3690))
* **skills:** repair YAML broken by Phase 0's tagging script (self-caused regression) ([a62304a](https://github.com/hybridlabor-api/aos/commit/a62304aee32ffe8530529fd28dbc661c8b7de3fe))
* **skills:** resolve F3-F5 pipeline command and duplicate skill issues ([2a33ed4](https://github.com/hybridlabor-api/aos/commit/2a33ed42f203f82886a87769304d82c02da81668))
* **skills:** restore brainstorming skill lost in Phase 0 dedup; fix bdbrainstorm's category ([8963c28](https://github.com/hybridlabor-api/aos/commit/8963c28969b055b2c38454c3af47063a836a72b9))
* **skills:** restore the copyright notice stripped from two Apache licences ([bda5794](https://github.com/hybridlabor-api/aos/commit/bda5794f0a0fb64f2566c4c8911ae3a6e8be0fad))
* **skills:** restore the force of the agent-sudo requirement ([f99bd90](https://github.com/hybridlabor-api/aos/commit/f99bd902aa90ffb81c809fa8e97cad9f0e1c7669))
* **skills:** stop seven descriptions from swallowing their category ([72cd8a3](https://github.com/hybridlabor-api/aos/commit/72cd8a30cf4dc1fd0b13e9c66692bf0750bb0e4a))
* **skills:** sync build_profile.py YAML hardening (code-review findings) ([addf932](https://github.com/hybridlabor-api/aos/commit/addf93272604acbc3f15cc53858df897ac0347b3))
* **skills:** wire grilling into the storms, and close three routing gaps ([64ffff4](https://github.com/hybridlabor-api/aos/commit/64ffff4c0104b4e1c77747e1f368b2b9815839c1))
* **startcycle-graph:** bootstrap nodes.json, without it every first run dies ([dab1ea7](https://github.com/hybridlabor-api/aos/commit/dab1ea72793741fe382d424a1cdc0c50cd165d86))
* **startcycle:** bootstrap .agents/ contract into target project ([bf60a38](https://github.com/hybridlabor-api/aos/commit/bf60a383366065b7486c766597c19bfd74770f90))
* **startcycle:** resolve skill/workflow naming collision ([96ef543](https://github.com/hybridlabor-api/aos/commit/96ef543372ae577ac4ab86b8bf74785131a0ad15))
* **startcycle:** route via scriptPath, not name -- by-name lookup fails ([931d72a](https://github.com/hybridlabor-api/aos/commit/931d72a817ff5b7b5c40ddffe0e06e8f7ede4de4))
* stop shipping four MCPs no installer path can select ([2e9e028](https://github.com/hybridlabor-api/aos/commit/2e9e028433ffa7e897757940841d6fb99957004f))
* stop shipping operational data, correct two false AO claims, repair the Python prewarm ([d99ad60](https://github.com/hybridlabor-api/aos/commit/d99ad60da023d2328464621456963246ba20d0b3))
* support Windows daemon lifecycle in AOS ([#51](https://github.com/hybridlabor-api/aos/issues/51)) ([0f9cbf9](https://github.com/hybridlabor-api/aos/commit/0f9cbf93cbf8607996ef7b1bced496379ff43cc1))
* surface Uninstall AOS in the main interactive menu ([80ba3f1](https://github.com/hybridlabor-api/aos/commit/80ba3f11694003fc8df4ca957ef99f6b5dcda6cd))
* three real bugs found on a live Windows test round ([5442810](https://github.com/hybridlabor-api/aos/commit/54428106437b5f212431c53acba6e668df8af531))
* **token-saver:** install Claude Code plugin to ~/.claude on Windows too ([a265f2e](https://github.com/hybridlabor-api/aos/commit/a265f2eae53a77a29ca6b17a88853f27449503b1))
* **token-saver:** look for the legacy Gemini extension in ~/.gemini ([41d8b7d](https://github.com/hybridlabor-api/aos/commit/41d8b7d9b6856362d24e98bbc2af5484d1b52e64))
* universal-tier workspace skills dir defaulted to cwd, crashed on an unwritable cwd ([fffee2c](https://github.com/hybridlabor-api/aos/commit/fffee2c78636741b14c910dd69d2671520005d15))
* v3.13 audit remediations (Blockers 1-3, SEC 1-4) ([e9bbf0a](https://github.com/hybridlabor-api/aos/commit/e9bbf0a383ae07f6a5ee7492fc6b0e4b27a948b8))
* Windows paths, memB ingestion, npm packaging and installer robustness ([02a0f24](https://github.com/hybridlabor-api/aos/commit/02a0f24459f92e9a043d0f135bf6c8a19e38f5ea))
* **windows:** fix cross-platform execSync, add blue color, and correct version verification path ([071013b](https://github.com/hybridlabor-api/aos/commit/071013b73e3621708624a8065a335b422da57017))
* **workflow:** resolve 8 real findings from adversarial review of startcycle.mjs ([000d73b](https://github.com/hybridlabor-api/aos/commit/000d73b19d9a24fb406b7f95031e3ee457007b15))


### Reverts

* **token-saver:** drop the %APPDATA%\claude orphan cleanup ([94deb3e](https://github.com/hybridlabor-api/aos/commit/94deb3eaeaccc40a28648ed623f6b3a346fecb09))


### Miscellaneous Chores

* pin next release to 3.12.1 ([534da8a](https://github.com/hybridlabor-api/aos/commit/534da8afc88e78e365773f3dbfec1477476e2c0b))
* pin the next release to 4.4.2 ([b0566a9](https://github.com/hybridlabor-api/aos/commit/b0566a9dc576d0966a1182639a123109b79eca47))
* pin the next release to 4.5.0 ([7799be2](https://github.com/hybridlabor-api/aos/commit/7799be2aa3efff9f8e86199556d4803d776258bc))


### Code Refactoring

* **skills:** deduplicate skill trees and tag skills by domain ([e9312a3](https://github.com/hybridlabor-api/aos/commit/e9312a322c23e018bb92f814948356bc3d693657))

## [4.12.1](https://github.com/hybridlabor-api/aos/compare/v4.12.0...v4.12.1) (2026-09-30)


### Bug Fixes

* **plugin:** declare Apache-2.0 and drop the hooks claim from plugin manifests ([#75](https://github.com/hybridlabor-api/aos/issues/75)) ([214bf5d](https://github.com/hybridlabor-api/aos/commit/214bf5da3f5c8882c901e3a2638ba32f08447565))
* **release:** let release-please bump plugin.json and marketplace.json versions ([#77](https://github.com/hybridlabor-api/aos/issues/77)) ([16fe711](https://github.com/hybridlabor-api/aos/commit/16fe7118c51c0cab6da97eafec36cee1beebb68a))

## [4.12.0](https://github.com/hybridlabor-api/aos/compare/v4.11.0...v4.12.0) (2026-09-30)


### Features

* **store:** /aos-store web UI with complete multi-file installs ([#70](https://github.com/hybridlabor-api/aos/issues/70)) ([ff5e8ec](https://github.com/hybridlabor-api/aos/commit/ff5e8ecf7029a50c4728592d25366b4bfc9b11ca))


### Bug Fixes

* **skills:** move root SKILL.md into skills/bdb-aos so skills CLI discovers all skills ([#72](https://github.com/hybridlabor-api/aos/issues/72)) ([033e810](https://github.com/hybridlabor-api/aos/commit/033e8107cf72416eb2bfcdc0232a8efb2d6497b9))

## [4.11.0](https://github.com/hybridlabor-api/aos/compare/v4.10.0...v4.11.0) (2026-09-30)


### Features

* **opencode:** harness plugin with graph loop-keeper and installer payload ([#68](https://github.com/hybridlabor-api/aos/issues/68)) ([837e5fb](https://github.com/hybridlabor-api/aos/commit/837e5fb32fa85e5b082cb0f92ce30f52517f158e))

## [4.10.0](https://github.com/hybridlabor-api/aos/compare/v4.9.0...v4.10.0) (2026-09-30)


### Features

* **arch:** Phase 0 and 2 optimizations ([#64](https://github.com/hybridlabor-api/aos/issues/64)) ([d19ca2a](https://github.com/hybridlabor-api/aos/commit/d19ca2ada80b67c14932a538d7ca1dff51f44e71))
* **cli:** AOS CLI and CICD Skills Import ([#66](https://github.com/hybridlabor-api/aos/issues/66)) ([9cbc7ae](https://github.com/hybridlabor-api/aos/commit/9cbc7ae47c9fd04caf2f22b19b764da631877e54))


### Bug Fixes

* **canvas:** Opencode integration and default canvas for plans ([#67](https://github.com/hybridlabor-api/aos/issues/67)) ([db17242](https://github.com/hybridlabor-api/aos/commit/db17242f4e1bfca4f9bf60eadd9bf3ba8f9427bf))

## [4.9.0](https://github.com/hybridlabor-api/aos/compare/v4.8.0...v4.9.0) (2026-09-30)


### Features

* **aos:** CI/CD skills, AOS CLI harness, plugin manifest & installer fixes ([#63](https://github.com/hybridlabor-api/aos/issues/63)) ([08ad51d](https://github.com/hybridlabor-api/aos/commit/08ad51d89109980c3cf98210997cbb68c93856ea))
* **opencode:** wire /startcycle-graph workflow context into bdb-aos plugin ([a9d8b66](https://github.com/hybridlabor-api/aos/commit/a9d8b662a2b1b5c02e482bc369fc749a19257c8f))
* **skills:** add universal ao-orchestrator skill across all harnesses ([4d92e1a](https://github.com/hybridlabor-api/aos/commit/4d92e1a128899b2b9b484cf45093f2ede11bdb35))


### Bug Fixes

* **hooks:** harden GO-gate cross-harness enforcement and populate antigravity-cli hooks ([200db0f](https://github.com/hybridlabor-api/aos/commit/200db0ff5b3e40fac99e7e2e6316360357f51cf0))
* **installer:** resolve Windows-specific EPERM, AO timeout and DEP0190 on Node 24 ([35b54da](https://github.com/hybridlabor-api/aos/commit/35b54da7c40e0d26b467aa4cbf0ee8e4e8432c08))
* **installer:** split rename swap into two phases to avoid ENOENT on retry ([5aa76cf](https://github.com/hybridlabor-api/aos/commit/5aa76cf6f196025bdd0e1626b4240dc771e47ae1))

## [4.8.0](https://github.com/hybridlabor-api/aos/compare/v4.7.2...v4.8.0) (2026-09-25)


### Features

* **installer:** enable cross-platform AO and native Windows Synapse support ([bd5699f](https://github.com/hybridlabor-api/aos/commit/bd5699fa451363b3e9741e8ad4336be8a50e9e69))

## [4.7.2](https://github.com/hybridlabor-api/aos/compare/v4.7.1...v4.7.2) (2026-09-25)


### Bug Fixes

* resolve adversarial review findings F-01 to F-04 and harden path lookups ([#59](https://github.com/hybridlabor-api/aos/issues/59)) ([13cd1f6](https://github.com/hybridlabor-api/aos/commit/13cd1f6c8e0d4df815c29119293d56bb46e5f473))

## [4.7.1](https://github.com/hybridlabor-api/aos/compare/v4.7.0...v4.7.1) (2026-09-25)


### Bug Fixes

* AOS 4.7.1 - System Doctor, AO Beta, Store Offline Index, Native Plans & Archify Contracts ([#57](https://github.com/hybridlabor-api/aos/issues/57)) ([1e032ef](https://github.com/hybridlabor-api/aos/commit/1e032efa82845e8a969c112c9d589e1c0b2131cf))

## [4.7.0](https://github.com/hybridlabor-api/aos/compare/v4.6.6...v4.7.0) (2026-09-24)


### Features

* AOS 4.7.0 - Live Pipeline Map, deja-vu Memory, memB Second Brain & Security Engine ([#55](https://github.com/hybridlabor-api/aos/issues/55)) ([a943785](https://github.com/hybridlabor-api/aos/commit/a9437859520e6626f05933d8adb627f2c045582d))

## [4.6.6](https://github.com/hybridlabor-api/aos/compare/v4.6.5...v4.6.6) (2026-09-20)


### Bug Fixes

* **cli:** cross-platform launcher binaries and windows path handling ([#53](https://github.com/hybridlabor-api/aos/issues/53)) ([acb8f72](https://github.com/hybridlabor-api/aos/commit/acb8f72b9fb8c831afd853baf897cae6173648ca))

## [4.6.5](https://github.com/hybridlabor-api/aos/compare/v4.6.4...v4.6.5) (2026-09-20)


### Bug Fixes

* support Windows daemon lifecycle in AOS ([#51](https://github.com/hybridlabor-api/aos/issues/51)) ([0f9cbf9](https://github.com/hybridlabor-api/aos/commit/0f9cbf93cbf8607996ef7b1bced496379ff43cc1))

## [4.6.4](https://github.com/hybridlabor-api/aos/compare/v4.6.3...v4.6.4) (2026-09-20)


### Bug Fixes

* **installer:** handle windows EPERM during module swap and bootstrap pip in venv ([a772825](https://github.com/hybridlabor-api/aos/commit/a7728250319f9c657f5f947cf352d1acedef733d))

## [4.6.3](https://github.com/hybridlabor-api/aos/compare/v4.6.2...v4.6.3) (2026-09-20)


### Bug Fixes

* **installer:** resolve TypeError log.ok and pass visualizer wiki path on windows ([39f9fe1](https://github.com/hybridlabor-api/aos/commit/39f9fe16fc874e779f2fa3349b101ea65a3da85c))

## [4.6.2](https://github.com/hybridlabor-api/aos/compare/v4.6.1...v4.6.2) (2026-09-20)


### Bug Fixes

* install openwiki CLI on demand and persist visualizer wiki path ([9782861](https://github.com/hybridlabor-api/aos/commit/9782861d9eb2d4764f9d8714ee1be4483a7836c4))

## [4.6.1](https://github.com/hybridlabor-api/aos/compare/v4.6.0...v4.6.1) (2026-09-20)


### Bug Fixes

* iterative visual render loop for hardware-pcb godmode skill ([f2411c6](https://github.com/hybridlabor-api/aos/commit/f2411c6bd0fe7cee53f5eaf6700bb766d757380c))

## [4.6.0](https://github.com/hybridlabor-api/aos/compare/v4.5.2...v4.6.0) (2026-09-20)


### Features

* **subagents:** multi-harness subagent architecture across claude, antigravity, opencode, and codex ([258a3a3](https://github.com/hybridlabor-api/aos/commit/258a3a3a458213292c472ede2253e0ee602a2aca))

## [4.5.2](https://github.com/hybridlabor-api/aos/compare/v4.5.1...v4.5.2) (2026-09-20)


### Bug Fixes

* **opencode:** add native plugin hooks, slim mcp profile, and skills wiring ([f015175](https://github.com/hybridlabor-api/aos/commit/f015175374ab0c9e6272a47793370ef6ce194abe))

## [4.5.1](https://github.com/hybridlabor-api/aos/compare/v4.5.0...v4.5.1) (2026-09-20)


### Bug Fixes

* **installer:** cross-harness hooks, windows openwiki daemon and dashboard opener ([ab08b9b](https://github.com/hybridlabor-api/aos/commit/ab08b9b0e2a0f53058dc5f60aab240db6af2ac2b))

## [4.5.0](https://github.com/hybridlabor-api/aos/compare/v4.4.1...v4.5.0) (2026-09-15)

### Features

* add live-preview-canvas skill ([672b719](https://github.com/hybridlabor-api/aos/commit/672b7196c481d2a5afbde3f56cf584d6b5672018))
* add engineering-hardware category and godmode-hardware-pcb ([f86484c](https://github.com/hybridlabor-api/aos/commit/f86484c54c705f00ae34f0d55c0b6feecfeb11aa))
* wire bdb-hardware-pcb as an optional AOS module ([b87a520](https://github.com/hybridlabor-api/aos/commit/b87a520182e12fe4e0fe7663c504f9992cd53142))
* register a real autostart entry for the launchpad dashboard itself ([ef4a53c](https://github.com/hybridlabor-api/aos/commit/ef4a53cf5e19741fcd3e441981fa82bc02a7f2b5))
* **dashboard:** add aos-dashboard, a live view of every BDB service ([a6dac4f](https://github.com/hybridlabor-api/aos/commit/a6dac4fce8a5879c8a6bc3d1db1f86728ab8d392))
* **launchpad:** add a favicon and an OpenWiki Visualizer card + autostart daemon ([0cdd6c1](https://github.com/hybridlabor-api/aos/commit/0cdd6c1f6f57519c0469b1a7a4d07978380d24b6))
* **launchpad:** replace emoji branding with real BDB SVG marks, Inter/IBM Plex Mono type stack

### Bug Fixes

* guard against a too-old Node.js before requiring anything ([57eb314](https://github.com/hybridlabor-api/aos/commit/57eb314e9158cd08d347fbe8601dab623aef1c7b))
* universal-tier workspace skills dir defaulted to cwd, crashed on an unwritable cwd ([fffee2c](https://github.com/hybridlabor-api/aos/commit/fffee2c78636741b14c910dd69d2671520005d15))
* kinetic-intro banner hardcoded v4.0.0, stale skill/MCP counts in all 3 READMEs, Node floor aligned to 20+ ([55adcdd](https://github.com/hybridlabor-api/aos/commit/55adcdd4f95d02dc738ebea5aa4b70566bc6777c))
* launchpad dashboard never opened on Quick Update, and its dev-workflow guard used a path from before the workspace reorg ([32d5f12](https://github.com/hybridlabor-api/aos/commit/32d5f129bf068cfeeb8830bf294809ac08a86a5f))
* Codex/ChatGPT-Desktop detection, self-perpetuating harness folders, isAutoYes credential reset ([89817d3](https://github.com/hybridlabor-api/aos/commit/89817d3e44615bd16a496f7aa286c0eb7459ac6d))
* retire dead global_legacy dirs on update, detect version downgrades ([3768698](https://github.com/hybridlabor-api/aos/commit/3768698d8384316a22f1cf6ca411602af00327e3))
* three real bugs found on a live Windows test round ([5442810](https://github.com/hybridlabor-api/aos/commit/54428106437b5f212431c53acba6e668df8af531))
* surface Uninstall AOS in the main interactive menu ([80ba3f1](https://github.com/hybridlabor-api/aos/commit/80ba3f11694003fc8df4ca957ef99f6b5dcda6cd))
* prune retired skills from disk on update, not just from the package ([7f02005](https://github.com/hybridlabor-api/aos/commit/7f020055e8106692aedbb41e6157e77333250508))
* remove BDB-internal skills, moved to private aos-internal repo ([87cefee](https://github.com/hybridlabor-api/aos/commit/87cefee61c089ccb1df63fa43360699475917a2e))
* stop shipping four MCPs no installer path can select ([2e9e028](https://github.com/hybridlabor-api/aos/commit/2e9e028433ffa7e897757940841d6fb99957004f))
* **installer:** do not register an MCP whose build produced nothing ([6232ac1](https://github.com/hybridlabor-api/aos/commit/6232ac10a0f6e464fb66af2d2966a14389aab4be))
* stop shipping operational data, correct two false AO claims, repair the Python prewarm ([d99ad60](https://github.com/hybridlabor-api/aos/commit/d99ad60da023d2328464621456963246ba20d0b3))
* **installer:** let AO install its own service instead of writing a broken one ([8e527c5](https://github.com/hybridlabor-api/aos/commit/8e527c53b2643cf0db83987c63dd4f55c452b732))
* **installer:** enable AO, but only where its binary can run ([c6e6726](https://github.com/hybridlabor-api/aos/commit/c6e6726f4df6eb8d8a760bd03378e89aef040988))
* **installer:** point AO at bdb-agent-orchestrator, never at the archived one ([59f0030](https://github.com/hybridlabor-api/aos/commit/59f00306b8bbfae824966e931f0d24038c78fe0c))
* **dashboard:** report AO's running version, not an archived package's ([37473c6](https://github.com/hybridlabor-api/aos/commit/37473c60bafe6059a8c47b3c5d7689925011bbb1))
* **installer:** add an uninstall, in two stages ([e79bd2c](https://github.com/hybridlabor-api/aos/commit/e79bd2c89d5e7c5a7a3a2759d7154a8741ebdd61))
* **installer:** stop the dry-run banner claiming more than it does ([c4f421d](https://github.com/hybridlabor-api/aos/commit/c4f421d73fb9ff3945d8f365f422a0d0cbc3a9be))
* **skills:** make the setup skills configure, not just diagnose ([9ff238a](https://github.com/hybridlabor-api/aos/commit/9ff238a3c7ec464cda8406a94383e1f17f4bacc9))
* **installer:** close the audit findings — nine defects in one family ([514d36f](https://github.com/hybridlabor-api/aos/commit/514d36f4ae42981b2f2208ca84afe39e39e01dbd))
* **installer:** detect harnesses by the software, not by its folders ([835fa6c](https://github.com/hybridlabor-api/aos/commit/835fa6c1c956dfae46e699a03fafcac412b96f2a))
* **openwiki:** daemon launcher dropped every provider but Gemini, defaulting silently to Gemini regardless of the configured LLM provider ([fb9f8e8](https://github.com/hybridlabor-api/aos/commit/fb9f8e84697f95b356472cf5363e7258e4e473da))
* **openwiki:** guard OPENWIKI_MODEL/BASE_URL against `set -u` under non-default providers ([0cdd6c1](https://github.com/hybridlabor-api/aos/commit/0cdd6c1f6f57519c0469b1a7a4d07978380d24b6))
* **launchpad:** plain white wordmark instead of a gradient ([2b53b8e](https://github.com/hybridlabor-api/aos/commit/2b53b8e2be63b992cf87f283c07b6c9d605deeec))

### Documentation

* update README (EN/DE/PT) for v4.5.0, Hardware & PCB module, and accurate skill/MCP counts (184 skills, 19 MCPs) ([006096c](https://github.com/hybridlabor-api/aos/commit/006096cd8e6110fe251c1dab7569e6691b4b0d39))
* clarify AOS repo stays public permanently, internals ship as a private npm package ([7744aa5](https://github.com/hybridlabor-api/aos/commit/7744aa5d5d7aa400bb04a750528814732331a54b))
* record the silent-failure audit and the rules it produced ([afe8a85](https://github.com/hybridlabor-api/aos/commit/afe8a8511cd60a7feb52c6426d4d5ba92da7a6eb))
* correct the queue.db finding — it was a near miss, not a leak ([cc2914c](https://github.com/hybridlabor-api/aos/commit/cc2914cf091ba6e143911a30967e332454870eb6))

## [4.4.1](https://github.com/hybridlabor-api/aos/compare/v4.4.0...v4.4.1) (2026-09-13)


### Bug Fixes

* **installer:** refresh hooks on Quick Update, not only a fresh install ([738d365](https://github.com/hybridlabor-api/aos/commit/738d365b7b7ac3a2f5363e656f34f7c10de599be))
* **installer:** stop freezing skills installed before manifest tracking ([5bf0d70](https://github.com/hybridlabor-api/aos/commit/5bf0d705830a63e34a62efab95ed970b34a36eb5))

## [4.4.0](https://github.com/hybridlabor-api/aos/compare/v4.3.0...v4.4.0) (2026-09-13)


### Features

* **skills:** add aos-setup and aos-project-init ([9fe0768](https://github.com/hybridlabor-api/aos/commit/9fe0768fdbf634493ca8c8d03e8318416da20b84))


### Bug Fixes

* **installer:** ship and wire the memB ambient memory hook ([9f7ec6b](https://github.com/hybridlabor-api/aos/commit/9f7ec6b6aba33a408a9351680e85049b10544f5d))
* **skills:** correct the doctors' install-layout and status assumptions ([478bfc7](https://github.com/hybridlabor-api/aos/commit/478bfc7cf60cc6b474261f9f89c3996781c29361))

## [4.3.0](https://github.com/hybridlabor-api/aos/compare/v4.2.0...v4.3.0) (2026-09-12)


### Features

* **ci:** validate the skill contract on every push ([0191f2c](https://github.com/hybridlabor-api/aos/commit/0191f2ce8c8685b06fa001344572fc70b9185a81))


### Bug Fixes

* address the independent review's confirmed findings ([ab92b05](https://github.com/hybridlabor-api/aos/commit/ab92b0543cf44f7bd72e4ced30e378e2fb367778))
* **installer:** match the MCP guides by their new directory names ([5d4075b](https://github.com/hybridlabor-api/aos/commit/5d4075b7be78f58e9b0b106b73dce27a0c6dff2d))
* **skills:** describe bdb-memb-mcp by the tools it actually exposes ([32f0c7d](https://github.com/hybridlabor-api/aos/commit/32f0c7dc4dcdd4d438997a4d6fac5e84e5db014c))
* **skills:** make the twelve MCP guides discoverable by any harness ([75929c4](https://github.com/hybridlabor-api/aos/commit/75929c43644bc23be192a00de815506d74111339))
* **skills:** remove pointers that resolve to nothing ([e168019](https://github.com/hybridlabor-api/aos/commit/e1680198b58a26010ae612504e85db784e2d3690))
* **skills:** restore the copyright notice stripped from two Apache licences ([bda5794](https://github.com/hybridlabor-api/aos/commit/bda5794f0a0fb64f2566c4c8911ae3a6e8be0fad))
* **skills:** restore the force of the agent-sudo requirement ([f99bd90](https://github.com/hybridlabor-api/aos/commit/f99bd902aa90ffb81c809fa8e97cad9f0e1c7669))
* **skills:** stop seven descriptions from swallowing their category ([72cd8a3](https://github.com/hybridlabor-api/aos/commit/72cd8a30cf4dc1fd0b13e9c66692bf0750bb0e4a))

## [4.2.0](https://github.com/hybridlabor-api/aos/compare/v4.1.0...v4.2.0) (2026-09-10)


### Features

* **ask-tim:** lead with a flow map, keep the catalogue beneath it ([4969c85](https://github.com/hybridlabor-api/aos/commit/4969c85378caf11e33788238bd95d11292fbbc42))
* **skills:** add teamwork-preview prompt crafting and delegation skill ([11fe6f5](https://github.com/hybridlabor-api/aos/commit/11fe6f5cbeeea636dda6cfebc391d8ad625a194e))
* **skills:** port the grilling family from mattpocock/skills (MIT) ([152225b](https://github.com/hybridlabor-api/aos/commit/152225bf6d69c9f47f4d52b937f480e9ac97271e))
* **skills:** ship bdbresilience and register it on shipping+engineering ([68993cb](https://github.com/hybridlabor-api/aos/commit/68993cb4d201130e05c5f14363f8535381cde87e))
* **startcycle:** add --skill=&lt;name&gt; mandatory skill injection ([4c376d5](https://github.com/hybridlabor-api/aos/commit/4c376d50a9397f14773fd315367089e0d1c54ae5))
* **teamwork-preview:** executable workflow, and deliver dispatchers globally ([4360e84](https://github.com/hybridlabor-api/aos/commit/4360e844e8ff626d957345acc297f7d04b9ddb1c))


### Bug Fixes

* **--skill:** look in every harness's skills dir, not just ~/.claude ([506fa88](https://github.com/hybridlabor-api/aos/commit/506fa88f03c19b1eabf342df6a7f668faa79bb04))
* **delegation:** agy is slow, not broken -- correct the timeout guidance ([f88b318](https://github.com/hybridlabor-api/aos/commit/f88b318568c5ebc9c52cfcf909af58447ed85b6c))
* **openwiki:** daemon could never load its SDK -- venv + pinned interpreter ([962abcd](https://github.com/hybridlabor-api/aos/commit/962abcd787b38568494191b61973cd0ce088f246))
* **skills:** wire grilling into the storms, and close three routing gaps ([64ffff4](https://github.com/hybridlabor-api/aos/commit/64ffff4c0104b4e1c77747e1f368b2b9815839c1))
* **startcycle-graph:** bootstrap nodes.json, without it every first run dies ([dab1ea7](https://github.com/hybridlabor-api/aos/commit/dab1ea72793741fe382d424a1cdc0c50cd165d86))

## [4.1.0](https://github.com/hybridlabor-api/aos/compare/v4.0.2...v4.1.0) (2026-09-09)


### Features

* **agents,skills:** port 6 subagents and Plan Canvas from affaan-m/ECC ([87a9e92](https://github.com/hybridlabor-api/aos/commit/87a9e92fc52f8e62c11d15c5019a6b245587c41b))
* **skills:** make Plan Canvas mandatory in bdbrainstorm and bdbmediastorm ([e5632d5](https://github.com/hybridlabor-api/aos/commit/e5632d5d554adb2af19b5a2463a201d15c95efaf))


### Bug Fixes

* **release:** resync release-please manifest to actual shipped version ([b62cfe6](https://github.com/hybridlabor-api/aos/commit/b62cfe6de6471bbc8574bf3a08b7d5fad0e33b14))

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
