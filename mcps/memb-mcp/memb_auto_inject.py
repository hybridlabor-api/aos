#!/usr/bin/env python3
"""
memB Auto-Injection Daemon / Script
Connects to the local memB VectorDB and automatically injects context into 
Cursor (.cursor/rules), Claude Code (CLAUDE.md), and GitHub Copilot (.github).
This implements the "Mem0-Style" File-Injection phase for closed IDEs.
"""

import os
import sys
import json
from typing import List, Dict, Any

current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

try:
    from memb import Memory
except ImportError:
    print("Error: Could not import memB module.", file=sys.stderr)
    sys.exit(1)

def init_memory():
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

def fetch_top_context(memory: Any, project_name: str) -> str:
    """Fetch Godmode and Project-specific memories to form the injected context."""
    context_parts = []
    
    # 1. Fetch Godmode & architectural rules
    godmode_memories = memory.search("developer preferences architecture rules", filters={"user_id": "bdb_developer"}, top_k=5)
    
    # 2. Fetch Project-specific rules
    project_memories = memory.search(f"{project_name} architecture decisions conventions", filters={"user_id": "bdb_developer"}, top_k=5)
    
    context_parts.append("# memB Auto-Injected Context")
    context_parts.append("The following knowledge was automatically retrieved from the memB vector engine.\n")
    
    context_parts.append("## Global Developer Preferences (Godmode)")
    if godmode_memories and 'results' in godmode_memories:
        for m in godmode_memories['results']:
            text = m.get("memory") or m.get("data") or m.get("document") or ""
            if text:
                context_parts.append(f"- {text.strip()}")

    context_parts.append(f"\n## Project Context: {project_name}")
    if project_memories and 'results' in project_memories:
        for m in project_memories['results']:
            meta = m.get('metadata', {})
            if meta.get('project') == project_name or meta.get('project_id') == project_name:
                text = m.get("memory") or m.get("data") or m.get("document") or ""
                if text:
                    context_parts.append(f"- {text.strip()}")

    if len(context_parts) <= 4:
        context_parts.append("- No specific project memory found. Rely on Godmode standards.")
        
    return "\n".join(context_parts)

def inject_cursor(target_dir: str, context: str):
    cursor_dir = os.path.join(target_dir, ".cursor", "rules")
    os.makedirs(cursor_dir, exist_ok=True)
    rule_path = os.path.join(cursor_dir, "999_memb_context.mdc")
    
    content = f"---\ndescription: memB Auto-Injected Knowledge Base\nglobs: *\n---\n\n{context}\n"
    with open(rule_path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"✅ Injected into Cursor: {rule_path}")

def inject_claude(target_dir: str, context: str):
    claude_dir = os.path.join(target_dir, ".claude")
    os.makedirs(claude_dir, exist_ok=True)
    rule_path = os.path.join(claude_dir, "CLAUDE.md")
    
    # If CLAUDE.md exists, we prepend or append. For simplicity, we overwrite with a specific memB block.
    # In a real daemon, we would safely parse and update the block.
    content = f"<!-- memB-start -->\n{context}\n<!-- memB-end -->\n"
    with open(rule_path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"✅ Injected into Claude Code: {rule_path}")

def inject_copilot(target_dir: str, context: str):
    github_dir = os.path.join(target_dir, ".github")
    os.makedirs(github_dir, exist_ok=True)
    rule_path = os.path.join(github_dir, "copilot-instructions.md")
    
    with open(rule_path, "w", encoding="utf-8") as f:
        f.write(context)
    print(f"✅ Injected into GitHub Copilot: {rule_path}")

def main():
    if len(sys.argv) > 1:
        target_dir = os.path.abspath(sys.argv[1])
    else:
        target_dir = os.getcwd()

    project_name = os.path.basename(target_dir)
    print(f"🚀 Running memB Auto-Injection for project '{project_name}' in {target_dir}")

    memory = init_memory()
    context = fetch_top_context(memory, project_name)

    inject_cursor(target_dir, context)
    inject_claude(target_dir, context)
    inject_copilot(target_dir, context)
    
    print("🎉 memB File Injection Complete. Agent prompts are now context-aware.")

if __name__ == "__main__":
    main()
