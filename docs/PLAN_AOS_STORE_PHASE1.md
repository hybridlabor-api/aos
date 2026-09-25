# Execution Plan: AOS Skill, Subagent & Extras Store (Phase 1)

**Target Repository:** `/Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills`  
**Target Worktree:** `/Users/timrennings/dev/bdb-dev/aos-wt-store`  
**Branch:** `feat/aos-store` (branched from `main`)  
**Scope:** Phase 1 — Core Store Infrastructure, Offline Index, CLI, and Dispatcher Fallback  
**Audience:** Autonomous Implementation Agent  
**Upstream Source:** `https://github.com/affaan-m/ECC` (Pinned Commit, MIT License)

---

## 🎯 1. Mission & Architectural Invariants

You are implementing Phase 1 of the **AOS Store** (`@hybridlabor-api/aos`). This provides an on-demand fallback layer for skills and subagents sourced from `affaan-m/ECC` whenever a requested capability is not in AOS's 185-skill core.

### ⚠️ Non-Negotiable Invariants (Audit-Mandated)
1. **No Forks:** Do NOT fork ECC to GitHub. Pin `affaan-m/ECC` directly via Git SHA in `vendor-manifest.json` (identical to `anti-slop` and `skylos`).
2. **No Mid-Run Downloads:** Never download or prompt to download during a `/startcycle-graph` run (violates the GO-Gate and headless guarantees). If `--skill=<name>` is missing, the dispatcher must escalate with a clear manual install instruction:
   ```text
   "<name> is not installed. Found in the ECC store.
   Run: aos store install <name>
   Then re-run your startcycle command."
   ```
3. **No File System in Dispatcher:** `.claude/workflows/startcycle-dispatch.mjs` has no direct `fs` access. The mandatory skill check is an `agent()` call (Haiku); you must extend its JSON schema with `store_matches: string[]` instead of adding `fs` calls.
4. **Trust Anchor is AOS Package:** `lib/ecc-store-index.json` ships inside the `@hybridlabor-api/aos` npm package. Downloads from GitHub must match the SHA-256 hash in this index. Hash mismatch = hard failure.
5. **Phase-1 Scope: Markdown Only:**
   - Only import `skills/` and `agents/` (Subagents).
   - **Strictly exclude** `scripts/`, `hooks/`, and `rules/` (prevents RCE and config pollution).
6. **Collision Invariant:** AOS core skills ALWAYS take precedence. If an ECC skill shares a name with an existing AOS skill, it is skipped and logged.
7. **Future-Proofing for Fucksaas & AO:** Every store item must contain schema fields for `tier: "free"`, `requires_auth: false`, and `origin: "ecc"` so Fucksaas PRO pay-gates and AO marketplace UI can be layered on in Phase 2 without changing the schema.

---

## 🛠️ 2. Worktree Initialization

Execute the following commands to create and enter the isolated worktree:

```bash
cd /Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills
git fetch origin main
git worktree add -b feat/aos-store /Users/timrennings/dev/bdb-dev/aos-wt-store main
cd /Users/timrennings/dev/bdb-dev/aos-wt-store
```

All modifications below MUST take place inside `/Users/timrennings/dev/bdb-dev/aos-wt-store/`.

---

## 📋 3. Step-by-Step Implementation Checklist

### Step 1: Upstream Pinning & Provenance
- [ ] Inspect the latest stable commit SHA of `affaan-m/ECC`:
  ```bash
  gh api repos/affaan-m/ECC/commits/main --jq '.sha'
  ```
- [ ] Add `ecc-store` entry to `vendor-manifest.json`:
  ```json
  "ecc-store": {
    "upstream": "https://github.com/affaan-m/ECC",
    "pinned_commit": "<FULL_SHA>",
    "purpose": "On-demand fallback store for skills and auxiliary subagents",
    "target": "lib/ecc-store-index.json"
  }
  ```
- [ ] Update `THIRD_PARTY_NOTICES.md` to document the full scope of ECC components and MIT license terms.

### Step 2: Store Index Generator (`scripts/build-ecc-store-index.mjs`)
- [ ] Create `scripts/build-ecc-store-index.mjs`. The script must:
  1. Fetch the tree from GitHub API for the pinned commit (`repos/affaan-m/ECC/git/trees/<sha>?recursive=1`) or clone to a temporary cache.
  2. Filter strictly for Markdown:
     - `skills/**/SKILL.md` or `skills/**/*.md`
     - `agents/*.md`
  3. Validate & sanitize frontmatter:
     - Must conform to AOS standards (runnable through `scripts/validate-skills.mjs` rules).
     - Compute SHA-256 for each raw file.
     - Scan for forbidden tokens (hardcoded Claude-only tools like `Bash`, `View`; replace or flag compatibility).
  4. Build schema:
     ```typescript
     interface StoreIndex {
       version: "1.0.0";
       generated_at: string;
       pinned_commit: string;
       skills: Record<string, {
         name: string;
         description: string;
         category: string;
         tier: "free";
         origin: "ecc";
         requires_auth: false;
         sha256: string;
         upstream_path: string;
         harness_support: ("claude" | "antigravity" | "codex" | "cursor" | "roo")[];
       }>;
       subagents: Record<string, {
         name: string;
         description: string;
         role: string;
         tier: "free";
         origin: "ecc";
         sha256: string;
         upstream_path: string;
       }>;
     }
     ```
  5. Check collisions against local `skills/` in AOS. Any collision is skipped.
  6. Output the compiled index to `lib/ecc-store-index.json` (keep size under 100 KB).
