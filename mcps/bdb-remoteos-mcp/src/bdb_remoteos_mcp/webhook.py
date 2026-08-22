from __future__ import annotations

import hashlib
import hmac
import json
import os
from typing import Any

import httpx

from .schemas import ApprovalRequestRecord


def webhook_url() -> str:
    return os.environ.get("REMOTEOS_WEBHOOK_URL") or os.environ.get("GATEKEEPER_WEBHOOK_URL") or ""


def sign_payload(body: bytes, key: bytes) -> str:
    return hmac.new(key, body, hashlib.sha256).hexdigest()


def build_alert(record: ApprovalRequestRecord, payload: dict) -> dict[str, Any]:
    target = payload.get("container_name") or payload.get("client_name") or "unknown"
    return {
        "content": (
            f"⚠️ **BDB RemoteOS Approval Alert**\n"
            f"Agent `{record.requester_agent}` requests "
            f"`{record.action_type}` on `{target}` "
            f"(Risk: {record.risk_level.value}).\n"
            f"Request `{record.request_id}` expires at {record.expires_at.isoformat()}Z."
        )
    }


def dispatch_alert(record: ApprovalRequestRecord, payload: dict, signing_key: bytes) -> bool:
    url = webhook_url()
    if not url:
        return False
    body = json.dumps(build_alert(record, payload), separators=(",", ":")).encode()
    signature = sign_payload(body, signing_key)
    try:
        response = httpx.post(
            url,
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Gatekeeper-Signature": signature,
                "X-RemoteOS-Signature": signature,
            },
            timeout=10.0,
        )
        return response.status_code < 300
    except httpx.HTTPError:
        return False
