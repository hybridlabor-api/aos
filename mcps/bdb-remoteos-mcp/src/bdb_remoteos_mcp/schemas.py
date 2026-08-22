from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field, constr

ContainerName = constr(pattern=r"^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])?$")


class RiskLevel(str, Enum):
    LOW = "low"
    STAGING = "staging"
    MEDIUM = "medium"
    HIGH = "high"


class ContainerTemplate(str, Enum):
    FROXLOR_MAIL = "froxlor-mail"
    AI_AGENT = "ai-agent"
    WORDPRESS = "wordpress"
    DEBIAN_CLEAN = "debian-clean"


class CreateContainerRequest(BaseModel):
    client_name: ContainerName = Field(..., description="Kundenname im Kebab-Case")
    domain: Optional[str] = None
    template: ContainerTemplate = ContainerTemplate.FROXLOR_MAIL
    environment: Literal["staging1", "production"] = "staging1"
    cpu_cores: int = Field(2, ge=1, le=4)
    ram_gb: int = Field(4, ge=1, le=8)
    disk_gb: int = Field(40, ge=10, le=100)


class ManageContainerRequest(BaseModel):
    container_name: ContainerName
    action: Literal["start", "stop", "restart", "delete"]
    reason: str = Field(..., min_length=5)


class AddRouteRequest(BaseModel):
    domain: str
    upstream_port: int = Field(..., ge=1, le=65535)
    require_auth: bool = True
    email: Optional[str] = None


class ApprovalDecision(BaseModel):
    token: str


class ApprovalRequestRecord(BaseModel):
    request_id: str
    requester_agent: str
    risk_level: RiskLevel
    action_type: str
    payload_json: str
    status: Literal["pending", "approved", "rejected", "expired"]
    created_at: datetime
    expires_at: datetime
    approved_by: Optional[str] = None
    approval_signature: Optional[str] = None


APPROVAL_TTL_MINUTES = 15

DESTRUCTIVE_ACTIONS = frozenset({"delete"})
MEDIUM_RISK_ACTIONS = frozenset({"restart"})


def classify_risk(req: CreateContainerRequest | ManageContainerRequest) -> RiskLevel:
    if isinstance(req, ManageContainerRequest):
        if req.action in DESTRUCTIVE_ACTIONS:
            return RiskLevel.HIGH
        if req.action in MEDIUM_RISK_ACTIONS:
            return RiskLevel.MEDIUM
        return RiskLevel.STAGING
    if req.environment == "production":
        return RiskLevel.HIGH
    return RiskLevel.STAGING


def default_expiry(now: datetime) -> datetime:
    return now + timedelta(minutes=APPROVAL_TTL_MINUTES)


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def gateway_api_key() -> str:
    return os.environ.get("REMOTEOS_API_KEY") or os.environ.get("GATEKEEPER_API_KEY") or "dev-local-key"
