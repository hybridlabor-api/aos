#!/usr/bin/env python3
"""Per-prompt semantic recall for the memb-inject hook.

Reads the prompt on stdin, runs memB's own hybrid search (`search_memory` in
the memB run.py: local ONNX embeddings plus BM25) and prints a JSON list of
{"memory", "score"} on stdout. Nothing else may reach stdout: the engine's
import and search noise is redirected to stderr.

Usage: memb-recall.py <limit> <memb-dir> [<user_id>] [<project_id>]
The hook spawns this under a hard time budget and skips silently on timeout,
so a slow engine start costs a missed hit, never a blocked prompt.
"""

import contextlib
import inspect
import json
import os
import sys


def main() -> int:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    memb_dir = sys.argv[2] if len(sys.argv) > 2 else ""
    user_id = sys.argv[3].strip() if len(sys.argv) > 3 and sys.argv[3].strip() else None
    project_id = sys.argv[4].strip() if len(sys.argv) > 4 and sys.argv[4].strip() else None
    query = sys.stdin.read().strip()[:500]
    if not query or not memb_dir:
        print("[]")
        return 0
    sys.path.insert(0, memb_dir)
    with contextlib.redirect_stdout(sys.stderr):
        import run  # noqa: E402  (builds the memB engine on import)
        kwargs = {"limit": limit}
        try:
            sig = inspect.signature(run.search_memory)
            if "user_id" in sig.parameters and user_id:
                kwargs["user_id"] = user_id
            if "project_id" in sig.parameters and project_id:
                kwargs["project_id"] = project_id
        except Exception:
            pass
        hits = run.search_memory(query, **kwargs)
    out = []
    for h in hits or []:
        text = str(h.get("memory") or "").strip()
        if text:
            try:
                score = float(h.get("score") or 0.0)
            except (TypeError, ValueError):
                score = 0.0
            item = {"memory": " ".join(text.split()), "score": score}
            meta = h.get("metadata") if isinstance(h.get("metadata"), dict) else {}
            item["metadata"] = meta
            user = h.get("user_id") or meta.get("user_id")
            if user:
                item["user_id"] = str(user)
            proj = h.get("project_id") or meta.get("project_id") or h.get("project") or meta.get("project")
            if proj:
                item["project_id"] = str(proj)
            cat = h.get("category") or meta.get("category")
            if not cat and isinstance(h.get("categories"), list) and h["categories"]:
                cat = h["categories"][0]
            if cat:
                item["category"] = str(cat)
            out.append(item)
    sys.stdout.write(json.dumps(out))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        # Fail open: no hits, exit 0.
        sys.stdout.write("[]")
        sys.exit(0)
