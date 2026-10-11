# Batch B changes (AOS repo, feat/batchb)

- **B1** — `skills/basic/godmode-media-creation/SKILL.md`: replaced the MCP-first body
  (8 phantom references to `openmontage_mcp` / `palmier_pro_mcp`) with the corrected
  CLI-first content from c-creator. Frontmatter kept AOS-valid: name, quoted
  single-line description (now Remotion/OpenMontage/TouchDesigner wording), category
  `media-eventtech`. Body MCP names verified against `mcp_config.json`
  (`bdb_td_minddesigner`, `bdb_after_effects_mcp`, `bdb_davinci_mcp`) and existing
  playbook usage (`comfyui-mcp`); Remotion/OpenMontage CLI paths marked external.
  Repo-wide grep for both phantom names now returns 0 hits; no generated
  manifests need regenerating (none referenced them).
- **B2** — same skill gained section "5. External Render Path: onetake": suggest
  onetake when Hyperframes is unavailable, lists its dependencies, PolyForm
  Noncommercial licence note, clone is a manual step.
- **B3** — `skills/playbooks/pb-social-pack/SKILL.md`: optional silence-cut step via
  auto-editor with preflight probe `auto-editor --version`; missing → one-line log
  and continue; pip install is a manual opt-in step.
- **B4/B5** — `skills/playbooks/pb-security-sweep/SKILL.md`: "Optional gate check:
  Strix" note — AI pentesting agent, install `curl -sSL https://strix.ai/install |
  bash` (verified against the Strix README), installation needs a separate GO.

## Post-GO host steps for Tim (never run by agents)

1. Clone onetake (https://github.com/feitangyuan/onetake) — manual step, non-commercial licence check first.
2. `pip install auto-editor` if spoken-head silence cuts are wanted in pb-social-pack.
3. `curl -sSL https://strix.ai/install | bash` if Strix gate checks are wanted (separate GO).

Verification left to the dispatcher (Docker): `npm test`,
`node tests/godmode-media-creation-phantom.test.mjs`, `npm run validate-skills`.

Changes were traced by hand per the no-shell rule; the test file and validator
syntax were not executed on this machine.
