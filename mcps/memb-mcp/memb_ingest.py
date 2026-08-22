#!/usr/bin/env python3
"""
memB Deep Ingestion Tool
Scans any directory path (e.g. ~/projects/my-app or custom project folders),
extracts project architectures, tech specs, READMEs, agent.md, openwiki notes, and past transcripts,
and ingests them into memB local vector memory (~/.MemBDB/memb.db).
"""

import os
import sys
import json
import glob
import argparse
import shutil
import hashlib
from typing import List, Dict, Any, Optional, NamedTuple

# Consoles and redirected pipes fall back to the locale codepage (e.g. cp1252 on German
# Windows), which cannot encode the status emojis used below.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Ensure local memb module is importable
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

try:
    from memb import Memory
except ImportError:
    print("Error: Could not import memB module.", file=sys.stderr)
    sys.exit(1)


def init_memory():
    """Initialize the local memB Memory instance with ONNX embedder."""
    # Memory.from_config() eagerly builds an OpenAI LLM client regardless of any other
    # provider key, although ingestion never calls an LLM (local_onnx embedder, infer=False).
    if "OPENAI_API_KEY" not in os.environ:
        os.environ["OPENAI_API_KEY"] = "sk-dummy-key-for-local-onnx-ingestion"

    db_dir = os.environ.get("MEMB_DATA_DIR") or os.path.expanduser("~/.MemBDB")
    os.makedirs(db_dir, exist_ok=True)
    db_path = os.path.join(db_dir, "memb.db")
    history_db_path = os.path.join(db_dir, "history.db")
    
    memory_config = {
        "embedder": {
            "provider": "local_onnx",
            "config": {}
        },
        "vector_store": {
            "provider": "numpy_flat",
            "config": {
                "collection_name": "bdb_agent_memory",
                "path": db_path
            }
        },
        "history_db_path": history_db_path
    }
    return Memory.from_config(memory_config)


IGNORE_DIRS = {
    "node_modules", "vendor", ".git", ".venv", "venv", "__pycache__",
    ".pytest_cache", "dist", "build", ".next", ".cache", "backups"
}

TARGET_FILES = [
    "agent.md", "README.md", "README.de.md", "package.json",
    "pyproject.toml", "mcp_config.json", "registry.json", "CLAUDE.md"
]

MARKDOWN_EXTENSIONS = {".md", ".markdown", ".mdx"}

# Hard ceiling per file so a single oversized document cannot stall a whole run.
MAX_FILE_BYTES = 512 * 1024

# With --all-markdown long files are split into successive chunks instead of being
# cut off silently.
CHUNK_CHARS = 4000

# Without --all-markdown the ingestion keeps exactly the shape it had before this
# tool learned to chunk: one document per file, cut off at these limits. Chunking
# every file by default would multiply embedding calls, DB rows and ~/.MemBDB
# growth per run for existing users and change the recorded "source" values.
DEFAULT_DOC_CHARS = 4000
OPENWIKI_DOC_CHARS = 3000


# Tried in order; latin-1 accepts any byte sequence, so the lossy fallback below is a
# guard for exotic decoder failures only.
TEXT_ENCODINGS = ("utf-8", "utf-8-sig", "cp1252", "latin-1")


class FileRead(NamedTuple):
    """Outcome of reading one file: content is None when the file is unusable."""
    content: Optional[str]
    reason: Optional[str]
    truncated: bool


def is_markdown(fname: str) -> bool:
    return os.path.splitext(fname)[1].lower() in MARKDOWN_EXTENSIONS


def is_openwiki_path(path: str) -> bool:
    """True if path is, or lives inside, a .openwiki directory (platform neutral)."""
    return ".openwiki" in os.path.normpath(path).split(os.sep)


