import os
import sys
from typing import Optional, List, Dict, Any

# Ensure local memb module is importable first
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

# Resolve dependencies if running through uv or mcp wrapper
try:
    from mcp.server.fastmcp import FastMCP
except ImportError:
    from fastmcp import FastMCP

from memb import Memory

mcp = FastMCP("BDB memB Local Persistent Memory")

# Initialize local Memory instance
db_dir = os.environ.get("MEMB_DATA_DIR") or os.path.expanduser("~/.MemBDB")
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
    "llm": {
        "provider": "gemini",
        "config": {
            "model": os.environ.get("MEMB_LLM_MODEL", "gemini-2.0-flash")
        }
    },
    "history_db_path": history_db_path
}

# Ensure data directory exists
os.makedirs(db_dir, exist_ok=True)
memory = Memory.from_config(memory_config)


@mcp.tool()
def add_memory(
    text: str, 
    user_id: str = "bdb_developer", 
    category: str = "coding_conventions", 
    project_id: Optional[str] = None,
    infer: bool = True
) -> str:
    """Adds a new fact, workflow pattern, architectural decision, or convention to persistent memory.
    
    Args:
        text: The text statement or fact to remember.
        user_id: Unique identifier for the developer user.
        category: Upstream development category. Options include:
                  'architecture_decisions', 'bug_fixes', 'coding_conventions', 'tooling_setup',
                  'anti_patterns', 'task_learnings', 'user_preferences', 'dependency_decisions',
                  'performance_findings', 'security_constraints', 'testing_patterns', 'data_model',
                  'api_contracts', 'deployment_runbook', 'team_norms', 'domain_glossary', 'godmode'.
        project_id: Optional directory name of the active project to isolate project-scoped context.
        infer: If True, uses LLM to extract structured facts. If False or on timeout, saves verbatim.
    """
    metadata = {
        "category": category
    }
    if project_id:
        metadata["project_id"] = project_id
        metadata["project"] = project_id
        
    try:
        memory.add(text, user_id=user_id, metadata=metadata, infer=infer)
    except Exception:
        # Graceful offline fallback: insert raw text without LLM inference
        memory.add(text, user_id=user_id, metadata=metadata, infer=False)
        
    return f"Successfully added memory to category '{category}'" + (f" (Project: {project_id})" if project_id else "")


