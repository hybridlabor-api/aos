# Changelog

## [5.4.2](https://github.com/hybridlabor-api/aos/compare/v5.4.2-beta.1...v5.4.2) (2026-10-28)


### Features

* **skills:** lean skill library with lean, smart, groups and full modes ([6b971b6](https://github.com/hybridlabor-api/aos/commit/6b971b6d3966c2dd4f520922b1c837eddb02d510))


### Bug Fixes

* **a2a:** pass the resolved harness pid to the Windows finisher ([216471b](https://github.com/hybridlabor-api/aos/commit/216471b41ae83f143edf12ea25b66fcb38e2b982))
* **a2a:** prune peers whose heartbeat lapsed past the idle window ([53e5ca5](https://github.com/hybridlabor-api/aos/commit/53e5ca59f1d4ded4787547d5c7657379d7919821))
* **agy:** keep only router skills in ~/.gemini/config/skills ([bd4ffc1](https://github.com/hybridlabor-api/aos/commit/bd4ffc1acc425f0a99fd459c43bb561f4b7c8702))
* **agy:** stop bundling skills in the agy plugin, retire old bundled copies ([833512c](https://github.com/hybridlabor-api/aos/commit/833512c8cbf0cc562ac221a5e8b94f4c0657f6af))
* **control-mod:** pass a runner instead of the engine across the logic import ([fa71400](https://github.com/hybridlabor-api/aos/commit/fa71400c680dd15d05fae2fd345b4c7735c91674))
* **doctor:** agy one-source row variable clash ([ef7c110](https://github.com/hybridlabor-api/aos/commit/ef7c110cfc5ddb8c0f921cd0be43fed993064a5f))
* **doctor:** read the gateway token with the imported readFileSync ([6ebb63c](https://github.com/hybridlabor-api/aos/commit/6ebb63ca6b08b4e197d0e573608c90a6a7f4bf63))
* **fabric:** resume a human step from the verdict record and name the url when waiting ([ba8ca8e](https://github.com/hybridlabor-api/aos/commit/ba8ca8e5b1795497ba006fe33ffc9e1f50ac8958))
* **gate:** fabric workers run hard-only ([f41d556](https://github.com/hybridlabor-api/aos/commit/f41d55624b39a8c3003aca30b5d8b5e88dbdcb7c))
* **harnesses:** OpenCode config is ~/.config/opencode on Windows too ([3d3b95b](https://github.com/hybridlabor-api/aos/commit/3d3b95bc45941fb15d088e9199ffe71499944a72))
* **hub:** allow same-site iframe navigation to /canvas when embedding is enabled ([2eae326](https://github.com/hybridlabor-api/aos/commit/2eae3262169642f1b59b6d4a1bed27e5c85d0301))
* **hub:** Windows service control is Startup/ScheduledTask, probe both loopbacks ([0caedbf](https://github.com/hybridlabor-api/aos/commit/0caedbf2fe9547ca7e325560a3882e7dc4121085))
* **plan-canvas:** explicit port beats server.json; private state dir skips endpoints announce/retire ([c42a117](https://github.com/hybridlabor-api/aos/commit/c42a117404c0a300ba413bdb714f216cae53ec91))
* **plan-canvas:** keep the verdict record for approve and request-changes, print the url before the wait ([374181b](https://github.com/hybridlabor-api/aos/commit/374181b71293bbd0e2db3f948c22a550eb227e8e))
* **v5:** run claude --version through cli-spawn on Windows ([20f8565](https://github.com/hybridlabor-api/aos/commit/20f8565f784312c37e72ffb9517d96ccc7e1583f))


### Miscellaneous Chores

* release 5.4.2 ([2ef0467](https://github.com/hybridlabor-api/aos/commit/2ef0467ef1944886328563341357d5e5e6be4d34))

## [5.4.2-beta.1](https://github.com/hybridlabor-api/aos/compare/v5.4.0-beta.1...v5.4.2-beta.1) (2026-10-28)


### Features

* **agenttrail:** Lanes tokens in the hub layout and count roll on change ([86ac3e9](https://github.com/hybridlabor-api/aos/commit/86ac3e9973eba09ce793bf8e1d8b1f90d372a8f5))
* AOS² 5.4.2-beta.1 (5.4.1 + 5.4.2 + 5.4.0-beta.2 hook fixes) ([73d39a3](https://github.com/hybridlabor-api/aos/commit/73d39a3ad5a1a68f14a27fd4bc763d8993c3e7e0))
* **fabric:** accept a pre-approved plan and run four parallel reviewers ([322ce95](https://github.com/hybridlabor-api/aos/commit/322ce95d1384c9c652f7b83e40cb7a369eaf841c))
* **fabric:** aos-fabric CLI and executor adapters (WP4-WP5) ([07a66fe](https://github.com/hybridlabor-api/aos/commit/07a66fe586067d1393ae6b9ccd49bc95e015e872))
* **fabric:** aos-fabric start, next, report, status, cancel with real steps (WP4) ([2d3b090](https://github.com/hybridlabor-api/aos/commit/2d3b0907f285a219563304b39362f16bdd95673b))
* **fabric:** core library for the harness-neutral fabric (schemas, store, edges) ([d8840af](https://github.com/hybridlabor-api/aos/commit/d8840af4356baf9becafb14f955d8f0881a4e6ab))
* **fabric:** drive and the executors, with a real timeout (WP5) ([9c28657](https://github.com/hybridlabor-api/aos/commit/9c28657a01ec59218f2e3849faa48528f6a04073))
* **fabric:** fabric-dispatch gets a cli engine, a thin client of aos-fabric (WP6) ([4f2ffdf](https://github.com/hybridlabor-api/aos/commit/4f2ffdf559a9554d9f364a5a5e133bfe6f51ec02))
* **fabric:** pass --role to ao when advertised; add ao_session_id to step events ([0757cdc](https://github.com/hybridlabor-api/aos/commit/0757cdc9b368da8ae8dee59a49a3854cd4ef0b15))
* **fabric:** the full edge table as one pure decide() (WP3) ([25c2e5d](https://github.com/hybridlabor-api/aos/commit/25c2e5d382d3dc367081e7cf4e8a9a40730fb119))
* **factory:** ship a default sandbox image for unattended runs ([0f18cea](https://github.com/hybridlabor-api/aos/commit/0f18cea5c386addc03cd6581885641741b45c538))
* **gateway:** seed a first selection from base and detected apps; direct-by-design servers ([9ecf327](https://github.com/hybridlabor-api/aos/commit/9ecf327605cbdfb4a835a7e3f2d791448d3b38ec))
* **mcp:** ship one Rhino MCP per harness, golem fallback opt-in via AOS_RHINO_MCP=fallback ([8ec86dd](https://github.com/hybridlabor-api/aos/commit/8ec86ddeda20ee3fd387ece60b87d56dcabba7bc))
* **router:** advisor reads models.&lt;harness&gt; from .aos/pipeline.json ([9193453](https://github.com/hybridlabor-api/aos/commit/91934537da891c101e266865dc0fcf5a4fb51b12))
* **skills:** add find-skill, rename bdb-updater to aos-update with a thin alias, rank ask-tim for find-skill queries ([f1efd65](https://github.com/hybridlabor-api/aos/commit/f1efd65cc53f121a3b6895e681968ff47c3d41d7))
* **skills:** generate ask-tim skill catalogue from frontmatter, rank store search by relevance ([022f3ff](https://github.com/hybridlabor-api/aos/commit/022f3ff731cb519a0948f1c85eba4c9baa528bc5))
* **update:** ask the update mode once on aos update ([53f3fc6](https://github.com/hybridlabor-api/aos/commit/53f3fc678c59efd9e6b607f38c51fcb0793a4493))


### Bug Fixes

* **a2a:** pre-create the peer reply dir and skip mkdir on reply when it exists ([54b273f](https://github.com/hybridlabor-api/aos/commit/54b273faeb2b04be1affba24905ba6f1c90b3669))
* **a2a:** start the Codex sidecar finisher outside Codex's job object on Windows ([b1a8375](https://github.com/hybridlabor-api/aos/commit/b1a837563bcec0889d10d95fe0342046246238c7))
* **a2a:** stop codex sidecars and Windows monitors when their owner process is gone ([667ff76](https://github.com/hybridlabor-api/aos/commit/667ff76a9e5d2af157f5e740ea8094f0f3242a31))
* **codenotch:** warn instead of failing when Windows still lists the old version ([676ef04](https://github.com/hybridlabor-api/aos/commit/676ef04dd79c5a164fb30ca0b329d9d98e497c60))
* **doctor,installer:** accept a current global npm install, split --platforms lists, resolve uv on Windows ([0bfffd4](https://github.com/hybridlabor-api/aos/commit/0bfffd4348541e4d9a69721b891e71002405084f))
* **doctor:** real gateway tool-count error and handshake, REA hint without missing package ([8add996](https://github.com/hybridlabor-api/aos/commit/8add99675518e59ec025f6ce50db160093ce0f2f))
* **fabric-dispatch:** end hook mode at the budget instead of spawning on ([0414c8c](https://github.com/hybridlabor-api/aos/commit/0414c8cb9a0cb096744e1beb9a40a0d8aa19bf95))
* **fabric:** close the blocking review findings ([0cb7e68](https://github.com/hybridlabor-api/aos/commit/0cb7e68d58059dce0325680c9531d322da1e59a7))
* **fabric:** close the remaining fail-open paths in the dispatcher shim ([7a056ec](https://github.com/hybridlabor-api/aos/commit/7a056ecaa30b165eeff601ba43ae612e817f253b))
* **fabric:** declare the --plan pre-approval record in the state schema ([88d6ff1](https://github.com/hybridlabor-api/aos/commit/88d6ff1f0e48913e9a69e1376e3a11f5adc32ec6))
* **fabric:** deterministic plan approval and reviewer merge ([dacd1a3](https://github.com/hybridlabor-api/aos/commit/dacd1a37f6ccedf4ab45d548011528d33f5c5203))
* **fabric:** escalate on every remaining executor failure path ([7e37640](https://github.com/hybridlabor-api/aos/commit/7e37640d9661b8bc21d90c4344dc4bd13325297f))
* **fabric:** event-sourced run store with safe lock takeover (WP2) ([aa438fa](https://github.com/hybridlabor-api/aos/commit/aa438facd5f0b7bfe97c8c51493be558151a1048))
* **fabric:** fail closed when the standalone agent shim's executor fails ([ad07122](https://github.com/hybridlabor-api/aos/commit/ad071225025727b29d4be84f9d603fc9901d817c))
* **fabric:** harden reports, briefs and registry; next exits 0 for ends the graph reached ([4905047](https://github.com/hybridlabor-api/aos/commit/4905047f8ca5b43fb9c98effde20c92fcb326ce4))
* **fabric:** installed libs, schema-valid --plan state, recorded reviews, checked replies ([c33267c](https://github.com/hybridlabor-api/aos/commit/c33267c87a077de7b13b3a77d30c1960200a0ccb))
* **fabric:** keep findings per node, keep open status, real shim fail-closed tests ([339378e](https://github.com/hybridlabor-api/aos/commit/339378e4efcb9c9d7405559611ef036938c88042))
* **fabric:** keep the home path out of reports, say why the scope was not checked ([3c9f70d](https://github.com/hybridlabor-api/aos/commit/3c9f70d0361be6680868f00e448c7bbee6a81491))
* **fabric:** retry deleting the run lock where Windows holds the file for a moment ([1be7d26](https://github.com/hybridlabor-api/aos/commit/1be7d26dc2c83930fe12444728559fb9708271af))
* **fabric:** run the AO executor in step.cwd via ao spawn --workdir ([5016612](https://github.com/hybridlabor-api/aos/commit/5016612e3d23df82b3448d850714e383f88878c7))
* **fabric:** stop drive cleanly with a waiting_for_human state instead of an outer timeout ([0263bbd](https://github.com/hybridlabor-api/aos/commit/0263bbd3e3fec136c6969e4b263c99827c87a5b4))
* **fabric:** validate step and report schemas for real (WP1) ([03db05a](https://github.com/hybridlabor-api/aos/commit/03db05a332fea0130f43ec849c532afc7aa35d5d))
* **fabric:** verify plan approval and merge reviews in code under every runtime ([27984bb](https://github.com/hybridlabor-api/aos/commit/27984bb0d997acccaa806bb3d53ab8ad9201cb8e))
* **factory:** allowlist the image contents and never pull the default image ([5edfce4](https://github.com/hybridlabor-api/aos/commit/5edfce42cf75d25ecc43fdbd15782ad8b9b6afff))
* **gateway:** keep the 5.4 selection behaviour, report instead of change ([50b4c6c](https://github.com/hybridlabor-api/aos/commit/50b4c6ca4762d13ec1dff19fbf0550696993c2ae))
* **gateway:** limit the P0 follow-up to doctor reporting ([dbbafc5](https://github.com/hybridlabor-api/aos/commit/dbbafc5cc4e798c4ffcb9be5da6f862aae26dbfc))
* **gateway:** report dropped servers, direct-by-design and unverified rows ([f702644](https://github.com/hybridlabor-api/aos/commit/f702644e80140c39c3381f8f16ce0d885b4d604e))
* **gateway:** resolve npx/uv on Windows in aos-mcp-env, warn and back off on failed pinned install ([700bf93](https://github.com/hybridlabor-api/aos/commit/700bf9320759c5ffd8be52b7f973b93d3a7f89d5))
* **gateway:** show the upstream root-cause line and npx cache hint in status and doctor ([7dcc42c](https://github.com/hybridlabor-api/aos/commit/7dcc42cee08fab001a167a5e2f5d274513392188))
* **gateway:** tolerate only the bare command form in memory entry check ([824ecb1](https://github.com/hybridlabor-api/aos/commit/824ecb1d2f69d53ec5daeb1aca3777d40193eb76))
* **gateway:** treat bare node/deja direct memory entries as confirmed so the gateway copy is removed ([5be75b5](https://github.com/hybridlabor-api/aos/commit/5be75b57f929987662adfcf125e966a5593dc618))
* **hooks:** give every hook a hard time budget and bounded children ([ebd2363](https://github.com/hybridlabor-api/aos/commit/ebd2363095d06daf6320ba71e04418a3806e8c31))
* **hub-ui:** catalog harness filter default and store description/state line ([e261047](https://github.com/hybridlabor-api/aos/commit/e26104737ee1634722919b44d1d7d79b547a4e32))
* **hub:** close the identity probe socket so hub-services tests exit ([addddea](https://github.com/hybridlabor-api/aos/commit/addddeab85ae89fdf7d489c1a5f6ca8247fd67e7))
* **hub:** identify the hub by /api/health before reporting it up ([3e3163b](https://github.com/hybridlabor-api/aos/commit/3e3163be69606f2abd82cc53ed3826ef4e824f31))
* **hub:** installed-version fallback, Windows ao path, HTML page for /trail when agenttrail is down ([3191ee5](https://github.com/hybridlabor-api/aos/commit/3191ee577787f57faf1cad1f6ae35208c3aab0b9))
* **hub:** run the hub identity probe before the generic port probe ([b14a747](https://github.com/hybridlabor-api/aos/commit/b14a7475154e058e530b5ea897795ce5f04faead))
* **installer:** keep bare node and deja when only versioned paths exist ([d473568](https://github.com/hybridlabor-api/aos/commit/d4735685dcefe384ba29dde1273f1451f25bfa3c))
* **installer:** show npm's error when the deja-vu install fails ([bcb9b49](https://github.com/hybridlabor-api/aos/commit/bcb9b49f8a1965d19d2da74cdbbfc2dec06c9915))
* **installer:** write absolute deja and node paths in shipped MCP entries ([dd32edb](https://github.com/hybridlabor-api/aos/commit/dd32edb48cb0782f687d05c9f09ecfb37a5452e4))
* **memb-inject:** hand the Windows shell one command line for deja ([ce0dfcb](https://github.com/hybridlabor-api/aos/commit/ce0dfcbcf9988ba2d4101613683f1d7b49e2a1f0))
* **opencode:** patch AOS-owned mcp entries into a commented opencode.jsonc ([#188](https://github.com/hybridlabor-api/aos/issues/188)) ([9e3a9c1](https://github.com/hybridlabor-api/aos/commit/9e3a9c11105dff83beaa94c5103dbc6ab1de9647))
* **plan-canvas:** re-park await after the server drops the held long-poll ([a606898](https://github.com/hybridlabor-api/aos/commit/a60689826feb81187522c0ab36cd428b2bf35585))
* **plan-canvas:** restart the server and retry open when it idles out mid-request ([0230ed7](https://github.com/hybridlabor-api/aos/commit/0230ed7538493b761c9d42dd7f81e6e3ea14a6e6))
* **router:** install config/router.json under ~/.agents and fail clearly when missing ([61ffc15](https://github.com/hybridlabor-api/aos/commit/61ffc15dd862d650fee1fee33bff096adb67b80e))
* **skills:** aos store search covers shipped skills with multi-word queries; refresh aos-setup, bdb-updater, ask-tim ([fd3cef2](https://github.com/hybridlabor-api/aos/commit/fd3cef2157034544c03698ddcc6c02cfa0bc9668))
* **skills:** fabric-graph keeps its routing trigger words in the description ([8629e2e](https://github.com/hybridlabor-api/aos/commit/8629e2e0d769d839c02495ec6ca745c6116975e5))
* **skills:** keep generated ask-tim catalogue free of brand tokens ([ac82609](https://github.com/hybridlabor-api/aos/commit/ac82609b2544b0718275474568893990718754e9))
* **uninstall:** address second review (env-carrying servers, fail-closed link check, filtered manifest) ([ea91235](https://github.com/hybridlabor-api/aos/commit/ea912354cb74e2440fe04dcb123f1dc07ba946d4))
* **uninstall:** content-based ownership for gemini configs, link-safe purge, crafted manifest entries refused ([73ab50a](https://github.com/hybridlabor-api/aos/commit/73ab50aa47ca6d96e95a8b3ccce08e99a4ca385d))
* **uninstall:** decide Antigravity files by content, back them up, never follow links ([b6d54f5](https://github.com/hybridlabor-api/aos/commit/b6d54f5ada947e18a6318233c1e425169af39775))
* **uninstall:** stop owned background processes, remove empty AOS folders, make --purge complete ([32f46b7](https://github.com/hybridlabor-api/aos/commit/32f46b76ec04e69a4ea3b623c4cdccade36368e2))
* **update:** correct skill manifest hashing and the gateway install cache ([75adae3](https://github.com/hybridlabor-api/aos/commit/75adae3cf1d160017923681a4f6e6571de035136))
* **update:** keep gateway uninstall exact with the npm install cache ([c7f5754](https://github.com/hybridlabor-api/aos/commit/c7f5754b775c88def17fc5be1a7c952032194031))
* **update:** make the skill sync skip and the gateway install cache safe ([6d9dcc9](https://github.com/hybridlabor-api/aos/commit/6d9dcc9101218d4ef663cc432139be95a57fa994))
* **update:** remove skill manifests on uninstall (needs review) ([3749c72](https://github.com/hybridlabor-api/aos/commit/3749c7254d055466f483b8459bc10b930adb172d))
* **update:** sync a skill copy again when only its record is left ([8c439e8](https://github.com/hybridlabor-api/aos/commit/8c439e8df3b83e4a61d0c0a1c5efa11f02bc4f5b))
* **update:** uninstall removes only the AOS skill record and emptied dirs ([13fb83e](https://github.com/hybridlabor-api/aos/commit/13fb83e71a1023539a2d1dfae458106849e329f5))
* **windows:** start every child process with windowsHide ([8811459](https://github.com/hybridlabor-api/aos/commit/8811459ad3df0a193a457927653abef48d519445))


### Performance Improvements

* **update:** time update steps, skip unchanged skill copies and gateway installs ([7b5cbb4](https://github.com/hybridlabor-api/aos/commit/7b5cbb418397078201a45386567d2961be632bce))


### Miscellaneous Chores

* release 5.4.2-beta.1 ([e8eae65](https://github.com/hybridlabor-api/aos/commit/e8eae65e08b173db3fbbb68cc87721ee114a147c))

## [5.4.0-beta.1](https://github.com/hybridlabor-api/aos/compare/v5.3.0...v5.4.0-beta.1) (2026-10-27)


### ⚠ BREAKING CHANGES

* /startcycle, /startcycle-graph, /startcycle-graph-user and /teamwork-preview no longer exist. Use /fabric (picks the mode), /fabric-graph, /fabric-multigraph and /fabric-teamwork.

### Features

* **agenttrail:** aos-trail tick flips exactly one plan checkbox - pure tickTask in lib/plan.mjs plus cli entry: use plan-file and task-id positionals, exit 1 without touching the file when the id is unknown, done already or ambiguous ([5ee6d05](https://github.com/hybridlabor-api/aos/commit/5ee6d0522f2f768bc6306b464328c410ff74db4f))
* **agenttrail:** aos-trail tick gains --doing/--done/--todo, default --done ([9892e68](https://github.com/hybridlabor-api/aos/commit/9892e68040b5a08dd20d68203e3f493185b474bb))
* **agenttrail:** attach workers to plan nodes via brief marker - stampTrailNode in lib/events.mjs: AOS_TRAIL_NODE env wins, a trail-node id marker anywhere in the payload or brief is the fallback. Wired into the Claude trail relay and the OpenCode plugin first-user-message scan ([9530640](https://github.com/hybridlabor-api/aos/commit/9530640e2cc1b0cde3a8b4e42f49b8ed1d89b096))
* **agenttrail:** compact grid layout for parallel nodes & collapse task lists ([cb88df6](https://github.com/hybridlabor-api/aos/commit/cb88df69801d4aad0f12ee59664d9fa37b755fe4))
* **agenttrail:** node-stamped workers read their first open task as [~] in the model ([c04b33e](https://github.com/hybridlabor-api/aos/commit/c04b33e2146805f846bd19b7becd42a1ba9be936))
* **agenttrail:** read-only CORS for local origins ([a2f10e7](https://github.com/hybridlabor-api/aos/commit/a2f10e7ffa8ce242ff14be737d2ba63620d660ca))
* **agenttrail:** worker card on live tasks - liveTasksFor groups reporting sessions per node and returns them as workers entries (name, harness, model when known, state, last file written and seconds since), rendered as existing tag chips on the hub task rows ([463d2c8](https://github.com/hybridlabor-api/aos/commit/463d2c8007f016e283e5851eb71515ecf2e06b4d))
* **allow:** aos allow &lt;preset&gt; adds recorded, reversible permission rules ([38de463](https://github.com/hybridlabor-api/aos/commit/38de463a000fbec188a9f39c74f98c289707b904))
* AOS² 5.4.0 Ouroboros ([468e3e3](https://github.com/hybridlabor-api/aos/commit/468e3e3cb7ebb4ad7d6fb4e5800e74e8d51f62fc))
* **aos:** complete top-level help, route &lt;sub&gt; --help, allow aos team ([cf6b252](https://github.com/hybridlabor-api/aos/commit/cf6b252871e66f7c06e4fdd4a05e60917a74dc54))
* **context:** apply gateway preset immediately on profile change ([2782e30](https://github.com/hybridlabor-api/aos/commit/2782e30f55e6ffa77966965c35db5b8f4942125f))
* **context:** inject rules once per session, enforce per-profile SessionStart cap ([b2da171](https://github.com/hybridlabor-api/aos/commit/b2da1713ede65ad66f0cfbbaedd51625687e5681))
* **context:** measure script, before/after numbers, cap OpenCode memB text ([9d78604](https://github.com/hybridlabor-api/aos/commit/9d78604c3374342a24269eb63ee2256d661ce869))
* **dispatch:** ensure a node's registry skills are installed before its worker starts ([74433fa](https://github.com/hybridlabor-api/aos/commit/74433fa3f0a61039947a7f964535cbe1a4d9853e))
* **docs:** generated CLI reference, spec drift tests, docs fixes ([01c999a](https://github.com/hybridlabor-api/aos/commit/01c999a47df719b64e53f70d87602d4b57e8dcac))
* **doctor:** Claude plugin row via claude plugin list with the shared CLI resolver ([c3c3728](https://github.com/hybridlabor-api/aos/commit/c3c3728efa2466cc1a52642aa43c12a8485f8bd5))
* **doctor:** memory start-context row per harness ([e61102f](https://github.com/hybridlabor-api/aos/commit/e61102f104fe0893e72b0325ebbdab50582ac792))
* **doctor:** one gateway hygiene row for duplicates and servers outside selection plus adopted ([806cc0e](https://github.com/hybridlabor-api/aos/commit/806cc0eb4918bed6cc6b5a4c7cfa681daa63e628))
* **doctor:** report AOS Startup entries disabled in Task Manager (win32, read-only) ([0ada563](https://github.com/hybridlabor-api/aos/commit/0ada563b13ce4395876b399fd6a3e8c21de40b54))
* **doctor:** state explicitly that VS Code mcp.json stays unmanaged ([#181](https://github.com/hybridlabor-api/aos/issues/181)) ([61eaa54](https://github.com/hybridlabor-api/aos/commit/61eaa542b4524cc69d344178189b454926cf0487))
* **e2e:** add headless aos-e2e.sh automation and a light test for the pb-aos-e2e playbook ([802b280](https://github.com/hybridlabor-api/aos/commit/802b280bb1daa149c39b28258f123af6065686b0))
* **gate:** accept local map-click receipts (plain click, no WebAuthn) ([bf40654](https://github.com/hybridlabor-api/aos/commit/bf406548a529b46ef8ba75e18480513bcba66ade))
* **gate:** honour gogate off and soft on OpenCode, keep the prompt-posting routes blocked ([dbe4f0a](https://github.com/hybridlabor-api/aos/commit/dbe4f0ae49d3d81d6a2fc75b45cdb1b8c71b0f7f))
* **gate:** OpenCode grants keep their typed duration, no separate 2h cap ([9f1908d](https://github.com/hybridlabor-api/aos/commit/9f1908d9ae05f7741dc0028de40220edb2a448b6))
* **gate:** snapshot click receipt hardening from earlier worker ([a487bc7](https://github.com/hybridlabor-api/aos/commit/a487bc72b5ec1010a957afdf60c1f89210b3ed9d))
* **gateway-cli:** aos-gateway add/remove with context profile preset on every harness enable ([f66645a](https://github.com/hybridlabor-api/aos/commit/f66645a226313b62f21cc27703cd44a92bb5f0ac))
* **gateway:** add gateway tool size guard and node counter ([483e9e6](https://github.com/hybridlabor-api/aos/commit/483e9e69813bb55abac88ae3fc8e9fed59435614))
* **gateway:** CLI mode via aos-gateway inspect and run, docs and worker rule ([bc45401](https://github.com/hybridlabor-api/aos/commit/bc45401480c8add52b9cd3c2322e5cb675d72772))
* **gateway:** doctor reports per-harness gateway exposure with estimated tokens ([aaa4f29](https://github.com/hybridlabor-api/aos/commit/aaa4f29dadb33bf6c342963a31c45912ac409035))
* **gateway:** gateway.servers selection setting, tier/module derivation and write-back ([f10cc5b](https://github.com/hybridlabor-api/aos/commit/f10cc5bc2949e98c63f991454199b76462948202))
* **gateway:** installer writes the derived gateway.servers selection ([6c481fd](https://github.com/hybridlabor-api/aos/commit/6c481fd8e0664a58c8ad69c4c5dd9f3301abe8d0))
* **gateway:** lazy loading on by default and auto-restart for stdio upstreams ([95c1cb1](https://github.com/hybridlabor-api/aos/commit/95c1cb11a8754d7453b8ceb34cfbec0077231edb))
* **gateway:** migrate memb_mcp and deja to direct harness configs on update ([bb0a5d7](https://github.com/hybridlabor-api/aos/commit/bb0a5d7cc81a4fe3923eead5d127c799a7a9c68e))
* **gateway:** opt-in async loading behind gateway.json asyncLoading, shown in status and doctor ([c4c1f64](https://github.com/hybridlabor-api/aos/commit/c4c1f648e96c52abf635750219010b25377cce7c))
* **gateway:** remove reappearing adopted duplicates, cover the HOME agy workspace file, keep per-session servers direct ([7b07e91](https://github.com/hybridlabor-api/aos/commit/7b07e917a70ad74e6112769bf9282860e8f54170))
* **gateway:** route desktop servers and more harness rows through the gateway ([12daa46](https://github.com/hybridlabor-api/aos/commit/12daa460205657bdb138ca3d5dff034cc0f9b893))
* **grilling:** decision rounds are asked as multiple choice ([73312d2](https://github.com/hybridlabor-api/aos/commit/73312d28b60a1a5a652eb7a64e4e11308cced672))
* **hub:** /api/router read and save routes over the layered router table ([23d65cb](https://github.com/hybridlabor-api/aos/commit/23d65cbf59c9be18737405bffae594f67b713182))
* **hub:** one-port reverse proxy, supervisor default install on update, status/doctor lines ([44c2140](https://github.com/hybridlabor-api/aos/commit/44c2140275ab5c87098b4f146948c401942999fd))
* **hub:** Router tab UI with role ordering, layer toggle and per-role test ([2bf0a45](https://github.com/hybridlabor-api/aos/commit/2bf0a45cd408d4f6ed2baa57fe79af0b8ce2259d))
* **hub:** start and stop the MCP gateway on Windows via its Startup wrapper ([f2c19fe](https://github.com/hybridlabor-api/aos/commit/f2c19fe876e2964b8984014951730e9d27d1a2a3))
* **hub:** X-Forwarded-Prefix contract, prefix-safe plan-canvas, endpoints.json discovery, Supervisor setting ([9658ca2](https://github.com/hybridlabor-api/aos/commit/9658ca21a713adc868417c8b785a4b3c6c689821))
* implement control roster filtering for session band display ([9c0c564](https://github.com/hybridlabor-api/aos/commit/9c0c564493910ab0b741e465cd054ef36c26a26e))
* **installer:** print one final fix line with PowerShell and bash commands when the Claude plugin step fails ([0f0e7fa](https://github.com/hybridlabor-api/aos/commit/0f0e7fa8cf648f1c9ea92d6a2766abe41d9e4a40))
* **installer:** remove retired installed files on update ([28cc90f](https://github.com/hybridlabor-api/aos/commit/28cc90f3ed1a6f15503e92643667ef99392fc2f2))
* **install:** skillSet setting (all|core) with moved-skill announcement and tests ([18fa55d](https://github.com/hybridlabor-api/aos/commit/18fa55df00cce0b88986b9d963da96ac03c9323a))
* **memory:** aos memory show prints the session start context ([c1f2391](https://github.com/hybridlabor-api/aos/commit/c1f2391d4a54801435da499e7ddbfd605fd92e64))
* **memory:** bootstrap empty memb.db, write hint, session hint for OpenCode and agy ([3e3dc4d](https://github.com/hybridlabor-api/aos/commit/3e3dc4d4f0858e682fe42c027825ecf2d2a624f2))
* **memory:** inject global domain rows only when they match the project or prompt ([a5f098f](https://github.com/hybridlabor-api/aos/commit/a5f098fc94b2df42104a4d64ece426e1f4b89814))
* **memory:** name the installed retrieval tools in the session hint ([b1ca74c](https://github.com/hybridlabor-api/aos/commit/b1ca74c5807d5dca0de0952519f81bc0881947e1))
* **memory:** optional deja hook-context digest, off by default ([1ee4859](https://github.com/hybridlabor-api/aos/commit/1ee48590973520792f1082848b8bd5acb7051a9a))
* **memory:** per-machine memory import paths and time, aos memory command ([b92392a](https://github.com/hybridlabor-api/aos/commit/b92392aea0b0102efcc31b17b33324d461780365))
* **memory:** session-end auto-save, nightly ingest job, provider-agnostic memB LLM config ([2ff31a6](https://github.com/hybridlabor-api/aos/commit/2ff31a659ccc1af3d6c306852947bce324bf4f79))
* **memory:** show a one-line memory status at session start ([37ddd5e](https://github.com/hybridlabor-api/aos/commit/37ddd5eac6ea73a6dec2f5ede15f36348cc8cd13))
* **opencode:** warn once when OpenCode 2.x is installed (installer and doctor) ([8111144](https://github.com/hybridlabor-api/aos/commit/81111449e6d79ee8ad72f7c6f93885ce4997c8bc))
* **packs:** install skills from a local library by pack selection ([d9705eb](https://github.com/hybridlabor-api/aos/commit/d9705eb23895497f51dfa90143b1d8fe55a952c1))
* **packs:** setup wizard persists its pack choices on fresh install and setup re-run ([7dc7b7a](https://github.com/hybridlabor-api/aos/commit/7dc7b7ac6f2525ad5ca8a3b6b98c9aebb07b1a80))
* **packs:** skill pack data, generated pack index in godmode heads, tests ([cdc195d](https://github.com/hybridlabor-api/aos/commit/cdc195d09c387a5c43ea8fe6a6f7a1b9b21682c0))
* **packs:** Variant A setup choices imply packs additively ([15356bc](https://github.com/hybridlabor-api/aos/commit/15356bc985b0ec396d2bd6ff769d849dee5c272b))
* **plan-canvas:** bdb-plan-builder is the default planning mode when detected ([65c655c](https://github.com/hybridlabor-api/aos/commit/65c655cb6228eeeeb4c6033d37bc6772649f5fe3))
* **plan-canvas:** open --await keeps a listener up in one call ([0fbd60e](https://github.com/hybridlabor-api/aos/commit/0fbd60ee4b1e23f1582a56b0b8d653a1379d716f))
* **plan-canvas:** trail sections may declare files:/by:, force regen keeps live marks ([7a0636b](https://github.com/hybridlabor-api/aos/commit/7a0636bac172065d9a1e13896989b9f6c4b0dd54))
* **plan:** Plan Builder is the default, no mode question ([41da7d1](https://github.com/hybridlabor-api/aos/commit/41da7d125313986014ab810d1cc6def91d84765b))
* **playbooks:** add pb-aos-e2e — AOS release E2E playbook and catalog registrations ([aac3426](https://github.com/hybridlabor-api/aos/commit/aac34260c0dbb507b19920d5b708d1b73d5f81fc))
* rename the startcycle family to fabric ([3de4c64](https://github.com/hybridlabor-api/aos/commit/3de4c64dde76249ee300934bf657a61b053ba529))
* **resources:** aos doctor --resources, pinned MCP installs, sandbox ports, test timeouts ([d801a7b](https://github.com/hybridlabor-api/aos/commit/d801a7b7e43339699a5e649d1ca182349174a711))
* **routing:** agenttrail monitors every multi-agent run and hosts GO approvals ([b27ed56](https://github.com/hybridlabor-api/aos/commit/b27ed561b53f1c06ef0186f8387b50c32279ee81))
* **skills:** Plan first section wires godmode heads and playbooks to their plan-canvas template ([bfd01fa](https://github.com/hybridlabor-api/aos/commit/bfd01fa51d470a93a65a88b6d2431a9e4593d52a))
* **stacks:** add Rust and Tauri v2 stack option ([2782bcd](https://github.com/hybridlabor-api/aos/commit/2782bcdd53b4548d0b9bc4160cf81cd2d63ff1e0))
* **startcycle:** template plans, canvas approval gate, trail env for workers ([9912cc5](https://github.com/hybridlabor-api/aos/commit/9912cc56c4c82ad36ec55c781cdbb4b10b148bac))
* **store:** aos store install/remove --pack from the local library ([96ca898](https://github.com/hybridlabor-api/aos/commit/96ca898caa35e08275c363f2a4fcd368968c40db))
* **store:** local aos source installs shipped skills from the package ([5ec2b96](https://github.com/hybridlabor-api/aos/commit/5ec2b9638cfe2fc848604f75f9f38cf920ae6d52))
* **ui:** restyle hub and store on shared tokens, make map/hub/store prefix-safe, fix map CSP ([cb9c688](https://github.com/hybridlabor-api/aos/commit/cb9c688bd47a82c6f6a6b8f7410d3e23aaddc96d))
* **ui:** shared AOS tokens and map side panel with GO cards, sessions and gate modes ([be4fea7](https://github.com/hybridlabor-api/aos/commit/be4fea742bd6c53660d2a57678c168efb62c65b2))
* **update:** what's new / optimize block after update and SessionStart one-liner ([d769350](https://github.com/hybridlabor-api/aos/commit/d76935014c9470a45a23a94ce38d1079d0c43eec))


### Bug Fixes

* **a2a,gate:** keep the hook free of process.exit, align the web cmdlet test with the plain-GO write method ([bfdb8c8](https://github.com/hybridlabor-api/aos/commit/bfdb8c891020781c206db19f2a2ec7a546018cdc))
* **a2a:** drop the last process.exit from the SessionStart hook's rejection handler ([af1fce3](https://github.com/hybridlabor-api/aos/commit/af1fce395568337babfbe0ccef0bd3ae05b03f6b))
* **a2a:** newest sidecar of a harness process retires older siblings; skip invalid --parent-pid; test reap helper ([fa4ef3b](https://github.com/hybridlabor-api/aos/commit/fa4ef3b21746c0e37e744ed4cda11e413dc4b172))
* **a2a:** no bare codex lookup on Windows; shim fallback delivers the prompt via stdin ([bff1027](https://github.com/hybridlabor-api/aos/commit/bff1027b61439e0b5d36644af142adfb2587553e))
* **a2a:** pass the multi-line codex prompt as plain argv outside Windows shims ([55b4346](https://github.com/hybridlabor-api/aos/commit/55b43464919ff1ea6cb99d1416d7744c41cf231f))
* **a2a:** phonebook labels peers from the session name, manual labels win ([c4ab71e](https://github.com/hybridlabor-api/aos/commit/c4ab71e03454c1039b908c0091c702a72b397ccd))
* **a2a:** resolve the real harness pid for the sidecar parent watch on Windows ([bbfb635](https://github.com/hybridlabor-api/aos/commit/bbfb6350c6070f02ec747ef23fd95c1d060b33eb))
* **a2a:** SessionStart hook replies at once, finishes detached, never fails and logs to ~/.aos/logs/a2a-session.log ([6cb0b64](https://github.com/hybridlabor-api/aos/commit/6cb0b64e3edd02cfe345c8f3495b6bfd5d67bd57))
* **a2a:** spawn codex through cli-spawn, unwrap npm shim so the prompt never touches cmd.exe ([b34db38](https://github.com/hybridlabor-api/aos/commit/b34db3845b6049565e3658fa21843c596ed24a5e))
* **a2a:** stop sibling sweep on shared hosts, detect reused owner pids, walk POSIX harness pid ([9a9b950](https://github.com/hybridlabor-api/aos/commit/9a9b950050ade3409bb95580a4c689b78fef1724))
* **a2a:** stop watching the owner pid for codex and agy sidecars ([c27aebc](https://github.com/hybridlabor-api/aos/commit/c27aebcfe501aec499cadfc523db09dd9196fec3))
* **a2a:** validate owner pid and add idle reaper for shared hosts ([7124388](https://github.com/hybridlabor-api/aos/commit/71243888e7515bd20d1dc0f1ee0678de70224052))
* address fabric rename review findings ([f3680b7](https://github.com/hybridlabor-api/aos/commit/f3680b7737318fb5d9a9e684ba97b7f03abb4f7f))
* **agents:** load pack agents from the shipped tree and gate them by pack selection (G3) ([1da0a2d](https://github.com/hybridlabor-api/aos/commit/1da0a2d89b463cc7a04fa7f1736a6d0531d98fb6))
* **agents:** swarm-wiring and v5-agents read pack personas from .agents/packs ([fcb32af](https://github.com/hybridlabor-api/aos/commit/fcb32af95bad4b9557aa9f15fc5a133a4c581fc5))
* **agenttrail:** ensure starts the repo map, never the hub or retires other maps ([977133f](https://github.com/hybridlabor-api/aos/commit/977133f83f8abd461c66d18df30e1590d793e2ee))
* **agenttrail:** guard M.plan in task helpers, scroll CSS for long task lists, real render tests ([e5eed9a](https://github.com/hybridlabor-api/aos/commit/e5eed9ababea20326a4ccf177d2554c5f3520761))
* **agenttrail:** host guard on every route, real-daemon CORS tests ([c526acd](https://github.com/hybridlabor-api/aos/commit/c526acdf2d577b0691470452b78f050671d2c2c3))
* **agenttrail:** import gate panel helpers in trail-hub ([ee78bca](https://github.com/hybridlabor-api/aos/commit/ee78bca659da85ed7162c245980756376c61fb79))
* **antigravity:** cover the aos-memb-save named hook in the fresh-output contract ([ff3410f](https://github.com/hybridlabor-api/aos/commit/ff3410fcfc4d661460712ffb59d2b9f9d18b9bb9))
* **aos-setup:** run the identity interview in the user's own language ([d7c662c](https://github.com/hybridlabor-api/aos/commit/d7c662cdf7e291515821c976b95164ff82a229c9))
* **audit:** detect login-blocked LaunchAgents (P0-3) and judge gate-store write targets (P1-11) ([75b0a58](https://github.com/hybridlabor-api/aos/commit/75b0a585a36840f652b83e4b5ba3b784db1c3c0f))
* **claude-desktop:** never write claude_desktop_config.json on Linux; uninstall strips AOS servers and drops the emptied file ([ddbe20f](https://github.com/hybridlabor-api/aos/commit/ddbe20f9111ed93e82c97d7508d22ff9391f10b6))
* **cli-spawn:** kill the process tree on win32 timeout so .cmd shim children do not linger ([7007a68](https://github.com/hybridlabor-api/aos/commit/7007a686558a382e7ba15b8e66e4c52ab6d5a6b9))
* **cli-spawn:** resolve claude/codex/agy from known install locations when PATH misses ([f2d3b20](https://github.com/hybridlabor-api/aos/commit/f2d3b202160245b9f384acdc98c4c5cbb9e9b9f3))
* **cli:** answer --help/-h/help before any other code in every CLI ([844a68b](https://github.com/hybridlabor-api/aos/commit/844a68b70550f80fe962b06dd2c0acb3d8c9e22c))
* **codex-plugin:** never register an npm package dir as marketplace source; drop a dangling bdb-aos entry ([9369a49](https://github.com/hybridlabor-api/aos/commit/9369a4908e7d17782669b2a0e57425a005bcab26))
* **codex-plugin:** only drop a dangling bdb-aos entry AOS registered; re-add it at once ([90c6bda](https://github.com/hybridlabor-api/aos/commit/90c6bdafe7e3147bff2fe6094f21a1307244ff22))
* **codex:** accept spaced and quoted table headers, refuse unsafe forms, remove only the recorded entry ([9a42227](https://github.com/hybridlabor-api/aos/commit/9a42227bd690bf4196f1319a189884acb2314d41))
* **codex:** add only the A2A reply dir as a sandbox writable root ([97e8d4f](https://github.com/hybridlabor-api/aos/commit/97e8d4fe5c166b1f9b251f736c9f4fcf159ad20a))
* **codex:** keep the legacy dispatch name in lib/retired-skills.js only ([ba999a3](https://github.com/hybridlabor-api/aos/commit/ba999a3dc616cbdb8c0ab57c67bcd65b53c360d9))
* **codex:** migrate the old startcycle-dispatch.mjs hook entry on update ([19245d6](https://github.com/hybridlabor-api/aos/commit/19245d65e90c7e13b5cef7ab07cce150cedd55db))
* **codex:** wire conventional-commits and env-file-protection like the other harnesses (G18) ([fef3134](https://github.com/hybridlabor-api/aos/commit/fef3134e13221e6492cc0bfd76767b6c07468b38))
* **commands:** align plan description in plugin-commands.json with generated copies ([75fd7c4](https://github.com/hybridlabor-api/aos/commit/75fd7c458b6e6e04e9645d03e56168c48e28c3da))
* **context:** one Full baseline for the savings estimate and its percentage (G20) ([99be475](https://github.com/hybridlabor-api/aos/commit/99be47573ddadd01414a660db40eb531bd2f9096))
* **context:** one full-profile baseline for savings and percentage (G20) ([cb6bf54](https://github.com/hybridlabor-api/aos/commit/cb6bf5429455a8ef92c1cbc29d07d77ee6f47538))
* **dashboard:** close missing brace in aos-dashboard and syntax-check every CLI entry ([646f6e6](https://github.com/hybridlabor-api/aos/commit/646f6e6b91246ce0f9586527140b1553a17d3dba))
* **dispatch:** double trailing backslashes and reject % in Windows CLI args ([a891ad5](https://github.com/hybridlabor-api/aos/commit/a891ad58f2ab73580da8519dc16ab6afe4e944f3))
* **dispatch:** resolve aos-store from the installed ~/.agents/bin first ([f3a5f30](https://github.com/hybridlabor-api/aos/commit/f3a5f30e87762b7504c457ef4c09847dbced63c3))
* **dispatch:** reword a comment that tripped the no-shell-true contract test ([d6c372b](https://github.com/hybridlabor-api/aos/commit/d6c372b3f8250113841cf6c64d7ed0fb8de5ed12))
* **doctor:** probe openwiki via cli-spawn, truthful :8088/:7781 wording, deja stale-store grace ([4ee228f](https://github.com/hybridlabor-api/aos/commit/4ee228ffc0878697410abeb1de6a667f9bf68335))
* **doctor:** report Roo Code skills without sentinel as unmanaged warning ([e4981b4](https://github.com/hybridlabor-api/aos/commit/e4981b43bf13387b7f3dbbb9ae321b12e3c0510c))
* **doctor:** run the rea npx probe through cli-spawn; duplicate-skills is expected (ok) while the Claude plugin is older than the kernel ([a70ea4b](https://github.com/hybridlabor-api/aos/commit/a70ea4b373f4296ee526df8230a3bf35812d1ffb))
* **embed:** inject bridge only when embedding is on; restore gatepanel import in trail-hub; relax GATE_KEYS test ([46cf6e9](https://github.com/hybridlabor-api/aos/commit/46cf6e958bf29adb0d48e25ede1f7f0f95f6ed8a))
* **embed:** make embedding opt-in, validate origins, scope bridge hello ([d5a87a6](https://github.com/hybridlabor-api/aos/commit/d5a87a6e74dc586c38701171d67c53c9cdb11b3c))
* **gate:** any non-GET call to the OpenCode server's own loopback port is guarded, including opencode run --attach ([6ba32c8](https://github.com/hybridlabor-api/aos/commit/6ba32c80ceecad4e224e94e97c38039a4e6392c7))
* **gate:** bind map click receipts to recorded requests ([9fa4a5a](https://github.com/hybridlabor-api/aos/commit/9fa4a5a77689cff099a99cb409b79dae5ac9e86d))
* **gate:** close round-4 review findings in go-gate ([2c999dc](https://github.com/hybridlabor-api/aos/commit/2c999dcaaf6d4895ae90307a5df905bbea976292))
* **gate:** git grep -O/--open-files-in-pager quoted command is code, not data ([3a04d84](https://github.com/hybridlabor-api/aos/commit/3a04d84b1bd6fb17e124f5a7717210d0ab8ed1a5))
* **gate:** PowerShell read-only check stays inside the budget and refuses command calls with variable or literal heads ([0eb6d41](https://github.com/hybridlabor-api/aos/commit/0eb6d4126a6996dd2476b6634e7e4117d2291234))
* **gate:** read-only PowerShell is free by content; iex and write-method web requests stay guarded ([ad57531](https://github.com/hybridlabor-api/aos/commit/ad575311db881bbe3d900d5e281bdbb02366b1be))
* **gateway,gate:** rotate gateway.log before the cap is already passed, treat -Form as a write in the read-only PowerShell check ([caf401a](https://github.com/hybridlabor-api/aos/commit/caf401a0cc3898db08a20865602f5fcf4c85b5ca))
* **gateway:** [] is a real selection; media tier honoured; mcp.json written before settings; remove prints harness effect ([bf944ca](https://github.com/hybridlabor-api/aos/commit/bf944cafd5729c8cec895051d3ba0f13ef68818d))
* **gateway:** a 503 without per-server details is degraded-unknown, not down ([6865490](https://github.com/hybridlabor-api/aos/commit/6865490d7b632f5ab2dd7c7ef677322dc2a325ef))
* **gateway:** adoption identity covers the whole entry; entries with extra settings stay direct ([306a1ba](https://github.com/hybridlabor-api/aos/commit/306a1ba322f7c1464ce8ec801981b153d894dbea))
* **gateway:** block gateway strip on skipped harnesses, re-add lost copy, backup symlinked mcp.json ([84731c5](https://github.com/hybridlabor-api/aos/commit/84731c56dc1f9144ba1b149f70eacd8b9c1eaf31))
* **gateway:** CLI mode target detection skips option values ([19ded2d](https://github.com/hybridlabor-api/aos/commit/19ded2dfba797357822839d3a55f16ab33742b84))
* **gateway:** confirm direct memory entries by command, keep TOML valid, clean backups ([5ce8f00](https://github.com/hybridlabor-api/aos/commit/5ce8f00e863c41cd2233cf089e4cfc0755d3741c))
* **gateway:** derive per-server status from /api/v1/servers, never ready with 0 listed servers ([c7ed4cf](https://github.com/hybridlabor-api/aos/commit/c7ed4cf9f00d01ff843d2a93a3d8c544a7034aa4))
* **gateway:** fix gatewaySizeMetrics contract and status JSON test cleanup ([12afeba](https://github.com/hybridlabor-api/aos/commit/12afeba0584bce3291f11b48e75ada5665372503))
* **gateway:** keep a stored selection of only retired names empty and report them ([5be2336](https://github.com/hybridlabor-api/aos/commit/5be2336e852a8913d0107fbebed6b43a43e877f7))
* **gateway:** keep memory direct when a harness write fails ([e70ef45](https://github.com/hybridlabor-api/aos/commit/e70ef45b15441e6f610ed74fe24161d65b55efc3))
* **gateway:** keep memory servers direct per session and out of gateway upstreams ([63fae92](https://github.com/hybridlabor-api/aos/commit/63fae92ab5113e7893fc93aaae7a95b8754721c2))
* **gateway:** let `aos-gateway status` drain instead of calling process.exit ([3533e87](https://github.com/hybridlabor-api/aos/commit/3533e879f933730013816a3287cf6ce5da63516e))
* **gateway:** lock every read-modify-write of migration.json, adopted.json and harness files ([4e706df](https://github.com/hybridlabor-api/aos/commit/4e706dfe182590a2c4cf72502397c649af5846b1))
* **gateway:** name why an upstream never connected, replace the unusable 1mcp restart hint, wait for loading servers in run ([f6ab02d](https://github.com/hybridlabor-api/aos/commit/f6ab02d62637d32a7cc68775ac3337180ea80a5d))
* **gateway:** only vendor-cited harness rows are verified; unverified paths split into legacy rows ([c15e70c](https://github.com/hybridlabor-api/aos/commit/c15e70ce946de0b4d9cc7ae326d755239d95d750))
* **gateway:** readAdopted never serves per-session servers ([fff490f](https://github.com/hybridlabor-api/aos/commit/fff490ff61dab0e2e22c5d625f702f5c14287add))
* **gateway:** redact secrets from the 1mcp log text status shows and cap it to one line ([4c2a5d1](https://github.com/hybridlabor-api/aos/commit/4c2a5d1599d2578f0df7ab1a2dd635b137ae215d))
* **gateway:** remove memory-direct entries and backups on uninstall ([4f34088](https://github.com/hybridlabor-api/aos/commit/4f340885df5e79ce00dda9416e6bc5db4df1fad3))
* **gateway:** report the running lazy-loading state, tolerate a BOM in gateway.json ([aba75b5](https://github.com/hybridlabor-api/aos/commit/aba75b55b91c10de2cc6f02b16aec3fd007cc078))
* **gateway:** resolve adopt ordering and memory direct migration scope ([5d6db8f](https://github.com/hybridlabor-api/aos/commit/5d6db8f55ef1b458d9fd8ab442973ab963313fea))
* **gateway:** run memory-direct migration on install, not only update ([0bd7fff](https://github.com/hybridlabor-api/aos/commit/0bd7fff23b5d630a9ce8f994fd4c651385bda933))
* **gateway:** run only selected servers; keep current upstreams on first migration only ([d9524cd](https://github.com/hybridlabor-api/aos/commit/d9524cd0ce266932f630a7f73e28c9d5e9660efb))
* **gateway:** select media servers only when their app is detected on a fresh install ([4e97f40](https://github.com/hybridlabor-api/aos/commit/4e97f4048776b58e20b5d6987ad383472816d341))
* **gateway:** serve codebase_memory_mcp through the gateway and doctor-check adopted servers ([0ad9a6c](https://github.com/hybridlabor-api/aos/commit/0ad9a6ca456e5f64cbf4114e1cc7616f97f6a529))
* **gateway:** serve writes its own and 1mcp's output to gateway.log on every platform, 0600, rotated ([d3f6952](https://github.com/hybridlabor-api/aos/commit/d3f6952898a6e31cb00d41b43a1a52514b1e8b01))
* **gateway:** treat 1mcp 503 with failing upstreams as degraded, not down ([be48032](https://github.com/hybridlabor-api/aos/commit/be480329e1f69a260bfa958a7895a17b7f7935d4))
* **gateway:** upstream PATH includes the global npm bin so deja and codebase-memory-mcp start ([fbe6029](https://github.com/hybridlabor-api/aos/commit/fbe60299b08e50b8335366cfe8ffc039f45ab8d8))
* **gate:** web cmdlets need a provable GET, dash variants and parameter prefixes are read, only plain locals count as read-only ([4b51346](https://github.com/hybridlabor-api/aos/commit/4b51346764ba6ae848ec769edcad5d2f6fbde81d))
* **golive:** rehash release.json for the vendored SKILL.md ([1158b05](https://github.com/hybridlabor-api/aos/commit/1158b05e4249fec2f2dccd2141eeb56039c422a4))
* **golive:** rehash release.json for the vendored SKILL.md ([f36a341](https://github.com/hybridlabor-api/aos/commit/f36a341be26ab8bdba72e0f17b8f6b06f95dcca3))
* **hooks:** bounded stdin read in fabric-dispatch and the agy a2a-inbox hook ([0e5985f](https://github.com/hybridlabor-api/aos/commit/0e5985f26708ec121f3419e9e99ef8d7c31838da))
* **hooks:** conventional-commits reads heredoc, -am and --message forms and only matches the command position (review 1) ([51ff34e](https://github.com/hybridlabor-api/aos/commit/51ff34e32905220e874067e975ebd8d154cbdf68))
* **hooks:** deny unreadable stdin again and release the stdin pipe after the read ([bbe6c4a](https://github.com/hybridlabor-api/aos/commit/bbe6c4ad1fa5d76275563bc8ed9f1fb8b6b5d6b5))
* **hooks:** read stdin with a bounded reader so an open pipe cannot hang a hook ([fa9f2e0](https://github.com/hybridlabor-api/aos/commit/fa9f2e09bb58f05d6ab5b26962544699cc799b8e))
* **hub:** cache ao binary codesign checks to prevent process pileup ([abe5641](https://github.com/hybridlabor-api/aos/commit/abe5641972e6bcfb46369bad003833761c11b927))
* **hub:** catalog marks Codex installed from ~/.agents/skills (no .codex copies since 5.4) ([8efe395](https://github.com/hybridlabor-api/aos/commit/8efe395ed5df9f555732d1a7d5ec6ce86879ac52))
* **hub:** gateway stop kills the supervisor before its 1mcp child and fails only when a match survives ([d7288c2](https://github.com/hybridlabor-api/aos/commit/d7288c283c2601c6105a0981aa32b61d4d56539f))
* **hub:** legacy ~/.codex/skills copies no longer count as installed; Codex agents still read from ~/.codex/agents ([c2ffda6](https://github.com/hybridlabor-api/aos/commit/c2ffda6d9fb4d8079d7adef449dddd56dc50a751))
* **hub:** load plan-canvas loopback-guard from the flat installed skills layout ([6b3c5ca](https://github.com/hybridlabor-api/aos/commit/6b3c5ca56ca7fe749e10861edebcaf13e43a354b))
* **hub:** probe the hub socket in services status instead of assuming up ([e4bff41](https://github.com/hybridlabor-api/aos/commit/e4bff41c3714f77360ae117cac60509e6b084c21))
* **hub:** watchdog child error listener, rotate stderr.log at 1 MB ([a27f813](https://github.com/hybridlabor-api/aos/commit/a27f8132a90d73bcfd91b267d460a2a38c3e4a32))
* **hub:** Windows stop matches the module dir plus the daemon's own interpreter and entry (review 7) ([8d3f71a](https://github.com/hybridlabor-api/aos/commit/8d3f71ac2e67ce3d71beda9c0bc365dfdac634db))
* **hub:** Windows watchdog logs to a file instead of invalid inherited handles, longer start wait, update no longer reports all ok when a running hub is gone afterwards ([12b4349](https://github.com/hybridlabor-api/aos/commit/12b4349bccca3789bb727f4968be47da296047ea))
* **installer:** back up foreign agent files before overwrite, record only owned global ones (F3) ([a4dd8f8](https://github.com/hybridlabor-api/aos/commit/a4dd8f882db4e7a205398a19f570449785be65f1))
* **installer:** cancel aborts the wizard; null-on-cancel only in the interactive menu ([92d1286](https://github.com/hybridlabor-api/aos/commit/92d1286ae55a6fb1e54460a9114b4df275380919))
* **installer:** launcher only pins npm dist-tags that are published ([e8c0354](https://github.com/hybridlabor-api/aos/commit/e8c0354ffba59556bf5795b3bfb3ac3e332f0b28))
* **installer:** launchers for every AOS bin and stale global npm install detection ([d35c2c0](https://github.com/hybridlabor-api/aos/commit/d35c2c024d2d3bd7a2d39c7ff3d2bd27b9d6f344))
* **installer:** leave a user-installed deja alone (probe npm root -g), record only AOS installs ([6c8ee73](https://github.com/hybridlabor-api/aos/commit/6c8ee73f30bc9828bb2ab9e92b3573ad19eeb2ed))
* **installer:** look for modules in ~/.agents when AOS runs from a global npm install ([7e5c501](https://github.com/hybridlabor-api/aos/commit/7e5c501f1271d735ec2db218b10b4e234437f8d8))
* **installer:** managed-block upsert for ~/.gemini/RULES.md and GEMINI.md ([0abafa1](https://github.com/hybridlabor-api/aos/commit/0abafa1ffc2ed7cbf0346a794bebacab090d160c))
* **installer:** pass the re-enable prompt as an option so non-interactive installs no longer crash in gateReenableStep ([f60855b](https://github.com/hybridlabor-api/aos/commit/f60855b966a39e85752c99ea9ba14b26caeaf53c))
* **installer:** qualify harnessMcpFiles so gateway selection is saved ([3ab210d](https://github.com/hybridlabor-api/aos/commit/3ab210d3e6caa1466401f461ae3d1abb1b4783c0))
* **installer:** record deja for uninstall only when AOS installed it (F2) ([801a366](https://github.com/hybridlabor-api/aos/commit/801a366eddd5a76c07438c132f291effd84a20ba))
* **installer:** set a failed venv aside instead of deleting it ([0dc35ee](https://github.com/hybridlabor-api/aos/commit/0dc35eea1620e0ab3f2364df0307eee777543c17))
* **installer:** single hook source via config/claude-hooks.json ([30da162](https://github.com/hybridlabor-api/aos/commit/30da162393ff7383b80a4ceb8219b5211a45c391))
* **installer:** skip the final plugin fix line when the CLI step was skipped by design ([c136853](https://github.com/hybridlabor-api/aos/commit/c136853865e8d0a7cf36a983455710c2f10d85c6))
* **installer:** surface venv errors and clean up half-built .venv ([86cebea](https://github.com/hybridlabor-api/aos/commit/86cebea4f5be960e0528c31a22c68fbcc254675d))
* **installer:** write Codex agents through writeCompiledAgent (backup before overwrite, record only owned) ([247d0cf](https://github.com/hybridlabor-api/aos/commit/247d0cfd5063fb5b66b3b766cb5e3eff659e3555))
* **launchers:** ship the aos-go-ref command documented in docs/a2a.md (G15) ([fe9f640](https://github.com/hybridlabor-api/aos/commit/fe9f640fd7af7bd2a85ae640f564a00d04173fb1))
* **mcp-env:** load the help guard optionally so the launcher starts servers when only its lib files are installed ([c91c0f1](https://github.com/hybridlabor-api/aos/commit/c91c0f19969b60fd6f201ca99afa0007907257b3))
* **memdirect:** say absent, not kept, when no gateway mcp.json exists ([a20f6d4](https://github.com/hybridlabor-api/aos/commit/a20f6d423ddbc3317ed009aa9e1bd4bffb69498d))
* **memory:** detect memB by its module install, not memb.db ([792e467](https://github.com/hybridlabor-api/aos/commit/792e4676f36a3b0712cf8faf4665840635750a0e))
* **memory:** harden memb-inject (no shell injection, no DB creation, FTS filter order, user scope, sqlite guard, shared deja budget, project id rules) ([620220c](https://github.com/hybridlabor-api/aos/commit/620220cd8ac33da61f68fa899b65b7776a5065c9))
* **menu:** keep Settings open after each change; cancel returns instead of exiting ([f295e70](https://github.com/hybridlabor-api/aos/commit/f295e70fce50a66a6d78fbc4849aedc4c501f57b))
* **menu:** remember failing setting codes, null multi-cancel writes nothing, main menu defaults to Settings after returning ([549ae2c](https://github.com/hybridlabor-api/aos/commit/549ae2cefb12ea7e7a71e855a8c91cfe5b74f071))
* **mods:** skip stale fleet files by mtime before reading them ([9414afe](https://github.com/hybridlabor-api/aos/commit/9414afe11928055ca84652222c90c3eb9311ac44))
* **npm-global-aos:** restore numeric-only older-than comparison ([fd7c5f8](https://github.com/hybridlabor-api/aos/commit/fd7c5f8e9fa1fa3fbab5eead922b80c3a3c0840b))
* **opencode:** dedupe bdb-aos.js entries in plugin[] by normalized path ([804072a](https://github.com/hybridlabor-api/aos/commit/804072a325870ff2c1f46e44ef4af062be959e1f))
* **opencode:** drop stale AOS bdb-aos.js entries from legacy OpenCode configs ([1ce48b6](https://github.com/hybridlabor-api/aos/commit/1ce48b6f15ff948f9b687f86e1f526411d365f51))
* **opencode:** load bdb-aos.js by auto-load only, drop our plugin[] entry ([8a45b6d](https://github.com/hybridlabor-api/aos/commit/8a45b6d648aeb448bf9c2f0e5bdbbf7965a10482))
* **opencode:** never launch opencode for the version check in dry runs or without a config dir ([5eb7ee4](https://github.com/hybridlabor-api/aos/commit/5eb7ee4a28543e8d1213cf42a0d4ce797ed57448))
* **package:** ship config/ so router table and allow presets exist when installed (G1) ([5bade53](https://github.com/hybridlabor-api/aos/commit/5bade5399676955b7a4afe7db056d1e990967c4a))
* **packs:** implied packs come from .bdb-manifest.json, not the file-hash manifest ([f32c535](https://github.com/hybridlabor-api/aos/commit/f32c5358a3ad48be6d5bebdd4997fdafa69a6d6a))
* **packs:** pack deselection keeps only the exact copies the store wrote ([0c86b86](https://github.com/hybridlabor-api/aos/commit/0c86b862de478c0cb9df661ec7cae3edaf07fc2d))
* **plan-canvas:** default to Plan Builder only for plan.mdx or a plan folder, standard for other files ([0d285d3](https://github.com/hybridlabor-api/aos/commit/0d285d3f362a49a836e1691ee4b6720eaa7e1de4))
* **plan-canvas:** never stop or restart a canvas server of another workspace ([644b29a](https://github.com/hybridlabor-api/aos/commit/644b29a9fa9bf46dec2091c9e3290a72125b8e19))
* **plan-canvas:** open defaults to the default mode, headless-safe browser launch, regenerate stale builder trail plan ([460024c](https://github.com/hybridlabor-api/aos/commit/460024ccd1b0199d587a2f9d07e372fa92652f67))
* **playbooks:** pb-aos-e2e description budget and backtacked repo paths ([16957f6](https://github.com/hybridlabor-api/aos/commit/16957f6f6539013c513113cfbfd6b37251c579d3))
* **plugin-migration:** accurate CLI-not-found message, lock-held ends in fix line, Windows local-install candidate ([b30bc6a](https://github.com/hybridlabor-api/aos/commit/b30bc6a4302afbf5dfe07deb9c0a2482a713eb41))
* **plugin-migration:** register the plugin per detected harness even with no loose roots ([e76eba8](https://github.com/hybridlabor-api/aos/commit/e76eba87f8aff831ebcb2bb9b5129d5a7bf0aa79))
* **plugin:** agy-commands copy is always checked and a stale directory is removed ([79ff3a9](https://github.com/hybridlabor-api/aos/commit/79ff3a9306dd15367bdbf7a822a5776fc38ef4b3))
* **plugin:** regenerate slim plugin manifests without the skills array ([a63d757](https://github.com/hybridlabor-api/aos/commit/a63d75722e1cbd323c97077855c980b9fdb47e65))
* **plugin:** report command and agent drift before the plugin copy check ([e7f7937](https://github.com/hybridlabor-api/aos/commit/e7f79374ca3c0288e34ba208ee65e5c640d0d58e))
* **plugin:** ship real copies instead of git symlinks under plugins/bdb-aos ([c9afbfa](https://github.com/hybridlabor-api/aos/commit/c9afbfa6e1f1659fe45b590216c363881ea37552))
* redact gateway and a2a logs, rotate a2a logs, remove hub.json after teardown ([d24a6f9](https://github.com/hybridlabor-api/aos/commit/d24a6f91f2934b758b08b069371a4e67722e4a99))
* **repair:** aos repair re-merges harness wiring and verifies it (G16) ([9cd1ca4](https://github.com/hybridlabor-api/aos/commit/9cd1ca4eb42e348d7baaf925a990d0c43f258d48))
* **repair:** wiring check covers only what the harness step writes; surface harness failures in runQuickUpdate (review 9) ([1480de0](https://github.com/hybridlabor-api/aos/commit/1480de08403b2133bf7e0256a2a709183b695256))
* **resources:** event-driven agenttrail map, idle auto-exit for on-demand servers, calmer trail-hub ([bc9caa2](https://github.com/hybridlabor-api/aos/commit/bc9caa2a2aae3d238a6d71ad95c25837435599d5))
* **rules:** refresh routing block in cursor global rules ([ce56f34](https://github.com/hybridlabor-api/aos/commit/ce56f34e71cf8bfcb8c8de92c0b9d6a7ce27dba5))
* **services:** Plan Canvas autostart runs on every install path and on update once registered (G7) ([20dc8b4](https://github.com/hybridlabor-api/aos/commit/20dc8b4eb67e7eea49283768dc5749566547f574))
* **settings:** never overwrite unparseable v5-settings.json; atomic write; keep gateway.servers when menu saves adopt state ([2f555c3](https://github.com/hybridlabor-api/aos/commit/2f555c37a1cb519e854609fe99169163978be047))
* **skills:** back up the whole skill before unlinking any file of it ([7485f81](https://github.com/hybridlabor-api/aos/commit/7485f8100576fa256cfbf8f1a3b536976fdaf544))
* **skills:** firecrawl-sdk description within the 160-char contract ([dea4c06](https://github.com/hybridlabor-api/aos/commit/dea4c06ad31fcc9a8aab088f88e48422310fa11f))
* **skills:** fold four descriptions the merge batches left unparseable ([3bda216](https://github.com/hybridlabor-api/aos/commit/3bda216be22058cc472c2ab6e78bdb4550482291))
* **skills:** leave a user-owned ~/.roo/skills/legacy alone unless the manifest lists it (review 2) ([a536c7d](https://github.com/hybridlabor-api/aos/commit/a536c7d8c6664a54d6008de2620036b657b732ac))
* **skills:** migrate the legacy ~/.roo/bdb-skills copy out on update, backing up edited files (review 3) ([d91324c](https://github.com/hybridlabor-api/aos/commit/d91324c00adf4249778c3689b1df57d0722c3fbe))
* **skills:** one OpenCode skills source, retire AOS-owned copies in ~/.config/opencode/skills with backup ([#187](https://github.com/hybridlabor-api/aos/issues/187)) ([43bd3d0](https://github.com/hybridlabor-api/aos/commit/43bd3d0930750ee537152721d97aed012f72bb0d))
* **skills:** one skill dir per harness for fresh install and update (G5) ([388248e](https://github.com/hybridlabor-api/aos/commit/388248e82ac5a5b059bf16f37a1d67165113d344))
* **skills:** prune the OpenCode skills dir like every other copy target (G4) ([f2e2c83](https://github.com/hybridlabor-api/aos/commit/f2e2c8354b1f8b8bc6e37ad8ece869c8fb87fde9))
* **skills:** quote shortened descriptions that contain a colon ([e9429b9](https://github.com/hybridlabor-api/aos/commit/e9429b9c7ac047942b14381ec011fa934b397da6))
* **skills:** restore description trigger words lost in the shortening merge ([36087e7](https://github.com/hybridlabor-api/aos/commit/36087e7f69888717fb214661f87962a11a846e4f))
* **skills:** trail step only for plan templates that have components ([553e9b9](https://github.com/hybridlabor-api/aos/commit/553e9b9faf78cef4904e689af5b815e1b7874d00))
* **startcycle:** human plan gate keeps comment texts, escalates on timeout/ended/no CLI, reopens Architect loop, Windows-safe CLI spawns ([acd711e](https://github.com/hybridlabor-api/aos/commit/acd711e78413ab562ae508b69df2cd8cfd94da89))
* **status:** label the memb service as the optional memB WebUI ([0372c2e](https://github.com/hybridlabor-api/aos/commit/0372c2ed07d32b4f5fe4f0b2affc88e3c81b15ad))
* **store:** commit pack engine and tests missing from the --pack commit ([63ef521](https://github.com/hybridlabor-api/aos/commit/63ef5212e78d85456303eb65525c68d9ac5cf88a))
* **store:** import claudeConfigDir; pack removal uses per-root backups, logged targets and shared roots ([8a452ab](https://github.com/hybridlabor-api/aos/commit/8a452ab3a86e7773f86f1595712292fcfda62e2c))
* **store:** name offline-missing pack skills, await pack install, fix pack tests ([0616709](https://github.com/hybridlabor-api/aos/commit/0616709a64980cd4dc6d4096fa511e05bb37ce7c))
* **store:** single-skill install logs the local origin (package or library) ([49f2ca6](https://github.com/hybridlabor-api/aos/commit/49f2ca62f6e4470a268eab041c48c58aa1988124))
* **tests:** align rust-stack-pack test with detectProjectStack and parseModuleSelection APIs ([d33bfbb](https://github.com/hybridlabor-api/aos/commit/d33bfbb5b0be80ca5fb156c17b78db2e3f053c41))
* **token-saver:** put the folder above src/ on PYTHONPATH when verify runs cli.py directly ([3ec7d30](https://github.com/hybridlabor-api/aos/commit/3ec7d30e5679e9227e6487572a1ba8d860adf53a))
* **token-saver:** run the verify CLI with PYTHONIOENCODING=utf-8 ([f427bbb](https://github.com/hybridlabor-api/aos/commit/f427bbbb53aaf7362174d3e032fa34cc39281482))
* **uninstall-records:** recordingCli forwards step options so the clone timeout survives ([5a6e44d](https://github.com/hybridlabor-api/aos/commit/5a6e44db7baa06d85a214f7dc51c65eeafaa3679))
* **uninstall:** archive harness marker backups instead of deleting ([4e4586a](https://github.com/hybridlabor-api/aos/commit/4e4586a1ca28368deb1610f1a1fc12f144d18319))
* **uninstall:** decide recorded agent files by hash only, marker sweep covers unrecorded ones (F1) ([2dc3e88](https://github.com/hybridlabor-api/aos/commit/2dc3e887fe8b7837752645d777023f84ef539a3e))
* **uninstall:** drop an opencode config that held only the AOS plugin entry ([28ed67a](https://github.com/hybridlabor-api/aos/commit/28ed67a2516e093025997336d099ee8ab9e2eaa8))
* **uninstall:** drop only AOS Codex hook handlers by exact script name, back up config.toml first ([25d3ee6](https://github.com/hybridlabor-api/aos/commit/25d3ee6fba3b1bb6458a776aebb40d0acd98632f))
* **uninstall:** drop the empty presets.json 1mcp writes on start ([37403c4](https://github.com/hybridlabor-api/aos/commit/37403c4b0d5bde61fbb62ddf29c57f1248efb2a6))
* **uninstall:** drop the mod marketplace entry and the skill library leftovers (G19, G23) ([b718f93](https://github.com/hybridlabor-api/aos/commit/b718f93c7f74e62a25f8c0b195f163ed08e915ee))
* **uninstall:** filter Claude hooks per handler and drop a matcher group only when empty ([ebdb984](https://github.com/hybridlabor-api/aos/commit/ebdb984387a735773e4687f682a8f4fd415f9ad4))
* **uninstall:** keep an edited file whose backup failed; remove deja MCP only in AOS's own form, with backup ([21990a1](https://github.com/hybridlabor-api/aos/commit/21990a1bcdd9876da214317cfd60b329ef7ceac8))
* **uninstall:** keep an opencode config that still carries user comments ([26fd8ed](https://github.com/hybridlabor-api/aos/commit/26fd8eda5177a0d8362802cf9f1aadf9717160ee))
* **uninstall:** keep oldest and newest gateway backup, archive the rest under ~/.aos/backups ([3a2c1af](https://github.com/hybridlabor-api/aos/commit/3a2c1affc166ca43876a4440304c8a6728acdbf8))
* **uninstall:** keep one stamp backup per file per run ([683f2f3](https://github.com/hybridlabor-api/aos/commit/683f2f35d3c6020284590f04ee3db9b688c78b38))
* **uninstall:** keep records whose reversal failed so a rerun can finish (F6) ([a9006ef](https://github.com/hybridlabor-api/aos/commit/a9006ef5684d2af71701c5198484d5fc91ec021c))
* **uninstall:** keep the marketplace record when the listing failed (F5) ([2d0d160](https://github.com/hybridlabor-api/aos/commit/2d0d16095f1475c872c477ce70948d787035ed9e))
* **uninstall:** keep unrecorded marker-only Codex agents instead of deleting them ([6cc9152](https://github.com/hybridlabor-api/aos/commit/6cc91529f59e7b1afc9b3b9a12dba9ba09441020))
* **uninstall:** list and gate MCP build-tree removal on AOS ownership, back up CLAUDE.md before stripping ([dc7d008](https://github.com/hybridlabor-api/aos/commit/dc7d008dafa6a4c2276441f0c84f175c5de7f338))
* **uninstall:** match hook commands by exact script name and back up settings.json first (F8) ([9ad3a57](https://github.com/hybridlabor-api/aos/commit/9ad3a5747139674ab442c36d43b421adee7f8eac))
* **uninstall:** one failing reversal no longer aborts the rest; failures are listed and kept for a rerun (F10) ([0b18d39](https://github.com/hybridlabor-api/aos/commit/0b18d39f1ba454d3c696add87e431ca9ab516d0f))
* **uninstall:** one stamp backup per harness file per run ([0b104c5](https://github.com/hybridlabor-api/aos/commit/0b104c5a2aa300e3a6cae4e0106a5f23edfdff0f))
* **uninstall:** prune intermediate gateway backups and clear gateway runtime files ([d78769c](https://github.com/hybridlabor-api/aos/commit/d78769c05153b9f7869f78fa0e6c415a69cbf4ec))
* **uninstall:** record and remove compiled agents and the user router config (G8, G9) ([6adeb59](https://github.com/hybridlabor-api/aos/commit/6adeb599c41805278352349992f71cd30c061ba7))
* **uninstall:** record files built after the MCP copy in .aos-copy.json so generated outputs leave with it ([4e74e6d](https://github.com/hybridlabor-api/aos/commit/4e74e6d4ca40dcf057f9131388dd5262f6c38fcd))
* **uninstall:** remove an opencode.jsonc left with only $schema after the MCP launcher entries go ([01c51d1](https://github.com/hybridlabor-api/aos/commit/01c51d131a0fe2cca44d4618802e8422af816c56))
* **uninstall:** remove AOS-copied MCP server folders whole ([880a7de](https://github.com/hybridlabor-api/aos/commit/880a7defeee8705c1935b1bfddb3d5d8d080a862))
* **uninstall:** remove AOS-created OpenCode config and backups ([f29e7d8](https://github.com/hybridlabor-api/aos/commit/f29e7d870c4d5369207086ed037108a477af3a6b))
* **uninstall:** remove build trees AOS created inside copied MCP servers ([ac9d748](https://github.com/hybridlabor-api/aos/commit/ac9d748eeef736e2e42abd35804d70752b41b1f7))
* **uninstall:** remove hub and gateway services without their bin; delete the generated gateway dir ([617a385](https://github.com/hybridlabor-api/aos/commit/617a3851b44f8750dfe7fb40c27a00affad9a259))
* **uninstall:** remove launchpad files only when they equal what the old generator wrote ([10e5f11](https://github.com/hybridlabor-api/aos/commit/10e5f11557b16e6056e2f45ccb46a0f6d382115b))
* **uninstall:** remove launchpad leftovers only when their content carries our marker (F4) ([26d77e8](https://github.com/hybridlabor-api/aos/commit/26d77e8ff3bc96f685060c5f2a0d9fbc43189360))
* **uninstall:** remove MCP copies only through a recorded per-folder install record ([dbb7abc](https://github.com/hybridlabor-api/aos/commit/dbb7abced124b9dfbb0703e97a5c7ccd32448098))
* **uninstall:** remove nested __pycache__ trees inside a recorded MCP copy ([b66ef03](https://github.com/hybridlabor-api/aos/commit/b66ef031e4af56afcb8e709e933405af22bc2c6a))
* **uninstall:** remove the ~/CLAUDE.md pointer the installer wrote ([ff07e66](https://github.com/hybridlabor-api/aos/commit/ff07e6602e4cff438b10d3b5c685d071d55465aa))
* **uninstall:** remove the AOS skills.paths from opencode.jsonc and drop the then-empty file ([be1e98f](https://github.com/hybridlabor-api/aos/commit/be1e98f5f49ac52ff6f6faf560ee67f8710f9873))
* **uninstall:** remove the Claude marketplace only when it is ours and no other plugin uses it (F5) ([44a78c7](https://github.com/hybridlabor-api/aos/commit/44a78c779a7ca9ee89976257fd7435972c1509d7))
* **uninstall:** report service removal failures, keep gateway detectable on rerun, match the exact script path ([891fd30](https://github.com/hybridlabor-api/aos/commit/891fd3055e78e5da2987d9ddbd155d97afca14cc))
* **uninstall:** retire records only when nothing is pending anywhere; explicit failure collector, no Done on failure ([863914c](https://github.com/hybridlabor-api/aos/commit/863914c061cdfbefc57048eb61b04c8ef8e37be4))
* **uninstall:** reverse nightly ingest, OpenWiki daemon, AO service, Token Saver and recorded npm globals (G10, G12, G13, G14) ([171344d](https://github.com/hybridlabor-api/aos/commit/171344d2144449778a7cba60c1daacd1c3e78581))
* **uninstall:** shared removeIfOnlySchema so an emptied opencode.jsonc goes whichever reversal runs last ([6145f30](https://github.com/hybridlabor-api/aos/commit/6145f304ff6b25475d840524d03e0db3a1f696c4))
* **uninstall:** strip gateway presets of the aos AND NOT shape even when the record lacks them ([6a96b64](https://github.com/hybridlabor-api/aos/commit/6a96b647ae93a5b5c3a72cf7aed8643fbed75862))
* **uninstall:** strip only AOS-made presets from the 1mcp presets.json ([33b7cb8](https://github.com/hybridlabor-api/aos/commit/33b7cb8184ac46fc6c7cff46bfbab72924b443bb))
* **uninstall:** strip the aos-memb-save named hook from agy hooks.json ([71c5ee4](https://github.com/hybridlabor-api/aos/commit/71c5ee4ec0eb7fd6ece8b37afa72a064893b9cb4))
* **uninstall:** Token Saver data always stays, purge semantics unchanged (F7) ([b121351](https://github.com/hybridlabor-api/aos/commit/b12135131a851432871f50144c9adecc904d39e0))
* **uninstall:** wire present() for hub and gateway so a service left without its bin is still removed; clear hub runtime state ([0581696](https://github.com/hybridlabor-api/aos/commit/05816960f28f6bd56109444b8db474b826cb1179))
* **update-check:** restore npm view fallback when fetch fails ([62c860a](https://github.com/hybridlabor-api/aos/commit/62c860a0970e54003dfd5e6ad205882c4a61330f))
* **update:** a package older than the install changes nothing and records no version ([7292c69](https://github.com/hybridlabor-api/aos/commit/7292c6974e354edc5210e9930a10a4ff7bd0cb91))
* **update:** compare against the real version order, not the host stub ([f0183ed](https://github.com/hybridlabor-api/aos/commit/f0183ed36a0f9fae158b21c9dcb4c5f0671036bd))
* **update:** do not register a dist-based MCP whose entry script is missing ([d6d17bf](https://github.com/hybridlabor-api/aos/commit/d6d17bf5c9d7be9d62e7bd49edc854de928cdfda))
* **update:** keep the stored tier on aos update and -y reinstall (G2) ([66091f1](https://github.com/hybridlabor-api/aos/commit/66091f1099cdf1e102b70d92241e90bbf8e271df))
* **update:** lost harness wiring counts as drift and plans the Harnesses step (G16) ([b37e240](https://github.com/hybridlabor-api/aos/commit/b37e240d92c502d603a5748ae7cdd3131c336157))
* **update:** MCP refresh keeps unregenerated Codex tables, skips commented JSONC and empty files, no OpenCode plugin side effect (review 4-6) ([ed47196](https://github.com/hybridlabor-api/aos/commit/ed47196ac204e6844837e2b6fedf5457744b41f3))
* **update:** migrate legacy agy MCP template on every update and fix doctor hint ([dbd3889](https://github.com/hybridlabor-api/aos/commit/dbd3889138e915cf980aac37ae785405d758f215))
* **update:** name npm's failure reason on the console line, retry the pinned MCP install once, keep polling a BUSY gateway ([c89346b](https://github.com/hybridlabor-api/aos/commit/c89346b85ef8f9ee330cc5d29ed1b346832f60ea))
* **update:** never overwrite an existing .bak, keep a .new that differs from the shipped file ([dc04d7d](https://github.com/hybridlabor-api/aos/commit/dc04d7d072582132d65287523e7b9c81b37d9c3e))
* **update:** print the Login Items hint for not-loaded com.bdb.* LaunchAgents ([85b15ab](https://github.com/hybridlabor-api/aos/commit/85b15ab0e2d6e454d4ad53183225812dc0ba976a))
* **update:** query the legacy schtasks entry before /End and /Delete ([40ae2bc](https://github.com/hybridlabor-api/aos/commit/40ae2bc1239ff8b654d76529200581f18e4aa6a7))
* **update:** re-sync shipped MCP definitions in harness configs on update (G6) ([49c86dc](https://github.com/hybridlabor-api/aos/commit/49c86dc4e538ded1626785dc8c8cd2398c1bd40b))
* **update:** recognise workflow scripts and replace untagged pre-release runtime scripts instead of keeping them as .new ([75fe8f5](https://github.com/hybridlabor-api/aos/commit/75fe8f5a58e836439d83430ba287e4f9e7991e95))
* **update:** restart memB and Synapse on Windows after an update (G17) ([ebf7c05](https://github.com/hybridlabor-api/aos/commit/ebf7c0575ddaa1ee1bc95184c29293a2b525cf84))
* **v5:** list memb-session-save as a context hook in the profile contract ([5cb6d8f](https://github.com/hybridlabor-api/aos/commit/5cb6d8f24b84e9ee72ca1988d4d76ba1b763e0a2))
* **v5:** match install-option tests to the ids and helpers the merges added ([d248334](https://github.com/hybridlabor-api/aos/commit/d2483341d0994d65608f4023ba3b715cb788b012))
* **win:** anchor the hub gateway stop to this install, system tools by absolute path, escape typographic quotes ([15be65f](https://github.com/hybridlabor-api/aos/commit/15be65fbfaa691557e25ba034fff2439c861ff5f))
* **windows:** keep reg.exe stderr out of the terminal when probing Codenotch ([65763ff](https://github.com/hybridlabor-api/aos/commit/65763ff7d4d8759140961c132005ea51c7faf7e6))
* **windows:** refuse % in cmd.exe shim arguments, accept lstat-only executables only under WindowsApps ([69b0bf9](https://github.com/hybridlabor-api/aos/commit/69b0bf9c1371b89a06b8b0f95a0d4349314fcdec))
* **windows:** resolve Store python app-execution aliases so Token Saver verify can run cli.py ([c344ca6](https://github.com/hybridlabor-api/aos/commit/c344ca65d1f09028d554492c031a55042d7858b3))
* **windows:** stop spawning with shell:true plus args (DEP0190); route npm through cli-spawn ([26e00da](https://github.com/hybridlabor-api/aos/commit/26e00dac78fd5a46816caa71a047f6ce98a140a1))
* **workflows:** ship-start gate test reads the derived label, not a stale literal ([8bb3925](https://github.com/hybridlabor-api/aos/commit/8bb39254278c1546ed051570e89d7538436bb994))


### Performance Improvements

* **agenttrail:** skip work with no viewer, memoize repo id, prune ended sessions ([331469f](https://github.com/hybridlabor-api/aos/commit/331469f724eb408a7c260be507f77dd7f031d86a))


### Reverts

* **agenttrail:** keep endpoints-lite self-contained, no runtime import from plan-canvas ([0784512](https://github.com/hybridlabor-api/aos/commit/0784512644c161d8d39a78e0f4c9284460fc141a))

## [5.3.0](https://github.com/hybridlabor-api/aos/compare/v5.2.1...v5.3.0) (2026-10-14)


### Features

* **router:** add advisory route logging hook to startcycle dispatcher ([b7421df](https://github.com/hybridlabor-api/aos/commit/b7421dfa6f1b9ba85805c5dd0951648aad013fbe))
* **router:** add central routing table and pure route resolution ([b183b30](https://github.com/hybridlabor-api/aos/commit/b183b309c62915d25e5c35685ceeabcf1b48ec05))
* **router:** add test suite for table validation, route resolution, and dispatcher advisory ([fdf93dd](https://github.com/hybridlabor-api/aos/commit/fdf93ddf902521a209e2fa8a24fd46a5c659ecc8))
* **router:** merge feat/router-r1 (table, route resolution, dispatcher advisory) ([b5605c1](https://github.com/hybridlabor-api/aos/commit/b5605c1a8b8b4452cab077a4ec635e70b84da26b))
* **settings:** add gateway sub-menu for status, adoption, and direct restore ([e8963a0](https://github.com/hybridlabor-api/aos/commit/e8963a00ea0cbb14231d093744878a22f789b8a5))
* **update:** diff-based plan phase and gating for kernel and packages ([359a005](https://github.com/hybridlabor-api/aos/commit/359a005fb642dfef0b6bcd579d2d733f0486e718))
* **update:** hash based drift detection and persisted last-run-failed flag ([cba4d38](https://github.com/hybridlabor-api/aos/commit/cba4d381167482c4e4f353cb86bdaac09a48c5a5))
* **update:** support force flag to re-apply all components ([f81ed47](https://github.com/hybridlabor-api/aos/commit/f81ed47f49a17f53d85fb7c51a7eb4e03f3c57b2))


### Bug Fixes

* **gateway:** answering none to the adoption prompt no longer switches the gateway to direct mode ([6092eb3](https://github.com/hybridlabor-api/aos/commit/6092eb3ba2c5527eade7041a757ec3635b45ea9b))
* **gateway:** implement real service restart and honor direct mode in update ([7a7cf51](https://github.com/hybridlabor-api/aos/commit/7a7cf517c10c4f84b2e63be7b982a63ad39049bc))
* **gateway:** remember the MCP adoption choice in v5 settings ([3fc846e](https://github.com/hybridlabor-api/aos/commit/3fc846eaa6c315f99e0cc3a7e592665d0a7c7164))
* **gateway:** skip reinstall and restart when the gateway is unchanged ([9763d1c](https://github.com/hybridlabor-api/aos/commit/9763d1cc85bf4f2f87e42b4684384cbaf05a119d))
* installer idempotent updates, gateway settings, Windows module locks, router R1 ([fa63340](https://github.com/hybridlabor-api/aos/commit/fa63340cb7900d362d5d0d645e0c8ef4c5223297))
* **installer:** a CRLF copy of a shipped text file is ours, not a user edit ([ca1cb0e](https://github.com/hybridlabor-api/aos/commit/ca1cb0e5f8325f94e23c23768085735f7902b54b))
* **installer:** a file identical to the payload is never kept as a user edit ([b4d8feb](https://github.com/hybridlabor-api/aos/commit/b4d8feb5e3b594c6f3b4737ab30d519e2ce0a99f))
* **installer:** keep the darwin launchpad open call unconditional; suppression already happens earlier ([d1d6245](https://github.com/hybridlabor-api/aos/commit/d1d62457e251ee3630932548bb21f591a82e15b1))
* **installer:** reorder guard files so hook list check passes ([2585705](https://github.com/hybridlabor-api/aos/commit/258570539e62a745af654c55bec7a9cc87cace7c))
* **menu:** retry failed steps in repair and print current only on empty plan ([48be7d2](https://github.com/hybridlabor-api/aos/commit/48be7d243dadab23bd622a74889d904f058496d5))
* no browser tabs on update, aos repair retries failed steps, Token Saver Store-Python detection ([b192618](https://github.com/hybridlabor-api/aos/commit/b192618498fd743e72cade15575abf5ede97f47b))
* **packages:** resolve Store-Python redirected path for token-saver on win32 ([738759e](https://github.com/hybridlabor-api/aos/commit/738759e5d988de2a4d614fc4519e89b5b99c0fe3))
* **pins:** single source for the deja and 1mcp pins ([0568986](https://github.com/hybridlabor-api/aos/commit/056898652df9bd5fdeafea84240c9061d0723be8))
* **profile:** persist and sanitize lastFailedSteps setting ([6315604](https://github.com/hybridlabor-api/aos/commit/631560487b92b8ad867ea40062440b662d2220b1))
* record files written by a stale update, replace stale gate files, stop pinned deja counting as outdated ([fa09045](https://github.com/hybridlabor-api/aos/commit/fa090456162fe5f0f4097801188992e333040c38))
* **router:** use dynamic import for workflow runner and fix pipeline fixture ([99f4c86](https://github.com/hybridlabor-api/aos/commit/99f4c8631e42da2b734eacb235ee7beafa43cac1))
* **router:** write the advisory log to stderr so it cannot corrupt dispatcher stdout ([a3d58f1](https://github.com/hybridlabor-api/aos/commit/a3d58f1a9635ae551312a7341d066a45999e622a))
* **update:** drift detection only counts files the installed kernel wrote, inside HOME ([d46f515](https://github.com/hybridlabor-api/aos/commit/d46f515f0e16033c7f7396b6950625893141ac50))
* **update:** plan broken packages on verify failure and print status for skipped components ([9860dfe](https://github.com/hybridlabor-api/aos/commit/9860dfe5e2b97cba21b7ba4f0a52095d454ddd87))
* **update:** re-apply alwaysUpdate packages after kernel or harness change ([baaf9e3](https://github.com/hybridlabor-api/aos/commit/baaf9e3e50f74da918a3e0af3e35720106584710))
* **update:** restart only services whose package changed in this run ([6c23df8](https://github.com/hybridlabor-api/aos/commit/6c23df82799a93965f09b97e78ae9c28cee41830))
* **update:** restart services without a package id after a kernel update ([98ad8d4](https://github.com/hybridlabor-api/aos/commit/98ad8d4a7eeccfb8edb7866bdaafcbc03deb1bdf))
* **update:** suppress browser opening during update and repair operations ([7afb4c8](https://github.com/hybridlabor-api/aos/commit/7afb4c88635677bd7696ec274d3cab6ecc69de32))
* **windows:** also stop orphaned workers that map files from a locked service directory ([a11541e](https://github.com/hybridlabor-api/aos/commit/a11541e2be3a7f4ffd774939add9104c8ab8fca7))
* **windows:** stop a service module's own processes before swapping its locked directory ([32e7b32](https://github.com/hybridlabor-api/aos/commit/32e7b326d34f511c63a42565df99f50f85fb0ac0))
* **windows:** use path.win32.basename so the service-module check is platform neutral ([c89e2c6](https://github.com/hybridlabor-api/aos/commit/c89e2c68067b91e7e528553237ea9299f42cf0b3))

## [5.2.1](https://github.com/hybridlabor-api/aos/compare/v5.2.0...v5.2.1) (2026-10-14)


### Bug Fixes

* **test:** hub port-busy test blocks an OS-assigned port instead of fixed 59996 ([18d2fcd](https://github.com/hybridlabor-api/aos/commit/18d2fcd1df90c909c3e0a4bc372acfd3013efde0))
* **test:** hub port-busy test uses an OS-assigned port ([844fd8c](https://github.com/hybridlabor-api/aos/commit/844fd8c801beb49d7cef0d03cba66ff2e1a81f6a))

## [5.2.0](https://github.com/hybridlabor-api/aos/compare/v5.1.1...v5.2.0) (2026-10-14)


### Features

* **agents:** add 16 upstream ECC code reviewers for full parity ([0110cbe](https://github.com/hybridlabor-api/aos/commit/0110cbeacec0796719017fd397ab957bb19246c3))
* AOS 5.2.0 bundle: Windows fixes, gate v2, A2A P2-P4, ECC parity, lane-b ergonomics ([b6ebcc8](https://github.com/hybridlabor-api/aos/commit/b6ebcc875297bb9edda9571213aa25a4e96e4105))
* **cli:** finish lane-b ergonomics: single preflight message, explicit exit code assertions, bundled CLI candidate tests ([ba3d336](https://github.com/hybridlabor-api/aos/commit/ba3d336f107f578e65b834ba45d93a68b08a0f5b))
* **cli:** plan-canvas mdx warning, installer prereq preflight, desktop cli detection ([7464fe6](https://github.com/hybridlabor-api/aos/commit/7464fe64fcc1da57488ba2bac3e56a34a94f755b))
* **content-demo:** demo plan-canvas recap board for the Pulse cue list (invented data) ([8fcb19f](https://github.com/hybridlabor-api/aos/commit/8fcb19fa707b13bd0e9cf207d2a373d9e4cd1ce9))
* **content-demo:** fictional Pulse demo plan, event driver and recording runbook ([d53a219](https://github.com/hybridlabor-api/aos/commit/d53a219046238660b08fab3d088263b8e2d3d515))
* **profile:** Token Saver is opt-in, rtk is installed by the user from its own repo ([a27d6a4](https://github.com/hybridlabor-api/aos/commit/a27d6a4c97dbe78ea1962359e2f5b7d3be5b97ae))
* **ui:** finalize bdb-ui-library integration ([8535235](https://github.com/hybridlabor-api/aos/commit/853523553fa6176ebd70d570d86cc53576b9266a))


### Bug Fixes

* **a2a:** bind only the claude pid, cap and order monitor delivery, flush the Codex identity line ([7565cef](https://github.com/hybridlabor-api/aos/commit/7565cefb05021a9e6e2c7cb0d21d7e9d6571ad92))
* **agents:** clean nonexistent skill references, update count to 45, and test all 24 reviewers ([3309422](https://github.com/hybridlabor-api/aos/commit/330942201c6e2fe247de9a33702c243376013bec))
* aos-gate resolves its scopes from the installed gate-profile, plugin descriptions count 45 agents, tests follow the opt-in Token Saver and the restored off profile ([637d9d0](https://github.com/hybridlabor-api/aos/commit/637d9d02279cf37afe631951a99f13a456f66ba3))
* **content-demo:** refuse a directory by path segment, make the driver tests environment independent ([7483c2f](https://github.com/hybridlabor-api/aos/commit/7483c2f0879f16e7ea8f2b2244f9627d4325524e))
* **content-demo:** remove personal paths and make driver path check generic ([bea600c](https://github.com/hybridlabor-api/aos/commit/bea600c696361e01dafc10e6519da21aea8e7413))
* **docs:** update subagent and reviewer counts after the ECC parity port ([c0f8b2c](https://github.com/hybridlabor-api/aos/commit/c0f8b2cc446f76df20447ccd07919903f60d193d))
* drop the MacOS/claude candidate, scope the module lock message, bound agy stderr and state at-least-once delivery honestly ([cb631f4](https://github.com/hybridlabor-api/aos/commit/cb631f458eb75b6167b244d3a8d20b8391acc67c))
* **gate:** aos-gate widening is a never-grantable plain-GO class, strict clears grants, grants keep the off expiry ([597f214](https://github.com/hybridlabor-api/aos/commit/597f21413cbacc4767eae0422a10e48fdfd8d034))
* **gate:** regenerate the guarded pattern list and restore the $PWD trust and work-profile behavior ([13e55fc](https://github.com/hybridlabor-api/aos/commit/13e55fc746cdf315d89e5744d754488e8d6b87ee))
* **gate:** restore fail-closed on unparseable commands and refuse agent-run aos-gate widening ([cfc7a60](https://github.com/hybridlabor-api/aos/commit/cfc7a60efd4c244c161ae7d9f21ce44a26b98aed))
* **gate:** restore the off profile and keep every widening action human-only ([deb1420](https://github.com/hybridlabor-api/aos/commit/deb1420a70b991c2feeca6cd527ea164198c676a))
* **ui:** add skill category, remove hardcoded user path, and pin version ([3abdb04](https://github.com/hybridlabor-api/aos/commit/3abdb043da2014df5cb6ab4f059e8b8591daca71))
* **ui:** skip the library wiring test explicitly, drop dangling references, revert the shadcn pin ([72018ef](https://github.com/hybridlabor-api/aos/commit/72018efa89a75e1ab1c51f9de0842a534d25c488))
* **update:** an update run by the latest package records its version instead of calling itself stale ([a2b060d](https://github.com/hybridlabor-api/aos/commit/a2b060d448d047ada904919e89c7d4c027d7c219))
* **windows:** extract tarballs with cwd-relative paths so GNU tar never reads C: as a host ([37889b6](https://github.com/hybridlabor-api/aos/commit/37889b6d4b31602bac2cb1163a7fe7541f2856c7))
* **windows:** hide the console of background spawns in a2a-agy, aos-acp, agenttrail, store-ui and aos-gogate ([b2c8f53](https://github.com/hybridlabor-api/aos/commit/b2c8f534dafd3f04a0017aee0e39b936ff72879d))
* **windows:** hide the console of installer and v5 step child processes ([ec219f0](https://github.com/hybridlabor-api/aos/commit/ec219f0380cffc5a4cd384ead2f7bc6bef865fc6))
* **windows:** honest Token Saver and Codenotch checks, optional creator engines no longer fail the step ([3dd8703](https://github.com/hybridlabor-api/aos/commit/3dd8703f82f523e3312bfdcca29cfba0c622465e))
* **windows:** retry the module swap rename and report a locked module clearly ([b1129e0](https://github.com/hybridlabor-api/aos/commit/b1129e0f03f3c57cce3c05cbb116f95aff1f9fcc))

## [5.1.1](https://github.com/hybridlabor-api/aos/compare/v5.1.0...v5.1.1) (2026-10-14)


### Bug Fixes

* **hooks:** give rules-inject and the GO hooks 10 s so a loaded machine no longer drops their output ([b67bf0e](https://github.com/hybridlabor-api/aos/commit/b67bf0ece86a4f92f059675f0ef281d45460099b))
* update hint, hook timeouts under load, Windows spawns and console windows (5.1.1) ([199dc0d](https://github.com/hybridlabor-api/aos/commit/199dc0d65e73fc35b3af84fea81559d6bf8ca1df))
* **update:** a version cache older than the running kernel is refetched, so the update no longer reports a stale remote ([0bae7fb](https://github.com/hybridlabor-api/aos/commit/0bae7fb3e2d21c3b8f4e3e48c41100163eafcff9))
* **update:** give the module npm view check 15 s on macOS and Linux too ([e47f28d](https://github.com/hybridlabor-api/aos/commit/e47f28d9847f06dcd073d02e9c4f4569a0b0430e))
* **update:** the generated shipped-hashes.json is overwritten, not kept as a user edit ([d1ffd60](https://github.com/hybridlabor-api/aos/commit/d1ffd60ff36cde0a50ca336c0b9d307541beb551))
* **windows:** hide console windows of detached hook and hub spawns ([1338646](https://github.com/hybridlabor-api/aos/commit/1338646d1e31401f59a272410480c1dbee18648c))
* **windows:** hide the console of cli-spawn children and of the session-start trail probe ([6bcf2fd](https://github.com/hybridlabor-api/aos/commit/6bcf2fde949db291058ed85d411941915fd04796))
* **windows:** hide the powershell console in the a2a process start-time probe ([9e3ba57](https://github.com/hybridlabor-api/aos/commit/9e3ba5789f5a95096ec658f95a3bcd65c146d154))
* **windows:** resolve npm .cmd shims for openwiki, deja, token-saver and npm view ([36d644e](https://github.com/hybridlabor-api/aos/commit/36d644e2f6bd7c415d95e8740c8384d1bcc0be61))

## [5.1.0](https://github.com/hybridlabor-api/aos/compare/v5.0.2...v5.1.0) (2026-10-14)


### Features

* **a2a:** add session labels, phonebook list format and label-based target resolution ([2bd39b1](https://github.com/hybridlabor-api/aos/commit/2bd39b13a04b8326445ce108e77d9c149979a6b7))
* AOS 5.1 — prompt audit fixes, hook timeouts, defaultMode auto, A2A labels ([6038cb5](https://github.com/hybridlabor-api/aos/commit/6038cb57065b637aace2e30a28ab0d6c10e44c6e))
* **aos-setup:** multi-agent worktree guidance and doctor checks ([6f874a7](https://github.com/hybridlabor-api/aos/commit/6f874a739fddba0660edd49ebbaae423e1251c32))


### Bug Fixes

* **a2a:** list shows label and session name, a bad label never blocks registration ([a9fe380](https://github.com/hybridlabor-api/aos/commit/a9fe380276202671c441f1859cc68cf65b7c1feb))
* **agy:** stage the plugin manifest with an empty skills array so agy stops logging relative-path errors ([833a1af](https://github.com/hybridlabor-api/aos/commit/833a1af0d84f23c3ba938f213e3487a6e0a2df37))
* **aos-setup:** worktree count and prunable checks are advisory, they no longer fail the doctor ([e0385e2](https://github.com/hybridlabor-api/aos/commit/e0385e2d81497b23f35781d43364ecdb61fd719e))
* **hooks:** set explicit Claude hook timeouts and fast bounded trail-relay and rules-inject ([13e6c8d](https://github.com/hybridlabor-api/aos/commit/13e6c8d0efb98fb51ffbda55842122c4fd1fd6dc))
* **installer:** retire legacy ~/.codex/skills copies of module skills matching ~/.agents ([e950394](https://github.com/hybridlabor-api/aos/commit/e950394312dd1c047cf1467cd73a05e8d9c2434c))
* **installer:** set permissions.defaultMode="auto" in Claude settings when absent ([aa444b2](https://github.com/hybridlabor-api/aos/commit/aa444b2f200c1dc546fe7e3de521da7ac44b4539))
* **instructions:** make ~/AGENTS.md canonical and avoid redundant rules injection ([000dcfa](https://github.com/hybridlabor-api/aos/commit/000dcfa4d7880be788747e7027b4a495aa6dfede))

## [5.0.2](https://github.com/hybridlabor-api/aos/compare/v5.0.1...v5.0.2) (2026-10-13)


### Bug Fixes

* AOS 5.0.2 — write only for detected harnesses, memB Python &gt;= 3.10, mods skip reasons, quoted & in go-gate ([9eee847](https://github.com/hybridlabor-api/aos/commit/9eee84761d6f5c78900545db7f6e698686505a37))
* **installer:** --hooks-only honours --platforms; tests name the harnesses they look at ([e6bf45f](https://github.com/hybridlabor-api/aos/commit/e6bf45fb369e7e44517df964be0eed1ae31bf08c))
* **installer:** write only for detected harnesses; -y installs for what is found, not for Antigravity ([8ac91e4](https://github.com/hybridlabor-api/aos/commit/8ac91e4156f4f9d0ebb4ed7a55a228acefb53177))
* **kernel:** verify the skills of the primary target the install really wrote ([085f962](https://github.com/hybridlabor-api/aos/commit/085f962a2a9a8b2134e9457dec35d0eb33b33cef))
* **memb:** pick Python &gt;= 3.10, bootstrap it with uv or fail loudly; exempt the memB scripts from the fresh-script cooldown ([39d4839](https://github.com/hybridlabor-api/aos/commit/39d4839921bc1aeca9c4b521bf55f77dbb86ce31))
* **mods,gate:** say why a Claude mod was skipped and add a doctor row; a quoted & does not split a command ([bd71c23](https://github.com/hybridlabor-api/aos/commit/bd71c23bbbdc0466ce4c2759956be47e810df436))

## [5.0.1](https://github.com/hybridlabor-api/aos/compare/v5.0.0...v5.0.1) (2026-10-13)


### Bug Fixes

* **uninstall:** stop only this user's own gateway and hub processes; read config files with a BOM ([c76ab29](https://github.com/hybridlabor-api/aos/commit/c76ab299fda9b3105ce9a2d27e62c7c1f2da7525))
* **uninstall:** stop only this user's own gateway and hub processes; read config files with a BOM (5.0.1) ([e42701f](https://github.com/hybridlabor-api/aos/commit/e42701f55c94837c7cac5c8f988e32854157d91e))

## [5.0.0](https://github.com/hybridlabor-api/aos/compare/v5.0.0-beta.2...v5.0.0) (2026-10-13)


### Features

* **codex:** AOS-owned execution-policy rules as the enforced gate layer ([88575b0](https://github.com/hybridlabor-api/aos/commit/88575b09364f2f8a8e10c5bc7257055706245759))
* **installer-v5:** enable the Claude Code mods with one settings.json write; unified memory docs ([31d7e2c](https://github.com/hybridlabor-api/aos/commit/31d7e2c25e571ba0bb69843694f3880cc2be9a38))
* **installer-v5:** fresh install adds gateway, hub service and all Claude Code mods ([1a22843](https://github.com/hybridlabor-api/aos/commit/1a22843694c31fd1a34f7d408bc9cfda206514d8))
* **installer:** aos launcher, launchers for hub/gogate/sessions/trail, English uninstaller output ([8980241](https://github.com/hybridlabor-api/aos/commit/89802418eaffe214338c5410952e2fffc4d62e07))
* **installer:** unified memory (memB, deja, OpenWiki, Codebase Memory for coding tools) in the default install ([1421e03](https://github.com/hybridlabor-api/aos/commit/1421e0300ef225d1cdbb66e99f367208cf04ba84))


### Bug Fixes

* **codex:** register go-gate without a matcher; read tool_input.cmd ([76b2aa3](https://github.com/hybridlabor-api/aos/commit/76b2aa38c4f7ff295bd0abb6d8e43ac5181ba573))
* **doctor:** Codex hook review is informational, never a false warning ([d2facd1](https://github.com/hybridlabor-api/aos/commit/d2facd130cefceaa02848ba0237404992017e390))
* **go-gate,hub:** read Codex code-mode exec sources; migrate the Windows hub from the beta.2 task to the Startup .vbs ([f5f2bc1](https://github.com/hybridlabor-api/aos/commit/f5f2bc1f2cba0e4184c35356d31f6d9921c76a72))
* **go-gate,uninstall:** Codex deny contract and Windows Startup entries on uninstall ([b169fa1](https://github.com/hybridlabor-api/aos/commit/b169fa1447ae51296c8b843ed41f8f5897f8746c))
* **go-gate:** free read-only gh calls and store reads through filters; guard aos-uninstall ([9c29ce5](https://github.com/hybridlabor-api/aos/commit/9c29ce516be4807bc663520b3442a76b0a125c06))
* **go-gate:** open powershell -Command and cmd /c like bash -c; -EncodedCommand needs a GO ([8902b28](https://github.com/hybridlabor-api/aos/commit/8902b2865ff85c9dc56e062ce49d6c6c2097656d))
* **go-gate:** type and Get-Content read the store like cat ([ace34a2](https://github.com/hybridlabor-api/aos/commit/ace34a26b446e3400c25a142a41ed55d60086dc3))
* **go-gate:** Windows spellings, backslash store paths, dry-run=false and inline spawn of a non-literal command ([78f0717](https://github.com/hybridlabor-api/aos/commit/78f071764bdf2f210f4ad09dd8096fc4cd1d8b3f))
* **installer:** back up each config file at most once per run ([8e9139c](https://github.com/hybridlabor-api/aos/commit/8e9139c5dc2e4a4c5ae2a93813f0886a9f6068e8))
* **installer:** sync rule blocks into ~/CLAUDE.md and ~/AGENTS.md from any working directory ([3cea3c1](https://github.com/hybridlabor-api/aos/commit/3cea3c14ff3beca871a4d912580de10c8a6cadd2))
* **installer:** touchdesigner-mcp builds without the mcpb pack step; Codex hook trust reminder and doctor row ([b1c7353](https://github.com/hybridlabor-api/aos/commit/b1c7353e16ab48fd4df1e785cc9152c8a730aeaa))
* **memb,hub:** reconcile memb-mcp on its real entry import; hub service starts without package.json ([8e82aa1](https://github.com/hybridlabor-api/aos/commit/8e82aa19c87c4f0228988e3bd44c1a0272dbc0f9))
* **opencode:** use the config dir OpenCode reads on Windows ([54a031b](https://github.com/hybridlabor-api/aos/commit/54a031b906be765e182048643ca0e9adf3f600c3))
* **uninstall:** remove the memB WebUI Startup entry on Windows ([420bf4f](https://github.com/hybridlabor-api/aos/commit/420bf4f10affa85eb78c5da02ee3ba34f2861052))
* **windows:** aos-acp starts npx/opencode shims, aos-a2a send exits cleanly, list marks stale peers ([65a8c66](https://github.com/hybridlabor-api/aos/commit/65a8c663a0569b28ff6075a238ea966416478a05))
* **windows:** gateway and hub start from the Startup folder, not a scheduled task ([9cf4a53](https://github.com/hybridlabor-api/aos/commit/9cf4a53f9242f2219aa896a21edfe4d578ece121))
* **windows:** gateway npm via cli-spawn, hub task XML as UTF-16, aos-uninstall launcher runs from the package ([c6d0e4a](https://github.com/hybridlabor-api/aos/commit/c6d0e4a63448da144c9973729b50a69cbe896a46))
* **windows:** pass core.longpaths to spawned CLIs so marketplace add can clone ([6607b1b](https://github.com/hybridlabor-api/aos/commit/6607b1b016c9363b3f05a3225d8ba2efd226199d))


### Miscellaneous Chores

* **release:** graduate from beta to stable 5.0.0 ([3b309af](https://github.com/hybridlabor-api/aos/commit/3b309af2153b382fe728aaac955f4927bd761c12))

## [5.0.0-beta.2](https://github.com/hybridlabor-api/aos/compare/v5.0.0-beta.1...v5.0.0-beta.2) (2026-10-11)


### Bug Fixes

* **agy:** stage real copies on Windows instead of junctions ([29ea505](https://github.com/hybridlabor-api/aos/commit/29ea5057b269e1d974c25f47263b33e7c87784db))
* **installer:** wire gate hooks and deny rules from any working directory ([f5894e0](https://github.com/hybridlabor-api/aos/commit/f5894e0dce13474c22f5573dd3893777a662e536))
* **rhino-mcp:** drop the git-lfs rules whose objects were never pushed ([2a0063d](https://github.com/hybridlabor-api/aos/commit/2a0063d67dd8d897a7879bb4361e8f542639aee1))


### Miscellaneous Chores

* release 5.0.0-beta.2 ([431e70d](https://github.com/hybridlabor-api/aos/commit/431e70dfa2f2f127b86ff16fadc9c46d8b775868))

## [5.0.0-beta.1](https://github.com/hybridlabor-api/aos/compare/v4.19.0...v5.0.0-beta.1) (2026-10-11)


### Features

* **a2a:** agy inbox MCP and resume executor, Codex queue/resume executor (Ziel C WP-LIVE-agy, WP-LIVE-codex) ([3d868fa](https://github.com/hybridlabor-api/aos/commit/3d868fabff59c08dae373c119d3d052cd0881c3f))
* **a2a:** agy PreInvocation inbox hook (delivers only at invocationNum 0, never mid-turn) ([7e94588](https://github.com/hybridlabor-api/aos/commit/7e945881fb82bce54e93968fb64ccb11f71c3b56))
* **a2a:** agy sidecar keeps one own conversation per A2A thread (--output-format json + --conversation) ([1f08b6d](https://github.com/hybridlabor-api/aos/commit/1f08b6d802eecda544b2e43c6111ec992299d721))
* **a2a:** agy sidecar logs task, context and conversation id per turn ([b3ad8f2](https://github.com/hybridlabor-api/aos/commit/b3ad8f220136b2447e9e01b0b61aaed743e0ef67))
* **a2a:** aos-a2a serve --mode agy|codex and ring-script sidecar bring-up for the agy/Codex legs ([e113ece](https://github.com/hybridlabor-api/aos/commit/e113ece5f040feeccef7e12a1982cf89903908c6))
* **a2a:** aos-a2a watch &lt;name&gt;, read-only live view of a peer (v5 WP-WATCH) ([34abac5](https://github.com/hybridlabor-api/aos/commit/34abac5660ae0fd8e54cd69e8b7b9b33d6f75a18))
* **a2a:** aos-a2a-mcp, outbound A2A tools for agy and Cursor (v5.0.0) ([3c9347f](https://github.com/hybridlabor-api/aos/commit/3c9347f7fe6192ea0bea2864421acdd6004760f6))
* **a2a:** Claude live peer inbox drain and stop hooks (Ziel C WP-LIVE-claude) ([97203bb](https://github.com/hybridlabor-api/aos/commit/97203bb13ef2a6c05443f97fa5b4aed4caff126c))
* **a2a:** Claude SessionStart sidecar hook and install test update (Ziel C WP-HOOK) ([beea6c8](https://github.com/hybridlabor-api/aos/commit/beea6c86bbda863b235a68342b1674bc3c58a956))
* **a2a:** ensureSidecar supports mode codex with a thread (Codex SessionStart sidecar) ([00c8260](https://github.com/hybridlabor-api/aos/commit/00c82603b21ca26ceb64c3aa5ecf1a4b9b212300))
* **a2a:** headless GO via auth-required with a human-minted reference (v5 WP-GO) ([b30e0ec](https://github.com/hybridlabor-api/aos/commit/b30e0ecae9534b79d3640d583484f7e35e051603))
* **a2a:** installer opt-in registration and doctor checks for agy and Cursor MCP ([83bc9b6](https://github.com/hybridlabor-api/aos/commit/83bc9b6a8abf485328adb6a02cd561604f70afb3))
* **a2a:** installer ships A2A hooks, lib copies and OpenCode plugin; doctor A2A matrix (Ziel C WP-INSTALL) ([ce0937b](https://github.com/hybridlabor-api/aos/commit/ce0937bf2cfb4bbf2a208ec439dd9f196cdd0c58))
* **a2a:** intercom book with heartbeat and aos-a2a book (v5 WP-BOOK) ([1ae8a05](https://github.com/hybridlabor-api/aos/commit/1ae8a05cd2f96897ca0004359c405d11a1a60056))
* **a2a:** live inbox format and live executor (Ziel C WP-LIVE-core) ([b93cf1b](https://github.com/hybridlabor-api/aos/commit/b93cf1b9e03d2d04fe685fdf4b02dd11c30490fe))
* **a2a:** live-e2e ring check script and A2A docs (Ziel C WP-E2E, WP-DOCS) ([a16ffc7](https://github.com/hybridlabor-api/aos/commit/a16ffc7e0720e151bdfd25ca5fc9f44d3211aa11))
* **a2a:** OpenCode live peer inject and reply hookup (Ziel C WP-LIVE-oc) ([b60d362](https://github.com/hybridlabor-api/aos/commit/b60d3624752af6842062c842ec816ef08676a0a9))
* **a2a:** outbound remote peers (allow-list, https-only, host pin, secrets.env, never-GO wrapper) (v5 R1+R3) ([ce446a8](https://github.com/hybridlabor-api/aos/commit/ce446a805179c70d8e7db37baf741cd8ba50b854))
* **a2a:** per-session sidecar starter and OpenCode init hookup (Ziel C WP-HOOK, lib part) ([35a64ba](https://github.com/hybridlabor-api/aos/commit/35a64baa2f65a78c94334106e5d5676609f3f2ad))
* **a2a:** session hook takes --harness codex (mode codex, thread = session id) and falls back to ~/.agents/lib ([f9caa34](https://github.com/hybridlabor-api/aos/commit/f9caa34ff98d510964e49355e20a8702beec2d06))
* **a2a:** ship the Codex session hook and the agy PreInvocation inbox hook through the installer ([237631d](https://github.com/hybridlabor-api/aos/commit/237631d716c43c9dbcda3245eea89a266a7eede6))
* **a2a:** spawn mode runs agy through aos-acp agy (plan mode for read-only jobs, scoped for write jobs) ([a127446](https://github.com/hybridlabor-api/aos/commit/a127446ac008ffae7e4f0cba58d6d6b5fc3da03b))
* **a2a:** spawn mode with job worktrees for write tasks (v5 WP-SPAWN) ([24261ca](https://github.com/hybridlabor-api/aos/commit/24261ca144795015addbd4a203d2980ba50abce4))
* **acp:** aos-acp agy target over the vendor agy --print (mode mapping, print-timeout, closed stdin, empty-response failure), docs and tests ([490faa6](https://github.com/hybridlabor-api/aos/commit/490faa63255aad9d55848b36cdfb65a01121c73f))
* **acp:** optional per-launch sandbox (aos-acp --sandbox coop|wsl2) ([5383d7b](https://github.com/hybridlabor-api/aos/commit/5383d7b4e295b62a70955daacbadc293aabd946b))
* **acp:** path-scoped permissions for workers (--allow-default scoped) (v5 WP-PERM-core) ([28b81c9](https://github.com/hybridlabor-api/aos/commit/28b81c9e5309edc5679f9396a19e4848c78c59d3))
* add annotation data model and storage for plan-canvas annotation v2 ([9a2b5b7](https://github.com/hybridlabor-api/aos/commit/9a2b5b73b16be5f4ba57d0191cc175084291c128))
* add annotation guard and loopback proxy (proxy tests still being fixed) ([1d85592](https://github.com/hybridlabor-api/aos/commit/1d855926bad555465079082c3e609de6a8046116))
* add Firecrawl MCP as opt-in pick with key-safe handling and doctor hint ([4e085b4](https://github.com/hybridlabor-api/aos/commit/4e085b4e6aee43aa9932a368360965022ff8d16d))
* add optional codebase-memory MCP module and skill ([1175ba3](https://github.com/hybridlabor-api/aos/commit/1175ba3c7d4e23dd984d81811b442847e8740af5))
* **agents:** eight new subagents (pcb, event manager, video/motion, live media operator, spec/prd, devils advocate, reviewer 1/2), read-only enforcement for reviewers ([0b28e90](https://github.com/hybridlabor-api/aos/commit/0b28e906181dd4a3d58216920271b34a2139df99))
* **agenttrail:** collapse hub card task lists and lay the board out as a wide grid ([74da5aa](https://github.com/hybridlabor-api/aos/commit/74da5aad0ec2674dbc012d87156010ba0916f2e6))
* **agenttrail:** HTTP guard for the hub's local transport ([bc39d0c](https://github.com/hybridlabor-api/aos/commit/bc39d0c8b5e4acd6a716d956cd43dcb6e1b112d1))
* **agenttrail:** hub-first ensure and callers ([bbcd024](https://github.com/hybridlabor-api/aos/commit/bbcd0244da2320320351daefdea571b7b27a7d57))
* **agenttrail:** link the plan node a worker runs to the live map ([6d84f09](https://github.com/hybridlabor-api/aos/commit/6d84f0932e69a2047b4063dcc3a6085b6d457729))
* **agenttrail:** one plan identity across a repo's worktrees ([00c2187](https://github.com/hybridlabor-api/aos/commit/00c21870d13bac813dfc87ba71bbb91d8bddc2a5))
* **agenttrail:** plan lifecycle, staleness and auto-archive ([83cffb8](https://github.com/hybridlabor-api/aos/commit/83cffb8d328ad5784abaad19aae949db6260d56c))
* **agenttrail:** read-only gate panel for the hub ([e94ce7d](https://github.com/hybridlabor-api/aos/commit/e94ce7d3c1182b22b75293f3936e16b95d241a3f))
* **agenttrail:** session table and the waiting-for-Tim list ([1c22472](https://github.com/hybridlabor-api/aos/commit/1c22472cf9937333a555915470218f57d9823e1b))
* **agenttrail:** show live plan tasks on the hub card ([4160080](https://github.com/hybridlabor-api/aos/commit/41600803da365591f2601ab7295ef786d239a0cf))
* **agenttrail:** the hub board, with copy-GO-text instead of a button ([ff5178f](https://github.com/hybridlabor-api/aos/commit/ff5178f75e77a72afd9c2a31b54729a31701b5d6))
* **agenttrail:** the trail hub — one daemon, one port, every repo ([1ad209d](https://github.com/hybridlabor-api/aos/commit/1ad209dec59b60b0970ba99002a398887baa589e))
* **agenttrail:** trail-event/1 contract and the aos-trail emit CLI ([b40c626](https://github.com/hybridlabor-api/aos/commit/b40c62633f9971c439aa2ccbf9c92bc14c94c474))
* **agenttrail:** WP-12 click endpoints and WebAuthn enrolment in the hub ([f26e42f](https://github.com/hybridlabor-api/aos/commit/f26e42f968179295450eb51b2a2897c56f8338ee))
* **agy:** run agy workers without MCP servers by default ([ea69d91](https://github.com/hybridlabor-api/aos/commit/ea69d91af005a9a531b039d195f139efb1550954))
* **alert-mod:** blink red around the prompt when the session needs the human ([5416375](https://github.com/hybridlabor-api/aos/commit/54163753ff3dbff20e4ec902d5e0a875cb7b4490))
* annotation agent protocol (WP7) ([46c5695](https://github.com/hybridlabor-api/aos/commit/46c569548ff2a59a18e6535ce9139a27643c8900))
* annotation overlay shell and markup bar (WP4/WP5) ([3a539d4](https://github.com/hybridlabor-api/aos/commit/3a539d4a1166e07e5462eec1c4bb2aaad411ee0c))
* **annotation:** notes panel, SVG connector lines, orphan chip and rebind (WP6) - NOT Docker-tested ([e5a7ea5](https://github.com/hybridlabor-api/aos/commit/e5a7ea50e4255acb9198b4866983fd5fe9840431))
* AOS v5 installer (release candidate 5.0.0-beta.1) ([78d95c5](https://github.com/hybridlabor-api/aos/commit/78d95c5ca7e4eae12b0f40c6ee26aaa9cc3cf60a))
* **aos-acp:** --trail-node and --trail-plan set the worker's plan node ([7a11446](https://github.com/hybridlabor-api/aos/commit/7a1144668ba088beb4a9a97d19a2f42c6056c9ae))
* **aos-sessions:** read-only overview of all sessions and ACP workers ([fffbfcc](https://github.com/hybridlabor-api/aos/commit/fffbfcc1e359734de8ef3ee78e4b765b34569c73))
* **aos-sessions:** wire the CLI, marketplace entry and tests; document the gate residuals ([0e2dacf](https://github.com/hybridlabor-api/aos/commit/0e2dacff25b18280cdef7f5d3aeb646cf5085f81))
* **cli:** aos status shows the supervised services; aos restart and aos dashboard ([#26](https://github.com/hybridlabor-api/aos/issues/26) W4) ([d7abce6](https://github.com/hybridlabor-api/aos/commit/d7abce62ec4243ec65da0c8f29cf99f1dbb968a9))
* **fleet-mod,alert-mod:** show the gate profile and mark release-class blocks ([413b968](https://github.com/hybridlabor-api/aos/commit/413b9682d8c72d2c62301a0d4744ab3f6af7966c))
* **fleet-mod:** go-gate pane v2 with mode switch, last-blocked strip and demo mode ([e628e77](https://github.com/hybridlabor-api/aos/commit/e628e77a4d28c9ac7f8ed5aacd877c2bf7645bec))
* **fleet-mod:** go-gate pane v3 card layout with lock icon, two columns and risk-coloured grants ([8d5e727](https://github.com/hybridlabor-api/aos/commit/8d5e727fe77d525a652cc5dc2d65f055fba0e548))
* **fleet-mod:** live plan box pane (/aos-plan) from the repo plan file ([355b7fc](https://github.com/hybridlabor-api/aos/commit/355b7fcea5454a8a0e4371f8db0f8429c258e33c))
* **fleet-mod:** tabbed aos-hub pane (Fleet | Gate | Plan) ([f20cc97](https://github.com/hybridlabor-api/aos/commit/f20cc97a41220d95ac5b10b394f890f5b857ba1d))
* **gate:** container-test grant scope for docker run, commit bypass forms need a GO ([aa77516](https://github.com/hybridlabor-api/aos/commit/aa7751624c77357ff917aa655b6d55b9d87e9771))
* **gate:** grant scope workspace for repo scripts that delete inside their own repo ([5a2093c](https://github.com/hybridlabor-api/aos/commit/5a2093c04fc983335d2089c90cc1ec437eeddede))
* **gate:** profile read module, aos-gate CLI skeleton, tests, docs (P1+P4, not wired) ([3a281aa](https://github.com/hybridlabor-api/aos/commit/3a281aa45653f11336fa8aa8ee17e68125711816))
* **gate:** profiles work/off honoured by the Claude hook; reader moves next to go-gate; aos-gate bin ([dea7154](https://github.com/hybridlabor-api/aos/commit/dea71548c467a25323442dec97932729bfe2f1fb))
* **gateway:** add adobe_uxp_mcp and bdb_unreal_mcp to the allow list (tool names checked, 64-char budget) ([9822dfd](https://github.com/hybridlabor-api/aos/commit/9822dfd641bd737de5290c85d5219631ba926384))
* **gateway:** adopt core, adopted.json upstreams, AE on the allow list ([8e754a3](https://github.com/hybridlabor-api/aos/commit/8e754a3772c382e0e55dd67ba9ab8368e0d6b0d3))
* **gateway:** adopt only-filter, agy serverUrl support, isAosShaped prefix, DIRECT reasons, 1mcp preset spike, harness-table design ([3468307](https://github.com/hybridlabor-api/aos/commit/34683075d954542b88e7ec1399d7b09aeaf91c66))
* **gateway:** aos-gateway adopt CLI and doctor warning; review fixes (secrets in args, corrupt adopted.json, rollback, disable cleans adopted.json) ([0b32ba7](https://github.com/hybridlabor-api/aos/commit/0b32ba76e9d393b3a65ecf94f5eba48aae932589))
* **gateway:** chrome-devtools behind the gateway; synapse, openwiki, firecrawl left to adopt ([b623b09](https://github.com/hybridlabor-api/aos/commit/b623b09925d0d013e9e5a6d83c2323acee0954b0))
* **gateway:** declarative harness table lib/harnesses.json drives classify, entryFor and harnessMcpFiles ([852497c](https://github.com/hybridlabor-api/aos/commit/852497c92e97d6f09b6c228e4b0555bf51837a0d))
* **gateway:** default-on in aos update, adopt dialog, full-install guard, 1mcp presets, Codex TOML ([3a6380d](https://github.com/hybridlabor-api/aos/commit/3a6380d5780a6ed3281cdf354c069e3d1d32ac2c))
* **gateway:** deja, memb_mcp and bdb_td_backup behind the gateway (GW-B host smoke test) ([fb655b0](https://github.com/hybridlabor-api/aos/commit/fb655b08dd4c0cd670261370f76ce4543a59b61f))
* **gateway:** doctor and verify flag direct duplicates per Claude project and in Codex TOML ([1c13b3f](https://github.com/hybridlabor-api/aos/commit/1c13b3fc184990241d644e998e17392893f63631))
* **gateway:** presets per harness kind, Linux systemd + Windows task service, harness switch gated on verify ([faa64a9](https://github.com/hybridlabor-api/aos/commit/faa64a9a028ec3032bd426036aeb2363d095e17c))
* **gate:** WP-9 Touch ID click receipts (go and grant), per-click WebAuthn proof ([1ea3713](https://github.com/hybridlabor-api/aos/commit/1ea371334a3d6b3845680d76f5197e0c45bc8bc4))
* **go-gate:** structured deny request records for the trail hub (WP-8) ([7ec2120](https://github.com/hybridlabor-api/aos/commit/7ec2120f66bd5eb693a2dceb4d400ea71815f316))
* **gogate:** aos-gogate status works with any installed harness hook dir; grants-per-harness doc (H1) ([d5acb98](https://github.com/hybridlabor-api/aos/commit/d5acb98a6dfa13c46bad99c23b9270dd735027e2))
* **golive:** wire into startcycle and shipping, add bdb-fleet guided hosting reference ([21a2d71](https://github.com/hybridlabor-api/aos/commit/21a2d71cfe074f149f78fb62c399ee3bc3492026))
* **grandma3:** typed ma3_* tools with validated builders (syntax from the official help), patch_fixture and execute_macro fixed ([acead81](https://github.com/hybridlabor-api/aos/commit/acead816751aa38696390bfdaa1c6d053d662a8b))
* **hub:** AOS Hub core, request guard, plans tab and route stubs (WP1) ([4669b94](https://github.com/hybridlabor-api/aos/commit/4669b94dcaea526296a45a7cf4a7e8b4465d235f))
* **hub:** services registry with aos services, catalog, WP1 review fixes (WP2, WP3) ([b936ee0](https://github.com/hybridlabor-api/aos/commit/b936ee0a79e7c41ee3f95374dcda8e53d4fd4f5f))
* **hub:** store rollback with validated backups, MCP kind, packages, hub integration, doctor checks, docs and Docker test (WP4, WP5) ([1f16fdd](https://github.com/hybridlabor-api/aos/commit/1f16fdd5a97509b28b248063f580a6d156c31187))
* **hub:** systemd control on Linux, RemoteOS out of the service list ([#26](https://github.com/hybridlabor-api/aos/issues/26) W2) ([99b8f4f](https://github.com/hybridlabor-api/aos/commit/99b8f4f384388d311b2d3b5d6c4342436c6a7862))
* **hub:** the AOS Hub runs as a service and supervises the others ([#26](https://github.com/hybridlabor-api/aos/issues/26) W3) ([d6803ab](https://github.com/hybridlabor-api/aos/commit/d6803abf849c894d43e994a47777c5490e735ea7))
* **hub:** watch loop that restarts crashed services through their service manager ([#26](https://github.com/hybridlabor-api/aos/issues/26) W1) ([fd2d117](https://github.com/hybridlabor-api/aos/commit/fd2d11731e339a85a7a58338f170366c97663d27))
* **hub:** Windows Task Scheduler text mirror for plan-canvas service ([62e4c7e](https://github.com/hybridlabor-api/aos/commit/62e4c7eb0e961dfe84064ff67f7dbfd6dd5ba1f0))
* **installer-v5:** aos-gogate read-only status and preset CLI ([5f6bc19](https://github.com/hybridlabor-api/aos/commit/5f6bc19798dbd997f1540aedfae6e3e1b3f7a2c7))
* **installer-v5:** copy only the hook scripts each harness wires; OpenCode plugin honours --no-hooks and minimal ([c05565c](https://github.com/hybridlabor-api/aos/commit/c05565c30806ca2f08153f474f84f306e83c624b))
* **installer-v5:** fleet mod package step ([6108ea9](https://github.com/hybridlabor-api/aos/commit/6108ea94fecdb61c5b736029827704bdfed3ebb4))
* **installer-v5:** install profiles and --no-hooks/--hooks-only/--without/AOS_DISABLED_MCPS, container scenarios, gate scope tests, agy model override ([370bef3](https://github.com/hybridlabor-api/aos/commit/370bef3a70dd3bf882f20bb68f9068d74fc3a41a))
* **installer-v5:** quiet Creator Extension update that skips an equal version; Synapse binary-name test; MCP refresh review notes ([55f4505](https://github.com/hybridlabor-api/aos/commit/55f450521ee705ecbf186323d4e48668bf9ceb1e))
* **installer-v5:** register the fleet mod (enabled in the Harnesses step unless opted out), async-aware package detection, fleet and aos-gogate tests in the suite ([b1c5542](https://github.com/hybridlabor-api/aos/commit/b1c554281d24fd0f7288af861c591a5658b34eb9))
* **installer:** a file from any shipped AOS release is AOS-owned ([efad2b0](https://github.com/hybridlabor-api/aos/commit/efad2b03221d1d0084c0b7037da8ab782a2e2188))
* **installer:** a run that cannot ask the coding question says how to opt in ([5e11b88](https://github.com/hybridlabor-api/aos/commit/5e11b88aeb3a18e06bc0262a0ebf6f3570a1e769))
* **installer:** ask once whether AOS is used for coding, enable Codebase Memory ([e6aa9ee](https://github.com/hybridlabor-api/aos/commit/e6aa9ee8fe6ea2d72b1ade8d8b7e22f3dce45e75))
* **installer:** memB, Synapse, Plan Canvas and the OpenWiki visualizer as systemd user units on Linux ([#26](https://github.com/hybridlabor-api/aos/issues/26) W5) ([25c9b6e](https://github.com/hybridlabor-api/aos/commit/25c9b6e336e38f8aaf019c2951f44cb2db0fe043))
* make adobe_uxp port configurable and move grandma3 default to 8081 ([44fb54e](https://github.com/hybridlabor-api/aos/commit/44fb54ebd61299d09c184d0e2d0ceac4b4c1f00b))
* **marketplace:** list bdb-aos-alert, version 4.19.0 ([a77b52f](https://github.com/hybridlabor-api/aos/commit/a77b52f03f4977e42fb09388518eec2e930cd74b))
* **mcp:** installer uses one-MCP-per-app picks, retires owned losers, ownership via shippedAll ([dcc2770](https://github.com/hybridlabor-api/aos/commit/dcc2770b24ab614317c0f98b4be0ac4d5743163c))
* **mcp:** pick one MCP per app by detected version (Blender official &gt;=5.1, Resolume bundled), shippedPicks ([f37d5be](https://github.com/hybridlabor-api/aos/commit/f37d5bef7506c0b9bad7ffe35f6cd0c8a97bdd57))
* **mcp:** swap After Effects to @kumoproductions/mcp-aftereffects@0.3.1, keep old server as _legacy ([faf3b70](https://github.com/hybridlabor-api/aos/commit/faf3b70f9b4b029a5cc2afabbe12f03f3f310d90))
* **mcsc:** delegate_* prefer aos-a2a send --role, native path as fallback (v5 WP-MCSC) ([fac72f8](https://github.com/hybridlabor-api/aos/commit/fac72f81a4e82eef2711b455fec9583465cae809))
* **memb:** verify checks 'from memb import Memory' in the shared venv and the harness configs' venv paths ([6b80403](https://github.com/hybridlabor-api/aos/commit/6b804030a1f3866b7e040fc2520f89410a91cb7c))
* **opencode:** godmode agents in the agent picker; master-session and project-orchestrator primary agents ([ec34a1f](https://github.com/hybridlabor-api/aos/commit/ec34a1fc3c04d5ea6ccb8158046a5cef74172228))
* **packages:** optional Rust + Tauri package (B4/B5) ([ab218bd](https://github.com/hybridlabor-api/aos/commit/ab218bd0587fa91000f4fcf86163efcc12778e3e))
* **packages:** StyleSeed skills become an optional package ([bed714d](https://github.com/hybridlabor-api/aos/commit/bed714de73e62232daaf1eceaa0463d958f22ad4))
* port ECC language reviewer agents as read-only AOS reviewers ([4f04a84](https://github.com/hybridlabor-api/aos/commit/4f04a841cc3273644b4cafc480778a9c0996ae81))
* **r8:** step 2a profile schema, validator, 4 domain profiles, tests (WIP, pre-review) ([219cf76](https://github.com/hybridlabor-api/aos/commit/219cf769649515ecd080920d401f73413ac06e1b))
* **r8:** step 2b dispatcher --profile, open state schema keys, profile-dispatch test (glm-free worker; unverified, needs Opus review + Docker) ([144abd3](https://github.com/hybridlabor-api/aos/commit/144abd3be744e04527cb2f47febc7e9741e7f656))
* route UI work to the version-pinned BDB component library first ([4610063](https://github.com/hybridlabor-api/aos/commit/46100639611e0a6414e9d4e5dccbac006c3a81fe))
* **routing:** automatic tool routing rules, sharper skill triggers, session hint hook (scope 5.0.0 items 1-4) ([8bb96b7](https://github.com/hybridlabor-api/aos/commit/8bb96b79afa0c2fa830cd018d48925f4c15a56bd))
* **routing:** wire aos-session-hint as a SessionStart context hook for Claude and Codex ([21b7521](https://github.com/hybridlabor-api/aos/commit/21b7521bfae0e6d8737ce38bea16be511e45fa55))
* **rustauri:** install the tauri-pilot CLI and register its MCP server ([1d469cf](https://github.com/hybridlabor-api/aos/commit/1d469cfcc4b82410a89d988e22dcbf7fdce454b0))
* **scripts:** list-skill-installs prints the skills.sh install commands per priority tier (m3 prep, never executes) ([5b1a4ec](https://github.com/hybridlabor-api/aos/commit/5b1a4ec078045f56a0c06d1e0d09f313fc05e7de))
* **sessions-mod:** /aos-sessions pane, a viewer for the aos-sessions CLI ([1a90aad](https://github.com/hybridlabor-api/aos/commit/1a90aadf8d23b8b8e36773b647dfbc972f4afecf))
* **skills:** add business-ops category (B1) ([2e33918](https://github.com/hybridlabor-api/aos/commit/2e33918e6e77c4de7d05df2c26e16000e8ba7557))
* **skills:** import tdd, diagnosing-bugs, code-review, to-spec, wayfinder from mattpocock/skills (MIT) ([0a54659](https://github.com/hybridlabor-api/aos/commit/0a5465993bace4016d71f41a9007b6304562801f))
* **skills:** merge firecrawl and DevOps skill clusters ([#23](https://github.com/hybridlabor-api/aos/issues/23) A+B) ([8c999e5](https://github.com/hybridlabor-api/aos/commit/8c999e5d5b97e46e68e479e5e72a2aed34a96f9d))
* **skills:** port the five missing factory skills from BuilderIO/skills (MIT), GO-gated ([e43e7f7](https://github.com/hybridlabor-api/aos/commit/e43e7f7684ef6d26f49c7f605bb2eff2f5ed74b8))
* **skills:** skill-create and instinct-status/export/import (concept inspired by ECC, no code copied) ([8e0bdd4](https://github.com/hybridlabor-api/aos/commit/8e0bdd422f0ff65578828fb8e0921989ad322223))
* **skills:** Track C wiring: pb-content-studio, content-studio routing, brand-neutral UI lookup ([07b798d](https://github.com/hybridlabor-api/aos/commit/07b798dd2967e820492fdc6c8a4e63e7a03fcc5a))
* **skills:** vendor golive (mikehasa/golive-skill, MIT) as a skill ([e038e65](https://github.com/hybridlabor-api/aos/commit/e038e65ca6ca7d445bad34094f5cc9412af4c43e))
* **store:** card grid, slide-over inspector and dry-run button (B3) ([0e26c30](https://github.com/hybridlabor-api/aos/commit/0e26c300f9f20041e7a891242b092220e3800eac))
* **store:** read-only /api/skill endpoint for the store inspector (B2) ([28e721d](https://github.com/hybridlabor-api/aos/commit/28e721db62f4d8b7016ffc85fa1f055ce5f24789))
* **v12-a11b:** ~/AGENTS.md managed, uninstall strips both rule blocks ([7a86ccf](https://github.com/hybridlabor-api/aos/commit/7a86ccf1b36330b673778f78acc24aaac39d0614))
* **v12-a11:** installer manages the tool-routing block, plan trigger for plan-canvas ([c132afe](https://github.com/hybridlabor-api/aos/commit/c132afecd7a001185f9247d7177aa4df98ade2dd))
* **v12-a12:** hub renders the classic map via one shared renderer ([d02aec5](https://github.com/hybridlabor-api/aos/commit/d02aec53c78fb0f02aadd19d0836c6f526169563))
* **v12-a13:** answerable QuestionForm in plan-canvas ([ae6342a](https://github.com/hybridlabor-api/aos/commit/ae6342a790e233985d753ba767d9e299e93c453d))
* **workers:** start aos-acp and mcsc workers without MCP servers by default ([b192691](https://github.com/hybridlabor-api/aos/commit/b192691228e946de317de408623ef465d88e025d))
* **workers:** start Codex workers without MCP servers by default ([e0c74d8](https://github.com/hybridlabor-api/aos/commit/e0c74d8df11816f14f604d9e1ee0ed46a490090e))


### Bug Fixes

* **a2a-go:** Opus findings A1-A7 (sidecar never consumes or says GO, read-only verification, resume from the stored prompt, reserved caller names, marker only as last stdout line, go-check ref TOCTOU, depth check first, CLI --task/--go-ref) ([1da6678](https://github.com/hybridlabor-api/aos/commit/1da6678767988159fd2161125928f6addae20a68))
* **a2a-go:** Opus residuals R1-R6 (child gate name used for verification, GO-per-session wording, reserved callers incl. a2a/aos_/system/master and a reserved system sender, full read-only validity check in --ref, pending claim before the await, stored original prompt) ([c1475f3](https://github.com/hybridlabor-api/aos/commit/c1475f3920bc0d8fd2ff0a07334725783d69a811))
* **a2a-mcp:** final Opus residuals (pulled-depth tracking never cleared by replies, send depth = max(env, pulled), card redirect refused, no spurious name warning, collision-free backups, atomic config writes) ([2fb8712](https://github.com/hybridlabor-api/aos/commit/2fb8712f8786b52a1d0f2ba8a25e3f4d05e1ded3))
* **a2a-mcp:** Opus security findings B1-B8 (depth limit in the MCP, installer never overwrites unparseable or foreign configs, uninstall removes AOS entries, fixed default peer names, loopback-only card fetch, no name arg on a2a_reply, no crash on non-object stdin) ([f9a9517](https://github.com/hybridlabor-api/aos/commit/f9a95175aaf9144820fddb9ae23a2fd2b230b61a))
* **a2a:** agy sidecar never uses --continue; Codex delivery always gives the absolute reply command ([c311da0](https://github.com/hybridlabor-api/aos/commit/c311da0fa81781c07c5afb0df4acd2c12ddb521c))
* **a2a:** claude inbox hook names the session in the reply command (--name &lt;session&gt;) ([180884a](https://github.com/hybridlabor-api/aos/commit/180884ab022325036a0c39149a04c7bd65b63be1))
* **a2a:** claude inbox hook uses replyCommand (absolute path when aos-a2a is not on PATH), keeps the stop_hook_active guard ([0d7d717](https://github.com/hybridlabor-api/aos/commit/0d7d71772438d454bbf827827dff6ea36df944b8))
* **a2a:** harden the intercom book (atomic writes, url hygiene, dead peers drop out, no chmod of user dirs) ([7c2dec0](https://github.com/hybridlabor-api/aos/commit/7c2dec0036cb957f2682a4a1b87431e1929759e9))
* **a2a:** hook allowlists, idempotent merge, uninstall, lib location, inbound text hardening ([f3f4c55](https://github.com/hybridlabor-api/aos/commit/f3f4c55866ce40b45e6de6b3d3b99962f416698d))
* **a2a:** keep OpenCode plugin default-export only, move A2A helpers to lib/a2a-oc.mjs ([8746389](https://github.com/hybridlabor-api/aos/commit/8746389804c5ea725418672fa35db30a268d65f2))
* **a2a:** live-e2e.sh agy --print, agy/codex timeouts, fresh claude window before sends, clearer codex failure ([a836661](https://github.com/hybridlabor-api/aos/commit/a8366616e37293d432367c5b4a9a2de8c5f6cc28))
* **a2a:** live-e2e.sh agy timeout default 900 s (a headless agy turn took 305 s) ([5c08ca9](https://github.com/hybridlabor-api/aos/commit/5c08ca9d72d675261e20f69867dfde04cf087f6c))
* **a2a:** live-e2e.sh bring-up (opencode serve + POST /session, busy claude turn window) ([b420dba](https://github.com/hybridlabor-api/aos/commit/b420dba06b365e529aba5e8d707c3970f188a47f))
* **a2a:** live-e2e.sh checks that the claude sidecar answers before every send to it (claude_ready) ([4b87039](https://github.com/hybridlabor-api/aos/commit/4b87039474f8a96aaecad5426f693596733960cc))
* **a2a:** live-e2e.sh item3 marker check, cleanup wait, claude window for ring pair ([e56fd53](https://github.com/hybridlabor-api/aos/commit/e56fd53b6f8a7a653812c03d11f3f48c45a4ae80))
* **a2a:** long sends poll GetTask instead of holding one blocking fetch (undici 300 s headers timeout) ([fb6c261](https://github.com/hybridlabor-api/aos/commit/fb6c261de28029bf6ac59a95667da0a438275754))
* **a2a:** reply instruction names the session (--name &lt;session&gt;) for Codex and agy ([9bf117a](https://github.com/hybridlabor-api/aos/commit/9bf117a698adfd16939b193cbc468295ba1ce187))
* **a2a:** reply instruction works without aos-a2a on PATH (absolute node form), shared replyCommand() ([6c38a36](https://github.com/hybridlabor-api/aos/commit/6c38a369d929fd741e9e0c984148999b6c8d522e))
* **a2a:** review round (path traversal in reply, inbound depth limit, name consistency, installer lib target, e2e script) ([2408353](https://github.com/hybridlabor-api/aos/commit/24083536e4bf1268abfc92363a5664ca36746163))
* **a2a:** S5-4 follow-up networkWrite on unquoted text, -K/--config, .exe heads ([3ed0670](https://github.com/hybridlabor-api/aos/commit/3ed067074168b241594dbadfd0d97313c34e59a6))
* **a2a:** S5-4 guard curl/wget/http network writes from worker shells ([0dccc5b](https://github.com/hybridlabor-api/aos/commit/0dccc5ba5bb94c53565293e2509e80568a401a82))
* **a2a:** S5-5 follow-up, codex queue pins --sandbox, resume puts -- before the prompt ([3feb907](https://github.com/hybridlabor-api/aos/commit/3feb90770ce8e292b2cbd7711874b1b039a17261))
* **a2a:** S5-5 run codex with an explicit sandbox and -- before the prompt ([5a6f36b](https://github.com/hybridlabor-api/aos/commit/5a6f36b08c2bc63cb2c1dca3678c2f1e27271463))
* **a2a:** serve falls back to a built-in live profile when none is configured ([51d3eb8](https://github.com/hybridlabor-api/aos/commit/51d3eb8e8f93bb92416076799b2ca52276a79bf9))
* **a2a:** standing rule for [a2a from X] messages in CLAUDE.md; e2e POST /session retry and diagnostics ([c5efca7](https://github.com/hybridlabor-api/aos/commit/c5efca7ecf28d6906e9c8a4aa1bd7f00bd727e40))
* **a2a:** start the sidecar with node, not with the host binary (OpenCode runs a compiled executable) ([a7a2a35](https://github.com/hybridlabor-api/aos/commit/a7a2a35cc4d652fea2b8ee2f96289746607aea23))
* **a2a:** stop hook hands over the message text and reply command; sidecar output goes to &lt;name&gt;.log ([e1223a9](https://github.com/hybridlabor-api/aos/commit/e1223a9e5ca58f51a3a2d85d385a7e6e56933764))
* **acp:** agy empty-answer failure message names the likely causes; record the second live check ([58397cf](https://github.com/hybridlabor-api/aos/commit/58397cf918c7e656ef18f738028be1cde6469cec))
* address ECC reviewer review findings ([215b816](https://github.com/hybridlabor-api/aos/commit/215b8164fa5ab76610d26da07278df884c0d0cd0))
* **agenttrail:** stop idle hub rebuilds and link live tasks to plan nodes ([747fe31](https://github.com/hybridlabor-api/aos/commit/747fe3127fa9813819da1607c188dc4abc162943))
* **agenttrail:** worktrees tests pass --plan after the v5 PLAN.md convention change ([d895ee0](https://github.com/hybridlabor-api/aos/commit/d895ee0c53771bb4aa5c695593d5538cad5fa1e2))
* annotation proxy headers, size-cap passthrough and tunnel test teardown ([5c54f20](https://github.com/hybridlabor-api/aos/commit/5c54f20d3569108c6409dfd40bc71f8df7d965f1))
* annotation proxy rewriteLocation, gzip-bomb and F6 tests (3 reds left) ([28bf3e0](https://github.com/hybridlabor-api/aos/commit/28bf3e059e6ad0f57a48f55cacd13f10b06948e7))
* annotation proxy security findings F1-F4 ([a58b7d0](https://github.com/hybridlabor-api/aos/commit/a58b7d0995049d9c97ba7a9606f7546ef8f9adce))
* **annotation:** a finished rebind no longer clears a newer pick handle ([9aa3705](https://github.com/hybridlabor-api/aos/commit/9aa3705efc43265c3372c901f7eb795b6a51a8df))
* **annotation:** proxy hardening rounds A+B (headersSent crash, content-length, chunked cap, HMR query rule, URL rules, encodings, IPv6 upstream, tests) - NOT Docker-tested ([5f759ce](https://github.com/hybridlabor-api/aos/commit/5f759ce0b0c058fb371c3ee60d4d41a3e774fd84))
* **annotation:** proxy LOW leftovers (token-path variants, case-insensitive query keys, protocol guard, keep-alive test, docs) ([81f290a](https://github.com/hybridlabor-api/aos/commit/81f290a2b7cd5c2f82148b75d11ee74ac2e9736e))
* **annotation:** round C - query-token refusal on /aos-api and /__aos_annot, abort-after-headers test and proxy listener - NOT Docker-tested ([3868d3c](https://github.com/hybridlabor-api/aos/commit/3868d3c6af4e9f0a7e02c09dd6a10e22870eb3d9))
* **annotation:** round D - chunked body on bodiless methods, [::1] dial, bare-path token rule, non-vacuous tests - NOT Docker-tested ([4d80e03](https://github.com/hybridlabor-api/aos/commit/4d80e03f6389f2b62325d3d04c18779b494eada5))
* **annotation:** round E lows - normalized token-path match, raw # refused, keep-alive/IPv6 test hygiene, docs - NOT Docker-tested ([e3ae178](https://github.com/hybridlabor-api/aos/commit/e3ae1787ff5d1e5a273a529be8e6b51ccb56b4bf))
* **annotation:** WP6 round F - observer ignores own mutations, destroy cleanup, cancellable pick, selector cap - NOT Docker-tested ([ace36cd](https://github.com/hybridlabor-api/aos/commit/ace36cd6a07ff5c85f0d4aae55c60dfed5bc0103))
* **annotation:** WP6 round G - pick ignores overlay clicks via composed path, selector cap at every site, per-panel pick, rebind catch, connectorPath test expectation - NOT Docker-tested ([0f11a62](https://github.com/hybridlabor-api/aos/commit/0f11a62496912bd4faf69eaf6ef6e4e478591244))
* **aos-sessions:** carry the package version in the plugin manifest and marketplace entry ([2b5516e](https://github.com/hybridlabor-api/aos/commit/2b5516e7613fa8f75562749d738bd89176a4002f))
* **codex:** startcycle-dispatch no longer prints agy's injectSteps under Codex and Claude ([6b3879d](https://github.com/hybridlabor-api/aos/commit/6b3879d19edbc1bd6d9e1528f953c62f19932455))
* **codex:** write hooks only to config.toml, migrate hooks.json with a backup, doctor notes the one-time /hooks trust ([c85a3d3](https://github.com/hybridlabor-api/aos/commit/c85a3d35ab9f89fb1fe38554582db7e94ad2967b))
* **commands:** hub restart in the plugin-commands source and generated copies; S5-3 tests find Git for Windows sh ([6f47cab](https://github.com/hybridlabor-api/aos/commit/6f47cab2f538e9428590371bc56f0902a6fab61a))
* **doctor:** AO revision check compares backend/ only; the gateway entry aos counts as lean in OpenCode ([e0e22b6](https://github.com/hybridlabor-api/aos/commit/e0e22b62778908bcb9adf605fc1ff60ede269bf9))
* **doctor:** the agy worker-home check only reads; the first agy worker start builds the home ([db1b7e2](https://github.com/hybridlabor-api/aos/commit/db1b7e251bdd9b4058f83ffe3c0420f969de8892))
* **fleet-mod:** put the blocked-command age on its own line ([ffcdbe7](https://github.com/hybridlabor-api/aos/commit/ffcdbe7f9f0762bac847e18f0d402c57fcdd827f))
* **gate:** a command-position dollar head followed by another dollar word is unscoped ([88e926f](https://github.com/hybridlabor-api/aos/commit/88e926f4077df199c9da3ff4024ef24ab7807671))
* **gate:** a container-test docker run keeps container scripts out of the host delete analysis ([7f5091a](https://github.com/hybridlabor-api/aos/commit/7f5091a1534aad73e2fa24943006779c9f7de0c2))
* **gate:** a git subcommand assembled from a variable is unscoped ([0117c3c](https://github.com/hybridlabor-api/aos/commit/0117c3cdf451d4a12c503fda9c03b601e493c509))
* **gate:** a wrapper keeps command position through its option and argument words ([8b28751](https://github.com/hybridlabor-api/aos/commit/8b28751d5d7db4a0dfcf80eb40e6381c7d892b8f))
* **gate:** all wrappers start a command position for the $-head rule ([621b178](https://github.com/hybridlabor-api/aos/commit/621b178c6296282d7e49694041b431fb7ff81bf7))
* **gate:** ampgradient repair order for the F10 catchAll rewrite decisions ([715ff28](https://github.com/hybridlabor-api/aos/commit/715ff2899d21d6880fa40b246d9b7521f13b6c29))
* **gate:** close the input regressions from the catchAll rewrite ([f712a66](https://github.com/hybridlabor-api/aos/commit/f712a662f20fd7275fc97819d2618de84e818480))
* **gate:** cooldown only under strict, node --check is a parse, $PWD docker mount resolves; R1 test drift ([b779637](https://github.com/hybridlabor-api/aos/commit/b779637f1997a1c86e97e5b793bbb7aa5aa4fc7c))
* **gate:** docker --entrypoint fails closed and git images guard like the entry program ([684f333](https://github.com/hybridlabor-api/aos/commit/684f33385fb3f23716a21f5e7a64008652f449b3))
* **gate:** docker -e/--env only as KEY=literal ([9bc909c](https://github.com/hybridlabor-api/aos/commit/9bc909c7235bb9f0fd3af9960d585c6ca31c824e))
* **gate:** docker subcommands other than run are read through catchAll ([99bfe54](https://github.com/hybridlabor-api/aos/commit/99bfe546f316632212033b0d09deb3069d3c63fc))
* **gate:** dollar-assembled verbs in opaque text fail closed ([6a24c46](https://github.com/hybridlabor-api/aos/commit/6a24c46948d3a718f8a29bca198f89a2ed9ccbd1))
* **gate:** EXTRA close store read bypasses (git grep -O, file -C, env prefixes, ugrep options) ([bd4b8e7](https://github.com/hybridlabor-api/aos/commit/bd4b8e7f038bd9fd780bb99d35b16a81116cb3d8))
* **gate:** EXTRA narrow GO/grant store write detection to real writes (FP log rows 16-19) ([43aff92](https://github.com/hybridlabor-api/aos/commit/43aff929aa4ce2ed6545a1aa9201c14b50203ad4))
* **gate:** harden container-test, aos-a2a data arguments, workspace scope and commit-bypass detection ([6407e81](https://github.com/hybridlabor-api/aos/commit/6407e81935119559b993107facaef10235d4b073))
* **gate:** opaque -c/eval bodies fail closed for $-assembled verbs ([0de6bdb](https://github.com/hybridlabor-api/aos/commit/0de6bdba011cff6fb35a1519426d98a9f188a0d7))
* **gate:** opaque bodies are split statement-wise with scanSplit and stripPrefix ([5703c77](https://github.com/hybridlabor-api/aos/commit/5703c77ea2d108007480a23cdd7f9094551d0f66))
* **gate:** read the first token after -c as the opaque shell body ([4c8a613](https://github.com/hybridlabor-api/aos/commit/4c8a613257d4e6e41da2369dfcc445fbec660062))
* **gate:** read-only docker exception refuses broad mounts and pre-image expansions; deny log masks credentials (review 23, 24, 26) ([039f280](https://github.com/hybridlabor-api/aos/commit/039f280c93ed0357b6e6bbfe4686915fa5ce6a77))
* **gate:** read-only docker mounts are an allow-list (project dir inside home, realpath, no dot segments); deny log masks bearer, flag, URL and prefixed tokens (re-review 1, 2, 4) ([b19d7ab](https://github.com/hybridlabor-api/aos/commit/b19d7abeb8c2a5244e4296f2c714d7a67f823bef))
* **gate:** read-only docker mounts no longer skip the in-container check ([dc50517](https://github.com/hybridlabor-api/aos/commit/dc5051753f5b42eab1389a164125887a96d476b1))
* **gate:** restore the old xargs flag-row decision and a cleaner GO message ([429c30c](https://github.com/hybridlabor-api/aos/commit/429c30ce165a506a1000d95ab4a84caaac114851))
* **gate:** rule 16 keeps an all-ro run free without --rm after the container scan ([8a2e839](https://github.com/hybridlabor-api/aos/commit/8a2e839a2a78b7dd3d551b02e790637809cc5687))
* **gate:** rule 16 rejects bare environment names exactly like the scope parser ([c4939ae](https://github.com/hybridlabor-api/aos/commit/c4939ae1ebad1d6c9ff1febbe0bc8c8db10050e0))
* **gate:** S5-1 trust installed scripts by ctime, not backdatable mtime ([9624aa7](https://github.com/hybridlabor-api/aos/commit/9624aa7206c952f9c0551327f77e4fd8979db220))
* **gate:** S5-2 raise analysis budget default to 500 ms on win32 ([8ff486d](https://github.com/hybridlabor-api/aos/commit/8ff486d6bcb3b721054e94d38a199293b41a4eec))
* **gate:** S5-3 wrap the gate hook command so a failure blocks ([717c435](https://github.com/hybridlabor-api/aos/commit/717c4352581a87403dc674c60ee2af008fff36ce))
* **gate:** setsid, flock and ionice wrap the command behind their arguments ([dd96973](https://github.com/hybridlabor-api/aos/commit/dd9697336f6547e2671afecb776e575089c3dc27))
* **gate:** skip shell option values when looking for the script file ([04b2960](https://github.com/hybridlabor-api/aos/commit/04b296046aa5211eaa81911a3197663f7dc74894))
* **gate:** split the xargs fallback between empty rows and flag-only rows ([6ae7946](https://github.com/hybridlabor-api/aos/commit/6ae79467330f0c4208e8f5c6b48e876efff0a7d4))
* **gate:** the analysis budget counts CPU time, not the wall clock ([f371807](https://github.com/hybridlabor-api/aos/commit/f3718071d9cdedc2e3cf9e764a5ccd65aaa07fd6))
* **gate:** the dollar-word guarded-noun rule fires only in opaque text or command positions ([ce181ee](https://github.com/hybridlabor-api/aos/commit/ce181ee0debbf8b6b460f71e3a8a044d6bce748e))
* **gate:** the go-gate works on Windows ([1a0083c](https://github.com/hybridlabor-api/aos/commit/1a0083c440ac202d628902b3930633d5e9efc589))
* **gate:** the quoted message of aos-a2a send/reply is data, not command text ([2c5f0e7](https://github.com/hybridlabor-api/aos/commit/2c5f0e72c6afe1da08a6bd598759d40f2cb71257))
* **gate:** the shell option scan runs all options until -c, skipping their values ([aef7012](https://github.com/hybridlabor-api/aos/commit/aef7012001cf438c3fe3b90e7dc842e80fcd4b0b))
* **gate:** V13 Highs - $PWD mount only without cd, node preloads are read ([c9788c1](https://github.com/hybridlabor-api/aos/commit/c9788c1aaca39deaf41c226c544b02b1205af754))
* **gate:** visible recursive rm flags of an xargs row are judged as before ([b656106](https://github.com/hybridlabor-api/aos/commit/b6561060c9da9b1d8f281ea5bdbc90279f9267be))
* **gateway:** build upstreams from the picked MCP set ([b88716e](https://github.com/hybridlabor-api/aos/commit/b88716e915e86a359c2730c2bb281277703b3d89))
* **gateway:** darwin-only default install, regenerate mcp.json after adopt, surface gateway log + verify in update step ([5295fe0](https://github.com/hybridlabor-api/aos/commit/5295fe070543c2876237fe0eafe72aff02dc43ff))
* **gateway:** direct duplicates removed per project and restored where they were ([f59b9b1](https://github.com/hybridlabor-api/aos/commit/f59b9b11ae30e0bd2b7b0c0b7cbc2b219298aa0a))
* **gateway:** dry-run and real path share the preset plan; preset-failure test records calls ([a700fe2](https://github.com/hybridlabor-api/aos/commit/a700fe2d68bf103fe9f782471662ec8b5206cbed))
* **gateway:** enable passes presets, unverified service on linux/win is a warning, adopt gated on verify ([e86e1b8](https://github.com/hybridlabor-api/aos/commit/e86e1b8102ad78fc577e6a5ed428c582f33a531d))
* **gateway:** F11 old grandma3 entry counts as AOS-owned, F12 no stale optional line ([c5c765f](https://github.com/hybridlabor-api/aos/commit/c5c765fe12eeea00c985efd0035130f8582b29af))
* **gateway:** F13 refresh on every update, F14 busy 1mcp is not down ([0b16b98](https://github.com/hybridlabor-api/aos/commit/0b16b987d77fe62a6a04c780e9f225ce11d21bbb))
* **gateway:** F15 wait for 1mcp init before switching harnesses on update ([1e16df9](https://github.com/hybridlabor-api/aos/commit/1e16df93cedde2595e126d91620b227190009e37))
* **gateway:** F15b restart grace window, switch harnesses on forwarder up ([512e010](https://github.com/hybridlabor-api/aos/commit/512e0103dbcc22cffa6e1ed78b76f988f7c76c88))
* **gateway:** per-target duplicate guard, Codex direct tables, templates in ~/.agents ([72fc449](https://github.com/hybridlabor-api/aos/commit/72fc449e8ae51eb66a376f3cf0660736e97be156))
* **gateway:** preset-failure test matches args[0], systemd append paths unquoted ([62e4f67](https://github.com/hybridlabor-api/aos/commit/62e4f67d6665dace7ec0b1a1d19066399bb5982b))
* **gateway:** presets only for exclusion kinds and only when created, adopted upstreams tagged, installer strips template presets, service fixes (win /End, linux quoting, daemon-reload), content-based test matching ([8416065](https://github.com/hybridlabor-api/aos/commit/8416065962405c5831b3be2b54062318c6198036))
* **gateway:** reap own orphaned 1mcp, roll back migration record on failed write, node-path doctor hint ([16b6ff7](https://github.com/hybridlabor-api/aos/commit/16b6ff7d639375eea1d239b1d7ee89373c40f7d4))
* **gateway:** round-2 follow-ups: darwin-only harness switch, step logs, platform-2 test ([4127611](https://github.com/hybridlabor-api/aos/commit/412761104da4f28a46d1467ac289856d6d3e2173))
* **gateway:** S2-1, S2-5, S2-6, S2-7, S2-8 review fixes; S2-9 documented ([90967e1](https://github.com/hybridlabor-api/aos/commit/90967e17ad40f95ce6052f25d138529f9f0d141f))
* **gateway:** tag every upstream aos+name, exclusion presets use 'aos AND NOT ...' (1mcp rejects standalone NOT) ([b6d9e5c](https://github.com/hybridlabor-api/aos/commit/b6d9e5c04e652a74cd92a6c33fd53030b276dd2d))
* **gate:** work profile treats unreadable commands by indirection, shared profileAllows, OpenCode honours profiles (Opus H1/H3) ([b8feeef](https://github.com/hybridlabor-api/aos/commit/b8feeefb18310d19d2f4772e2955d7d9e293dd87))
* **gate:** xargs with a guarded program and no visible arguments is unscoped ([2968300](https://github.com/hybridlabor-api/aos/commit/2968300ae55066b1208fc30f88aa63fe2f7f4baa))
* **go-check:** regenerate guarded-patterns.json from GUARDED_PATTERNS ([ff04eca](https://github.com/hybridlabor-api/aos/commit/ff04ecad5b34cc87d18ea2eea8362c2ffeccf3f4))
* **go-gate:** bounded hub log reads, hide revoke and credential files from state keys (WP-8d) ([133f50a](https://github.com/hybridlabor-api/aos/commit/133f50acd8a49ecdf528955cd20cadfd52d31736))
* **go-gate:** close computed-head, brace, glob and package-manager bypasses (rechecks 5-10) ([94f3b43](https://github.com/hybridlabor-api/aos/commit/94f3b4337acc12d8a117706d83b47a5b5402de41))
* **go-gate:** planted FIFO, device or huge files on the decision path can no longer hang the hook ([c9e013b](https://github.com/hybridlabor-api/aos/commit/c9e013bfc99c2515e472c1dc2f8a4f3283b55968))
* **golive:** keep the vendored bundle verifiable ([0575037](https://github.com/hybridlabor-api/aos/commit/0575037fdfbb6bc2fe2e9345743ecabb6124f3cd))
* **grandma3:** GM-2/3/4 (stop label after failed patch, docstrings, trimmed names, import from any cwd) ([c51cac1](https://github.com/hybridlabor-api/aos/commit/c51cac119d3b02c18f4d6cbdb8cd9933e75eff31))
* harden store install rollback, redaction, service control and download limits ([5d81ebb](https://github.com/hybridlabor-api/aos/commit/5d81ebbb9a0ef2b6a2b8037062f6a5d323d95423))
* **hooks:** protect the go-gate store from all file tools, uncapped and symlink-aware (wp9b) ([c33d5d0](https://github.com/hybridlabor-api/aos/commit/c33d5d0e865bfc4c10d3e5efba084fb242a9f4aa))
* **hooks:** S5-8 follow-up trail-relay hook 3 s, 1.5 s safety exit, 500 ms fetch cap ([7d5fc31](https://github.com/hybridlabor-api/aos/commit/7d5fc31b16b2fe08b090f8da929e2789bc732bca))
* **hooks:** S5-8 give trail-relay hooks 5 s and keep its own caps below that ([6121f7c](https://github.com/hybridlabor-api/aos/commit/6121f7ccffed15aed4320083dcffe24e0f67a82f))
* **hub:** a crashed gateway is visible to the watcher; Docker findings on d7abce62 ([8ea1ee7](https://github.com/hybridlabor-api/aos/commit/8ea1ee71f6f18de02cd9a4498ec49e919f1993ae))
* **hub:** on Windows the hub task keeps a watchdog that respawns a crashed hub ([3995037](https://github.com/hybridlabor-api/aos/commit/399503714baf8412b68fad1632452d997b5984a1))
* **hub:** S3-2 walk lib/hub subdirectories in the stale-code stamp ([9db6f48](https://github.com/hybridlabor-api/aos/commit/9db6f485ef633d09c5d6e50c16f47e2f8ff8cd6d))
* **hub:** S3-4 do not respawn the hub after a deliberate stop ([40a62e8](https://github.com/hybridlabor-api/aos/commit/40a62e81ef7bb68933d05f5390b82fba603ec775))
* **hub:** S3-5 add the restart verb (stop, wait for the port, start) ([85a8482](https://github.com/hybridlabor-api/aos/commit/85a84824cfd221e24179cbc16a1329ccaf2a5be3))
* **hub:** S3-9 resolve argv[1] symlinks for the main-script check ([d9b0ede](https://github.com/hybridlabor-api/aos/commit/d9b0ede250285e952f892da092e2cc7431a98a8c))
* **hub:** security review fixes (real spawn runner, atomic backup reservation, hardened rollback, redaction, launchd edge cases, scoped overrides) ([0812c39](https://github.com/hybridlabor-api/aos/commit/0812c3993fabd5dd1be0d94673f725e4779ff5c9))
* **hub:** the service runs the hub in-process; Windows uninstall stops it ([522fb14](https://github.com/hybridlabor-api/aos/commit/522fb14e896681afe0afa7579f388443395d0f41))
* **installer-v5:** harden fleet step and aos-gogate after review ([b9842a8](https://github.com/hybridlabor-api/aos/commit/b9842a875e91b61a129fdea0c072b90a0827b7f2))
* **installer-v5:** harness/kernel/adapter failures fail the step, steps never prompt (review A1, A2, B11) ([b92c8d4](https://github.com/hybridlabor-api/aos/commit/b92c8d4ee7570cbe2232b8a4677e7636752316e6))
* **installer-v5:** install options review repair (S1-S6, R1-R4, P1-P3) ([4b19c0a](https://github.com/hybridlabor-api/aos/commit/4b19c0a9ac0f9b9d10000ca75158fc1988e62bda))
* **installer-v5:** launchctl text parse, memB dep repair, generic repair retry, token-saver detect (review A3, A4, A5, A6) ([d900a8f](https://github.com/hybridlabor-api/aos/commit/d900a8f63607acab40a707c8f5a074f3bad39090))
* **installer-v5:** repair round 2 (R5, R7-R11, R13, R14) ([6c2a486](https://github.com/hybridlabor-api/aos/commit/6c2a4866206ff0d31ca98e19f03c0aa03a0330b4))
* **installer-v5:** stale-kernel notice, unknown versions, OpenWiki key flow, refused secrets, Ollama no key, behavioural tests (review A7, A8, B12, C14, C17, T28-T30) ([65ddba9](https://github.com/hybridlabor-api/aos/commit/65ddba90ef2dbdc5e7261d31cbdcdfaf3b62f039))
* **installer:** a skipped Codenotch step (null result, e.g. dry-run) no longer stops the installer ([3ef1b3f](https://github.com/hybridlabor-api/aos/commit/3ef1b3f089e6f6080f44463b79b599c59ce833d3))
* **installer:** aos-bus import from installed copy, direct UXP fixed port 8080, hardware MCP ownership check, A2A deps from the package dir ([2a090bc](https://github.com/hybridlabor-api/aos/commit/2a090bc2280bbda1b39f2b8ce9a416f0f0ace118))
* **installer:** install a2a-permissions.mjs next to the installed aos-acp ([4febb04](https://github.com/hybridlabor-api/aos/commit/4febb041ad37195e48755403244a295e8871bbf7))
* **installer:** installGoCheck also copies gate-profile.mjs next to go-gate ([d8e73df](https://github.com/hybridlabor-api/aos/commit/d8e73dfb49f07a81a9b279c4e39e6dafee0aff93))
* **installer:** installRustauri iterates destination objects, not paths ([fd64587](https://github.com/hybridlabor-api/aos/commit/fd64587ace301c94f047945e94820a82b4a81206))
* **installer:** memB verify and repair cover the WebUI venv deps ([3f87491](https://github.com/hybridlabor-api/aos/commit/3f87491a6d58757578261a4653329a5d3340def5))
* **installer:** preserved .env, data, logs and .venv survive a failed module swap ([3ccf447](https://github.com/hybridlabor-api/aos/commit/3ccf4472e82d89a40d03a23c0e1826194ef4d37c))
* **installer:** S1-2 move retired legacy skill dir aside instead of rmSync ([c1455a7](https://github.com/hybridlabor-api/aos/commit/c1455a75b6259ee4b4fc6a047d9f0656d3a30010))
* **installer:** S1-4 report failed modules and set exit code ([dddde4b](https://github.com/hybridlabor-api/aos/commit/dddde4b47df5c940e4f37bf4de8a73ea3a77f76a))
* **installer:** S1-5 back up real files before replacing them with symlinks ([40ee8b4](https://github.com/hybridlabor-api/aos/commit/40ee8b43a60c0443bfc487206cf9eccbbc168a62))
* **installer:** settings.json backups are pruned again shortly after a boot ([ff7d4d5](https://github.com/hybridlabor-api/aos/commit/ff7d4d56cd85af40b95ff1c6d6267b4b8013f3da))
* **installer:** ship aos-gate launcher and resolvable gate-profile copy ([98cee87](https://github.com/hybridlabor-api/aos/commit/98cee87eaf75302499531c154af932816bd03ea4))
* **installer:** shipped-hashes cover every root the install manifest tracks ([270b5fd](https://github.com/hybridlabor-api/aos/commit/270b5fdfb84ccfb096707531fae53852f0957401))
* **installer:** V12 blockers F5, F6, F8, F9, F10 ([e62dbee](https://github.com/hybridlabor-api/aos/commit/e62dbee9d9450728b026e5bcacf20a198913053a))
* **installer:** venv --clear, synapse/openwiki --help probes, update summary ([faf550a](https://github.com/hybridlabor-api/aos/commit/faf550afa8f99b18cb3a07f2dc3f24316e3eaf72))
* **installer:** write agents where OpenCode and agy load them ([60c9e4d](https://github.com/hybridlabor-api/aos/commit/60c9e4dca9a19aef2f0ff23d46efc259f28d0914))
* **instinct:** attribution lines in all four skills, registration order assertion ([95402a8](https://github.com/hybridlabor-api/aos/commit/95402a8b006bc0ebd73ec616e110feaf5b8c5596))
* **instinct:** export bounds and JWT/xox secret shapes from the PO re-review ([b0fb721](https://github.com/hybridlabor-api/aos/commit/b0fb7218b30c9a2692115daf0d16d3ba14e14100))
* **marketplace:** fleet entry follows the bdb-aos version after the 4.19.0 merge ([662ca51](https://github.com/hybridlabor-api/aos/commit/662ca51590c049f4707b2513f4fe48e75b302ae4))
* **mcp:** keep pick candidates out of mcp_config.json (mcp_picks.json), full commit pin, shippedAll for ownership, never pick an undefined candidate ([bda25fb](https://github.com/hybridlabor-api/aos/commit/bda25fb0a0dd5f4d10f32290c05c64bede922c93))
* **mcp:** review fixes AD-1 AD-4 AE-2 AE-3 (all-or-nothing adopt per name, token-like args, Node &gt;= 24 preflight, AE legacy entry opt-in) ([6052c70](https://github.com/hybridlabor-api/aos/commit/6052c70380674ab70b74bf3d7ea74e1d55ac4cad))
* **mcsc:** codex adapter no longer calls stdin.end() on an ignored stdin ([85ea0ee](https://github.com/hybridlabor-api/aos/commit/85ea0ee6301c5a750e75b65f028304e8208c47b2))
* **opencode-verify:** include the hub command ([547412b](https://github.com/hybridlabor-api/aos/commit/547412bdbcf30c37614fb206cbdd1a26b28b9298))
* **package:** restore repository.type, the roo test already runs from the test script ([6951b35](https://github.com/hybridlabor-api/aos/commit/6951b3558edae8d7370d677ef791a1f7316b8df6))
* **package:** S8-6 exclude .env files from the npm payload ([e4d9ffb](https://github.com/hybridlabor-api/aos/commit/e4d9ffb83533e59ebb6c78a3978bbb7b634e4f98))
* **package:** S8-6 exclude only local secret env files; keep tracked .env.example and runtime .env.production ([eb030ba](https://github.com/hybridlabor-api/aos/commit/eb030baf9af819d199e21471c52e50843dd14777))
* **package:** ship agy-hooks/ and .cursor/ in the npm tarball ([3e13a7f](https://github.com/hybridlabor-api/aos/commit/3e13a7f3720b73135729526f235ba74c856ac584))
* **packages:** Remote verify runs the module's bin/cli.js instead of a nonexistent remote binary ([8bf0a64](https://github.com/hybridlabor-api/aos/commit/8bf0a641ebac8872953d25281e9d61f9c31b51c3))
* **packages:** Token Saver update check uses the scoped npm name ([738aeb2](https://github.com/hybridlabor-api/aos/commit/738aeb20760b77b2aae9c101f99f9a149e9e8cec))
* **plan-canvas:** on Windows the Startup bat restarts a crashed or updated canvas ([6d73532](https://github.com/hybridlabor-api/aos/commit/6d73532a0c82abf6599d76ac81686caefdc280b3))
* **plugin:** drop author e-mail from plugin manifests and generator ([391625f](https://github.com/hybridlabor-api/aos/commit/391625f951b737c2ef890cb1138f924d74091716))
* **r8:** 2b Opus review F1-F5,F7,F8 (profile load after flag parse, PROFILE_SCHEMA, name check, replace/add revalidation, test paths) ([dc13c14](https://github.com/hybridlabor-api/aos/commit/dc13c1450b71995b0e414f63d8a8e55fa29ee207))
* **r8:** apply Opus review findings F1-F13 to step 2a (glm-free worker, unverified: needs Docker run) ([bacab5e](https://github.com/hybridlabor-api/aos/commit/bacab5e5a9cf8f628e9dbed3dc61829ac19919c7))
* **r8:** Architect and TechLead know the profile domain, Architect can skip optional profile nodes (F9, N3) ([3c0b530](https://github.com/hybridlabor-api/aos/commit/3c0b530c9b6c96206bdd775fd57107a3c033a443))
* **r8:** dispatcher hardcodes no model (load-profile uses modelOpt, drop 'sonnet' default for profile add nodes) ([49254b8](https://github.com/hybridlabor-api/aos/commit/49254b84638b057a9d5e3d57cb25bc07da34011b))
* **r8:** duplicate --profile escalates (N4), Shipping prompt is profile-neutral in profile runs (F11) ([e647791](https://github.com/hybridlabor-api/aos/commit/e647791e74e695b6a8d86b3e76d6f337ca6253bd))
* **r8:** kebab-case gate key and trigger rejected by validator in Docker ([c23a16f](https://github.com/hybridlabor-api/aos/commit/c23a16ffb8252baf651baacd5429b0b5e0f4521f))
* **r8:** Opus pass 2 - graph.md status (F12), Shipping replaces state.gate with exact keys (N1), add-entry id/agentType/writes checks (N2) ([139190e](https://github.com/hybridlabor-api/aos/commit/139190e418410c0b07d9619207c3313e6332cf24))
* **r8:** Opus recheck N1-N8 (export registryNodeIds, CI validator step, state-file artifact paths, wording) ([9843412](https://github.com/hybridlabor-api/aos/commit/98434124e7b7fed161fa8200c18073de62f9fc4a))
* **release:** publish prereleases to their dist-tag with tags fetched; hub survives a missing openwiki ([82a209a](https://github.com/hybridlabor-api/aos/commit/82a209a1e806a31730d1b5ca85fdf2bdba2cb259))
* **release:** S8-1 configure release-please for 5.0.0 beta prereleases ([40da5ae](https://github.com/hybridlabor-api/aos/commit/40da5ae181c38410adbcbe29b1d71640de0c1af1))
* **release:** S8-4 bump fleet, sessions and alert plugin versions ([441a8ba](https://github.com/hybridlabor-api/aos/commit/441a8baf3fcf72b65006cc085169dbbe0561cbd5))
* repair memb venv deps, sync hardware MCP venvs and gate kicad/openscad on app presence ([1fd3036](https://github.com/hybridlabor-api/aos/commit/1fd3036622cd1fc68249d88e1e4cf8b01998920f))
* **services:** no server keeps serving old code after aos update ([#26](https://github.com/hybridlabor-api/aos/issues/26) W6) ([5d87183](https://github.com/hybridlabor-api/aos/commit/5d8718393d9129375e33803a12e2b47abaeaf482))
* **skills:** factory skills review fixes (GO gating on every write step, report-only watchdog/recover, doc link, notices) ([15b2cc3](https://github.com/hybridlabor-api/aos/commit/15b2cc3f2f5d1dbf9bc4fd12f4dc892abf8faf9f))
* **skills:** godmode-3d-creation back to the CLI-first version ([b1a4c83](https://github.com/hybridlabor-api/aos/commit/b1a4c83b372e9b3e38ed9a38decfba14c0cac36b))
* **skills:** godmode-media-creation without phantom MCP refs (CLI-first), onetake routing and licence note, optional auto-editor step, Strix gate note (Batch B: B1 B2 B3 B5) ([f378e79](https://github.com/hybridlabor-api/aos/commit/f378e799446b17d9114136bd1a4079f375975e3d))
* **skills:** no BDB branding in skills; a project's brand comes from its own tokens ([3a61ca4](https://github.com/hybridlabor-api/aos/commit/3a61ca4b9f2bd1d619e994857e2ee6f197e362d7))
* **skills:** rename code-review to two-axis-code-review and justify tdd/diagnosing-bugs overlap ([653e807](https://github.com/hybridlabor-api/aos/commit/653e807915f5a475889d46c474422ea4ee716c31))
* **tests:** Lenovo findings on 25c9b6e3 (Windows paths and test HOME) ([1f5f378](https://github.com/hybridlabor-api/aos/commit/1f5f378ec72f4066d5ce64fd40cd8775c8a0bf2c))
* **tests:** three red files from Docker 64a8d219 ([8019337](https://github.com/hybridlabor-api/aos/commit/80193373dc16233aa1c634e3e2b23716d60f3b22))
* **token-saver:** never compress piped, redirected or curl output ([c9579f0](https://github.com/hybridlabor-api/aos/commit/c9579f0fb6c967a49f57edee2cea494c19e7fc62))
* **token-saver:** unique BDB processor priorities, update processor count test (36 -&gt; 42) ([0a14c42](https://github.com/hybridlabor-api/aos/commit/0a14c42e1aa75d98a2f9c974e14074c63021c4f0))
* **uninstall:** remove the Windows Startup vbs/bat services ([fa76343](https://github.com/hybridlabor-api/aos/commit/fa763436b344a787c8732eecd3c1bfcdc3ff6ff1))
* **uninstall:** S1-7 remove module folders only when the install recorded them ([122caca](https://github.com/hybridlabor-api/aos/commit/122caca41f85ce352c14e22c005a450b574bb4a0))
* **uninstall:** S1-8 uninstall deja-vu and its MCP entry only when AOS installed it ([fa910ff](https://github.com/hybridlabor-api/aos/commit/fa910ff4e111f8093fa9bf24342da90dfcf95d60))
* **v12-a14b:** explicit AOS_HOME is authoritative; challenger2 projectLocal stub ([2adfd21](https://github.com/hybridlabor-api/aos/commit/2adfd2116e2374887c25e4abec269d02ab3e0a24))
* **v12-a14:** pre-existing test failures fixed at the root cause ([ac49c73](https://github.com/hybridlabor-api/aos/commit/ac49c73959a701038ac67515c31ad9062e857fcd))
* **v12-a:** A5 spawn SDK via a2aImport, A7 doctor names foreign Codex duplicates ([94aa9fe](https://github.com/hybridlabor-api/aos/commit/94aa9fe5392a68af1b4e2b6ea5adc4962bbdda92))
* **v5:** S7-4 record and uninstall Rust + Tauri skills and tauri-pilot CLI ([d905941](https://github.com/hybridlabor-api/aos/commit/d905941a70816cbd5509b7d41cc2339329cef5a2))
* **validate:** selftest anti-example fence matches the opening-fence rule ([b752be4](https://github.com/hybridlabor-api/aos/commit/b752be4eb9459423bd1f5e2fe3e0e0c2764dc018))
* **windows:** aos-acp waits for in-flight trail posts before taskkill; Lenovo round 6 test portability ([ddffb14](https://github.com/hybridlabor-api/aos/commit/ddffb1446588ca2d5f0c6633a71cc9c805d9324c))
* **windows:** doctor and agenttrail ensure resolve their own paths with fileURLToPath ([d6990e1](https://github.com/hybridlabor-api/aos/commit/d6990e13aaedb35d41f51e24c0a393a568133ac0))
* **windows:** gate resolves $PWD for a native cwd; agenttrail tests stop their hubs ([1ea07b2](https://github.com/hybridlabor-api/aos/commit/1ea07b2709cd30b3963e824b804bbfdae1421b9e))
* **windows:** Lenovo round 5 fixes (agenttrail exit wait, acp tree kill, a2a start-time cache, gate symlink refusal, test portability) ([f15fb07](https://github.com/hybridlabor-api/aos/commit/f15fb07b6a6e40372ea1a9235cbfce1c6d6e30d8))
* **windows:** non-gate fixes from the Lenovo round 3 (Part C) ([64a8d21](https://github.com/hybridlabor-api/aos/commit/64a8d219e6bda11c4fbeb647050eb310b1cc8735))


### Miscellaneous Chores

* release 5.0.0-beta.1 ([d9c1a7f](https://github.com/hybridlabor-api/aos/commit/d9c1a7fda6b38b5e6012d294953e6c0655cbc182))

## [4.19.0](https://github.com/hybridlabor-api/aos/compare/v4.18.1...v4.19.0) (2026-10-06)


### Features

* **agy:** install the bdb-aos plugin through the agy CLI with a flat staged skills dir ([cc6ad8d](https://github.com/hybridlabor-api/aos/commit/cc6ad8d46c85cdd30649e6318a2bc4eb95d8c1a2))
* **codenotch:** show how to start the app after install ([32530b5](https://github.com/hybridlabor-api/aos/commit/32530b5e0f44772ac25cd5af1ed765523ec65625))
* **codex:** install the bdb-aos Codex plugin through the codex CLI ([6e29a4d](https://github.com/hybridlabor-api/aos/commit/6e29a4d201bb9872d34a38e6657a2a694c32b78e))
* **doctor:** check agy hooks format and bdb-aos plugin registration per harness ([195052e](https://github.com/hybridlabor-api/aos/commit/195052e58c413502e8a754089473fe5e1523f80c))
* **doctor:** verify OpenCode plugin, commands, aos-acp and go-check ([86b24ea](https://github.com/hybridlabor-api/aos/commit/86b24ea845b94ee4be9ce032e52b34c77d5b6842))
* **gate:** classify recursive deletes in any language and hard-block home deletes ([687b27e](https://github.com/hybridlabor-api/aos/commit/687b27e072633cad607ff50367650b983d167959))
* **installer:** run the agy plugin step and undo it in aos-uninstall ([013fa9f](https://github.com/hybridlabor-api/aos/commit/013fa9fdb32f1d38860797644e0b2233134de717))
* **installer:** wire Codex plugin install, uninstall and docs ([e9094ba](https://github.com/hybridlabor-api/aos/commit/e9094ba71b1bb7108d43a4e32e8614ef29a5625e))
* **plugins:** add cli-spawn resolver and cmd.exe-safe runner ([e63d773](https://github.com/hybridlabor-api/aos/commit/e63d773397c68c819535dd419877806550c36408))
* **rules:** add managed Destructive Actions block to every instruction template ([5705490](https://github.com/hybridlabor-api/aos/commit/570549061a736c67c607cf422231582fd27494a6))


### Bug Fixes

* **acp:** pin the claude and codex ACP adapters to exact versions ([7585e32](https://github.com/hybridlabor-api/aos/commit/7585e32b3ec7bd769d9035842406bfd456fca683))
* **acp:** resolve go-gate and trail from the installed layout, --help exits 0 ([f35a72f](https://github.com/hybridlabor-api/aos/commit/f35a72f8213560401b4807de9aa8377f3bbb88ec))
* **agents:** Codex agent files in Codex format without a fixed model; OpenCode inherits ([e2522a4](https://github.com/hybridlabor-api/aos/commit/e2522a4ca96d77b9a39745f6116ed114271908d4))
* **agy-hooks:** write one named hook per concern, migrate the legacy hooks lump, write through symlinks ([d481b0e](https://github.com/hybridlabor-api/aos/commit/d481b0ef3b03b3315cd4481cb35eff4c3b7b86bb))
* AOS 4.18.2 installer fixes, go-gate delete guard and pinned MCPs ([156726f](https://github.com/hybridlabor-api/aos/commit/156726fe08ca3c1dc2b24404dc499367629ed83e))
* **codenotch:** single friendly line when no release exists yet ([42ea456](https://github.com/hybridlabor-api/aos/commit/42ea4565c52ca155b1f9daba395a43cf910bcd90))
* **codex-plugin:** record ownership only for what AOS installed ([71bf189](https://github.com/hybridlabor-api/aos/commit/71bf189cbee4f5cacb0e49f7b31591e761344e58))
* **codex:** make AOS hook/MCP removal and merge independent of marker comments ([1b01254](https://github.com/hybridlabor-api/aos/commit/1b01254831f1d379fa0784d38c297df92d5f7c19))
* **codex:** review follow-ups for F4 (features table, doctor hooks check, MCP sub-tables, deja ownership) ([6f42383](https://github.com/hybridlabor-api/aos/commit/6f4238383da4b5e21912d8a2c328ec3b41d35ac7))
* **doctor:** no installer.js dependency, nested plugin skills, real MCSC and named agy hooks ([6fbbac8](https://github.com/hybridlabor-api/aos/commit/6fbbac8c1fa10a0d4a492d7e843d458b441c0c0f))
* **gate:** classify feature-branch pushes by proving the destination from the git config (aos-22b) ([32e034a](https://github.com/hybridlabor-api/aos/commit/32e034ae34b1bc402bf5fb9fd95f4787f57a6441))
* **gate:** fail closed, narrow the home policy, fix pipe and loop regressions (aos-22) ([c45c48a](https://github.com/hybridlabor-api/aos/commit/c45c48aa42ba7cac0822b71067d12967246fcf41))
* **gate:** resolve cwd and variables for home-level targets, close review findings ([d8cc247](https://github.com/hybridlabor-api/aos/commit/d8cc24729c267bbfe52f5c3fdccdd5b34b14f917))
* **gate:** review round 3, repo state and env taint, path normalisation, budget, aliases ([7d34331](https://github.com/hybridlabor-api/aos/commit/7d343318a4bd7686e6e4b73fdcfa79e01041ae3e))
* **installer,doctor:** stop writing ~/.codex/skills, honour CLAUDE_CONFIG_DIR, single pluginSkills ([5f6f62d](https://github.com/hybridlabor-api/aos/commit/5f6f62dd87fc829b63e5295ac4a96e65c75e494e))
* **installer:** aos-07 items 1-8 and 10, aos-16, aos-17 installer bugs ([d6c9641](https://github.com/hybridlabor-api/aos/commit/d6c96415cb1640c3d6dbabb6dd0632aeeecd88f8))
* **installer:** aos-bus launcher with marker, real launcher list, go-buildinfo and uninstall records ([c901e10](https://github.com/hybridlabor-api/aos/commit/c901e105d604196fab68da7d2e1bbfea5d58bd1c))
* **installer:** no empty or needless backups, de-duplicate kept-edit report; harden cli-spawn; document measured Codex roots ([c74ad95](https://github.com/hybridlabor-api/aos/commit/c74ad95f9ccec0399612236072149fff267cc04a))
* **installer:** Quick Update plugin steps, single Codex skill root, drop HOME .codex-plugin ([a345195](https://github.com/hybridlabor-api/aos/commit/a345195683fd61360ae5a151aa5129645fb2fc3f))
* **installer:** read .agents/AGENTS.md with its real case ([4009c4f](https://github.com/hybridlabor-api/aos/commit/4009c4f7371f383b8f863e8e938befde807099c0))
* **installer:** string-aware JSONC parsing and no rewrite of unparseable configs ([2392b6b](https://github.com/hybridlabor-api/aos/commit/2392b6b395b1841097c0f5b369ab388383e60571))
* **installer:** wire aos-acp on PATH, ship lib and trail.mjs for installed CLIs ([06e64ac](https://github.com/hybridlabor-api/aos/commit/06e64ac721fbd6193ec183335fe32c193539113c))
* **mcp:** run computer-use via pinned npx and pin every npx MCP (aos-18, aos-20) ([375fa3b](https://github.com/hybridlabor-api/aos/commit/375fa3b9e7df5ec2063c26087ae673edb41ffc44))
* **mcsc:** gate every startup CLI call, not only the inventory probe ([d08e7d0](https://github.com/hybridlabor-api/aos/commit/d08e7d09af388de714b0a4d1dfd0a03140999d86))
* **mcsc:** stop the agy inventory probe from recursing through agy's own MCP servers ([7082b20](https://github.com/hybridlabor-api/aos/commit/7082b205bd1418a1cb337b77429336e9681f9b55))
* **plugin-migration:** recursive plugin.json-aware skill evidence requiring every wanted skill ([01d4635](https://github.com/hybridlabor-api/aos/commit/01d4635f08f632e208a35d815d82c69804e31ec0))
* **plugin:** parse real claude plugin list output, handle disabled and already-installed ([af48bb5](https://github.com/hybridlabor-api/aos/commit/af48bb5ca7597b82bbd46a29cba7c491db740a2d))
* **plugin:** run claude plugin marketplace add/install after settings registration ([1c90589](https://github.com/hybridlabor-api/aos/commit/1c905898812a735e55cb6ff83d9336095c585709))
* **plugins:** honest update log, 300s clone timeout, opt-outs, npx source, CLAUDE_CONFIG_DIR ([6e84722](https://github.com/hybridlabor-api/aos/commit/6e84722138e34be02dc15369f9bcdacde1728651))
* **uninstall:** keep foreign Codex tables and JSONC comments, honour CLAUDE_CONFIG_DIR and AOS_PLUGIN_CLI=on ([676ae67](https://github.com/hybridlabor-api/aos/commit/676ae671d1dae828f2a8d21d547ba63a23bcd556))
* **uninstall:** reverse agy, Codex, OpenCode, launcher and Claude plugin registrations ([5ba41f1](https://github.com/hybridlabor-api/aos/commit/5ba41f129277f7c741b1d41d561b107d9d2b52e5))

## [4.18.1](https://github.com/hybridlabor-api/aos/compare/v4.18.0...v4.18.1) (2026-10-02)


### Bug Fixes

* **installer:** define newestDistTag, Quick Update crashed with a ReferenceError ([#135](https://github.com/hybridlabor-api/aos/issues/135)) ([216bd6f](https://github.com/hybridlabor-api/aos/commit/216bd6f3bde9f01c7bc0707b95e3258ea6c34fa2))

## [4.18.0](https://github.com/hybridlabor-api/aos/compare/v4.17.0...v4.18.0) (2026-10-02)


### Features

* **canvas:** plan-canvas as annotation dispatcher, agenttrail one map per repo ([#129](https://github.com/hybridlabor-api/aos/issues/129)) ([f7823dc](https://github.com/hybridlabor-api/aos/commit/f7823dccd21d4ddab93368b7c3762858b49e3d80))
* **coordination:** depth limit, go-check for AO, routing docs ([#132](https://github.com/hybridlabor-api/aos/issues/132)) ([81c4404](https://github.com/hybridlabor-api/aos/commit/81c44045a461ab40f3207b0aee16cb221090f7e7))
* **installer:** install BDB AO Codenotch on macOS and Windows by default (opt-out) ([#133](https://github.com/hybridlabor-api/aos/issues/133)) ([97f4fdb](https://github.com/hybridlabor-api/aos/commit/97f4fdbca82e5d585ebdd602ad9e42d5e8106626))
* **installer:** opt-in OpenCode permission.external_directory for AOS paths ([#130](https://github.com/hybridlabor-api/aos/issues/130)) ([a41ccae](https://github.com/hybridlabor-api/aos/commit/a41ccaefe1ef1b72e25a8584a55d58bea9634dcd))
* **memb:** ambient project memory in the inject hook ([#131](https://github.com/hybridlabor-api/aos/issues/131)) ([257ce53](https://github.com/hybridlabor-api/aos/commit/257ce5360be2fc14e7eb15779fd414644ac74cc8))

## [4.17.0](https://github.com/hybridlabor-api/aos/compare/v4.16.0...v4.17.0) (2026-10-02)


### Features

* **plugin:** bdb-aos plugin for all harnesses, go-gate modes, playbooks and loop ([#126](https://github.com/hybridlabor-api/aos/issues/126)) ([78a30bb](https://github.com/hybridlabor-api/aos/commit/78a30bbeb3d97790242cdf8279942b60f84b45ae))


### Bug Fixes

* **installer:** aos version and aos help print and exit instead of installing ([#127](https://github.com/hybridlabor-api/aos/issues/127)) ([5f69ee3](https://github.com/hybridlabor-api/aos/commit/5f69ee37987909be7b263593e0a96ead52b2d9b1))

## [4.16.0](https://github.com/hybridlabor-api/aos/compare/v4.15.0...v4.16.0) (2026-10-01)


### Features

* **aos-acp:** add --model flag and reject fable workers ([#117](https://github.com/hybridlabor-api/aos/issues/117)) ([be70958](https://github.com/hybridlabor-api/aos/commit/be70958cf4cb442a952b537e0e546a8ab2d78b20))
* **playbooks:** wave 2 — pb-master, pb-ship, pb-harness-work, pb-worktrees-land, pb-clip-from-moodboard ([#118](https://github.com/hybridlabor-api/aos/issues/118)) ([0eede24](https://github.com/hybridlabor-api/aos/commit/0eede24bb7fff6aa467d7aa4e1285f42f7d4a7f9))
* **playbooks:** wave 3 — 24 playbooks across engineering, AOS, design, content, media, ops and everyday work ([#125](https://github.com/hybridlabor-api/aos/issues/125)) ([20a1ce2](https://github.com/hybridlabor-api/aos/commit/20a1ce234f3fe45287fb4aef47ffb052f55bfaca))


### Bug Fixes

* **installer:** never downgrade the AO binary, keep user-edited agents, honest version line ([#124](https://github.com/hybridlabor-api/aos/issues/124)) ([bd85238](https://github.com/hybridlabor-api/aos/commit/bd8523837a47ed6604d5baa5249f0a2331f7448a))

## [4.15.0](https://github.com/hybridlabor-api/aos/compare/v4.14.1...v4.15.0) (2026-10-01)


### Features

* **bus:** aos-bus with visible OpenCode TUI delivery, heartbeat liveness and gate hardening ([#121](https://github.com/hybridlabor-api/aos/issues/121)) ([8719272](https://github.com/hybridlabor-api/aos/commit/8719272491e83ba8b8569379aeeb8a98168ce02a))


### Bug Fixes

* **skills:** keep pipeline, role and playbook skills model-invocable ([#120](https://github.com/hybridlabor-api/aos/issues/120)) ([c45e976](https://github.com/hybridlabor-api/aos/commit/c45e97620c971883999a134ad315ac554e7889dc))

## [4.14.1](https://github.com/hybridlabor-api/aos/compare/v4.14.0...v4.14.1) (2026-10-01)


### Bug Fixes

* **installer:** write Windows-safe agy hook commands, self-check them and fail open ([#116](https://github.com/hybridlabor-api/aos/issues/116)) ([07f8f96](https://github.com/hybridlabor-api/aos/commit/07f8f969a6a71966f9cfbc14f65ba7068de0aa62))

## [4.14.0](https://github.com/hybridlabor-api/aos/compare/v4.13.2...v4.14.0) (2026-10-01)


### Features

* add skills.sh.json to group the 214 skills on the skills.sh repo page ([#95](https://github.com/hybridlabor-api/aos/issues/95)) ([665feb9](https://github.com/hybridlabor-api/aos/commit/665feb979f1c5c4db30df2844a51924f2384c846))
* **agenttrail:** auto-start the live map and surface its link ([#115](https://github.com/hybridlabor-api/aos/issues/115)) ([7126f88](https://github.com/hybridlabor-api/aos/commit/7126f88973ebf825a2b3e070635c0de004f0b247))
* **launchpad:** Plan Canvas card with start hint and opt-in autostart ([#109](https://github.com/hybridlabor-api/aos/issues/109)) ([69ea4fe](https://github.com/hybridlabor-api/aos/commit/69ea4fef1b63dc15edfc41327ff225f44bfee64a))
* **master-session:** supervise sessions, GO token, aos-acp client and OpenCode adapter ([#111](https://github.com/hybridlabor-api/aos/issues/111)) ([1178ef5](https://github.com/hybridlabor-api/aos/commit/1178ef5eefc6a2438b463649901d0698a93096c8))
* **plan-canvas:** always offer the planning mode (modes command, open --mode) ([#103](https://github.com/hybridlabor-api/aos/issues/103)) ([24ba4a2](https://github.com/hybridlabor-api/aos/commit/24ba4a260c276d5d0c4315e78c321af9589bea73))
* **plan-canvas:** BDB Plan Builder - renderer for plan folders with a board view ([#107](https://github.com/hybridlabor-api/aos/issues/107)) ([fbce692](https://github.com/hybridlabor-api/aos/commit/fbce69224b9639d60ef4ba650bed9430e00a3dab))
* **playbooks:** playbook format, validator support and five wave-1 playbooks ([#110](https://github.com/hybridlabor-api/aos/issues/110)) ([7b4f31c](https://github.com/hybridlabor-api/aos/commit/7b4f31ce4cfa7aa332deb346cb30eda06e447304))
* **pr-recap:** visual PR recap skill built on the Plan Builder ([#113](https://github.com/hybridlabor-api/aos/issues/113)) ([455e242](https://github.com/hybridlabor-api/aos/commit/455e242f9bc0188473ff620f2d1589c2b1c3ea47))
* **skills:** vendor agentic-harness-patterns from keli-wen (MIT) ([#112](https://github.com/hybridlabor-api/aos/issues/112)) ([d9ef6cd](https://github.com/hybridlabor-api/aos/commit/d9ef6cd9436208dcad7a8fa1c53f8b6d14e46b58))
* **skills:** vendor plan-arbiter and Factory stage 1-2 from BuilderIO/skills ([#101](https://github.com/hybridlabor-api/aos/issues/101)) ([4338108](https://github.com/hybridlabor-api/aos/commit/43381082ba7e2c1c7e27b252843d451d37fcecfc))
* **skills:** vendor stay-within-limits and quick-recap from BuilderIO/skills ([#99](https://github.com/hybridlabor-api/aos/issues/99)) ([5e49d8a](https://github.com/hybridlabor-api/aos/commit/5e49d8a63c485a280af63085d0b67e1533c8ed4c))
* **skills:** vendor visual-plan, visual-recap and visual-edit from BuilderIO/skills (optional) ([#105](https://github.com/hybridlabor-api/aos/issues/105)) ([dc9f0a9](https://github.com/hybridlabor-api/aos/commit/dc9f0a9e5121e6c5f2fc65faa2a5018aee67ef46))
* **swarm:** shared common skill set for every pipeline node and harness ([#100](https://github.com/hybridlabor-api/aos/issues/100)) ([5baf8b2](https://github.com/hybridlabor-api/aos/commit/5baf8b288e015a85b3c9c53e0dc769eb6102929f))
* **visual-edit:** bdb-visual-edit skill with element sanitizer and Plan Builder source anchors ([#114](https://github.com/hybridlabor-api/aos/issues/114)) ([8675794](https://github.com/hybridlabor-api/aos/commit/8675794f69ff0aa90c683030d1700728defb44f9))


### Bug Fixes

* **installer:** atomic ao binary swap, --version/--help without install, mcsc start, command name ([#104](https://github.com/hybridlabor-api/aos/issues/104)) ([fc3173c](https://github.com/hybridlabor-api/aos/commit/fc3173c8038c757363c8876a6b7a45636c628ead))
* **installer:** write an agy-valid hooks.json and migrate old AOS entries (go-gate under Antigravity) ([#106](https://github.com/hybridlabor-api/aos/issues/106)) ([a5023d6](https://github.com/hybridlabor-api/aos/commit/a5023d6a53894ef2e760f54ed10508f8f35acb6a))
* **plan-builder:** visual polish and recap-review / recap-board templates ([#108](https://github.com/hybridlabor-api/aos/issues/108)) ([4453be9](https://github.com/hybridlabor-api/aos/commit/4453be95e2f50425821ef77bb9fc6775915f6470))
* **plan-canvas:** pin the request Origin to the server port and refuse cross-site fetches ([#102](https://github.com/hybridlabor-api/aos/issues/102)) ([6bf54f9](https://github.com/hybridlabor-api/aos/commit/6bf54f98391c04f2a2a7018e9d03131349acff46))

## [4.13.2](https://github.com/hybridlabor-api/aos/compare/v4.13.1...v4.13.2) (2026-09-30)


### Bug Fixes

* **hooks:** go-gate fails closed, global hook paths, idempotent Codex merge, uninstall symmetry ([#89](https://github.com/hybridlabor-api/aos/issues/89)) ([c59ce96](https://github.com/hybridlabor-api/aos/commit/c59ce967d40b8606abbc5ad13a355bacbb8889b7))
* **installer:** report module failures honestly, keep existing env secrets, atomic manifest writes ([#88](https://github.com/hybridlabor-api/aos/issues/88)) ([89b26e6](https://github.com/hybridlabor-api/aos/commit/89b26e69788127577bf885dd2773f3d3f7bb7255))

## [4.13.1](https://github.com/hybridlabor-api/aos/compare/v4.13.0...v4.13.1) (2026-09-30)


### Bug Fixes

* **store:** UI crashed with 'reading length' on AOS Core items lacking requires ([#91](https://github.com/hybridlabor-api/aos/issues/91)) ([910a889](https://github.com/hybridlabor-api/aos/commit/910a889a43eeb9dbb30cd181eebf23b3182eed7f))

## [4.13.0](https://github.com/hybridlabor-api/aos/compare/v4.12.1...v4.13.0) (2026-09-30)


### Features

* **plugin:** ship the Claude plugin from plugins/bdb-aos (about 31 MB instead of 156 MB) ([#85](https://github.com/hybridlabor-api/aos/issues/85)) ([44a3458](https://github.com/hybridlabor-api/aos/commit/44a3458072e21b8083117d5245d2ddd3d26ed6c1))
* **skills:** vendor humanlayer design-control-loop as an opt-in skill ([#82](https://github.com/hybridlabor-api/aos/issues/82)) ([01068f3](https://github.com/hybridlabor-api/aos/commit/01068f3895f0240ce2c5c87967e23f8d099e648f))
* **store:** add Scenario (scenario-labs/skills, MIT) as a second catalog source ([#83](https://github.com/hybridlabor-api/aos/issues/83)) ([5258568](https://github.com/hybridlabor-api/aos/commit/5258568bcd03aa66b6fbf55009cd2dc88003626c))


### Bug Fixes

* **agents:** use a role's pipeline.json model only for its own harness ([#87](https://github.com/hybridlabor-api/aos/issues/87)) ([ca3b156](https://github.com/hybridlabor-api/aos/commit/ca3b15657f9589163b9d75d2613ebab4cec7eabb))
* **release:** read release settings from release-please-config.json only ([#78](https://github.com/hybridlabor-api/aos/issues/78)) ([75dd7ec](https://github.com/hybridlabor-api/aos/commit/75dd7ecd5020034c67cae33ca9de550688d6208a))
* **release:** tag releases without the component prefix ([#80](https://github.com/hybridlabor-api/aos/issues/80)) ([54fb598](https://github.com/hybridlabor-api/aos/commit/54fb59853b836df83efd012f571e4c9a51135c22))

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