def read_text_file(path: str, truncate_oversized: bool = False) -> FileRead:
    """Read a text file, trying several encodings before falling back to lossy decoding.

    Files above MAX_FILE_BYTES are skipped, unless truncate_oversized is set: then their
    first CHUNK_CHARS characters are kept so no previously ingested file is lost.
    """
    try:
        size = os.path.getsize(path)
    except OSError as e:
        return FileRead(None, f"could not stat file ({e})", False)

    truncated = size > MAX_FILE_BYTES
    if truncated and not truncate_oversized:
        return FileRead(None, f"too large ({size // 1024} KB > {MAX_FILE_BYTES // 1024} KB limit)", False)

    def read_with(encoding: str, errors: Optional[str] = None) -> str:
        with open(path, "r", encoding=encoding, errors=errors) as f:
            return f.read(CHUNK_CHARS) if truncated else f.read()

    for encoding in TEXT_ENCODINGS:
        try:
            return FileRead(read_with(encoding).strip(), None, truncated)
        except UnicodeDecodeError:
            continue
        except OSError as e:
            return FileRead(None, f"could not read file ({e})", False)

    try:
        content = read_with("utf-8", errors="replace").strip()
    except OSError as e:
        return FileRead(None, f"could not read file ({e})", False)
    print(f"  ⚠ No matching encoding, undecodable bytes replaced: {path}")
    return FileRead(content, None, truncated)


def make_documents(source: str, project: str, doc_type: str, content: str,
                   chunked: bool = False, limit: int = DEFAULT_DOC_CHARS) -> List[Dict[str, Any]]:
    """Build the memB documents for one file.

    chunked=False (the default, i.e. every run without --all-markdown) reproduces
    the historical behaviour exactly: a single document holding the first *limit*
    characters, with the plain source value and no "[part i/n]" suffix.

    chunked=True splits the whole content into CHUNK_CHARS sized documents so
    nothing is lost by truncation.
    """
    if not chunked:
        return [{
            "source": source,
            "project": project,
            "type": doc_type,
            "content": content[:limit]
        }]

    chunks = [content[i:i + CHUNK_CHARS] for i in range(0, len(content), CHUNK_CHARS)]
    total = len(chunks)
    return [
        {
            "source": source if total == 1 else f"{source} [part {idx}/{total}]",
            "project": project,
            "type": doc_type,
            "content": chunk
        }
        for idx, chunk in enumerate(chunks, start=1)
    ]


def scan_directory(root_dir: str, project_name: str, all_markdown: bool = False) -> Dict[str, Any]:
    """Scan root_dir recursively for key project architecture files.

    With all_markdown=True every markdown file is picked up instead of only
    TARGET_FILES, and every captured file is split into CHUNK_CHARS sized documents.
    Without the flag the output is document-identical to the pre-chunking version:
    one document per file, cut off at DEFAULT_DOC_CHARS (OPENWIKI_DOC_CHARS for
    .openwiki notes).
    Returns {"documents": [...], "files_captured": int, "files_found": int}.
    """
    documents: List[Dict[str, Any]] = []
    counters = {"found": 0, "captured": 0}
    seen_paths = set()
    print(f"🔍 Scanning directory: {root_dir} for project '{project_name}'...")

    def collect(path: str, source: str, doc_type: str, truncate_oversized: bool = True,
                limit: int = DEFAULT_DOC_CHARS):
        # The openwiki pass and the generic walk can reach the same file; count it once.
        real_path = os.path.realpath(path)
        if real_path in seen_paths:
            return
        seen_paths.add(real_path)
        counters["found"] += 1
        # Files that were ingested before this flag existed keep their oversized content
        # (truncated) so nothing is lost; only the broad markdown sweep skips them.
        read = read_text_file(path, truncate_oversized=truncate_oversized)
        if read.truncated and read.content:
            kept = CHUNK_CHARS if all_markdown else min(CHUNK_CHARS, limit)
            print(f"  ✂ Truncated to the first {kept} chars "
                  f"(above {MAX_FILE_BYTES // 1024} KB limit): {source}")
        if read.content:
            documents.extend(make_documents(source, project_name, doc_type, read.content,
                                            chunked=all_markdown, limit=limit))
            counters["captured"] += 1
        elif read.reason:
            print(f"  ⚠ Skipped ({read.reason}): {source}")

    def result() -> Dict[str, Any]:
        return {
            "documents": documents,
            "files_captured": counters["captured"],
            "files_found": counters["found"]
        }

    # If the target path is directly a .openwiki directory or contains .openwiki
    if is_openwiki_path(root_dir):
        for wiki_file in os.listdir(root_dir):
            if wiki_file.endswith(".md"):
                collect(
                    os.path.join(root_dir, wiki_file),
                    f"{project_name}/.openwiki/{wiki_file}",
                    "openwiki_doc",
                    limit=OPENWIKI_DOC_CHARS
                )
        if documents:
            return result()

    for dirpath, dirnames, filenames in os.walk(root_dir):
        # Skip ignored directories
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS and not d.startswith(".")]

        # Check for openwiki docs
        openwiki_dir = os.path.join(dirpath, ".openwiki")
        if os.path.isdir(openwiki_dir):
            for wiki_file in os.listdir(openwiki_dir):
                if wiki_file.endswith(".md"):
                    collect(
                        os.path.join(openwiki_dir, wiki_file),
                        f"{project_name}/.openwiki/{wiki_file}",
                        "openwiki_doc",
                        limit=OPENWIKI_DOC_CHARS
                    )

        # Check for target project files
        for fname in filenames:
            if fname in TARGET_FILES:
                f_path = os.path.join(dirpath, fname)
                collect(f_path, os.path.relpath(f_path, root_dir), fname)
            elif all_markdown and is_markdown(fname):
                f_path = os.path.join(dirpath, fname)
                collect(f_path, os.path.relpath(f_path, root_dir), "markdown_doc", truncate_oversized=False)

    return result()


