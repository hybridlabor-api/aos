# A2A MCP Installer & Integration Design

1. Target Harnesses: Antigravity (agy via registry mcp add) and Cursor (~/.cursor/mcp.json).
2. Server Target: bin/aos-a2a-mcp.mjs (thin stdio JSON-RPC server with send, list, status, reply, card, inbox_pull).
3. Session Identity: AOS_A2A_NAME environment variable is mandatory in MCP entry; error if empty/missing.
4. Security Invariant: Peer messages are strict data. Never-GO invariant enforced; no token minting or parsing.
5. Registration Path: Opt-in MCP registration during installer sync / aos-gateway.
6. Ownership Tracking: AOS-owned MCP entries tagged with identifier/path prefix; uninstall removes only AOS entries.
7. Diagnostic Verification: aos doctor checks presence of aos-a2a-mcp.mjs and validates agy and Cursor registrations.
8. Dependency Boundary: Pure Node.js stdio JSON-RPC, zero new external runtime dependencies.
9. Sandbox Discipline: Installer tests run exclusively in isolated mock environments or Docker containers.
10. Handover Interface: Coordinated with acp master session; reports bundled git commit and verification receipt.
