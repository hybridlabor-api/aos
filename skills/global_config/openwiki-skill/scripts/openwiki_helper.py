#!/usr/bin/env python3
import os
import sys
import json
import hashlib
import argparse
import subprocess
from datetime import datetime

def run_cmd(args, cwd=None):
    try:
        res = subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=True)
        return res.stdout.strip()
    except subprocess.CalledProcessError as e:
        return f"Error running command {' '.join(args)}: {e.stderr.strip()}"
    except Exception as e:
        return f"Exception running command {' '.join(args)}: {str(e)}"

def collect_evidence(cwd):
    git_summary = []
    
    # 1. Get current commit HEAD
    head = run_cmd(["git", "rev-parse", "HEAD"], cwd)
    if head.startswith("Error") or head.startswith("Exception"):
        return f"Not a git repository or git is not initialized: {head}"
    git_summary.append(f"### Git HEAD\n{head}")
    
    # 2. Get status (unstaged / staged changes)
    status = run_cmd(["git", "status", "--short"], cwd)
    git_summary.append(f"### Git Status (Short)\n{status if status else '(clean working directory)'}")
    
    # 3. Read metadata from .openwiki/.last-update.json
    metadata_path = os.path.join(cwd, ".openwiki", ".last-update.json")
    last_update = None
    if os.path.exists(metadata_path):
        try:
            with open(metadata_path, "r") as f:
                last_update = json.load(f)
        except Exception as e:
            git_summary.append(f"*(Warning: Could not parse existing .last-update.json: {e})*")
            
    # 4. Git log since last documentation sync
    if last_update and "gitHead" in last_update:
        last_head = last_update["gitHead"]
        if last_head != head:
            log = run_cmd(["git", "log", f"{last_head}..HEAD", "--name-status", "--oneline"], cwd)
            git_summary.append(f"### Git Changes since last Wiki Update ({last_head})\n{log if log else '(no changes in commits)'}")
        else:
            git_summary.append("### Git Commit Log\nHEAD matches last update gitHead. No new commits since last update.")
    else:
        log = run_cmd(["git", "log", "-n", "15", "--name-status", "--oneline"], cwd)
        git_summary.append(f"### Recent Git Commits\n{log if log else '(no commit history)'}")
        
    # 5. Unstaged diff of files excluding .openwiki, package.json version changes, etc.
    diff = run_cmd(["git", "diff", "--name-status"], cwd)
    git_summary.append(f"### Unstaged File Diffs\n{diff if diff else '(no unstaged changes)'}")
    
    return "\n\n".join(git_summary)

def calculate_snapshot(folder):
    if not os.path.exists(folder):
        return "empty"
    hasher = hashlib.sha256()
    # Walk and sort to ensure deterministic hashing
    for root, dirs, files in sorted(os.walk(folder)):
        # Skip hidden folders / metadata files that change without content meaning
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for file in sorted(files):
            if file in [".last-update.json", "_plan.md", "README.md", "agent.md", "CLAUDE.md"]:
                continue
            path = os.path.join(root, file)
            rel_path = os.path.relpath(path, folder)
            hasher.update(f"file:{rel_path}\0".encode("utf-8"))
            try:
                with open(path, "rb") as f:
                    hasher.update(f.read())
                hasher.update(b"\0")
            except Exception:
                pass
    return hasher.hexdigest()

def execute_commit(cwd):
    # Verify we have changes to commit in .openwiki, README.md, agent.md or CLAUDE.md
    paths_to_stage = [".openwiki", "README.md", "agent.md", "CLAUDE.md"]
    modified_paths = []

    for path in paths_to_stage:
        full_path = os.path.join(cwd, path)
        if os.path.exists(full_path):
            status = run_cmd(["git", "status", "--porcelain", path], cwd)
            if status:
                modified_paths.append(path)

    if not modified_paths:
        return "No documentation changes detected to commit."

    # Stage the documentation files
    for path in modified_paths:
        run_cmd(["git", "add", path], cwd)

    # Commit the changes. Repos without a git identity need an explicit author
    # passed on the command line; never write git config.
    msg = "docs(wiki): update project specs and codebase documentation [auto]"
    commit_args = ["git", "commit", "-m", msg]
    email = run_cmd(["git", "config", "user.email"], cwd)
    if not email or email.startswith("Error") or email.startswith("Exception"):
        commit_args.insert(1, "-c")
        commit_args.insert(2, "user.name=AOS OpenWiki")
        commit_args.insert(3, "-c")
        commit_args.insert(4, "user.email=openwiki@aos.local")
    commit_res = run_cmd(commit_args, cwd)
    return f"Successfully committed documentation changes:\n{commit_res}"

def main():
    parser = argparse.ArgumentParser(description="OpenWiki Antigravity Skill Helper")
    parser.add_argument("--command", required=True, choices=["collect", "pre-snapshot", "post-snapshot", "commit"])
    parser.add_argument("--cwd", default=os.getcwd())
    parser.add_argument("--pre-hash", default=None)
    parser.add_argument("--model", default=os.environ.get("OPENWIKI_MODEL", ""))  # set the current model ID via OPENWIKI_MODEL
    parser.add_argument("--run-type", default="update", choices=["init", "update"])
    args = parser.parse_args()

    wiki_folder = os.path.join(args.cwd, ".openwiki")
    
    if args.command == "collect":
        print(collect_evidence(args.cwd))
    elif args.command == "pre-snapshot":
        print(calculate_snapshot(wiki_folder))
    elif args.command == "post-snapshot":
        post_hash = calculate_snapshot(wiki_folder)
        if args.pre_hash and args.pre_hash == post_hash:
            print("NO_CHANGES")
        else:
            metadata_path = os.path.join(wiki_folder, ".last-update.json")
            os.makedirs(os.path.dirname(metadata_path), exist_ok=True)
            head = run_cmd(["git", "rev-parse", "HEAD"], args.cwd)
            metadata = {
                "updatedAt": datetime.utcnow().isoformat() + "Z",
                "command": args.run_type,
                "gitHead": head if not head.startswith("Error") else None,
                "model": args.model,
                "contentHash": post_hash
            }
            try:
                with open(metadata_path, "w") as f:
                    json.dump(metadata, f, indent=2)
                print("METADATA_WRITTEN")
            except Exception as e:
                print(f"ERROR_WRITING_METADATA: {e}")
    elif args.command == "commit":
        print(execute_commit(args.cwd))

if __name__ == "__main__":
    main()
