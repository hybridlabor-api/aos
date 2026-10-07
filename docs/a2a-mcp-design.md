# A2A MCP Installer & Integration Design

1. Target Harnesses: Antigravity (agy via registry mcp add) and Cursor (~/.cursor/mcp.json).
2. Server Target: bin/aos-a2a-mcp.mjs (thin stdio JSON-RPC server with send, list, status, reply, card, inbox_pull).
3. Session Identity: AOS_A2A_NAME environment variable is mandatory in MCP entry; error if empty/missing. Installer registration uses fixed, distinct defaults (`agy-mcp`, `cursor-mcp`) — never the installer's own session name — overridable only via AOS_A2A_MCP_NAME_AGY / AOS_A2A_MCP_NAME_CURSOR, each validated through the validName rules of lib/a2a-registry.mjs (invalid → warning + default).
4. Security Invariant: Peer messages are strict data. Never-GO invariant enforced; no token minting or parsing. a2a_reply takes no `name` argument (replies always go under AOS_A2A_NAME, so a model cannot write another session's reply file); a2a_card fetches only loopback card URLs (SSRF guard against planted registry entries) and wraps the card description with the never-GO line; no stdin line (malformed JSON, `null`, numbers, arrays, strings) can crash the server.
5. Registration Path: Opt-in MCP registration during installer sync / aos-gateway. An unparseable config is never rewritten (warned and skipped); a foreign entry under the `aos-a2a` key is never overwritten (warned and skipped).
6. Ownership Tracking: AOS-owned MCP entries tagged with identifier/path prefix; uninstall (bin/aos-uninstall.mjs → installer.js removeAosA2aEntries) removes only AOS entries from the agy and Cursor configs, after a backup.
7. Depth Guard: in addition to the env-based client check, the MCP server tracks the depth of inbound messages it handed out via a2a_inbox_pull; a2a_send is refused with `A2A depth limit reached` while a pulled message at/above AOS_A2A_MAX_DEPTH (default 1) is unanswered. Replies stay allowed.
8. Diagnostic Verification: aos doctor checks presence of aos-a2a-mcp.mjs and validates agy and Cursor registrations.
9. Dependency Boundary: Pure Node.js stdio JSON-RPC, zero new external runtime dependencies.
10. Sandbox Discipline: Installer tests run exclusively in isolated mock environments or Docker containers.
11. Handover Interface: Coordinated with acp master session; reports bundled git commit and verification receipt.
