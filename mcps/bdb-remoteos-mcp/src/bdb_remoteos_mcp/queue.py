from __future__ import annotations

import hashlib
import hmac
import json
import sqlite3
import uuid
from datetime import datetime
from typing import Optional, List

from .schemas import ApprovalDecision, ApprovalRequestRecord, RiskLevel, default_expiry, utcnow

_SCHEMA = """
CREATE TABLE IF NOT EXISTS approval_queue (
    request_id TEXT PRIMARY KEY,
    requester_agent TEXT NOT NULL,
    risk_level TEXT NOT NULL,
    action_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    approved_by TEXT,
    approval_signature TEXT,
    executed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_status_expires ON approval_queue (status, expires_at);
"""


class ApprovalQueue:
    def __init__(self, db_path: str, signing_key: bytes) -> None:
        self.signing_key = signing_key
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA busy_timeout=5000")
        self.conn.executescript(_SCHEMA)
        self.expire_stale()

    def expire_stale(self) -> None:
        with self.conn:
            self.conn.execute(
                "UPDATE approval_queue SET status='expired'"
                " WHERE status='pending' AND expires_at <= ?",
                (utcnow().isoformat(),),
            )

    def enqueue(self, requester_agent: str, risk_level: RiskLevel, action_type: str, payload: dict) -> str:
        now = utcnow()
        request_id = f"req-{uuid.uuid4().hex[:8]}"
        record_payload = json.dumps(payload, sort_keys=True)
        with self.conn:
            self.conn.execute(
                "INSERT INTO approval_queue (request_id, requester_agent, risk_level,"
                " action_type, payload_json, status, created_at, expires_at)"
                " VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
                (
                    request_id,
                    requester_agent,
                    risk_level.value,
                    action_type,
                    record_payload,
                    now.isoformat(),
                    default_expiry(now).isoformat(),
                ),
            )
        return request_id

    def get(self, request_id: str) -> Optional[ApprovalRequestRecord]:
        row = self.conn.execute(
            "SELECT * FROM approval_queue WHERE request_id=?", (request_id,)
        ).fetchone()
        return self._to_record(row) if row else None

    def list_pending(self, status: str = "pending") -> List[ApprovalRequestRecord]:
        self.expire_stale()
        rows = self.conn.execute(
            "SELECT * FROM approval_queue WHERE status=? ORDER BY created_at DESC", (status,)
        ).fetchall()
        return [self._to_record(row) for row in rows]

    def pending_token(self, request_id: str) -> Optional[str]:
        """Issue the HMAC approval token for a still-pending request (admin flow)."""
        self.expire_stale()
        record = self.get(request_id)
        if record is None or record.status != "pending":
            return None
        return self._signature_for(record)

    def approve(self, token: str, approver: str) -> Optional[str]:
        """Atomically approve exactly one pending request matching the HMAC token."""
        self.expire_stale()
        rows = self.conn.execute(
            "SELECT * FROM approval_queue WHERE status='pending' ORDER BY created_at"
        ).fetchall()
        for row in rows:
            record = self._to_record(row)
            if hmac.compare_digest(self._signature_for(record), token):
                with self.conn:
                    cur = self.conn.execute(
                        "UPDATE approval_queue SET status='approved', approved_by=?,"
                        " approval_signature=? WHERE request_id=? AND status='pending'",
                        (approver, token, record.request_id),
                    )
                    if cur.rowcount == 1:
                        return record.request_id
                return None
        return None

    def claim_approved(self) -> Optional[ApprovalRequestRecord]:
        """Atomically claim one approved-but-not-yet-executed request."""
        row = self.conn.execute(
            "SELECT * FROM approval_queue WHERE status='approved' AND executed=0"
            " ORDER BY created_at LIMIT 1"
        ).fetchone()
        if row is None:
            return None
        record = self._to_record(row)
        with self.conn:
            cur = self.conn.execute(
                "UPDATE approval_queue SET executed=1 WHERE request_id=? AND executed=0",
                (record.request_id,),
            )
        if cur.rowcount == 1:
            return record
        return None

    def _signature_for(self, record: ApprovalRequestRecord) -> str:
        message = (
            f"{record.request_id}|{record.payload_json}|{record.expires_at.isoformat()}"
        ).encode()
        return hmac.new(self.signing_key, message, hashlib.sha256).hexdigest()

    @staticmethod
    def _to_record(row: sqlite3.Row) -> ApprovalRequestRecord:
        try:
            created = datetime.fromisoformat(row["created_at"])
        except (TypeError, ValueError):
            created = utcnow()
        try:
            expires = datetime.fromisoformat(row["expires_at"])
        except (TypeError, ValueError):
            expires = utcnow()
        return ApprovalRequestRecord(
            request_id=row["request_id"],
            requester_agent=row["requester_agent"],
            risk_level=RiskLevel(row["risk_level"]),
            action_type=row["action_type"],
            payload_json=row["payload_json"],
            status=row["status"],  # type: ignore[arg-type]
            created_at=created,
            expires_at=expires,
            approved_by=row["approved_by"],
            approval_signature=row["approval_signature"],
        )
