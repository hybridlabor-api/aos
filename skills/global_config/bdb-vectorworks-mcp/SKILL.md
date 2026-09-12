---
name: bdb-vectorworks-mcp
description: Utilizes the Vectorworks RAG + MCP server to search and retrieve Python and VectorScript API documentation.
category: media-eventtech
---

# Vectorworks RAG MCP — Integration and AI Agent Guide

This skill file instructs AI agents on how to utilize the Vectorworks RAG (Retrieval-Augmented Generation) and MCP server. It details documentation searches, VectorScript code generation, and troubleshooting steps.

## 1. Overview and Pipeline Value

The **Vectorworks RAG + MCP Server** integrates local Vectorworks Python and VectorScript developer documentation. Using sentence-transformers and a FAISS semantic index, it provides immediate API lookups and code generation recommendations directly to AI models. This avoids syntax hallucinations when generating CAD or BIM layout scripts.

### Architecture
- **FastAPI / WebSocket Server:** Exposes search routes (`/search`, `/answer`) and a WebSocket JSON-RPC 2.0 interface (default port `8765`) acting as the MCP endpoint.
- **FAISS Vector Index:** Performs local CPU-bound cosine similarity queries against chunked document sources.
- **Dockerized Environment:** Package compose wraps the indexer, database, and FastAPI applications.

---

## 2. System Instructions

### Workflow Priorities
1. **API Validation first:** Before generating any VectorScript or Vectorworks Python script, query the RAG database to verify the function signature (e.g. parameter order, return values).
2. **Context boundaries:** VectorScript (Pascal-based syntax) and Vectorworks Python have specific execution rules. Explicitly query RAG if you are unsure how attributes or records are handled.
3. **Drafting Verification:** Use `vw.answer` to receive a detailed breakdown with citations. Do not write complex routines without consulting the retrieved document chunks first.

---

## 3. Available Tools and API Parameters

The server provides three tools via WebSocket:

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| **`vw.search`** | `query: string`, `k?: int` (default 6) | Returns semantic search hits from the Vectorworks SDK/VectorScript references. |
| **`vw.answer`** | `query: string`, `k?: int` | Returns a draft explanation or script snippet synthesized from indexed document blocks. |
| **`vw.get`** | `doc_id: string`, `chunk_id: string` | Retrieves a specific document chunk to review source context or examples. |

---

## 4. Code Recipes and Prompt Cookbook

### Recipe 1: Retrieve Function Signatures
Find details on drawing a standard rectangle with attributes using VectorScript:

```json
// Tool Call: vw.search
{
  "query": "Rect or CreateRectangle or PushAttrs"
}

// Tool Call: vw.answer
{
  "query": "How do I draw a rectangle in VectorScript and set its fill color?"
}
```

### Recipe 2: VectorScript Structure Example
Consulting a search result from `vw.get`, construct a standard VectorScript block:

```pascal
Procedure CreateCustomRect;
VAR
    h : HANDLE;
Begin
    { Draw rectangle }
    Rect(0, 0, 150, 100);
    h := LNewObj;
    
    { Set fill style and color to red }
    SetFPat(h, 1); { Solid fill }
    SetFillBack(h, 65535, 0, 0); { RGB 16-bit color }
    
    ReDraw;
End;
Run(CreateCustomRect);
```

---

## 5. Troubleshooting and Connection Details

### Configuration and Setup
- **Web Interface:** `http://localhost:8000` (FastAPI UI)
- **MCP WebSocket URL:** `ws://localhost:8765`
- **Port Settings:**
  - `API_PORT` (FastAPI): Default `8000`
  - `MCP_PORT` (WebSocket): Default `8765`

### Connection Verification
Ensure the Docker containers are running and port `8765` is bound:
```bash
# Verify WebSocket port
curl http://localhost:8000/search?q=PushAttrs
```

### Rebuilding index
If you update or add new documentation files inside the `data/` folder, rebuild the FAISS database index:
```bash
docker compose run --rm app python -m app.indexer --rebuild
```

### Common Errors and Fixes
1. **`Connection Refused on ws://localhost:8765`**
   - *Cause:* The Docker containers are not running, or the app container crashed.
   - *Fix:* Run `docker compose up -d` in the `vectorworks-mcp` directory and inspect container logs via `docker compose logs app`.
2. **`API signature hallucination / Incorrect Pascal syntax`**
   - *Cause:* The AI did not consult the RAG database before generating the code block.
   - *Fix:* Force the agent to run `vw.search` with the specific function name or topic, then review output references.