def scan_antigravity_transcripts(max_sessions: int = 20) -> List[Dict[str, Any]]:
    """Scan Antigravity past conversation logs for key user instructions & decisions."""
    logs_base = os.path.expanduser("~/.gemini/antigravity-cli/brain")
    documents = []

    if not os.path.isdir(logs_base):
        return documents

    print(f"🧠 Scanning Antigravity conversation brain logs...")
    session_dirs = sorted(
        [os.path.join(logs_base, d) for d in os.listdir(logs_base) if os.path.isdir(os.path.join(logs_base, d))],
        key=os.path.getmtime,
        reverse=True
    )[:max_sessions]

    for sdir in session_dirs:
        transcript_path = os.path.join(sdir, ".system_generated", "logs", "transcript.jsonl")
        if not os.path.isfile(transcript_path):
            continue

        try:
            with open(transcript_path, "r", encoding="utf-8") as f:
                user_prompts = []
                for line in f:
                    try:
                        step = json.loads(line)
                        if step.get("type") == "USER_INPUT" and step.get("content"):
                            txt = step["content"].strip()
                            if len(txt) > 20 and not txt.startswith("/"):
                                user_prompts.append(txt)
                    except Exception:
                        pass

                if user_prompts:
                    session_id = os.path.basename(sdir)
                    summary = "\n- ".join(user_prompts[:5])
                    documents.append({
                        "source": f"chat_session_{session_id[:8]}",
                        "project": "chat_history",
                        "type": "conversation_transcript",
                        "content": f"User Decisions & Requirements in Session {session_id[:8]}:\n- {summary}"
                    })
        except Exception:
            pass

    return documents


