#!/usr/bin/env python3
"""Per-prompt semantic recall for the memb-inject hook.

Reads the prompt on stdin, runs memB's own hybrid search (`search_memory` in
the memB run.py: local ONNX embeddings plus BM25) and prints a JSON list of
{"memory", "score"} on stdout. Nothing else may reach stdout: the engine's
import and search noise is redirected to stderr.

Usage: memb-recall.py <limit> <memb-dir>
The hook spawns this under a hard time budget and skips silently on timeout,
so a slow engine start costs a missed hit, never a blocked prompt.
"""

import contextlib
import json
import os
import sys


def main() -> int:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    memb_dir = sys.argv[2] if len(sys.argv) > 2 else ""
    query = sys.stdin.read().strip()[:500]
    if not query or not memb_dir:
        print("[]")
        return 0
    sys.path.insert(0, memb_dir)
    with contextlib.redirect_stdout(sys.stderr):
        import run  # noqa: E402  (builds the memB engine on import)
        hits = run.search_memory(query, limit=limit)
    out = []
    for h in hits or []:
        text = str(h.get("memory") or "").strip()
        if text:
            try:
                score = float(h.get("score") or 0.0)
            except (TypeError, ValueError):
                score = 0.0
            out.append({"memory": " ".join(text.split()), "score": score})
    sys.stdout.write(json.dumps(out))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        # Fail open: no hits, exit 0.
        sys.stdout.write("[]")
        sys.exit(0)
