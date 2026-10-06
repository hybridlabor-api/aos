# Installer v5 — review of the Ziel C merge (sonnet, read-only, at 03cdd72)

Findings B1, M2 confirmed by the dispatcher (grep). Others as reported by the reviewer.

## Repair (worker contract; Edit/Write only, no commit, no shell)

| ID | Fix |
|---|---|
| B1 | Add `a2a-inbox.mjs` (and `a2a-session.mjs` if shipped) to every BDB hook-script allowlist: installer.js `bdbHookScripts` (~4905, ~5030), the AGY/Codex lists (~4998), `bin/aos-uninstall.mjs` ~312, `lib/uninstall-records.js` `AOS_SCRIPTS` (:18) and `CODEX_AOS_SCRIPTS` (:127). `mergeBdbSettingsHooks` must be idempotent for the A2A entries (no clone per run) and uninstall must remove them. Tests: run `mergeBdbSettingsHooks` twice → exactly one drain and one stop entry; uninstall removes them (real uninstall path, container-only like tests/uninstall-e2e.test.js). |
| M2 | Add `aos-a2a` to `cliBins` in installer.js `installGlobalBinaries` (~4858) so installer users get the command. Test. |
| M4 | A2A hook imports `../../lib/a2a-inbox.mjs`: make it resolve for project-local and global installs (ship the lib next to the hook or resolve via the install manifest), or make the hook a no-op with one stderr line when the lib is missing. Test both layouts. |
| M5 | `installA2aLibCopies` must not write into the bare `$HOME/lib` or `$HOME/.gemini/lib`: copy under `~/.agents/lib` (the existing AOS dir) and record every copy in the uninstall records; uninstall removes them. `a2a-sidecar.mjs`/`a2a-client.mjs` copies that cannot resolve `@a2a-js/sdk` must not be shipped as copies. Test. |
| B2a | Inbound payload hardening (not the policy parts): in lib/a2a-oc.mjs deliverA2a and .claude/hooks/a2a-inbox.mjs wrap the message body in a clearly delimited quoted block and strip/neutralise lines that imitate the footer, `[go-token]`, rules blocks or system tags; sanitise `from` AND task fields. Tests with forged footer/[go-token]/`</system>` text: the output must contain them only inside the quoted block, escaped. |
| m1/m2 | Check the Host header against loopback names; put the bearer check before `express.json` (agent card stays public); register the URL with the address actually bound. Tests. |
| m3 | Tests that can fail: doctor A2A rows are not `add(..., true)` warn-only when the matrix is broken; uninstall removal; forged text. |

Not in this contract (needs Tim): pre-allowed `Bash(aos-a2a send:*)` in `.claude/settings.json` (B2), sidecar opt-in vs opt-out (M1), v5 package entry for A2A in lib/v5 (M6), `mergeBdbSettingsHooks` merging `permissions` (M3).
Out of scope: .claude/hooks/go-gate.mjs, lib/gateway/*, lib/v5/* (except reading), plugins/*.