def ingest_to_memb(memory: Any, documents: List[Dict[str, Any]], category: str,
                   coverage: Optional[Dict[str, int]] = None, purge_project: Optional[str] = None):
    """Ingest extracted documents into memB vector memory with MD5 content deduplication."""
    if purge_project:
        print(f"🧹 Purging existing memories for project '{purge_project}' before re-ingestion...")
        try:
            items = memory.vector_store.list(filters={"project_id": purge_project})
            for item in items:
                m_id = getattr(item, "id", None)
                if m_id:
                    memory.delete(m_id)
            print(f"  ✓ Purged {len(items)} existing records for '{purge_project}'")
        except Exception as e:
            print(f"  ✕ Purge error: {e}")

    # Build existing content hashes map for deduplication
    existing_hashes = set()
    try:
        existing_items = memory.vector_store.list()
        for item in existing_items:
            payload = getattr(item, "payload", {})
            h = payload.get("metadata", {}).get("content_hash")
            if h:
                existing_hashes.add(h)
    except Exception:
        pass

    print(f"💾 Ingesting {len(documents)} document snippets into memB (~/.MemBDB/memb.db)...")
    success_count = 0
    skipped_count = 0

    for doc in documents:
        content_hash = hashlib.md5(f"{doc['project']}:{doc['source']}:{doc['content']}".encode("utf-8")).hexdigest()
        if content_hash in existing_hashes:
            skipped_count += 1
            continue

        text_entry = f"[{doc['project']} | {doc['type']} | {doc['source']}]\n{doc['content']}"
        try:
            memory.add(
                text_entry,
                user_id="bdb_developer",
                metadata={
                    "project": doc["project"],
                    "project_id": doc["project"],
                    "type": doc["type"],
                    "source": doc["source"],
                    "category": category,
                    "content_hash": content_hash
                },
                infer=False
            )
            existing_hashes.add(content_hash)
            success_count += 1
            print(f"  ✓ Ingested: {doc['source']}")
        except Exception as e:
            print(f"  ✕ Failed ({doc['source']}): {e}")

    print(f"\n🎉 Finished memB ingestion: {success_count} added, {skipped_count} unchanged ({len(documents)} total processed)!")
    if coverage:
        print(f"📁 File coverage: {coverage['files_captured']}/{coverage['files_found']} "
              "candidate files captured in the scanned directory.")


def get_memory_title(data: str, mid: str) -> str:
    import re
    if not data: return mid[:8]
    clean = re.sub(r'[:/|\\#^\[\]]', '', data)
    clean = re.sub(r'[^\w\säöüßÄÖÜ]', ' ', clean)
    clean = re.sub(r'\s+', ' ', clean).strip()
    words = [w for w in clean.split() if len(w) > 2][:4]
    if not words: return mid[:8]
    return "_".join(words) + "_" + mid[:4]


