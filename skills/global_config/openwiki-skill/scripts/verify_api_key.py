#!/usr/bin/env python3
"""Verify an OpenWiki Gemini API key with retry + TLS fallback + model discovery.

Reads GEMINI_API_KEY (required) and OPENWIKI_MODEL (optional) from the
environment. If the configured model does not exist (404 NOT_FOUND), the
script discovers a valid generateContent-capable model via the models API
instead of failing. Prints VERIFIED_OK and exits 0 on success; prints a clear
error diagnosis and exits 1 on failure so callers never report a false
success for a key that cannot reach the API.
"""
import os
import sys


def find_available_model(client):
    """Return a generateContent-capable Gemini/Gemma model name or None."""
    try:
        for model in client.models.list():
            name = getattr(model, "name", "") or ""
            if not name.startswith("models/"):
                continue
            short = name.split("/", 1)[1]
            if not short.lower().startswith(("gemini", "gemma")):
                continue
            actions = getattr(model, "supported_actions", None) or []
            if not actions or "generateContent" in actions:
                return short
    except Exception:
        pass
    return None


def make_attempt(name, client_factory, model):
    client = client_factory()
    client.models.generate_content(model=model, contents="Say OK")
    print(f"Attempt ({name}) succeeded with model '{model}'")
    return True


def main():
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    configured_model = os.environ.get("OPENWIKI_MODEL", "").strip()

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

    def factory_secure():
        return genai.Client(api_key=api_key)

    def factory_no_tls():
        return genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(httpx_client=httpx.Client(verify=False)),
        )

    probe = factory_secure()
    discovered_model = find_available_model(probe)
    if discovered_model:
        print(f"Discovered available model: {discovered_model}")

    models_to_try = []
    if configured_model:
        models_to_try.append(configured_model)
    models_to_try.append("gemini-2.0-flash")
    if discovered_model and discovered_model not in models_to_try:
        models_to_try.append(discovered_model)

    attempt_specs = []
    for model in models_to_try:
        attempt_specs.append(("secure TLS", model))
        attempt_specs.append(("secure TLS (retry)", model))
        attempt_specs.append(("TLS verification disabled", model))

    for label, model in attempt_specs:
        factory = factory_secure if "TLS verification disabled" not in label else factory_no_tls
        try:
            make_attempt(label, factory, model)
            print("VERIFIED_OK")
            return 0
        except Exception as e:
            msg = (str(e) or e.__class__.__name__).strip()
            print(f"Attempt ({label}, model '{model}') failed: {msg[:400]}")

    print("VERIFICATION_FAILED")
    print("Possible causes:")
    print("  1. The API key is invalid or revoked (400 API_KEY_INVALID).")
    print("  2. No generateContent-capable Gemini/Gemma model is available to this key (404 NOT_FOUND).")
    print("  3. Network/firewall is blocking generativelanguage.googleapis.com.")
    print("  4. TLS/SSL certificate validation issue (last attempt disabled verification).")
    print("The daemon will run in collect-only mode until a valid key/model is configured.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
