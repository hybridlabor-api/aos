from __future__ import annotations

import os
import pytest
from bdb_remoteos_mcp.server import (
    remoteos_get_system_status,
    remoteos_add_route,
    remoteos_approval_queue_list,
)


def test_mcp_system_status():
    res = remoteos_get_system_status()
    assert res["status"] == "online"
    assert res["service"] == "bdb-remoteos-mcp"


def test_mcp_add_route():
    res = remoteos_add_route("test.example.com", 3000, require_auth=True)
    assert res["status"] == "executed"
    assert res["route"]["domain"] == "test.example.com"
    assert res["route"]["upstream_port"] == 3000


def test_mcp_approval_queue_list():
    res = remoteos_approval_queue_list("pending")
    assert isinstance(res, list)