def build_ai_vault(memory: Any):
    """Generates an AI-first flat-file markdown vault for native agent access."""
    print("🌸 Generating physical AI-first Vault (God Mode Topology)...")
    vault_dir = os.path.join(os.environ.get("MEMB_DATA_DIR", os.path.expanduser("~/.MemBDB")), "memB_Vault")
    shutil.rmtree(vault_dir, ignore_errors=True)
    os.makedirs(vault_dir, exist_ok=True)
    os.makedirs(os.path.join(vault_dir, "Projects"), exist_ok=True)
    
    # Write universal agent.md operating manual
    agent_md_content = """# memB Vault: Agent Operating Manual

This vault is an AI-first physical manifestation of the local `memB` vector database. It is auto-generated during ingestion to allow native file-system access.

## 1. Vault Topology (God Mode)
This vault strictly follows a Top-Down Radial Tree topology:
`God_Mode.md` -> `Projects` -> `Categories` -> `Clusters` -> `Memories`.
Agents can natively navigate this hierarchy using standard OS tools (`grep`, `list_dir`, `view_file`) without needing complex API calls.

## 2. The Vector Memory Engine & Sorting
Behind this physical vault lies the `~/.MemBDB/memb.db` SQLite/Vector database.
- **Sorting & Clustering:** During `memb_ingest`, all code, transcripts, and documentation are vectorized using a local lightweight embedding model. The data is structurally sorted by `Project` and `Category`, which physically manifests as the folders you see here.
- **Auto-Balancing:** To prevent context bloat and ensure crisp vector boundaries, any category exceeding 25 entries is mathematically chunked into Sub-Clusters.

## 3. Utilization by the 30MB Local LLM
The `memB` architecture is brutally optimized for ultra-fast inference on small, local models (e.g., 30MB-class ONNX embedders or tiny SLMs).
- **Zero-Compute Macro Context:** By maintaining this pre-computed physical tree, the small local LLM doesn't have to parse complex relational graphs or waste context tokens trying to figure out the system architecture. It simply reads `God_Mode.md` to instantly understand the ecosystem at near-zero token cost.
- **Micro-Targeted RAG:** When resolving a task, the local 30MB LLM uses the vector index to instantly retrieve only the 3-5 most relevant Memory payloads. Because the memories are atomically split into tiny, focused `.md` files (the Neurons), the small LLM's context window is never overwhelmed. It gets exactly the snippet it needs to execute a task accurately.
"""
    with open(os.path.join(vault_dir, "agent.md"), "w", encoding="utf-8") as f:
        f.write(agent_md_content)
    
    # get_all() takes top_k; a "limit" kwarg is silently swallowed and the default of 20 applies.
    all_mem = memory.get_all(filters={"user_id": "bdb_developer"}, top_k=10000)
    results = all_mem.get("results", []) if all_mem else []
    
    tree = {}
    for item in results:
        meta = item.get("metadata", {})
        p = meta.get("project") or meta.get("project_id") or "Global"
        c = meta.get("category") or "General"
        if c == "godmode": p = "Global"
        
        if p not in tree: tree[p] = {}
        if c not in tree[p]: tree[p][c] = []
        tree[p][c].append(item)
    
    # 1. God Mode Hub
    god_content = f"# 👑 GOD MODE: Core Knowledge Base\n\n> **Total Ecosystem Memories:** {len(results)}\n\n## 🌌 Projects\n\n"
    for proj in tree.keys():
        god_content += f"- [[Projects/{proj}/_Hub|Project: {proj}]]\n"
    with open(os.path.join(vault_dir, "God_Mode.md"), "w", encoding="utf-8") as f:
        f.write(god_content)
        
    # 2. Strict Top-Down Hierarchy
    for proj, categories in tree.items():
        proj_dir = os.path.join(vault_dir, "Projects", proj)
        os.makedirs(proj_dir, exist_ok=True)
        
        p_content = f"---\ntags:\n  - memB/project\n---\n\n# 🚀 Project: {proj}\n\n## Sub-Clusters\n"
        for cat in categories.keys():
            p_content += f"- [[Projects/{proj}/{cat}/_Hub|Category: {cat}]]\n"
        with open(os.path.join(proj_dir, "_Hub.md"), "w", encoding="utf-8") as f:
            f.write(p_content)
            
        for cat, items in categories.items():
            cat_dir = os.path.join(proj_dir, cat)
            os.makedirs(cat_dir, exist_ok=True)
            
            c_content = f"---\ntags:\n  - memB/category\n---\n\n# 🏷️ Category: {cat}\n\n"
            
            CLUSTER_SIZE = 25
            if len(items) > CLUSTER_SIZE:
                c_content += "## Memory Clusters\n"
                num_clusters = (len(items) + CLUSTER_SIZE - 1) // CLUSTER_SIZE
                for i in range(num_clusters):
                    c_name = f"Cluster_{i+1}"
                    c_dir = os.path.join(cat_dir, c_name)
                    os.makedirs(c_dir, exist_ok=True)
                    c_content += f"- [[Projects/{proj}/{cat}/{c_name}/_Hub|{c_name}]]\n"
                    
                    cl_content = f"---\ntags:\n  - memB/cluster\n---\n\n# 🌌 {c_name} ({cat})\n\n## 🧠 Memories\n"
                    c_items = items[i*CLUSTER_SIZE : (i+1)*CLUSTER_SIZE]
                    for item in c_items:
                        title = get_memory_title(item.get("document", ""), item.get("id", ""))
                        cl_content += f"- [[Projects/{proj}/{cat}/{c_name}/{title}|{title.replace('_', ' ')}]]\n"
                        m_content = f"---\nid: \"{item.get('id')}\"\ndate: \"{item.get('created_at', '')}\"\ntags: [memB/memory]\n---\n\n# 🧠 {title.replace('_', ' ')}\n\n## 📜 Payload\n\n{item.get('document', '')}\n"
                        with open(os.path.join(c_dir, f"{title}.md"), "w", encoding="utf-8") as f:
                            f.write(m_content)
                    with open(os.path.join(c_dir, "_Hub.md"), "w", encoding="utf-8") as f:
                        f.write(cl_content)
            else:
                c_content += "## 🧠 Memories\n"
                for item in items:
                    title = get_memory_title(item.get("document", ""), item.get("id", ""))
                    c_content += f"- [[Projects/{proj}/{cat}/{title}|{title.replace('_', ' ')}]]\n"
                    m_content = f"---\nid: \"{item.get('id')}\"\ndate: \"{item.get('created_at', '')}\"\ntags: [memB/memory]\n---\n\n# 🧠 {title.replace('_', ' ')}\n\n## 📜 Payload\n\n{item.get('document', '')}\n"
                    with open(os.path.join(cat_dir, f"{title}.md"), "w", encoding="utf-8") as f:
                        f.write(m_content)
            
            with open(os.path.join(cat_dir, "_Hub.md"), "w", encoding="utf-8") as f:
                f.write(c_content)
    
    print(f"✅ AI Vault successfully generated at {vault_dir}")


