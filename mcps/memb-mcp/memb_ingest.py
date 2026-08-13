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
from typing import List, Dict, Any, Optional

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
    if "OPENAI_API_KEY" not in os.environ and "GEMINI_API_KEY" not in os.environ:
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


def scan_directory(root_dir: str, project_name: str) -> List[Dict[str, Any]]:
    """Scan root_dir recursively for key project architecture files."""
    documents = []
    print(f"🔍 Scanning directory: {root_dir} for project '{project_name}'...")

    # If the target path is directly a .openwiki directory or contains .openwiki
    if os.path.basename(root_dir.rstrip("/")) == ".openwiki" or "/.openwiki" in root_dir:
        for wiki_file in os.listdir(root_dir):
            if wiki_file.endswith(".md"):
                w_path = os.path.join(root_dir, wiki_file)
                try:
                    with open(w_path, "r", encoding="utf-8") as f:
                        content = f.read().strip()
                    if content:
                        documents.append({
                            "source": f"{project_name}/.openwiki/{wiki_file}",
                            "project": project_name,
                            "type": "openwiki_doc",
                            "content": content[:3000]
                        })
                except Exception:
                    pass
        if documents:
            return documents

    for dirpath, dirnames, filenames in os.walk(root_dir):
        # Skip ignored directories
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS and not d.startswith(".")]

        # Check for openwiki docs
        openwiki_dir = os.path.join(dirpath, ".openwiki")
        if os.path.isdir(openwiki_dir):
            for wiki_file in os.listdir(openwiki_dir):
                if wiki_file.endswith(".md"):
                    w_path = os.path.join(openwiki_dir, wiki_file)
                    try:
                        with open(w_path, "r", encoding="utf-8") as f:
                            content = f.read().strip()
                        if content:
                            documents.append({
                                "source": f"{project_name}/.openwiki/{wiki_file}",
                                "project": project_name,
                                "type": "openwiki_doc",
                                "content": content[:3000]
                            })
                    except Exception:
                        pass

        # Check for target project files
        for fname in filenames:
            if fname in TARGET_FILES:
                f_path = os.path.join(dirpath, fname)
                try:
                    with open(f_path, "r", encoding="utf-8") as f:
                        content = f.read().strip()
                    if content:
                        documents.append({
                            "source": os.path.relpath(f_path, root_dir),
                            "project": project_name,
                            "type": fname,
                            "content": content[:4000]
                        })
                except Exception:
                    pass

    return documents


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


def ingest_to_memb(memory: Any, documents: List[Dict[str, Any]], category: str):
    """Ingest extracted documents into memB vector memory."""
    print(f"💾 Ingesting {len(documents)} document snippets into memB (~/.MemBDB/memb.db)...")
    success_count = 0

    for doc in documents:
        text_entry = f"[{doc['project']} | {doc['type']} | {doc['source']}]\n{doc['content']}"
        try:
            memory.add(
                text_entry,
                user_id="bdb_developer",
                metadata={"project": doc["project"], "type": doc["type"], "source": doc["source"], "category": category},
                infer=False
            )
            success_count += 1
            print(f"  ✓ Ingested: {doc['source']}")
        except Exception as e:
            print(f"  ✕ Failed ({doc['source']}): {e}")

    print(f"\n🎉 Finished memB ingestion: {success_count}/{len(documents)} entries successfully indexed!")


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
    
    all_mem = memory.get_all(filters={"user_id": "bdb_developer"}, limit=10000)
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
    parser.add_argument("--transcripts", action="store_true", help="Also mine past Antigravity conversation logs")
    parser.add_argument("--category", default="project_architecture", help="Memory category (e.g. 3D_Engine, Styling_System)")
    args = parser.parse_args()

    target_path = os.path.abspath(args.path)
    if not os.path.exists(target_path):
        print(f"Error: Path '{target_path}' does not exist.", file=sys.stderr)
        sys.exit(1)

    memory = init_memory()
    docs = []

    if os.path.isfile(target_path):
        project_name = args.project or os.path.basename(os.path.dirname(target_path))
        try:
            with open(target_path, "r", encoding="utf-8") as f:
                content = f.read().strip()
            if content:
                docs.append({
                    "source": os.path.basename(target_path),
                    "project": project_name,
                    "type": "custom_file",
                    "content": content[:4000]
                })
        except Exception as e:
            print(f"Error reading file {target_path}: {e}", file=sys.stderr)
    else:
        project_name = args.project or os.path.basename(target_path)
        docs = scan_directory(target_path, project_name)

    if args.transcripts:
        chat_docs = scan_antigravity_transcripts(max_sessions=30)
        docs.extend(chat_docs)

    if docs:
        ingest_to_memb(memory, docs, category=args.category)
    else:
        print("No new documents to ingest.")
        
    # Always rebuild the physical AI vault for agents
    build_ai_vault(memory)


if __name__ == "__main__":
    main()
