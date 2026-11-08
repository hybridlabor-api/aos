"""Where the MCP server looks for Blender's address.

Multi-instance workflows (#358) run one Blender per job, so the address has to be
settable per MCP client entry. Client configs pass a plain `args` list far more
easily than per-entry env vars, hence --host/--port on top of BLENDER_HOST/PORT.

The precedence chain -- CLI flags > environment > defaults -- is the contract these
tests pin, along with the two ways a user silently ends up on the wrong instance:
an unparseable BLENDER_PORT, and a mistyped flag that argparse would otherwise drop.
"""

import pytest

from blender_mcp.server import (
    DEFAULT_HOST,
    DEFAULT_PORT,
    parse_connection_args,
    resolve_connection,
)


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    """Never inherit a real BLENDER_HOST/PORT from the developer's shell."""
    monkeypatch.delenv("BLENDER_HOST", raising=False)
    monkeypatch.delenv("BLENDER_PORT", raising=False)


def test_defaults_when_nothing_is_configured():
    assert resolve_connection() == (DEFAULT_HOST, DEFAULT_PORT)


def test_environment_overrides_defaults(monkeypatch):
    monkeypatch.setenv("BLENDER_HOST", "host.docker.internal")
    monkeypatch.setenv("BLENDER_PORT", "9999")
    assert resolve_connection() == ("host.docker.internal", 9999)


def test_cli_overrides_environment(monkeypatch):
    monkeypatch.setenv("BLENDER_HOST", "host.docker.internal")
    monkeypatch.setenv("BLENDER_PORT", "9999")
    assert resolve_connection("localhost", 9877) == ("localhost", 9877)


def test_cli_host_and_port_override_independently(monkeypatch):
    # Targeting a second local instance means passing --port alone; the env
    # host must survive that, and vice versa.
    monkeypatch.setenv("BLENDER_HOST", "10.0.0.5")
    monkeypatch.setenv("BLENDER_PORT", "9999")
    assert resolve_connection(cli_port=9877) == ("10.0.0.5", 9877)
    assert resolve_connection(cli_host="localhost") == ("localhost", 9999)


def test_port_zero_from_cli_is_respected(monkeypatch):
    # Guards the `is not None` check against a truthiness regression.
    monkeypatch.setenv("BLENDER_PORT", "9999")
    assert resolve_connection(cli_port=0) == (DEFAULT_HOST, 0)


def test_unparseable_env_port_falls_back_instead_of_crashing(monkeypatch):
    # Previously an int() straight on the env var, so a bad value raised
    # ValueError from inside the first tool call rather than at startup.
    monkeypatch.setenv("BLENDER_PORT", "not-a-port")
    assert resolve_connection() == (DEFAULT_HOST, DEFAULT_PORT)


def test_empty_env_port_falls_back(monkeypatch):
    monkeypatch.setenv("BLENDER_PORT", "")
    assert resolve_connection() == (DEFAULT_HOST, DEFAULT_PORT)


def test_parses_flags_from_argv():
    assert parse_connection_args(["--host", "localhost", "--port", "9877"]) == (
        "localhost",
        9877,
    )


def test_no_flags_yields_no_override():
    assert parse_connection_args([]) == (None, None)


def test_unknown_args_are_ignored_not_fatal():
    # MCP clients may append their own arguments to the server command; an
    # unrecognised one must not stop the server from starting.
    assert parse_connection_args(["--some-client-flag", "--port", "9877"]) == (
        None,
        9877,
    )


def test_mistyped_flag_is_reported(caplog):
    # --prot would otherwise be dropped in silence and the user would connect
    # to the default port, looking like the flag simply had no effect.
    with caplog.at_level("WARNING"):
        host, port = parse_connection_args(["--prot", "9877"])
    assert (host, port) == (None, None)
    assert "--prot" in caplog.text
