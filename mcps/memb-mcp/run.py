import os
import sys
from typing import Optional, List, Dict, Any

# Ensure local memb module is importable first
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

# Resolve dependencies if running through uv or mcp wrapper
from mcp.server.fastmcp import FastMCP
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
            "model": "gemini-1.5-flash"
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
    category: str = "godmode", 
    project_id: Optional[str] = None
) -> str:
    """Adds a new fact, workflow pattern, or design guideline to the agent's long-term memory.
    
    Args:
        text: The text statement or fact to remember.
        user_id: Unique identifier for the developer user.
        category: Memory scope type. Use 'godmode' for global, 'media' for TouchDesigner, 'web' for React/frontend, 'software' for APIs/Python.
        project_id: Optional folder name of the active project (e.g. 'VisualSelect_By_BDB') to isolate context.
    """
    metadata = {
        "category": category,
        "user_id": user_id
    }
    if project_id:
        metadata["project_id"] = project_id
        
    memory.add(text, user_id=user_id, metadata=metadata)
    return f"Successfully added memory to category '{category}'" + (f" (Project: {project_id})" if project_id else "")

@mcp.tool()
def search_memory(
    query: str, 
    user_id: str = "bdb_developer", 
    limit: int = 5,
    project_id: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Queries the local semantic database for relevant memories, configurations, and styles.
    
    Args:
        query: The semantic search query term.
        user_id: The developer user identifier.
        limit: Maximum number of memories to return.
        project_id: Optional active project directory name to fetch project-specific memories in addition to global God Mode memories.
    """
    # 1. Fetch global God Mode memories
    godmode_res = memory.search(query=query, filters={"category": "godmode", "user_id": user_id}, top_k=limit)
    results = godmode_res.get("results", [])
    
    # 2. Fetch project-specific memories if requested
    if project_id:
        project_res = memory.search(query=query, filters={"project_id": project_id, "user_id": user_id}, top_k=limit)
        results.extend(project_res.get("results", []))
        
    # Remove duplicates and sort by similarity score descending
    seen_ids = set()
    unique_results = []
    for item in results:
        m_id = item.get("id")
        if m_id not in seen_ids:
            seen_ids.add(m_id)
            unique_results.append(item)
            
    unique_results.sort(key=lambda x: x.get("score", 0.0), reverse=True)
    return unique_results[:limit]

@mcp.tool()
def list_memories(user_id: str = "bdb_developer", limit: int = 50) -> List[Dict[str, Any]]:
    """Lists all active memories stored locally in SQLite for this user.
    
    Args:
        user_id: The developer user identifier.
        limit: Max number of records to return.
    """
    # get_all() takes top_k; a "limit" kwarg is silently swallowed and the default of 20 applies.
    all_m = memory.get_all(filters={"user_id": user_id}, top_k=limit)
    return all_m.get("results", []) if all_m else []

@mcp.tool()
def delete_memory(memory_id: str) -> str:
    """Removes a specific memory segment by its unique UUID.
    
    Args:
        memory_id: UUID of the memory item.
    """
    memory.delete(memory_id)
    return f"Successfully deleted memory with ID {memory_id}"

if __name__ == "__main__":
    mcp.run()
