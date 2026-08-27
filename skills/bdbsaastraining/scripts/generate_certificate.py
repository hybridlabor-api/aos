#!/usr/bin/env python3
"""
Certificate PDF Generator for /bdbsaastraining
Renders certificate_template.html to PDF using Playwright Chromium.

Prerequisites (werden vor dem Rendern geprüft):
  - Python-Paket 'playwright'         →  uv run --with playwright python <script> ...
  - Chromium/Chrome für Playwright    →  playwright install chromium
Fehlen sie, gibt das Skript eine klare Anleitung statt eines Tracebacks.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from datetime import datetime
from pathlib import Path

TRACK_LABELS = {
    "A": "AI-Agent Sandbox Engineering",
    "B": "WordPress / Web-App Hosting",
    "C": "Mailserver (Froxlor / Postfix / Dovecot)",
    "D": "Clean Debian · Datenbank & Worker",
    "E": "Custom Workload Engineering",
}


def check_prerequisites() -> list[str]:
    """Gibt eine Liste menschenlesbarer Probleme zurück (leer = alles ok)."""
    problems: list[str] = []
    try:
        import playwright  # noqa: F401
    except ImportError:
        problems.append(
            "Python-Paket 'playwright' fehlt.\n"
            "   Fix:  uv run --with playwright python "
            f"{Path(__file__).name} \"<Name>\" --score <N> --track <A-E>\n"
            "   oder: pip install playwright"
        )
        return problems  # ohne playwright bringt der Rest nichts

    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            ok = False
            for launch in (
                lambda: p.chromium.launch(channel="chrome", args=["--no-sandbox"]),
                lambda: p.chromium.launch(args=["--no-sandbox"]),
            ):
                try:
                    b = launch()
                    b.close()
                    ok = True
                    break
                except Exception:
                    continue
            if not ok:
                problems.append(
                    "Kein Chromium/Chrome für Playwright gefunden.\n"
                    "   Fix:  playwright install chromium"
                )
    except Exception as exc:  # pragma: no cover
        problems.append(f"Playwright-Startfehler: {exc}\n   Fix:  playwright install chromium")
    return problems


def generate_certificate_pdf(
    candidate_name: str,
    score: int = 10,
    max_score: int = 10,
    track: str | None = None,
    output_dir: str = "production_artifacts/certificates",
) -> str:
    template_path = Path(__file__).parent.parent / "templates" / "certificate_template.html"
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found at: {template_path}")

    template_html = template_path.read_text(encoding="utf-8")

    now = datetime.now()
    issue_date = now.strftime("%Y-%m-%d")
    percentage = int((score / max_score) * 100)

    track = (track or "").upper().strip()
    track_label = TRACK_LABELS.get(track, "General SaaS Host Administration")
    track_line = f"Track {track} · {track_label}" if track in TRACK_LABELS else track_label

    raw_hash = f"{candidate_name}:{issue_date}:{score}:{percentage}:{track or '-'}:BDB-AGENT-OS"
    cert_id = f"BDB-SAAS-{hashlib.sha256(raw_hash.encode()).hexdigest()[:8].upper()}"

    rendered_html = (
        template_html.replace("{{ candidate_name }}", candidate_name)
        .replace("{{ issue_date }}", issue_date)
        .replace("{{ score }}", str(score))
        .replace("{{ percentage }}", str(percentage))
        .replace("{{ cert_id }}", cert_id)
        .replace("{{ track_line }}", track_line)
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate BDB SaaS Host Administrator PDF Certificate")
    parser.add_argument("name", help="Candidate Name (e.g. 'Noah Becker')")
    parser.add_argument("--score", type=int, default=10, help="Exam score 0..10 (default: 10)")
    parser.add_argument("--track", default=None, choices=list(TRACK_LABELS) + [c.lower() for c in TRACK_LABELS],
                        help="Absolvierte Trainingsspur A-E")
    parser.add_argument("--out", default="production_artifacts/certificates", help="Output directory")
    parser.add_argument("--skip-check", action="store_true", help="Prerequisite-Check überspringen")
    args = parser.parse_args()

    if args.score < 8:
        print(f"⚠️  Score {args.score}/10 < 8 — Bestehensgrenze nicht erreicht. Kein Zertifikat.", file=sys.stderr)
        return 2

    if not args.skip_check:
        problems = check_prerequisites()
        if problems:
            print("❌ Zertifikat kann nicht erzeugt werden — fehlende Voraussetzungen:\n", file=sys.stderr)
            for pr in problems:
                print(f" • {pr}\n", file=sys.stderr)
            return 1

    pdf_path = generate_certificate_pdf(args.name, args.score, track=args.track, output_dir=args.out)
    print(f"✅ Zertifikat erzeugt:\n{pdf_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
