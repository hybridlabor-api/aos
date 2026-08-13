#!/usr/bin/env python3
"""Verify an OpenWiki Gemini API key with retry + TLS fallback.

Reads GEMINI_API_KEY (required) and OPENWIKI_MODEL (optional) from the
environment. Prints VERIFIED_OK and exits 0 on success; prints a clear
error diagnosis and exits 1 on failure so callers never report a false
success for a key that cannot reach the API.
"""
import os
import sys


def main():
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    model = os.environ.get("OPENWIKI_MODEL", "").strip() or "gemma-4-12b-it"

    if not api_key:
        print("ERROR: GEMINI_API_KEY is empty - nothing to verify.")
        return 1

    try:
        from google import genai
        from google.genai import types
        import httpx
    except ImportError as e:
        print(f"ERROR: google-genai / httpx not installed: {e}")
        print("       Run: pip install google-genai")
        return 1

    attempts = [
        ("secure TLS", lambda: genai.Client(api_key=api_key)),
        ("secure TLS (retry)", lambda: genai.Client(api_key=api_key)),
        ("TLS verification disabled", lambda: genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(httpx_client=httpx.Client(verify=False)),
        )),
    ]

    for name, factory in attempts:
        try:
            client = factory()
            client.models.generate_content(model=model, contents="Say OK")
            print("VERIFIED_OK")
            return 0
        except Exception as e:
            msg = (str(e) or e.__class__.__name__).strip()
            print(f"Attempt ({name}) failed: {msg[:400]}")

    print("VERIFICATION_FAILED")
    print("Possible causes:")
    print("  1. The API key is invalid, revoked, or has no access to the configured model.")
    print("  2. Network/firewall is blocking generativelanguage.googleapis.com.")
    print("  3. TLS/SSL certificate validation issue (last attempt disabled verification).")
    print("The daemon will run in collect-only mode until a valid key is configured.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
