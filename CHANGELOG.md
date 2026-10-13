# Changelog

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
