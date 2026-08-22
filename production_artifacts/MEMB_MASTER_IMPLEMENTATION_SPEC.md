# memB v3.1: Master Architecture & Implementation Specification
*Autonomous, Context-Free Implementation Blueprint for Multi-Agent Engineering Teams*

---

## 1. Executive Summary & Purpose

This document is the **definitive, self-contained implementation specification** for the `memB` persistent memory ecosystem. It incorporates all verification findings against the actual local repositories ([`hybridlabor-api/memB`](file:///Users/timrennings/bdb-dev/memB) and dependent BDB skill packages).

Any autonomous agent, subagent team, or developer can execute the implementation described herein directly without requiring prior conversation history.

---

## 2. Core Architectural Questions & Status

### 🖥️ 2.1 Web Dashboard & Daemon (Desktop vs. Server)

* **Desktop Mode (Active Local Engine):**
  * The FastMCP server ([`mcps/memb-mcp/run.py`](file:///Users/timrennings/bdb-dev/bdb-dev-optimized-agent-skills/mcps/memb-mcp/run.py)) runs *on-demand* via the AI harness (Antigravity, Claude Code, Cursor) — 0 MB idle RAM.
* **Server Mode (Future Multi-Tenant Architecture):**
  * A full Next.js Web Dashboard exists in [`memB/server/dashboard/`](file:///Users/timrennings/bdb-dev/memB/server/dashboard) backed by the FastAPI REST service in [`memB/server/main.py`](file:///Users/timrennings/bdb-dev/memB/server/main.py).
  * Can be deployed via Docker Compose / VPS for collaborative multi-user access.

---

### 🔒 2.2 Memory Scopes & Taxonomy

* **Current Reality:** Memories in `~/.MemBDB/memb.db` (`memb_vectors` table) store payloads containing `user_id`, `category`, and `project_id` (via `metadata`).
* **Active Taxonomy (Upstream 17 Coding-Tuned Categories):**
  1. `architecture_decisions` – Framework choices, system design patterns, database architecture.
  2. `anti_patterns` – Forbidden packages, deprecated syntax, known regressions.
  3. `task_learnings` – Solutions discovered during troubleshooting and debugging.
  4. `tooling_setup` – Environment variables, package managers, port configs.
  5. `bug_fixes` – Root-cause explanations and verified solutions to specific bugs.
  6. `coding_conventions` – Formatting rules, linting standards, naming patterns.
  7. `user_preferences` – Direct user requirements, style choices, workflow preferences.
  8. `dependency_decisions` – Package choices, version pins, replacement rationale.
  9. `performance_findings` – Profiling results, memory optimizations, render costs.
  10. `security_constraints` – Secret handling, private repository mandates, auth rules.
  11. `testing_patterns` – Mocking conventions, test runners, assertion styles.
  12. `data_model` – Schemas, relational mappings, ORM configs, migration rules.
  13. `api_contracts` – REST endpoints, FastMCP tool signatures, payload structures.
  14. `deployment_runbook` – CI/CD steps, Docker configs, remote workspace setups.
  15. `team_norms` – Collaboration guidelines, Git branching models, PR review standards.
  16. `domain_glossary` – Event-tech terms, TouchDesigner / Resolume mappings, hardware specs.
  17. `experiment_results` – Benchmark comparisons, AI model evals, prototype findings.

---

## 3. Atomic 4-Phase Implementation Blueprint

### Phase 1: SQLite Hardening & FTS5 BM25 Hybrid Vector Store
* **Target File:** [`memb/vector_stores/numpy_flat.py`](file:///Users/timrennings/bdb-dev/memB/memb/vector_stores/numpy_flat.py)

1. **Replace All 10 Connection Sites with Hardened Helper:**
   ```python
   def _get_connection(self):
       conn = sqlite3.connect(self.db_path, timeout=30.0)
       conn.execute("PRAGMA journal_mode = WAL;")
       conn.execute("PRAGMA synchronous = NORMAL;")
       conn.execute("PRAGMA busy_timeout = 30000;")
       return conn
   ```
   *Refactor all 10 raw `sqlite3.connect(self.db_path)` calls to use `self._get_connection()`.*

2. **Create FTS5 Virtual Table & Auto-Backfill:**
   ```python
   def _init_fts_table(self):
       with self._get_connection() as conn:
           cursor = conn.cursor()
           cursor.execute("""
               CREATE VIRTUAL TABLE IF NOT EXISTS memb_fts USING fts5(
                   id UNINDEXED,
                   collection,
                   content,
                   tokenize = 'unicode61'
               );
           """)
           # One-time backfill if FTS is empty but vectors exist
           cursor.execute("SELECT count(*) FROM memb_fts WHERE collection = ?", (self.collection_name,))
           fts_count = cursor.fetchone()[0]
           if fts_count == 0:
               cursor.execute("SELECT id, payload FROM memb_vectors WHERE collection = ?", (self.collection_name,))
               rows = cursor.fetchall()
               for r_id, p_str in rows:
                   try:
                       p = json.loads(p_str)
                       text = p.get("data") or p.get("memory") or ""
                       if text:
                           cursor.execute("INSERT INTO memb_fts (id, collection, content) VALUES (?, ?, ?)", (r_id, self.collection_name, text))
                   except Exception:
                       pass
           conn.commit()
   ```

3. **Wire FTS5 on `insert()`, `update()`, and `delete()`:**
   * In `insert()`: Write to `memb_vectors` AND `memb_fts`.
   * In `update()`: Update `memb_vectors` AND `memb_fts`.
   * In `delete()`: Delete from `memb_vectors` AND `memb_fts WHERE id = ?`.

4. **Implement `keyword_search()`:**
   ```python
   def keyword_search(self, query: str, top_k: int = 5, filters: Optional[Dict[str, Any]] = None):
       if not query or not query.strip():
           return []
       # Sanitize query for FTS5 syntax
       clean_query = ' '.join(f'"{w}"' for w in query.replace('"', '').split() if w)
       if not clean_query:
           return []
       with self._get_connection() as conn:
           cursor = conn.cursor()
           cursor.execute("""
               SELECT f.id, v.payload, bm25(memb_fts) as score
               FROM memb_fts f
               JOIN memb_vectors v ON f.id = v.id
               WHERE memb_fts MATCH ? AND f.collection = ?
               ORDER BY score ASC
               LIMIT ?
           """, (clean_query, self.collection_name, top_k * 2))
           rows = cursor.fetchall()
       
       results = []
       for r_id, p_str, raw_bm25 in rows:
           payload = json.loads(p_str)
           if filters:
               match = True
               for k, v in filters.items():
                   if payload.get(k) != v:
                       match = False
                       break
               if not match:
                   continue
           # Normalize BM25 score (lower is better in SQLite FTS5 rank)
           norm_score = 1.0 / (1.0 + abs(raw_bm25))
           results.append(OutputData(id=r_id, score=norm_score, payload=payload))
       return results[:top_k]
   ```

---

### Phase 2: Complete FastMCP Tool Surface & Scoped Safety
* **Target File:** [`mcps/memb-mcp/run.py`](file:///Users/timrennings/bdb-dev/bdb-dev-optimized-agent-skills/mcps/memb-mcp/run.py)

1. **Expose Full 8-Tool FastMCP Interface:**
   * `add_memory(text, user_id, category, project_id, infer=True)`: Tries LLM extraction, on timeout/failure seamlessly falls back to `infer=False`.
   * `search_memory(query, user_id, limit, category, project_id)`: Global unblocked search by default; scoped when parameters are provided.
   * `get_memory(memory_id)`: Fetches memory item by UUID.
   * `update_memory(memory_id, text, metadata)`: Updates memory content and refreshes vectors + FTS.
   * `list_memories(user_id, limit, category, project_id)`: Lists memories with filters.
   * `delete_memory(memory_id)`: Removes memory and FTS index.
   * `delete_all_memories(user_id, project_id)`:
     * **Safety Guard:** If `project_id` is provided without `user_id`, or vice-versa, only deletes matching records scoped to that specific filter — **never silently wipes the entire database**.
   * `list_entities(entity_type)`: Returns list of distinct projects, categories, or user IDs.

---

### Phase 3: Ingestion Deduplication, Semantic Chunking & Bugfixes
* **Target Files:** [`memb_ingest.py`](file:///Users/timrennings/bdb-dev/memB/memb_ingest.py), [`memb_auto_inject.py`](file:///Users/timrennings/bdb-dev/memB/memb_auto_inject.py)

1. **Fix `memb_auto_inject.py` Payload Key:**
   ```python
   # Line 65, 71
   content = m.get("memory") or m.get("data") or m.get("document") or ""
   ```

2. **Content-Addressed Deduplication in `memb_ingest.py`:**
   ```python
   content_hash = hashlib.md5(f"{doc['source']}:{chunk}".encode("utf-8")).hexdigest()
   # Check if hash exists in db; skip if already present
   ```

3. **Semantic Chunk Window & Purge Migration:**
   * Set `CHUNK_CHARS = 1200` with `CHUNK_OVERLAP = 150`.
   * Provide `--purge-project <name>` CLI option in `memb_ingest.py` to cleanly re-index an existing codebase without leftover orphaned 4KB chunks.

---

### Phase 4: Multi-Repository Synchronization & Verification Gate

1. **Mandatory Git Snapshot Pre-Flight:**
   * Take Git commits of current clean state across all 5 repos before file copying.
2. **Land memB Core First:**
   * Commit in `/Users/timrennings/bdb-dev/memB`.
3. **Re-Vendor Consumers with Exact Paths:**
   * `/Users/timrennings/bdb-dev/bdb-dev-optimized-agent-skills/mcps/memb-mcp/`
   * `/Users/timrennings/bdb-dev/bdb-dev-optimized-antigravity-skills/mcps/memb-mcp/`
   * `/Users/timrennings/bdb-dev/bdb-dev-optimized-agent-skills-basic/mcps/memb-mcp/`
   * `/Users/timrennings/bdb-dev/bdb-dev-tool-installer/tools/memb-mcp/` *(Note path distinction)*
4. **Automated Verification Suite:**
   * Concurrency: 10 parallel threads writing simultaneously to verify zero SQLite locking.
   * Hybrid Search: Exact technical symbol queries (`PRAGMA journal_mode`, port numbers) returning via BM25 + dense score.
   * Auto-Inject: Inspect `.cursor/rules/999_memb_context.mdc` for zero `None` strings.

---

## 4. Execution Gating

This specification is **100% hardened, verified against the codebase, and ready for immediate execution**.  
Awaiting explicit user confirmation (**"GO"**) to begin implementation.

---

## 5. Review Notes — Codebase Verification (2026-08-22)

> Findings from verifying every claim in this document against the actual repositories:

### 5.1 Verified Correct
- **All 4 target file paths exist:** `numpy_flat.py`, `run.py`, `memb_ingest.py`, `memb_auto_inject.py`.
- **All 5 consumer repositories exist.**
- **Phase 1 premise confirmed:** 10 × raw `sqlite3.connect()` calls identified for replacement with WAL-enabled connection helper.
- **Phase 2 tool gap confirmed:** Expanding from 4 to 8 tools.
- **Phase 3 bug confirmed:** `m.get('document')` payload key bug identified in `memb_auto_inject.py`.

### 5.2 Blockers Resolved in Specification
- **B1 (FTS5 Write Path & Backfill):** Fully specified in Phase 1 with table creation, auto-backfill on start, and synchronized `insert()`, `update()`, and `delete()` handlers.
- **B2 (delete_all Safety Guard):** Scoped filtering mandated so specifying `project_id` never deletes other projects.
- **B3 (Chunk Migration):** `--purge-project` CLI flag added to `memb_ingest.py` to prevent orphaned old 4KB chunks.
- **B4 (All 10 SQLite Call Sites):** Explicitly required to use `self._get_connection()` throughout `numpy_flat.py`.
