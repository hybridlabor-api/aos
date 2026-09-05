#!/usr/bin/env python3
"""
Sync and aggregate all .openwiki and openwiki folders from all ~/dev repositories
into a unified ~/.openwiki/ecosystem-wiki for master graph visualization.
"""
import os
import shutil
from pathlib import Path

dev_root = Path.home() / "dev"
target_root = Path.home() / ".openwiki" / "ecosystem-wiki"

if target_root.exists():
    shutil.rmtree(target_root)
target_root.mkdir(parents=True, exist_ok=True)

count_repos = 0
count_files = 0

for root, dirs, files in os.walk(dev_root):
    dirs[:] = [d for d in dirs if d not in ["node_modules", ".git", ".venv", "dist", "build", ".worktrees"]]
    for d in list(dirs):
        if d in [".openwiki", "openwiki"] and "tools/openwiki" not in root:
            repo_dir = Path(root)
            wiki_dir = repo_dir / d
            rel_repo = repo_dir.relative_to(dev_root)
            dest_dir = target_root / rel_repo
            dest_dir.mkdir(parents=True, exist_ok=True)
            
            md_files = [f for f in wiki_dir.glob("*.md") if not f.name.startswith(".")]
            if md_files:
                count_repos += 1
                for f in md_files:
                    shutil.copy2(f, dest_dir / f.name)
                    count_files += 1

# Generate master index.md linking all nodes
index_file = target_root / "index.md"
lines = [
    "---",
    "type: hub",
    "title: BDB Ecosystem Master Knowledge Graph",
    "description: Central hub linking all 31 BDB repositories and documentation pages.",
    "tags: [bdb, ecosystem, architecture, overview]",
    "---",
    "",
    "# BDB Agent OS Ecosystem Master Wiki",
    "",
    "Welcome to the central knowledge hub across all active BDB repositories.",
    "",
    "## Repositories by Category",
    ""
]

categories = sorted([d for d in target_root.iterdir() if d.is_dir()])
for cat in categories:
    lines.append(f"### {cat.name.upper()}")
    repos = sorted([r for r in cat.iterdir() if r.is_dir()])
    for repo in repos:
        mds = sorted(list(repo.glob("*.md")))
        if mds:
            page_links = [f"[{m.stem.replace('_', ' ').title()}]({m.relative_to(target_root)})" for m in mds]
            lines.append(f"- **{repo.name}**: " + ", ".join(page_links))
    lines.append("")

with open(index_file, "w") as f:
    f.write("\n".join(lines))

print(f"Aggregated {count_files} pages across {count_repos} repos into {target_root}")
