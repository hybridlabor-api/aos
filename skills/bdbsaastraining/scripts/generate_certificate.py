#!/usr/bin/env python3
"""
Certificate PDF Generator for /bdbsaastraining
Renders certificate_template.html to PDF using Playwright Chromium.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from datetime import datetime
from pathlib import Path


def generate_certificate_pdf(
    candidate_name: str,
    score: int = 10,
    max_score: int = 10,
    output_dir: str = "production_artifacts/certificates",
) -> str:
    template_path = Path(__file__).parent.parent / "templates" / "certificate_template.html"
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found at: {template_path}")

    template_html = template_path.read_text(encoding="utf-8")

    now = datetime.now()
    issue_date = now.strftime("%Y-%m-%d")
    percentage = int((score / max_score) * 100)
    
    # Generate cryptographic certificate ID
    raw_hash = f"{candidate_name}:{issue_date}:{score}:{percentage}:BDB-AGENT-OS"
    cert_id = f"BDB-SAAS-{hashlib.sha256(raw_hash.encode()).hexdigest()[:8].upper()}"

    # Replace template placeholders
    rendered_html = (
        template_html.replace("{{ candidate_name }}", candidate_name)
        .replace("{{ issue_date }}", issue_date)
        .replace("{{ score }}", str(score))
        .replace("{{ percentage }}", str(percentage))
        .replace("{{ cert_id }}", cert_id)
    )

    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    safe_name = candidate_name.lower().replace(" ", "_")
    output_pdf = out_dir / f"BDB_SaaS_Admin_Certificate_{safe_name}.pdf"
    temp_html = out_dir / f"temp_{safe_name}.html"
    temp_html.write_text(rendered_html, encoding="utf-8")

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="chrome", args=["--no-sandbox", "--disable-setuid-sandbox"])
        except Exception:
            browser = p.chromium.launch(args=["--no-sandbox", "--disable-setuid-sandbox"])
        page = browser.new_page()
        page.goto(f"file://{temp_html.resolve()}", wait_until="networkidle")
        page.pdf(
            path=str(output_pdf.resolve()),
            format="A4",
            landscape=True,
            print_background=True,
            margin={"top": "0mm", "bottom": "0mm", "left": "0mm", "right": "0mm"},
        )
        browser.close()

    if temp_html.exists():
        temp_html.unlink()

    return str(output_pdf.resolve())


def main():
    parser = argparse.ArgumentParser(description="Generate BDB SaaS Host Administrator PDF Certificate")
    parser.add_argument("name", help="Candidate Name (e.g. 'Noah' or 'TKD')")
    parser.add_argument("--score", type=int, default=10, help="Exam score (default: 10)")
    parser.add_argument("--out", default="production_artifacts/certificates", help="Output directory")
    args = parser.parse_args()

    pdf_path = generate_certificate_pdf(args.name, args.score, output_dir=args.out)
    print(f"✅ Certificate PDF generated successfully at:\n{pdf_path}")


if __name__ == "__main__":
    main()
