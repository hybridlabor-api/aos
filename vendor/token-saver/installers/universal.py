import os
import sys


def _force_utf8_stdio():
    """Force UTF-8 on stdout/stderr so emoji in output never crashes
    on Windows (default cp1252 cannot encode them)."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (AttributeError, OSError, ValueError):
                pass


_force_utf8_stdio()


def install(use_symlink=False):
    print("\n--- Universal Agent Harness (IDE & CLI Rules) ---")
    
    rule_content = """---
name: heimdall-token-saver
description: Instructions for using Heimdall Token Saver to compress terminal output.
---

# Heimdall Token Saver (Context Compression)

You have access to the `token-saver` CLI tool. 
Whenever you execute terminal commands that produce large outputs (e.g., `git diff`, `npm install`, `pytest`, `cargo test`, `kubectl`, `terraform`), you MUST prefix your command with `token-saver run`.

Example:
❌ `git diff`
✅ `token-saver run 'git diff'`

❌ `pytest -v`
✅ `token-saver run 'pytest -v'`

This compresses the terminal output, saving 60-99% of your context window tokens while preserving all critical errors and information. Do not use this for interactive commands like `nano` or `vim`.
"""

    workspace_dir = os.getcwd()

    targets = {
        "Cursor": ".cursor/rules/998_heimdall_token_saver.mdc",
        "Windsurf": ".windsurf/rules/998_heimdall_token_saver.mdc",
        "GitHub Copilot": ".github/copilot-instructions.md",
        "Codex": ".codex-plugin/system.md",
        "Kiro IDE & CLI": ".kiro/rules.md",
        "OpenCode": ".opencode/system.md",
        "Command Code": ".commandcode/rules.md",
        "Gemini CLI": ".gemini/rules.md",
        "Other Agents": "agent.md"
    }

    for agent_name, file_path in targets.items():
        full_path = os.path.join(workspace_dir, file_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        
        # If it's a generic file like agent.md or copilot-instructions.md, we append.
        # Otherwise, we write the rule file directly.
        if "rules" not in file_path.split("/") and os.path.exists(full_path):
            with open(full_path, "r", encoding="utf-8") as f:
                existing_content = f.read()
            if "token-saver" not in existing_content:
                with open(full_path, "a", encoding="utf-8") as f:
                    f.write("\n\n" + rule_content)
                print(f"✅ Appended Heimdall rules to {agent_name} ({file_path})")
        else:
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(rule_content)
            print(f"✅ Injected Heimdall rules for {agent_name} ({file_path})")

def uninstall():
    print("\n--- Universal Agent Harness (IDE & CLI Rules) ---")
    targets = [
        ".cursor/rules/998_heimdall_token_saver.mdc",
        ".windsurf/rules/998_heimdall_token_saver.mdc"
    ]
    workspace_dir = os.getcwd()
    for file_path in targets:
        full_path = os.path.join(workspace_dir, file_path)
        if os.path.exists(full_path):
            os.remove(full_path)
            print(f"🗑️  Removed {file_path}")
