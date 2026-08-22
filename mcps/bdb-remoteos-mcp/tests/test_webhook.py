from __future__ import annotations

import hashlib
import hmac
import json

import httpx
import pytest

from bdb_remoteos_mcp import webhook
from bdb_remoteos_mcp.schemas import ApprovalRequestRecord, RiskLevel, utcnow


def _record() -> ApprovalRequestRecord:
    from datetime import timedelta

    now = utcnow()
    return ApprovalRequestRecord(
        request_id="req-abc123",
        requester_agent="overwatch-agent",
        risk_level=RiskLevel.HIGH,
        action_type="container_delete",
        payload_json='{"container_name": "kunde-1"}',
        status="pending",
        created_at=now,
        expires_at=now + timedelta(minutes=15),
    )


def test_dispatch_signs_and_sends(monkeypatch):
    sent: dict = {}

    def fake_post(url, content=None, headers=None, timeout=None):
        sent.update({"url": url, "body": content, "headers": headers})
        return httpx.Response(204)

    monkeypatch.setattr(webhook.httpx, "post", fake_post)
    monkeypatch.setattr(webhook, "webhook_url", lambda: "https://discord.example/webhook")

    key = b"secret"
    ok = webhook.dispatch_alert(_record(), {"container_name": "kunde-1"}, key)

    assert ok is True
    assert sent["url"] == "https://discord.example/webhook"
    expected_sig = hmac.new(key, sent["body"], hashlib.sha256).hexdigest()
    assert sent["headers"]["X-RemoteOS-Signature"] == expected_sig
    assert "kunde-1" in json.loads(sent["body"])["content"]


def test_dispatch_disabled_without_env(monkeypatch):
    monkeypatch.setattr(webhook, "webhook_url", lambda: "")
    assert webhook.dispatch_alert(_record(), {}, b"k") is False


def test_dispatch_swallows_http_error(monkeypatch):
    def fake_post(*a, **kw):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(webhook.httpx, "post", fake_post)
    monkeypatch.setattr(webhook, "webhook_url", lambda: "https://discord.example/webhook")
    assert webhook.dispatch_alert(_record(), {}, b"k") is False
