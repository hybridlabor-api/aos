# Automated CI/CD GitHub Pages Deployment Guide

This document details the automated pipeline for hosting, updating, and verifying standalone documentation sites via GitHub Pages and GitHub Actions.

---

## 🏗️ Architecture & Pipeline Flow

```
Push to main (docs/**) ──▶ GitHub Actions (deploy-docs.yml) ──▶ Upload Artifact (docs/) ──▶ Deploy to Pages ──▶ Live URL (https://<owner>.github.io/<repo>/)
```

---

## 📋 Step-by-Step Implementation

### Step 1: Directory Layout
All static files, assets, and the main entrypoint must live inside `docs/`:
```text
your-repo/
├── .github/
│   └── workflows/
│       └── deploy-docs.yml       # Automated CI/CD Pipeline
├── docs/
│   ├── index.html                # Main documentation entrypoint
│   ├── .nojekyll                 # Disables Jekyll processing (mandatory for raw HTML/CSS)
│   ├── CNAME                     # Optional: Custom domain (e.g. docs.yourdomain.com)
│   └── assets/                   # Optional: images, icons
└── README.md                     # Links and live status badges
```

---

### Step 2: GitHub Actions Workflow (`deploy-docs.yml`)
Copy the turnkey template from `templates/deploy-docs.yml` into `.github/workflows/deploy-docs.yml`.

**Key Capabilities:**
- **Path-Filtered Triggers:** Only runs when files in `docs/**` or the workflow itself change, preventing unnecessary runner minute usage.
- **Concurrency Control:** `group: "pages"` ensures subsequent pushes gracefully queue or deploy without race conditions.
- **Least-Privilege Permissions:**
  - `contents: read`: Clones repository.
  - `pages: write`: Writes to GitHub Pages environment.
  - `id-token: write`: OIDC token for secure environment authentication.

---

### Step 3: Programmatic Activation via GitHub CLI
Run this one-liner to switch the repository from legacy Jekyll build to modern GitHub Actions workflow deployment:

```bash
gh api -X PUT repos/<owner>/<repo>/pages -f build_type=workflow
```

If GitHub Pages is not yet created on the repo, initialize it first:
```bash
gh api -X POST repos/<owner>/<repo>/pages -f "source[branch]=main" -f "source[path]=/docs"
gh api -X PUT repos/<owner>/<repo>/pages -f build_type=workflow
```

---

### Step 4: Dispatch & Verify
Trigger the pipeline manually or push a commit:
```bash
# Trigger workflow
gh workflow run deploy-docs.yml

# Watch real-time execution in terminal
gh run watch --exit-status

# Verify HTTP 200 on live endpoint
curl -sI https://<owner>.github.io/<repo>/
```

---

### Step 5: README Badge & Header Integration
Add the status badges and live URL link to the project `README.md`:
```markdown
[![Documentation](https://img.shields.io/badge/Docs-Live%20Manual-blue?style=flat-square&logo=github)](https://<owner>.github.io/<repo>/)

> 🌐 **Live User Manual & Interactive Guide:** [https://<owner>.github.io/<repo>/](https://<owner>.github.io/<repo>/)
```