- [ ] Run `node scripts/build-ecc-store-index.mjs` and verify `lib/ecc-store-index.json`.

### Step 3: CLI Implementation (`bin/aos-store.mjs` & `installer.js`)
- [ ] Create `bin/aos-store.mjs`:
  - `aos store list [--type=skills|agents]` -> Formatted table of available items.
  - `aos store search <query>` -> Search by name, tags, description in `lib/ecc-store-index.json`.
  - `aos store install <name> [--project]` ->
    1. Look up `<name>` in `lib/ecc-store-index.json`.
    2. Check if already installed locally; collision guard against AOS core.
    3. Download raw content from `https://raw.githubusercontent.com/affaan-m/ECC/<pinned_sha>/<upstream_path>`.
    4. Compute SHA-256 and assert match with index (halt on mismatch).
    5. Write file:
       - If `--project`: write to `./skills/<name>/SKILL.md`.
       - If global: fan-out to all active harnesses (`~/.agents/skills/<name>/SKILL.md`, `~/.claude/skills/<name>/SKILL.md`, etc., reusing logic from `installer.js`).
    6. Log success with green checkmark.
- [ ] Make `bin/aos-store.mjs` executable (`chmod +x bin/aos-store.mjs`).
- [ ] Register in `package.json`:
  ```json
  "bin": {
    ...
    "aos-store": "bin/aos-store.mjs"
  }
  ```
- [ ] Wire up `aos store <args>` in `installer.js` so running `aos store search` forwards directly to `bin/aos-store.mjs`.

### Step 4: Dispatcher Hook (`.claude/workflows/startcycle-dispatch.mjs`)
- [ ] Locate the `validate-mandatory-skills` agent call around lines 701–741.
- [ ] Update the prompt and JSON schema:
  - Add `store_matches: { type: 'array', items: { type: 'string' } }` to the output schema.
  - Instruct the agent to check `lib/ecc-store-index.json` for any skill not found locally on disk.
- [ ] Update escalation handling (lines 728–739):
  ```javascript
  const missing = skillCheckResult?.missing ?? [];
  if (missing.length > 0) {
    const storeMatches = skillCheckResult?.store_matches ?? [];
    const suggestions = skillCheckResult?.suggestions ?? [];
    
    let msg = `--skill named skill(s) that are not currently installed: ${missing.join(', ')}.\n`;
    if (storeMatches.length > 0) {
      msg += `Found in the AOS / ECC Store: ${storeMatches.join(', ')}.\n` +
             `Run: aos store install ${storeMatches.join(' ')}\n` +
             `Then re-run your startcycle command.\n`;
    } else if (suggestions.length > 0) {
      msg += `Did you mean: ${suggestions.join(', ')}?\n`;
    }
    return await escalate(msg);
  }
  ```

### Step 5: Router Update (`skills/global_config/ask-tim/SKILL.md`)
- [ ] Add a new section in `ask-tim/SKILL.md` titled `## Outside the core: the ECC store`:
  - Explain that when no native AOS skill fits (e.g. Django, Spring, Godot), the user can query the store via `aos store search <query>`.
  - Document `aos store install <name>` for on-demand activation.
  - Reiterate that the core remains 185 high-trust skills.

### Step 6: Verification & Quality Gate
- [ ] Run skill validator:
  ```bash
  npm run test
  npm run validate:strict
  ```
- [ ] Test the CLI commands:
  ```bash
  node bin/aos-store.mjs list | head -n 20
  node bin/aos-store.mjs search django
  node bin/aos-store.mjs search spring
  ```
- [ ] Test mock installation:
  ```bash
  node bin/aos-store.mjs install <test-skill> --dry-run
  ```
- [ ] Ensure Git working tree is clean and commits follow Conventional Commits:
  - `feat(store): add build-ecc-store-index generator and store-index.json`
  - `feat(store): implement aos-store CLI and installer integration`
  - `feat(dispatcher): suggest aos store install on missing mandatory skills`
  - `docs(ask-tim): add ECC store fallback section`

---

## 🚀 4. Definition of Done
1. `npm test` and `npm run validate` pass with zero errors.
2. `lib/ecc-store-index.json` is generated, valid JSON, under 100 KB.
3. `bin/aos-store.mjs` executes cleanly without unhandled rejections.
4. Worktree is ready for review and merge into `main`.