def main():
    parser = argparse.ArgumentParser(description="memB Deep Ingestion Tool")
    parser.add_argument("path", nargs="?", default=os.path.expanduser("~/bdb-dev"), help="File or directory path to ingest")
    parser.add_argument("--project", help="Explicit project name (defaults to folder basename)")
    parser.add_argument("--purge-project", help="Purge all previous memories for this project name before ingesting")
    parser.add_argument("--transcripts", action="store_true", help="Also mine past Antigravity conversation logs")
    parser.add_argument("--category", default="project_architecture", help="Memory category (e.g. 3D_Engine, Styling_System)")
    parser.add_argument("--all-markdown", action="store_true",
                        help="Capture every markdown file instead of only the fixed TARGET_FILES "
                             "whitelist, and split every captured file into chunks instead of "
                             "keeping only its first 4000 (3000 for .openwiki) characters")
    args = parser.parse_args()

    target_path = os.path.abspath(args.path)
    if not os.path.exists(target_path):
        print(f"Error: Path '{target_path}' does not exist.", file=sys.stderr)
        sys.exit(1)

    memory = init_memory()
    docs = []
    coverage = None

    if os.path.isfile(target_path):
        project_name = args.project or os.path.basename(os.path.dirname(target_path))
        read = read_text_file(target_path, truncate_oversized=True)
        if read.truncated and read.content:
            print(f"  ✂ Truncated to the first {CHUNK_CHARS} chars "
                  f"(above {MAX_FILE_BYTES // 1024} KB limit): {target_path}")
        if read.content:
            docs = make_documents(os.path.basename(target_path), project_name, "custom_file",
                                  read.content, chunked=args.all_markdown)
        elif read.reason:
            print(f"Error reading file {target_path}: {read.reason}", file=sys.stderr)
    else:
        project_name = args.project or os.path.basename(target_path)
        scan = scan_directory(target_path, project_name, all_markdown=args.all_markdown)
        docs = scan["documents"]
        coverage = {"files_captured": scan["files_captured"], "files_found": scan["files_found"]}

    if args.transcripts:
        chat_docs = scan_antigravity_transcripts(max_sessions=30)
        docs.extend(chat_docs)

    if docs:
        ingest_to_memb(memory, docs, category=args.category, coverage=coverage, purge_project=args.purge_project)
    elif coverage:
        print("No new documents to ingest "
              f"({coverage['files_captured']}/{coverage['files_found']} candidate files captured).")
    else:
        print("No new documents to ingest.")
        
    # Always rebuild the physical AI vault for agents
    build_ai_vault(memory)


if __name__ == "__main__":
    main()
