#!/usr/bin/env python3
"""
Sync and aggregate all .openwiki and openwiki folders from all ~/dev repositories
into a cleanly clustered, hierarchical star-tree topology for the OpenWiki visualizer.
"""
import os
import shutil
from pathlib import Path

dev_root = Path.home() / "dev"
target_root = Path.home() / ".openwiki" / "ecosystem-wiki"

if target_root.exists():
    shutil.rmtree(target_root)
target_root.mkdir(parents=True, exist_ok=True)

CATEGORIES = ["bdb-dev", "web", "agents", "media", "ubiquiti", "vendor", "sandbox"]
category_repos = {cat: {} for cat in CATEGORIES}

for root, dirs, files in os.walk(dev_root):
    dirs[:] = [d for d in dirs if d not in ["node_modules", ".git", ".venv", "dist", "build", ".worktrees"]]
    for d in list(dirs):
        if d in [".openwiki", "openwiki"] and "tools/openwiki" not in root:
            repo_dir = Path(root)
            wiki_dir = repo_dir / d
            rel_repo = repo_dir.relative_to(dev_root)
            parts = rel_repo.parts
            if not parts:
                continue
            cat = parts[0]
            if cat not in category_repos:
                category_repos[cat] = {}
            repo_name = "/".join(parts[1:]) if len(parts) > 1 else parts[0]
            
            md_files = [f for f in wiki_dir.glob("*.md") if not f.name.startswith(".")]
            if md_files:
                category_repos[cat][repo_name] = (repo_dir, md_files)

def clean_title_and_type(stem, repo_name):
    stem_lower = stem.lower()
    if "quickstart" in stem_lower:
        doc_type = "Quickstart"
        doc_label = "Quickstart"
    elif "arch" in stem_lower:
        doc_type = "Architecture"
        doc_label = "Architecture"
    elif "release" in stem_lower or "changelog" in stem_lower:
        doc_type = "Release Notes"
        doc_label = "Changelog"
    elif "decision" in stem_lower or "adr" in stem_lower:
        doc_type = "Decisions"
        doc_label = "Decisions"
    elif "health" in stem_lower or "report" in stem_lower:
        doc_type = "Health Report"
        doc_label = "Health"
    else:
        doc_type = "Guide"
        doc_label = stem.replace("_", " ").replace("-", " ").title()
        if len(doc_label) > 20:
            doc_label = doc_label[:18] + "…"
    
    clean_repo = Path(repo_name).name
    title = f"{clean_repo} – {doc_label}"
    return title, doc_type

total_pages = 0

for cat, repos in category_repos.items():
    if not repos:
        continue
    cat_dir = target_root / cat
    cat_dir.mkdir(parents=True, exist_ok=True)
    
    for repo_name, (repo_path, md_files) in repos.items():
        repo_target_dir = cat_dir / repo_name
        repo_target_dir.mkdir(parents=True, exist_ok=True)
        primary_file = next((f for f in md_files if "quickstart" in f.name.lower()), md_files[0])
        
        for f in md_files:
            content = f.read_text(encoding="utf-8", errors="ignore")
            title, doc_type = clean_title_and_type(f.stem, repo_name)
            
            body = content
            if body.startswith("---"):
                end = body.find("\n---", 3)
                if end != -1:
                    body = body[end + 4:].strip()
            
            if f == primary_file:
                sub_links = []
                for sub in md_files:
                    if sub != primary_file:
                        sub_title, _ = clean_title_and_type(sub.stem, repo_name)
                        sub_links.append(f"[{sub_title}]({sub.name})")
                
                nav_bar = f"\n\n---\n**Domain Hub**: [Category: {cat.upper()}](../index.md)"
                if sub_links:
                    nav_bar += "\n\n**Topics in this repository**:\n" + "\n".join(f"- {l}" for l in sub_links)
            else:
                prim_title, _ = clean_title_and_type(primary_file.stem, repo_name)
                nav_bar = f"\n\n---\n**Navigation**: [← {prim_title}]({primary_file.name}) | [Category: {cat.upper()}](../index.md)"
            
            new_frontmatter = (
                f"---\n"
                f"type: {doc_type}\n"
                f"title: \"{title}\"\n"
                f"description: {doc_type} documentation for {repo_name}.\n"
                f"tags: [{cat}, {Path(repo_name).name}, {doc_type.lower().replace(' ', '-')}]\n"
                f"---\n\n"
            )
            
            final_content = new_frontmatter + body + nav_bar
            dest_file = repo_target_dir / f.name
            dest_file.write_text(final_content, encoding="utf-8")
            total_pages += 1
            
    cat_index = cat_dir / "index.md"
    cat_lines = [
        "---",
        "type: Cluster",
        f"title: \"Domain: {cat.upper()}\"",
        f"description: Domain hub for {len(repos)} repositories in {cat}.",
        f"tags: [{cat}, cluster-hub]",
        "---",
        "",
        f"# {cat.upper()} Architecture Domain",
        "",
        f"Contains **{len(repos)} active repositories**.",
        "",
        f"[← Master Ecosystem Hub](../index.md)",
        "",
        "## Repositories in this Domain",
        ""
    ]
    for repo_name in sorted(repos.keys()):
        _, md_files = repos[repo_name]
        primary_file = next((f for f in md_files if "quickstart" in f.name.lower()), md_files[0])
        prim_title, _ = clean_title_and_type(primary_file.stem, repo_name)
        rel = f"{repo_name}/{primary_file.name}"
        cat_lines.append(f"- **[{Path(repo_name).name}]({rel})** — {len(md_files)} pages")
        
    cat_index.write_text("\n".join(cat_lines), encoding="utf-8")
    total_pages += 1

root_index = target_root / "index.md"
root_lines = [
    "---",
    "type: Hub",
    "title: \"BDB Agent OS – Master Ecosystem\"",
    "description: Central hub for all 31 repositories across 7 domains.",
    "tags: [bdb, master-hub]",
    "---",
    "",
    "# BDB Agent OS – Ecosystem Architecture",
    "",
    "Central topology hub connecting all 7 architecture domains and 31 repositories:",
    ""
]

for cat in sorted(category_repos.keys()):
    repos = category_repos[cat]
    if not repos:
        continue
    root_lines.append(f"- **[{cat.upper()} Domain]({cat}/index.md)** — {len(repos)} repositories")

root_lines.append("")
root_index.write_text("\n".join(root_lines), encoding="utf-8")
total_pages += 1

print(f"Generated clean tree topology with {total_pages} pages!")