@mcp.tool()
def search_memory(
    query: str, 
    user_id: str = "bdb_developer", 
    limit: int = 5,
    category: Optional[str] = None,
    project_id: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Hybrid semantic vector + BM25 keyword search across stored memories.
    
    Args:
        query: The search query term.
        user_id: The developer user identifier.
        limit: Maximum number of memories to return.
        category: Optional category filter. If omitted, searches all categories.
        project_id: Optional project directory name filter.
    """
    results_map: Dict[str, Dict[str, Any]] = {}
    filters = {"user_id": user_id}
    if category:
        filters["category"] = category
    if project_id:
        filters["project_id"] = project_id
        
    # 1. Dense Semantic Vector Search
    try:
        if category or project_id:
            dense_res = memory.search(query=query, filters=filters, top_k=limit)
        else:
            dense_res = memory.search(query=query, filters={"user_id": user_id}, top_k=max(limit * 2, 10))
        for item in dense_res.get("results", []):
            m_id = item.get("id")
            if m_id:
                results_map[m_id] = item
    except Exception:
        pass
        
    # 2. Native FTS5 BM25 Keyword Search
    try:
        bm25_res = memory.vector_store.keyword_search(query=query, top_k=limit, filters=filters if (category or project_id) else None)
        for r in bm25_res:
            m_id = getattr(r, "id", None)
            if m_id:
                if m_id in results_map:
                    # Boost score if found by both dense and sparse
                    results_map[m_id]["score"] = min(1.0, results_map[m_id].get("score", 0.5) * 1.25)
                else:
                    payload = getattr(r, "payload", {})
                    results_map[m_id] = {
                        "id": m_id,
                        "memory": payload.get("data") or payload.get("memory") or "",
                        "score": round(getattr(r, "score", 0.5), 4),
                        "metadata": payload.get("metadata", {}),
                        "categories": payload.get("categories", [payload.get("category", "general")]),
                        "created_at": payload.get("created_at")
                    }
    except Exception:
        pass
        
    final_list = list(results_map.values())
    final_list.sort(key=lambda x: x.get("score", 0.0), reverse=True)
    return final_list[:limit]


@mcp.tool()
def get_memory(memory_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves a single memory item by its unique UUID.
    
    Args:
        memory_id: UUID of the memory item.
    """
    try:
        return memory.get(memory_id)
    except Exception:
        return None


@mcp.tool()
def update_memory(memory_id: str, text: str, metadata: Optional[Dict[str, Any]] = None) -> str:
    """Updates an existing memory statement and recalculates its embeddings and search index.
    
    Args:
        memory_id: UUID of the memory item.
        text: Updated memory content text.
        metadata: Optional dictionary of metadata to update.
    """
    try:
        memory.update(memory_id, data=text)
        return f"Successfully updated memory {memory_id}"
    except Exception as e:
        return f"Failed to update memory: {str(e)}"


@mcp.tool()
def list_memories(
    user_id: str = "bdb_developer", 
    limit: int = 50,
    category: Optional[str] = None,
    project_id: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Lists active memories stored locally for this user with optional filtering.
    
    Args:
        user_id: The developer user identifier.
        limit: Max number of records to return.
        category: Optional category filter.
        project_id: Optional project identifier filter.
    """
    filters = {"user_id": user_id}
    if category:
        filters["category"] = category
    if project_id:
        filters["project_id"] = project_id
        
    all_m = memory.get_all(filters=filters, top_k=limit)
    return all_m.get("results", []) if all_m else []


@mcp.tool()
def delete_memory(memory_id: str) -> str:
    """Removes a specific memory segment by its unique UUID.
    
    Args:
        memory_id: UUID of the memory item.
    """
    memory.delete(memory_id)
    return f"Successfully deleted memory with ID {memory_id}"


@mcp.tool()
def delete_all_memories(
    user_id: Optional[str] = None,
    project_id: Optional[str] = None
) -> str:
    """Safely deletes memories matching a specific project or user scope without wiping unrelated data.
    
    Args:
        user_id: Developer user ID to clear.
        project_id: Specific project name to clear memories for.
    """
    if not user_id and not project_id:
        return "Error: Refusing to delete all memories without at least one filter scope (user_id or project_id)."
        
    filters = {}
    if user_id:
        filters["user_id"] = user_id
    if project_id:
        filters["project_id"] = project_id
        
    items = memory.vector_store.list(filters=filters)
    deleted_count = 0
    for item in items:
        m_id = getattr(item, "id", None)
        if m_id:
            memory.delete(m_id)
            deleted_count += 1
            
    return f"Successfully deleted {deleted_count} memories matching scope (user_id={user_id}, project_id={project_id})"


@mcp.tool()
def list_entities(entity_type: str = "projects") -> List[str]:
    """Lists distinct projects, categories, or user identifiers currently registered in memory.
    
    Args:
        entity_type: Type of entities to inspect ('projects', 'categories', or 'users').
    """
    items = memory.vector_store.list()
    entities = set()
    for item in items:
        payload = getattr(item, "payload", {})
        if entity_type == "projects":
            proj = payload.get("project_id") or payload.get("project")
            if proj:
                entities.add(str(proj))
        elif entity_type == "categories":
            cat = payload.get("category")
            if cat:
                entities.add(str(cat))
            for c in payload.get("categories", []):
                entities.add(str(c))
        elif entity_type == "users":
            u = payload.get("user_id")
            if u:
                entities.add(str(u))
                
    return sorted(list(entities))


if __name__ == "__main__":
    mcp.run()

